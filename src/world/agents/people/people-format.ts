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
/** Frames through a runner's stride, and through a stander's sway. */
export const RUN_STRIDES = 8;
export const STAND_FRAMES = 4;

/** A CHILD: as tall, as a share of a grown-up, and the step they walk at, metres. */
export const CHILD_HEIGHT = 0.64;
export const CHILD_STEP_M = 0.48;
/** A runner's step, metres: the phase runs π a step of it. */
export const RUN_STEP_M = 1.25;
/**
 * HAND IN HAND: how far apart a grown-up and a child walk, metres, side to
 * side, and how far out to the side the grown-up's hand is; the child's
 * reaches the rest of the way. @see figureTris hold, walker-life
 */
export const HOLD_GAP_M = 0.62;
export const HOLD_REACH_M = 0.34;
/** How high their hands are, metres. */
export const HOLD_Z = 0.86;

/** Who walks a child, hand in hand, and who goes running: figures baked for it. */
export const PARENTS = ["casual", "longHair", "skirt"] as const;
export const KIDS = ["kid", "kidSkirt"] as const;
export const JOGGERS = ["shorts", "ponytail", "casual", "slim"] as const;
/**
 * DOGS, by breed: how long a step of their trot, metres, and the coats they
 * come in — the coat and the markings, tinted at runtime.
 */
export const DOGS = {
  terrier: { step: 0.32, coats: [[0xe8dcc4, 0x6b4a2e], [0xf2efe8, 0x2a2622], [0x8a6a48, 0x3a2a1c]] },
  lab: { step: 0.55, coats: [[0xd9b77a, 0xc49a5c], [0x2a2522, 0x1c1916], [0x7a4a26, 0x5c3518]] },
  dachs: { step: 0.3, coats: [[0x7a3e1c, 0x2a1a10], [0x2a2420, 0x9a6a3a], [0xa8743c, 0x6a4422]] },
} as const;
export type Breed = keyof typeof DOGS;
export const BREEDS = Object.keys(DOGS) as Breed[];
/** Where a dog's collar is, metres, forward of its middle and up: where the lead is clipped. */
export const COLLAR: Record<Breed, { l: number; z: number }> = {
  terrier: { l: 0.19, z: 0.28 }, lab: { l: 0.31, z: 0.56 }, dachs: { l: 0.28, z: 0.25 },
};
/** Texels to a world px at scale 1. */
export const PERSON_RES = 2.5;
/** Texels between one layer of a frame and the next. */
export const PERSON_GAP = 3;

/** The soft shadow at a person's feet. @see BakeOpts */
export const PERSON_SHADOW = { hl: 0, hw: 0, edge: 0.1, soft: 0.16, strength: 0.38, reach: 0.2 };
/** None sat down: the seat under them throws its own. */
export const SITTER_SHADOW = { ...PERSON_SHADOW, strength: 0 };
/** A dog's, small and long. */
export const DOG_SHADOW = { ...PERSON_SHADOW, hl: 0.2, hw: 0.04, reach: 0.12, strength: 0.3 };
/** A rider's, the length of the bike. */
export const RIDER_SHADOW = { ...PERSON_SHADOW, hl: 0.5, hw: 0.08 };

/**
 * A frame: its page and where it starts, then each layer cropped to what it
 * covers — width, height and the origin in it — side by side, `GAP` apart. A
 * layer the figure doesn't have is 0 wide.
 */
export type PersonFrame = number[];

/**
 * A figure's frames, set by set, heading by heading: its walk (`headings ×
 * strides`); if it works, its work; sat down, one a heading; on a bike, a turn
 * of the pedals; stood, its sway; running (`headings × runStrides`); walking
 * hand in hand; and a dog's, sniffing, one a heading.
 */
export type FigureFrames = {
  walk: PersonFrame[]; work?: PersonFrame[]; sit?: PersonFrame[]; ride?: PersonFrame[];
  stand?: PersonFrame[]; run?: PersonFrame[]; hold?: PersonFrame[]; sniff?: PersonFrame[];
};
export type FrameSet = keyof FigureFrames;

export type PeopleSheet = {
  res: number; headings: number; strides: number; layers: number;
  pages: string[];
  figures: Record<string, FigureFrames>;
  runStrides: number; standFrames: number;
};
