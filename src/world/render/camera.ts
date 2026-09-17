/**
 * World v2 — world bounds and band culling.
 *
 * v1 computes its bounds from `generateWorld()` corners plus a fixed 400px pad
 * and bakes in the wrapper size; here the world sits at natural coordinates so
 * bounds are a pure function of the grid.
 */
import { HEIGHT_UNIT, HH, HW, MAX_RISE, TILE_DIAMOND_H, cellToWorld } from "../iso";
import type { Grid } from "../grid";

/** Tallest skirt in the atlases (131px frame − 66px diamond). Padding only. */
const MAX_SKIRT = 65;

export type Bounds = { minX: number; maxX: number; minY: number; maxY: number };

/**
 * Highest point any cell can reach, in half steps.
 *
 * `grid.maxHeight` is the highest cell BASE, and a ramp there rises a further
 * MAX_RISE above it — the named edge is the high one. Leaving that out makes
 * the camera and the cull range short by one rise, which crops the top of the
 * tallest ramp on the map.
 */
const topOf = (grid: Grid) => Math.max(0, grid.maxHeight) + MAX_RISE;

/**
 * World-space AABB of the whole map, including the lift of its tallest cell
 * and the drop of its deepest.
 */
export function worldBounds(grid: Grid, scale = 1, padCells = 1): Bounds {
  const { w, h } = grid;
  // Widest cells on each side: (0, h−1) is far left, (w−1, 0) far right.
  const minX = cellToWorld(0, h - 1, 0, scale).wx - HW * scale * padCells;
  const maxX = cellToWorld(w - 1, 0, 0, scale).wx + HW * scale * padCells;
  // Highest point is the tallest cell in band 0; lowest is the deepest in the last band.
  const minY = -topOf(grid) * HEIGHT_UNIT * scale
    - (TILE_DIAMOND_H / 2) * scale - HH * scale * padCells;
  const maxY = cellToWorld(w - 1, h - 1, 0, scale).wy
    - Math.min(0, grid.minHeight) * HEIGHT_UNIT * scale
    + (MAX_SKIRT + HH) * scale + HH * scale * padCells;
  return { minX, maxX, minY, maxY };
}

export const boundsCentre = (b: Bounds) => ({
  x: (b.minX + b.maxX) / 2,
  y: (b.minY + b.maxY) / 2,
});

/**
 * Which bands can intersect a visible world rect.
 *
 * A band's own row sits at `b · HH`, but a cell in it is lifted by its height,
 * so the range must be widened: the far edge by the map's max lift (a tall
 * column in a distant band can still be on screen) and the near edge by the
 * tallest frame skirt. Two bands of slack absorb rounding.
 */
export function visibleBandRange(
  grid: Grid,
  scale: number,
  viewTop: number,
  viewBottom: number,
): { lo: number; hi: number } {
  const bandY = HH * scale;
  const lift = topOf(grid) * HEIGHT_UNIT * scale;
  const drop = -Math.min(0, grid.minHeight) * HEIGHT_UNIT * scale;
  const lo = Math.floor((viewTop - MAX_SKIRT * scale - drop) / bandY) - 2;
  const hi = Math.ceil((viewBottom + lift) / bandY) + 2;
  return { lo, hi };
}

/**
 * Scale that fits the whole map in a screen of the given size.
 *
 * Fits BOTH axes — the projected map is roughly 2:1 so which axis binds
 * depends on the canvas shape — and leaves a small margin.
 */
export function fitScale(
  b: Bounds,
  screenW: number,
  screenH: number,
  margin = 0.94,
): number {
  const bw = b.maxX - b.minX;
  const bh = b.maxY - b.minY;
  if (bw <= 0 || bh <= 0 || screenW <= 0 || screenH <= 0) return 1;
  return Math.min(screenW / bw, screenH / bh) * margin;
}
