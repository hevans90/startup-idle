import type { GeneratorId } from "../../state/generators.store";
import type { Tier } from "./services";
import type { NeedId } from "./needs";

/**
 * World v2 — what each thing near a house is worth to it: the numbers the mood
 * and the desirability both count by. @see mood, desirability
 */
/** What each thing adds to a house's mood, in satisfaction points. */
export const MOOD = {
  perTenthLost: -6,
  stranded: -30,
  unmet: -6,
  crowded: -6,
  wonder: 5,
  sludge: -15,
  /** Fouled water in view, in place of the water view. @see fouledHouses */
  polluted: -8,
  flooded: -20,
  derelict: -5,
} as const;
/**
 * What each need met adds, by the kind it is met for: about what a café, a
 * park and a gym together did, over a kind's needs. @see NEEDS
 */
export const NEED_MOOD: Record<GeneratorId, number> = { intern: 7, vibe_coder: 7, "10x_dev": 5 };
/** How near a wonder and a derelict count, in tiles. */
export const WONDER_REACH = 10;
export const DERELICT_REACH = 4;
/** A house's mood never goes past this, either way. */
export const MOOD_LIMIT = 40;
/** At or below this, people start to leave; one every this many seconds. */
export const MOVE_OUT_AT = -25;
export const MOVE_OUT_EVERY = 60;

/**
 * THE WORDS FOR WHAT A HOUSE LIVES WITH, one list for the mood and the
 * desirability both: lower case, as they are read mid-line ("Morale −8 ·
 * unhappy: no services"), and opening a line in capitals. @see game/wording
 */
export const WHY = {
  stranded: "no road to work",
  commute: "long commute",
  deskless: "no desk",
  unmet: "unmet needs",
  food: "food",
  nightlife: "nightlife",
  coffee: "coffee",
  scene: "a scene",
  health: "a doctor",
  fitness: "fitness",
  quiet: "quiet",
  crowded: "crowded",
  polluted: "polluted water",
  waterView: "water view",
  wonder: "near a wonder",
  derelict: "derelict nearby",
  sludge: "sludge",
  flooded: "flooded",
  planned: "AI-planned",
  culture: "company culture",
} as const;
export type Why = (typeof WHY)[keyof typeof WHY];

/** The word for each need met. */
export const NEED_WHY: Record<NeedId, Why> = {
  food: WHY.food, nightlife: WHY.nightlife, coffee: WHY.coffee, scene: WHY.scene, health: WHY.health, fitness: WHY.fitness, quiet: WHY.quiet,
};

/** What a house's mood is made of, each part signed. */
export type MoodParts = { total: number; parts: { why: Why; points: number }[] };

const NEED_WORDS = new Set<string>(Object.values(NEED_WHY));
/** How many of a house's needs its mood says are met: near it, or a workplace's lunch. */
export const needsCounted = (m: MoodParts) => m.parts.filter((p) => NEED_WORDS.has(p.why)).length;

/** What a view of water adds, and how near the water has to be, in tiles. */
export const WATER_VIEW = 5;
export const WATER_REACH = 2;

/**
 * THE DESIRABILITY A HOUSE GROWS INTO EACH TIER AT. A lot becomes II with a
 * need met and nothing against it; III wants more, or water, or a wonder; a
 * tower the best of everything — and its needs met besides. It declines only
 * `DECLINE_MARGIN` under the threshold it grew past, so a house on the line
 * does not flicker between two. @see stepEvolution, NEEDS_FOR
 */
export const GROW_AT: Record<Tier, number> = { t0: -Infinity, t1: 4, t2: 10, landmark: 16 };
export const DECLINE_MARGIN = 4;
/**
 * What a kind wants before it will move in at all. None now: the 10x devs, who
 * were particular, live on the Campus. @see stepArrivals, CAMPUS_BEDS
 */
export const MOVE_IN_AT: Partial<Record<GeneratorId, number>> = {};
