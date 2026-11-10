/**
 * The baked people sheet's index, as `dev/bake-people.ts` writes it and the
 * game reads it. @see people-sheet.ts
 */

import { TILES_PER_M } from "../cars/models";

/**
 * A STEP, as people walk: about 0.72 m at an easy pace. Everyone on foot —
 * the town's walkers, the old drawn people, a site's carriers — moves their
 * phase on by π a step of this, so their feet keep pace with the ground.
 */
export const STEP_M = 0.72;
export const STEP_TILES = STEP_M * TILES_PER_M;

/** Riders on bikes, as the figures go: those dressed for it. @see figures BIKE */
export const RIDERS = ["casual", "ponytail", "curly", "shorts", "slim", "suit"] as const;
/** A bike's length and width overall, metres: for its spacing in the traffic and its band. */
export const BIKE_LENGTH = 1.75;
export const BIKE_WIDTH = 0.6;
/** Metres a turn of the pedals carries a bike, in its gear: how fast the rider's legs go round. */
export const PEDAL_TURN_M = 7;

/** Headings baked round the turn, and frames through a stride (two steps). */
export const PERSON_HEADINGS = 16;
export const PERSON_STRIDES = 12;
/** Texels to a world px at scale 1. */
export const PERSON_RES = 2.5;
/** Texels between one layer of a frame and the next. */
export const PERSON_GAP = 3;

/** The soft shadow at a person's feet. @see BakeOpts */
export const PERSON_SHADOW = { hl: 0, hw: 0, edge: 0.1, soft: 0.16, strength: 0.38, reach: 0.2 };
/** None sat down: the seat under them throws its own. */
export const SITTER_SHADOW = { ...PERSON_SHADOW, strength: 0 };
/** A rider's, the length of the bike. */
export const RIDER_SHADOW = { ...PERSON_SHADOW, hl: 0.5, hw: 0.08 };

/**
 * A frame: its page and where it starts, then each layer cropped to what it
 * covers — width, height and the origin in it — side by side, `GAP` apart. A
 * layer the figure doesn't have is 0 wide.
 */
export type PersonFrame = number[];

export type PeopleSheet = {
  res: number; headings: number; strides: number; layers: number;
  pages: string[];
  /**
   * Each figure's walk, `headings × strides` frames heading by heading; if it
   * works, its work; sat down, a frame a heading; and if it rides, riding
   * its bike, `headings × strides` frames through a turn of the pedals.
   */
  figures: Record<string, { walk: PersonFrame[]; work?: PersonFrame[]; sit: PersonFrame[]; ride?: PersonFrame[] }>;
};
