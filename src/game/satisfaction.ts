/**
 * MORALE, each kind's: one number, −40 to +40 — the scale houses' morale is on
 * — made of its parts: HOME (the morale of the houses they live in, the town's
 * say, in full), WORK (the perks bought), LEADERS and EVENTS,
 * the score drifting toward their sum. It scales what the kind produces,
 * ×0.5 at −40 to ×2 at +40, and does one thing more for each kind: interns'
 * moves innovation, vibe coders' the slop pit, 10x devs' their cost curve.
 * (Still "satisfaction" in the code until the names change.)
 * @see plans/innovation-overhaul.md §2
 */
import type { EmployeePerks, GeneratorId } from "../state/generators.store";

export const SATISFACTION_MIN = -40;
export const SATISFACTION_MAX = 40;

/** Points from the old −100…+100 scale to Morale's −40…+40: for what was written in the old one. */
export const TO_MORALE = 0.4;
export type SatisfactionScores = Record<GeneratorId, number>;

export const defaultSatisfactionScores = (): SatisfactionScores => ({
  intern: 0,
  vibe_coder: 0,
  "10x_dev": 0,
});

export function clampScore(n: number): number {
  return Math.min(SATISFACTION_MAX, Math.max(SATISFACTION_MIN, n));
}

/**
 * WORK, for one kind: what the perks bought do to their morale (before the
 * other parts). Not headcount: crowding is the town's to say, in Home.
 */
export function satisfactionTargetForRole(
  _id: GeneratorId,
  _amount: number,
  perks: EmployeePerks,
): number {
  let t = 0;
  t -= perks.moneyLevel * 12.5;
  t += perks.innovationLevel * 9;
  t -= perks.costLevel * 10;
  t -= perks.autoBuyLevel * 6;
  return clampScore(t * TO_MORALE);
}

/** Output at −40 (worst). */
export const SATISFACTION_REVENUE_MULT_AT_MIN = 0.5;
/** Output at +40 (best). Morale 0 is always ×1. */
export const SATISFACTION_REVENUE_MULT_AT_MAX = 2;
export const SATISFACTION_REVENUE_MULT_NEUTRAL = 1;

/** What a kind produces at a morale: [−40, 0] → [×0.5, ×1], [0, +40] → [×1, ×2], linear each side. */
export function satisfactionRevenueMultiplier(score: number): number {
  const s = clampScore(score);
  const t = s / SATISFACTION_MAX;
  return s <= 0 ? 1 + t * (1 - SATISFACTION_REVENUE_MULT_AT_MIN) : 1 + t * (SATISFACTION_REVENUE_MULT_AT_MAX - 1);
}

export function stepSatisfactionScores(
  prev: SatisfactionScores,
  perksByRole: Record<GeneratorId, EmployeePerks>,
  amounts: Record<GeneratorId, number>,
  seconds: number,
  targetOffsets: Partial<Record<GeneratorId, number>> = {},
): SatisfactionScores {
  const k = 0.05;
  const next = { ...prev };
  for (const id of ["intern", "vibe_coder", "10x_dev"] as GeneratorId[]) {
    const base = satisfactionTargetForRole(id, amounts[id] ?? 0, perksByRole[id]);
    const target = clampScore(base + (targetOffsets[id] ?? 0));
    const cur = prev[id];
    next[id] = clampScore(cur + (target - cur) * Math.min(1, k * seconds));
  }
  return next;
}

/** INTERNS' MORALE moves the company's innovation: ×0.8 at −40, ×1.2 at +40. */
export const INTERN_INNOVATION_SWING = 0.2;
export function internSatisfactionIpsMultiplier(internScore: number): number {
  return 1 + (clampScore(internScore) / SATISFACTION_MAX) * INTERN_INNOVATION_SWING;
}

/** VIBE CODERS' MORALE moves the slop pit: happy, they ship cleaner — half the fill at +40, twice it at −40. */
export function vibeSlopMultiplier(vibeScore: number): number {
  return 2 ** (-clampScore(vibeScore) / SATISFACTION_MAX);
}

/** 10X DEVS' MORALE bends their cost curve: added to their cost exponent (negative = cheaper), ±0.35 at the ends. */
export function dev10xSatisfactionExponentDelta(score: number): number {
  if (score === 0) return 0;
  return (-clampScore(score) / SATISFACTION_MAX) * 0.35;
}
