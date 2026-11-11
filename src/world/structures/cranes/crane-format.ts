/**
 * The baked cranes sheet's index, as `dev/bake-cranes.ts` writes it and the
 * game reads it. @see crane-sheet.ts
 */

/** Texels to a world px at scale 1. */
export const CRANE_RES = 1;
/** Texels between one piece of a frame and the next. */
export const CRANE_GAP = 3;

/**
 * A frame: its page and where it starts, then each piece cropped to what it
 * covers — width, height and the origin in it — side by side, `GAP` apart:
 * the layers first, then the marks.
 */
export type CraneFrame = number[];

export type CranesSheet = {
  res: number;
  layers: number;
  marks: number;
  pages: string[];
  /** Each part's frames, in the order of the headings it is baked at. @see CRANE_PARTS */
  parts: Record<string, CraneFrame[]>;
};
