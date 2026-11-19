/**
 * The baked trees' index, as `dev/bake-trees.ts` writes it and the game reads it: every kind in every look, at
 * four turns, both layers of a frame cut to the same box — the leaves to tint, then the rest beside it, `gap` on —
 * so one quad reads both. @see render/tree-mesh
 */
/** A frame: its page, where its first layer starts, its size (each layer's), and the tree's foot in it. */
export type TreeFrame = [page: number, x: number, y: number, w: number, h: number, ox: number, oy: number];
export type TreesSheet = {
  res: number;
  turns: number;
  gap: number;
  pages: { file: string; w: number; h: number }[];
  /** By kind, then look: a frame a turn. (Not `frames`: Pixi takes any JSON with `frames` for a spritesheet.) */
  looks: Record<string, Record<string, TreeFrame[]>>;
};
