/**
 * The baked houses sheet's index, as `dev/bake-houses.ts` writes it and the
 * game reads it. @see houses-sheet.ts
 */

/** Texels to a world px at scale 1. */
export const HOUSE_RES = 2.5;
/** Texels between one layer of a frame and the next. */
export const HOUSE_GAP = 3;
/** Layers: the walls, white and tinted in the game; then everything else. */
export const HOUSE_LAYERS = 2;

/**
 * A frame: its page and where it starts, then each layer cropped to what it
 * covers — width, height and the origin in it — side by side, `GAP` apart.
 */
export type HouseFrame = number[];

/** A kit's parts: its ground floor, the floors that stack on it, and its roof. */
export type HouseFrames = {
  ground: HouseFrame; mids: HouseFrame[]; roof: HouseFrame;
  /** The snow lying on its roof, alone, as the roof hides it: its second layer. @see houses/models snowOver */
  snow?: HouseFrame;
};

export type HousesSheet = {
  res: number;
  layers: number;
  pages: string[];
  kits: Record<string, HouseFrames>;
};
