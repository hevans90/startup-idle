/**
 * The baked landmarks sheet's index, as `dev/bake-landmarks.ts` writes it and
 * the game reads it. @see landmarks-sheet.ts
 */

/** Texels to a world px at scale 1. */
export const LANDMARK_RES = 2;
/** The snow's, coarser: white, and soft at its edges. */
export const LANDMARK_SNOW_RES = 1;

/** A tile's share of a building: its page, where it is on it, its size, and the origin in it — the middle of the plot, at the ground. Empty, `null`. */
export type LandmarkPiece = [page: number, x: number, y: number, w: number, h: number, ox: number, oy: number] | null;

/** A building: the plot it is baked for, and a piece for each tile of it, row by row. */
export type LandmarkFrames = {
  w: number; h: number; tiles: LandmarkPiece[]; /** Its canopies, a tile each as well: drawn over whatever the game stands on that tile. */ over: LandmarkPiece[];
  /** The snow lying on it, alone, a tile each as its tiles are and as it hides it; and on its canopies. @see houses/models snowOver */
  snow?: LandmarkPiece[]; snowOver?: LandmarkPiece[];
};

export type LandmarksSheet = { res: number; snowRes?: number; pages: string[]; marks: Record<string, LandmarkFrames> };
