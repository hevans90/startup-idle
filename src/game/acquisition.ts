import Decimal from "break_infinity.js";
import { resetRunStores } from "../simulation/reset-game-stores";
import { useDirectivesStore } from "../state/directives.store";
import { useExitsStore } from "../state/exits.store";
import { useFounderStore } from "../state/founder.store";
import { usePrestigeStore } from "../state/prestige.store";
import { useValuationStore } from "../state/valuation.store";
import { computeEquityMultipliers } from "./modifiers";

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
    Math.floor(EQUITY_BASE * Math.pow(ratio, EQUITY_EXP) * eq.prestige * (1 + eq.juice) * mandateEquityBoost),
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
    targetEquity / (EQUITY_BASE * eq.prestige * (1 + eq.juice)),
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

/** Whether the D8 AGI Acquisition (5× equity) option is available. */
export function canAGIAcquire(): boolean {
  return (
    canAcquire() &&
    useDirectivesStore.getState().agiAcquisitionUnlocked
  );
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
  useDirectivesStore.getState().onExit(accrued.toNumber(), equityGain.toNumber());

  // Check D8 post-AGI conditions after banking exits.
  const { allocated, exits } = usePrestigeStore.getState();
  useDirectivesStore.getState().checkPostAgiConditions(allocated.length, exits);

  resetRunStores();
  return equityGain;
}

/**
 * Accept the acquisition offer: bank the Equity, then soft-reset the run.
 * No-op if not eligible. Returns the Equity banked (0 if it didn't fire).
 */
export function performAcquisition(): Decimal {
  return executeAcquisition(1);
}

/**
 * AGI Acquisition (D8 reward): same as a normal acquisition but pays 5× equity.
 */
export function performAGIAcquisition(): Decimal {
  if (!canAGIAcquire()) return new Decimal(0);
  return executeAcquisition(5);
}
