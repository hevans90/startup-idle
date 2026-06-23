import Decimal from "break_infinity.js";
import { resetRunStores } from "../simulation/reset-game-stores";
import { usePrestigeStore } from "../state/prestige.store";
import { useValuationStore } from "../state/valuation.store";

/**
 * Company Acquisition (prestige) economics. You "sell" the company once you've
 * built enough total accrued valuation, banking permanent Equity scaled with
 * diminishing returns, then start a fresh company keeping only your Equity +
 * skill tree. Constants are tunable; the UI previews the exact payout.
 */

/** Minimum accrued valuation before an acquisition offer is available. */
export const ACQUISITION_THRESHOLD = 1000;
/** Equity granted exactly at the threshold. */
const EQUITY_BASE = 3;
/** Diminishing-returns exponent on (accrued / threshold). */
const EQUITY_EXP = 0.5;

/**
 * Equity an acquisition would pay for a given total accrued valuation.
 * `floor(BASE · (accrued / THRESHOLD)^EXP)`, zero below the threshold.
 */
export function equityForAccrued(accrued: Decimal): Decimal {
  if (accrued.lt(ACQUISITION_THRESHOLD)) return new Decimal(0);
  const ratio = accrued.div(ACQUISITION_THRESHOLD).toNumber();
  return new Decimal(Math.floor(EQUITY_BASE * Math.pow(ratio, EQUITY_EXP)));
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
  usePrestigeStore.getState().bankAcquisition(gain);
  resetRunStores();
  return gain;
}
