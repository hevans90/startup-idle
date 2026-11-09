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

/** Headings baked round the turn, and frames through a stride (two steps). */
export const PERSON_HEADINGS = 16;
export const PERSON_STRIDES = 12;
/** Texels to a world px at scale 1. */
export const PERSON_RES = 2.5;
/** Texels between one layer of a frame and the next. */
export const PERSON_GAP = 3;

/** The soft shadow at a person's feet. @see BakeOpts */
export const PERSON_SHADOW = { hl: 0, hw: 0, edge: 0.1, soft: 0.16, strength: 0.38, reach: 0.2 };

/**
 * A frame: its page and where it starts, then each layer cropped to what it
 * covers — width, height and the origin in it — side by side, `GAP` apart. A
 * layer the figure doesn't have is 0 wide.
 */
export type PersonFrame = number[];

export type PeopleSheet = {
  res: number; headings: number; strides: number; layers: number;
  pages: string[];
  /** Each figure's walk, `headings × strides` frames heading by heading; and, if it works, its work. */
  figures: Record<string, { walk: PersonFrame[]; work?: PersonFrame[] }>;
};
