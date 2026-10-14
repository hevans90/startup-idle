/**
 * MORALE THAT LASTS: what an event does to how a kind feels — a hackathon
 * hosted, one turned down, the slop pit drained over their heads — held as a
 * lean on their satisfaction's TARGET for a day, rather than a bump to the
 * score itself. A bump is gone in a minute: the score returns to its target
 * at 5% a second, so "+15 satisfaction" was worth a couple of seconds of
 * work. A lean is felt for as long as it lasts. Live state; not saved.
 * @see stepSatisfactionScores, tickSatisfaction
 */
import type { GeneratorId } from "../state/generators.store";
import { DAY_SECONDS } from "../world/daylight";

/** How long an event's morale is felt, seconds: a day. */
export const MORALE_SECONDS = DAY_SECONDS;

let effects: { who: GeneratorId; points: number; until: number }[] = [];

/** A lean of `points` on a kind's satisfaction, for `seconds`. */
export function addMorale(who: GeneratorId, points: number, seconds = MORALE_SECONDS, now = Date.now()): void {
  effects.push({ who, points, until: now + seconds * 1000 });
}

/** Each kind's lean from events still being felt, in satisfaction points. */
export function moraleOffsets(now = Date.now()): Partial<Record<GeneratorId, number>> {
  effects = effects.filter((e) => e.until > now);
  const out: Partial<Record<GeneratorId, number>> = {};
  for (const e of effects) out[e.who] = (out[e.who] ?? 0) + e.points;
  return out;
}

/** Every lean forgotten: a new company. */
export const clearMorale = () => { effects = []; };
