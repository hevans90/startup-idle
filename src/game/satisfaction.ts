import type { EmployeePerks, GeneratorId } from "../state/generators.store";

export const SATISFACTION_MIN = -100;
export const SATISFACTION_MAX = 100;

export type SatisfactionScores = Record<GeneratorId, number>;

export const defaultSatisfactionScores = (): SatisfactionScores => ({
  intern: 0,
  vibe_coder: 0,
  "10x_dev": 0,
});

function clampScore(n: number): number {
  return Math.min(SATISFACTION_MAX, Math.max(SATISFACTION_MIN, n));
}

/** Target satisfaction for one role from headcount + perks (before smoothing). */
export function satisfactionTargetForRole(
  id: GeneratorId,
  amount: number,
  perks: EmployeePerks
): number {
  let t = 0;
  t -= Math.min(40, 8 * Math.log1p(amount));
  t -= perks.moneyLevel * 12.5;
  t += perks.innovationLevel * 9;
  t -= perks.costLevel * 10;
  t -= perks.autoBuyLevel * 6;
  if (id === "10x_dev") t -= amount * 0.15;
  return clampScore(t);
}

/** Cash (money) output multiplier for one employee type; linear in score. */
export const SATISFACTION_REVENUE_MULT_AT_MIN = 0.25;
export const SATISFACTION_REVENUE_MULT_AT_MAX = 10;

export function satisfactionRevenueMultiplier(score: number): number {
  const s = clampScore(score);
  const span = SATISFACTION_MAX - SATISFACTION_MIN;
  const t = (s - SATISFACTION_MIN) / span;
  return (
    SATISFACTION_REVENUE_MULT_AT_MIN +
    t * (SATISFACTION_REVENUE_MULT_AT_MAX - SATISFACTION_REVENUE_MULT_AT_MIN)
  );
}

export function stepSatisfactionScores(
  prev: SatisfactionScores,
  perksByRole: Record<GeneratorId, EmployeePerks>,
  amounts: Record<GeneratorId, number>,
  seconds: number
): SatisfactionScores {
  const k = 0.35;
  const next = { ...prev };
  for (const id of ["intern", "vibe_coder", "10x_dev"] as GeneratorId[]) {
    const target = satisfactionTargetForRole(id, amounts[id] ?? 0, perksByRole[id]);
    const cur = prev[id];
    next[id] = clampScore(cur + (target - cur) * Math.min(1, k * seconds));
  }
  return next;
}

/** Global IPS mult from intern morale: bonus when positive only. */
export function internSatisfactionIpsMultiplier(internScore: number): number {
  if (internScore <= 0) return 1;
  return 1 + (internScore / SATISFACTION_MAX) * 0.12;
}

/** Scales passive valuation gain; strong penalty when interns unhappy. */
export function internSatisfactionValuationMultiplier(internScore: number): number {
  if (internScore >= 0) return 1;
  return Math.max(0, 1 + (internScore / SATISFACTION_MAX) * 0.75);
}

/** Manager progress gain mult; floor at 0 after apply in tick. */
export function internSatisfactionManagerAccrualMultiplier(internScore: number): number {
  if (internScore >= 0) {
    return 1 + (internScore / SATISFACTION_MAX) * 0.1;
  }
  return Math.max(0.12, 1 + (internScore / SATISFACTION_MAX) * 0.88);
}

/** Added to stored 10x_dev cost exponent (negative = cheaper). Clamped later to MIN. */
export function dev10xSatisfactionExponentDelta(score: number): number {
  if (score === 0) return 0;
  return (-score / SATISFACTION_MAX) * 0.35;
}

/** Percentage points per second (0–100 scale) when vibe satisfaction is negative. Intentionally slow. */
export function vibeSingularityAccrualRatePerSecond(vibeScore: number): number {
  if (vibeScore >= 0) return 0;
  const intensity = -vibeScore / SATISFACTION_MAX;
  return intensity * 0.012;
}
