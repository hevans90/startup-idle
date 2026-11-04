/**
 * MORALE THAT LASTS: what an event does to how a kind feels — a hackathon
 * hosted, one turned down — held as a lean on their satisfaction's TARGET for
 * a day, rather than a bump to the score itself. A bump is gone in a minute:
 * the score returns to its target at 5% a second, so "+15 satisfaction" was
 * worth a couple of seconds of work. A lean is felt for as long as it lasts.
 * Kept as conditions, so a reload keeps it. @see game/conditions,
 * stepSatisfactionScores
 */
import type { GeneratorId } from "../state/generators.store";
import { DAY_SECONDS } from "../world/daylight";
import { addCondition, conditionsNow, removeConditions } from "./conditions";

/** How long an event's morale is felt, seconds: a day. */
export const MORALE_SECONDS = DAY_SECONDS;

/** A lean of `points` on a kind's satisfaction, for `seconds`. */
export function addMorale(who: GeneratorId, points: number, seconds = MORALE_SECONDS, now = Date.now()): void {
  addCondition({ source: "morale", only: who, lean: points, until: now + seconds * 1000 });
}

/** Each kind's lean from events still being felt, in satisfaction points. */
export function moraleOffsets(now = Date.now()): Partial<Record<GeneratorId, number>> {
  const out: Partial<Record<GeneratorId, number>> = {};
  for (const c of conditionsNow(now)) if (c.lean && c.only) out[c.only] = (out[c.only] ?? 0) + c.lean;
  return out;
}

/** Every lean forgotten: a new company. */
export const clearMorale = () => removeConditions((c) => c.lean !== undefined);
