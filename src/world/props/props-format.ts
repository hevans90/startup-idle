/**
 * The baked props sheet's index, as `dev/bake-props.ts` writes it and the
 * game reads it. @see props-sheet.ts
 */

/** Turns baked round: a prop stands square to the streets. */
export const PROP_TURNS = 4;
/** Texels to a world px at scale 1. */
export const PROP_RES = 2.5;
/** Texels between one layer of a frame and the next. */
export const PROP_GAP = 3;

/** Each prop's tinted layer, as it most often is: leaves in leaf, a parasol's cloth. */
export const PROP_TINT: Readonly<Record<string, number>> = {
  oak: 0x5f8f3e, lime: 0x6f9d45, hornbeam: 0x4f8a3e, cherry: 0xf2b3cb, birch: 0x8fb552, pine: 0x2f5e3a, cafe: 0xd8432f,
};

/**
 * A frame: its page and where it starts, then each layer cropped to what it
 * covers — width, height and the origin in it — side by side, `GAP` apart.
 */
export type PropFrame = number[];

export type PropsSheet = {
  res: number;
  turns: number;
  layers: number;
  pages: string[];
  props: Record<string, PropFrame[]>;
};
