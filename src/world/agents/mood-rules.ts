import type { GeneratorId } from "../../state/generators.store";
import type { Tier } from "./services";

/**
 * World v2 — what each thing near a house is worth to it: the numbers the mood
 * and the desirability both count by. @see mood, desirability
 */
/** What each thing adds to a house's mood, in satisfaction points. */
export const MOOD = {
  perTenthLost: -6,
  stranded: -30,
  cafe: 4,
  park: 6,
  gym: 4,
  noServices: -6,
  slopNear: -8,
  slopFull: -12,
  crowded: -6,
  wonder: 5,
  sludge: -15,
  flooded: -20,
  derelict: -5,
} as const;
/** How near the slop pit and a wonder count, in tiles. */
export const SLOP_REACH = 6;
export const WONDER_REACH = 10;
export const DERELICT_REACH = 4;
/** A house's mood never goes past this, either way. */
export const MOOD_LIMIT = 40;
/** At or below this, people start to leave; one every this many seconds. */
export const MOVE_OUT_AT = -25;
export const MOVE_OUT_EVERY = 60;

/** What a house's mood is made of, each part signed. */
export type MoodParts = { total: number; parts: { why: string; points: number }[] };

/** What a view of water adds, and how near the water has to be, in tiles. */
export const WATER_VIEW = 5;
export const WATER_REACH = 2;

/**
 * THE DESIRABILITY A HOUSE GROWS INTO EACH TIER AT. A lot becomes II with a
 * café near and nothing against it; III wants a park as well, or water, or a
 * wonder; a tower the best of everything. It declines only `DECLINE_MARGIN`
 * under the threshold it grew past, so a house on the line does not flicker
 * between two. @see stepEvolution
 */
export const GROW_AT: Record<Tier, number> = { t0: -Infinity, t1: 4, t2: 10, landmark: 16 };
export const DECLINE_MARGIN = 4;
/** What a kind wants before it will move in at all. @see stepArrivals */
export const MOVE_IN_AT: Partial<Record<GeneratorId, number>> = { "10x_dev": 10 };
