/**
 * The baked boats sheet's index, as `dev/bake-boats.ts` writes it and the
 * game reads it. @see boat-sheet.ts
 */

/** Headings baked round the turn, as the cars'. */
export const BOAT_HEADINGS = 32;
/** Texels to a world px at scale 1. */
export const BOAT_RES = 1;
/** Texels between one part of a frame and the next. */
export const BOAT_GAP = 3;

/**
 * A frame: its page and where it starts, then each part cropped to what it
 * covers — width, height and the origin in it — side by side, `GAP` apart:
 * the layers first, then the marks.
 */
export type BoatFrame = number[];

export type BoatsSheet = {
  res: number;
  headings: number;
  layers: number;
  marks: number;
  pages: string[];
  boats: Record<string, BoatFrame[]>;
};
