/**
 * Lower-bound seconds to afford `cost` at constant MPS (ignores innovation scaling IPS).
 * Useful for catalog sanity checks without running the full store loop.
 */
export function secondsToAffordAtConstantMps(
  cost: number,
  startingMoney: number,
  mps: number
): number {
  if (mps <= 0) return Number.POSITIVE_INFINITY;
  const need = Math.max(0, cost - startingMoney);
  return need / mps;
}
