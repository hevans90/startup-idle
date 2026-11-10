/**
 * The baked vehicle sheet's index, as `dev/bake-cars.ts` writes it and the
 * game reads it. @see car-sheet.ts
 */

/** Headings baked, round the full turn: as many as the box cars had. */
export const CAR_HEADINGS = 32;
/** Texels to a world px at scale 1. */
export const CAR_RES = 2;

/**
 * A frame: its page and where it starts, then each layer cropped to what it
 * covers — its width, height and the origin in it. The trim sits right of the
 * paint, `GAP` on. Then each lamp's mask, packed apart: its page, where it
 * starts, and its size and origin — seven numbers. A livery's paint is
 * empty: 0 wide; so is a lamp a vehicle has none of, or none seen at that
 * heading.
 * @see raster LAMPS
 */
export type CarFrame = [
  page: number, x: number, y: number,
  pw: number, ph: number, pox: number, poy: number,
  tw: number, th: number, tox: number, toy: number,
  ...lamps: number[],
];

export type CarSheet = {
  res: number;
  headings: number;
  pages: string[];
  models: Record<string, { length: number; width: number; frames: CarFrame[] }>;
};

/** Texels between the paint layer and the trim layer of a frame. */
export const CAR_GAP = 4;
