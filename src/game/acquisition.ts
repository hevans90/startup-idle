import Decimal from "break_infinity.js";
import { resetRunStores } from "../simulation/reset-game-stores";
import { useExitsStore } from "../state/exits.store";
import { useFounderStore } from "../state/founder.store";
import { usePrestigeStore } from "../state/prestige.store";
import { useValuationStore } from "../state/valuation.store";
import { useVapeAchievementsStore } from "../state/vape-achievements.store";

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
  const ratio = accrued.div(ACQUISITION_THRESHOLD).toNumber();
  // Skill-tree "exit" passives boost the payout (equityMult ≥ 1, neutral = 1).
  const equityMult = usePrestigeStore.getState().modifiers.equityMult;
  // Vape shop DNA chip adds an additive equity bonus.
  const juiceEquityMult =
    1 + useVapeAchievementsStore.getState().juiceEquityMultBonus;
  return new Decimal(
    Math.floor(EQUITY_BASE * Math.pow(ratio, EQUITY_EXP) * equityMult * juiceEquityMult),
  );
}

/**
 * Inverse of {@link equityForAccrued}: the total accrued valuation needed for an
 * acquisition offer of `targetEquity` (accounting for the equity multiplier).
 * Used to show progress toward the next Equity point.
 */
export function accruedForEquity(targetEquity: number): Decimal {
  if (targetEquity <= 0) return new Decimal(0);
  const equityMult = usePrestigeStore.getState().modifiers.equityMult;
  const juiceEquityMult =
    1 + useVapeAchievementsStore.getState().juiceEquityMultBonus;
  const ratio = Math.pow(
    targetEquity / (EQUITY_BASE * equityMult * juiceEquityMult),
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
export function performAcquisition(): Decimal {
  const gain = pendingEquity();
  if (gain.lte(0)) return new Decimal(0);

  // Record the exit before the reset so the founder id is still set.
  const founderId = useFounderStore.getState().selectedFounderId;
  const accrued = useValuationStore.getState().accruedThisRun;
  if (founderId) {
    useExitsStore.getState().recordExit(founderId, accrued.toNumber());
  }

  usePrestigeStore.getState().bankAcquisition(gain);
  resetRunStores();
  return gain;
}
