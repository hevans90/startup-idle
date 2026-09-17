/**
 * World v2 — terrain columns (plan §3.2).
 *
 * A cell higher than its neighbours shows a side wall. The tileset has no
 * separate wall art and needs none: every ground frame is a 132×66 diamond top
 * plus a 33px skirt, and that skirt IS one full step of wall. So a column is
 * copies of the cell's own tile stacked at `HEIGHT_STEP` intervals, each one's
 * top covered by the copy above it, leaving only the skirts visible.
 *
 * The slabs are a WALL material, not the cell's own tile. Measuring
 * landscapeTiles_067 explains why: its silhouette is the expected hexagon, but
 * the art draws grass with a ~17px green LIP down the sides (at x=2 the pixels
 * are green through row 50 and only brown from 51). Stacking the surface tile
 * therefore paints a green stripe every 33px however the sprites are ordered —
 * the striping is in the artwork, not in the occlusion. A grass plateau wants
 * grass on top and earth below, which is also why v1 builds its pit walls from
 * the dirt tile.
 *
 * NO per-face tinting. The art already shades the two skirt faces differently —
 * measured on landscapeTiles_083, the down-left face is rgb(167,125,83) and the
 * down-right rgb(129,96,62) — so lighting them by hand would fight the
 * tileset. v1's pit tints exist to make walls read as dug earth, which is a
 * material choice, not a lighting one; a plain terrain column wants neither.
 *
 * Only the two camera-facing directions can ever be exposed (+x is down-right,
 * +y is down-left), so only those are measured. A drop to the NORTH or EAST is
 * behind the cell and invisible.
 */
import { Sprite, type Texture } from "pixi.js";

import { HEIGHT_STEP, bandOf, cellToWorld, spriteY } from "../iso";
import { VOID, idx, inBounds, type Grid } from "../grid";
import type { BandLayer } from "./bands";
import { TILE_BLEED, type Palette } from "./terrain";

/**
 * Height that off-map counts as, in half steps.
 *
 * Deliberately the fixed datum rather than `grid.minHeight`: keying it to the
 * live minimum would mean digging a pit anywhere silently grew a skirt on every
 * boundary cell on the map. At the datum a flat edge cell shows only its own
 * skirt — which is what makes the map read as a plateau with no special edge
 * tiles — while a RAISED edge cell still shows its full column.
 */
export const OFF_MAP_HEIGHT = 0;

/**
 * Frame the walls are built from. Earth, deliberately: see the note above about
 * the surface tiles' green lip. Not a palette material — the wall is not
 * something the paint tool can select, so it is looked up in the atlas directly
 * and cannot be knocked out by a palette change.
 */
export const WALL_FRAME = "landscapeTiles_083.png";

export type CliffLayer = {
  /** Stacked slabs per cell, parallel to the grid. Empty where nothing is exposed. */
  slabs: (Sprite[] | null)[];
  palette: Palette;
  scale: number;
  wallFrame: string;
};

export function createCliffLayer(
  grid: Grid,
  palette: Palette,
  scale = 1,
  wallFrame = WALL_FRAME,
): CliffLayer {
  return { slabs: new Array(grid.w * grid.h).fill(null), palette, scale, wallFrame };
}

const heightOr = (grid: Grid, x: number, y: number) =>
  inBounds(grid, x, y) ? grid.height[idx(grid, x, y)] : OFF_MAP_HEIGHT;

/**
 * Half steps of wall exposed on a cell's visible sides — the larger of the two
 * drops, since one stack of slabs covers both faces of the skirt.
 */
export function exposedDrop(grid: Grid, x: number, y: number): number {
  if (!inBounds(grid, x, y)) return 0;
  const here = grid.height[idx(grid, x, y)];
  const dx = here - heightOr(grid, x + 1, y);   // down-right face
  const dy = here - heightOr(grid, x, y + 1);   // down-left face
  return Math.max(0, dx, dy);
}

/**
 * Extra slabs a drop needs BELOW the cell's own sprite.
 *
 * Derived from the SHARED EDGE, not from the centre column — measuring down the
 * middle gives an answer one slab short, and the missing slab shows as a black
 * wedge along the base of the cliff.
 *
 * Take the down-right face. The cell's silhouette runs its lower-right edge
 * from `(wx + HW, wy + HH)` to `(wx, wy + 2·HH)`. The lower neighbour is one
 * band nearer and `drop` units down, so its upper-left edge runs from
 * `(wx + HW, wy + drop·HEIGHT_UNIT)` to `(wx, wy + HH + drop·HEIGHT_UNIT)`.
 * Those edges are parallel, and `j` slabs push the cell's down by
 * `j·HEIGHT_STEP`, so they meet when
 *
 *     HH + j·HEIGHT_STEP = drop·HEIGHT_UNIT   ⇒   j = drop/2 − 1
 *
 * The down-left face is the mirror image and gives the same count. So a
 * one-step drop needs nothing added (the cell's own skirt IS one step) and
 * every further step adds one slab.
 */
export const slabsFor = (drop: number) => Math.max(0, Math.ceil(drop / 2) - 1);

/** Reconcile one cell's column: add, re-texture, reposition or remove in place. */
export function syncCliff(
  cl: CliffLayer,
  bl: BandLayer,
  grid: Grid,
  textures: Record<string, Texture>,
  x: number,
  y: number,
): void {
  if (!inBounds(grid, x, y)) return;
  const i = idx(grid, x, y);
  // A void cell has no surface, so nothing to hold a wall up.
  const tex = grid.terrain[i] === VOID ? undefined : textures[cl.wallFrame];
  const want = tex ? slabsFor(exposedDrop(grid, x, y)) : 0;

  let list = cl.slabs[i];
  if (!want) {
    if (list) {
      for (const s of list) { s.parent?.removeChild(s); s.destroy(); }
      cl.slabs[i] = null;
    }
    return;
  }
  if (!list) { list = []; cl.slabs[i] = list; }

  const parent = bl.cliffOf[bandOf(x, y)];
  const { wx, wy } = cellToWorld(x, y, grid.height[i], cl.scale);
  // Anchored to the CELL's own frame, not the wall's: the first slab sits
  // directly below the tile the player sees, and the two frames can differ in
  // height (the atlas has 99px and 131px ground tiles).
  const surfaceFrame = cl.palette[grid.terrain[i]] ?? null;
  const surfaceTex = surfaceFrame ? textures[surfaceFrame] : undefined;
  const top = spriteY(wy, (surfaceTex ?? tex!).height, cl.scale);

  // shrink
  while (list.length > want) {
    const s = list.pop()!;
    s.parent?.removeChild(s);
    s.destroy();
  }
  // grow / update. d = 1 is the slab immediately below the cell's own skirt.
  for (let d = 1; d <= want; d++) {
    let s = list[d - 1];
    if (!s) {
      s = new Sprite(tex!);
      s.anchor.set(0.5, 1);
      s.roundPixels = true;
      list[d - 1] = s;
    } else if (s.texture !== tex) {
      s.texture = tex!;
    }
    // SHALLOWER SLABS MUST DRAW ON TOP. Each slab hides the next one's diamond
    // exactly — the tile silhouette's lower V is congruent with the diamond
    // half below it — but only in that order. Reversed, every slab's upper
    // diamond half is exposed as a pair of triangles poking out of the wall,
    // which is what insertion order alone produced (deepest added last, so
    // drawn last). z-sorted rather than insertion-ordered because a cell can
    // gain slabs later, and appending a new deepest one would break the chain.
    s.zIndex = -d;
    if (s.parent !== parent) parent.addChild(s);
    s.x = wx;
    s.y = top + d * HEIGHT_STEP * cl.scale;
    s.scale.set(cl.scale * TILE_BLEED);
  }
}

/** Build every column. Only for first paint or a full reload. */
export function buildCliffs(
  cl: CliffLayer,
  bl: BandLayer,
  grid: Grid,
  textures: Record<string, Texture>,
): void {
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) syncCliff(cl, bl, grid, textures, x, y);
  }
}

export const slabCount = (cl: CliffLayer) =>
  cl.slabs.reduce((n, l) => n + (l ? l.length : 0), 0);
