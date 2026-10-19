import Decimal from "break_infinity.js";
import { resetRunStores } from "../simulation/reset-game-stores";
import { useExitsStore } from "../state/exits.store";
import { useGenerationStore } from "../state/generation.store";
import { useFounderStore } from "../state/founder.store";
import { usePrestigeStore } from "../state/prestige.store";
import { useSessionStore } from "../state/session.store";
import { useValuationStore } from "../state/valuation.store";
import { computeEquityMultipliers } from "./modifiers";
import { termBonusNow } from "./term-sheets";

/**
 * Company Acquisition (prestige) economics. You "sell" the company once you've
 * built enough total accrued valuation, banking permanent Equity scaled with
 * diminishing returns, then start a fresh company keeping only your Equity +
 * skill tree. Constants are tunable; the UI previews the exact payout.
 */

/** Minimum accrued valuation before an acquisition offer is available. */
export const ACQUISITION_THRESHOLD = 1000;
/** Equity granted exactly at the threshold — enough for ~5 starter nodes
 * (the first five nodes cost 1+2+3+4+5 = 15). */
const EQUITY_BASE = 15;
/** Diminishing-returns exponent on (accrued / threshold). */
const EQUITY_EXP = 0.5;

/**
 * THE TOWN'S BONUS on a sale: a company that built a good town sells for
 * more. The map says how much through a registered reader — houses grown,
 * services, wonders — and with no map registered there is none.
 * @see setTownBonusReader, townBonusOf
 */
let townBonus: (() => number) | null = null;

/** Tell the acquisition how to ask the map for its bonus; returns a function that stops it. */
export function setTownBonusReader(read: () => number): () => void {
  townBonus = read;
  return () => { if (townBonus === read) townBonus = null; };
}

/** The town's bonus as a share, 0 to `TOWN_BONUS_CAP`. */
export const townBonusNow = (): number => Math.max(0, Math.min(TOWN_BONUS_CAP, townBonus?.() ?? 0));

/** The most a town adds to a sale. */
export const TOWN_BONUS_CAP = 0.5;

/**
 * Equity an acquisition would pay for a given total accrued valuation.
 * `floor(BASE · (accrued / THRESHOLD)^EXP)`, zero below the threshold.
 */
export function equityForAccrued(accrued: Decimal): Decimal {
  if (accrued.lt(ACQUISITION_THRESHOLD)) return new Decimal(0);
  // Clamp before toNumber() — break_infinity Decimals beyond ~1.8e308 would
  // produce Infinity, which propagates through Math.pow and Math.floor,
  // yielding Infinity equity and making all skill-tree nodes appear free.
  const ratio = Math.min(accrued.div(ACQUISITION_THRESHOLD).toNumber(), 1e200);
  const eq = computeEquityMultipliers();
  const mandateEquityBoost = useValuationStore.getState().getEconomyMultipliers().equityBoost;
  return new Decimal(
    Math.floor(EQUITY_BASE * Math.pow(ratio, EQUITY_EXP) * eq.prestige * (1 + eq.juice) * mandateEquityBoost * (1 + townBonusNow()) * (1 + termBonusNow())),
  );
}

/**
 * Inverse of {@link equityForAccrued}: the total accrued valuation needed for an
 * acquisition offer of `targetEquity` (accounting for the equity multiplier).
 * Used to show progress toward the next Equity point.
 */
export function accruedForEquity(targetEquity: number): Decimal {
  if (targetEquity <= 0) return new Decimal(0);
  const eq = computeEquityMultipliers();
  const ratio = Math.pow(
    targetEquity / (EQUITY_BASE * eq.prestige * (1 + eq.juice) * (1 + townBonusNow()) * (1 + termBonusNow())),
    1 / EQUITY_EXP,
  );
  return new Decimal(ACQUISITION_THRESHOLD * ratio);
}

/** Equity the player would earn if they acquired right now. */
export function pendingEquity(): Decimal {
  return equityForAccrued(useValuationStore.getState().accruedThisRun);
}

/** Whether an acquisition offer is currently available (worth ≥ 1 Equity). */
export function canAcquire(): boolean {
  return pendingEquity().gt(0);
}

/**
 * Accept the acquisition offer: bank the Equity, then soft-reset the run
 * (founder cleared → the app drops back to founder-select for the next
 * company; prestige + skill tree are preserved). No-op if not eligible.
 * Returns the Equity banked (0 if it didn't fire).
 */
function executeAcquisition(equityMultiplier = 1): Decimal {
  const gain = pendingEquity();
  if (gain.lte(0)) return new Decimal(0);

  const founderId = useFounderStore.getState().selectedFounderId;
  if (!founderId) return new Decimal(0);

  const accrued = useValuationStore.getState().accruedThisRun;
  const equityGain = equityMultiplier !== 1 ? gain.mul(equityMultiplier).floor() : gain;
  useExitsStore.getState().recordExit(founderId, accrued.toNumber());
  usePrestigeStore.getState().bankAcquisition(equityGain);


  // One more company this generation: the singularity keeps more of itself. @see afterSale
  useGenerationStore.getState().recordSale(founderId, equityGain.toNumber());
  resetRunStores();
  return equityGain;
}

/**
 * AN ACQUIRER AT THE DOOR: a premium on top of the offer for a sale agreed
 * while the offer is on the table — the run's climax as a decision, take it
 * now or hold out for a bigger company. Live state, set by the offer event and
 * gone when it lapses. @see world/events "offer"
 */
export const OFFER_PREMIUM = 1.25;
/** What investors left unimpressed by a tour take off the next offer's premium. @see Session.snubbed */
export const SNUB = 0.15;
/** The premium the next acquirer offers: less once investors have been shown a poor town. */
export const offerPremium = () => OFFER_PREMIUM - (useSessionStore.getState().snubbed ? SNUB : 0);
let premium: { mult: number; until: number } | null = null;
export function setOfferPremium(mult: number, until: number): void { premium = { mult, until }; }
export function clearOfferPremium(): void { premium = null; }
/** The premium a sale agreed now would carry: 1 for none. */
export function offerPremiumNow(now = Date.now()): number {
  return premium && now < premium.until ? premium.mult : 1;
}
/** When the premium on the table lapses, ms since the epoch, or null for none. */
export const offerPremiumUntil = (now = Date.now()) => (premium && now < premium.until ? premium.until : null);

/**
 * Accept the acquisition offer: bank the Equity, then soft-reset the run —
 * with an acquirer's premium, if one is on the table. No-op if not eligible.
 * Returns the Equity banked (0 if it didn't fire).
 */
export function performAcquisition(): Decimal {
  const mult = offerPremiumNow();
  premium = null;
  return executeAcquisition(mult);
}

