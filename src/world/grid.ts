/**
 * World v2 — dense cell storage.
 *
 * Every per-cell layer is a typed array indexed `y * w + x`. v1 used
 * `Set<string>` with `"x,y"` keys, which allocates a string per lookup — fine
 * for a world built once, but autotiling and cliff-face resolution both walk
 * neighbours constantly, so v2 pays nothing per read.
 *
 * Nothing here is memoized at module scope (v1's `generateWorld()` caches a
 * single immutable world, which is precisely why it can never change).
 */

import { RAMP, rampDir, rampRise, type RampDir, type Surface, type SurfaceAt } from "./iso";

export { RAMP, RAMP_HALF, RAMP_NAME, packRamp, rampDir, rampRise, type RampDir } from "./iso";

/** Palette index 0 is reserved for VOID on both material layers. */
export const VOID = 0;

/**
 * One placed structure.
 *
 * `structureAt` stores the **id**, not an index into a list. An index is not
 * stable: demolishing compacts the list and every later structure's cells then
 * point at the wrong record — and undo, which restores records out of order,
 * makes that worse. Ids are monotonic and never reused, so a cell either names
 * a structure that exists or names nothing.
 *
 * The footprint is recorded on the INSTANCE as well as on its definition. That
 * is deliberate duplication: `structureAt` and this record have to agree about
 * which cells are occupied, and rebuilding the layer on load must not depend on
 * a definition that may since have changed shape or been removed altogether.
 */
export type Structure = {
  id: number;
  /** {@link import("./structures/def").StructureDef} id. */
  def: string;
  /** Footprint origin — its minimum x and y. */
  x: number;
  y: number;
  /** Footprint size, as placed. */
  w: number;
  h: number;
};
export type Grid = {
  readonly w: number;
  readonly h: number;
  /** Material index per cell; 0 = void (renders nothing). */
  terrain: Uint16Array;
  /** Elevation in HALF steps, signed: + hill, − excavated. */
  height: Int8Array;
  /** Paved material index per cell; 0 = unpaved. */
  paved: Uint16Array;
  /** {@link RAMP} direction per cell; 0 = level. */
  ramp: Uint8Array;
  /** Structure ID per cell, −1 = empty. An ID, not a list index — see {@link Structure}. */
  structureAt: Int32Array;
  /** Placed structures, by id. */
  structures: Map<number, Structure>;
  /** Next id to hand out. Monotonic, so an id is never reused. */
  nextStructureId: number;
  /** Cached bounds of `height`, kept current by {@link setHeight}. */
  minHeight: number;
  maxHeight: number;
};

export function createGrid(w: number, h: number, terrainFill = VOID): Grid {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
    throw new Error(`createGrid: bad size ${w}×${h}`);
  }
  const n = w * h;
  const g: Grid = {
    w, h,
    terrain: new Uint16Array(n),
    height: new Int8Array(n),
    paved: new Uint16Array(n),
    ramp: new Uint8Array(n),
    structureAt: new Int32Array(n),
    structures: new Map(),
    nextStructureId: 1,
    minHeight: 0,
    maxHeight: 0,
  };
  if (terrainFill !== VOID) g.terrain.fill(terrainFill);
  g.structureAt.fill(-1);
  return g;
}

export const inBounds = (g: Grid, x: number, y: number) =>
  x >= 0 && y >= 0 && x < g.w && y < g.h;

/** Flat index. Callers must have checked bounds. */
export const idx = (g: Grid, x: number, y: number) => y * g.w + x;

export const terrainAt = (g: Grid, x: number, y: number) =>
  inBounds(g, x, y) ? g.terrain[idx(g, x, y)] : VOID;

export const pavedAt = (g: Grid, x: number, y: number) =>
  inBounds(g, x, y) ? g.paved[idx(g, x, y)] : VOID;

/** Structure id occupying a cell, or −1. */
export const structureAt = (g: Grid, x: number, y: number) =>
  inBounds(g, x, y) ? g.structureAt[idx(g, x, y)] : -1;

/** The structure occupying a cell, or null. */
export function structureOf(g: Grid, x: number, y: number): Structure | null {
  const id = structureAt(g, x, y);
  return id < 0 ? null : g.structures.get(id) ?? null;
}

/** Every cell of a footprint, row-major. Cells outside the map are included. */
export function footprintCells(x: number, y: number, w: number, h: number) {
  const out: { x: number; y: number }[] = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push({ x: x + dx, y: y + dy });
  return out;
}

/**
 * Write a structure's id across its footprint, or −1 to lift it.
 *
 * For rebuilding the layer on LOAD. Editing goes through a command instead, so
 * that undo has the before/after values — see `edit/commands`.
 */
export function stampFootprint(g: Grid, s: Structure, id = s.id) {
  for (const c of footprintCells(s.x, s.y, s.w, s.h)) {
    if (inBounds(g, c.x, c.y)) g.structureAt[idx(g, c.x, c.y)] = id;
  }
}

export const rampAt = (g: Grid, x: number, y: number): RampDir =>
  inBounds(g, x, y) ? rampDir(g.ramp[idx(g, x, y)]) : RAMP.NONE;

/** Packed ramp byte (direction + rise bit); 0 off-map. */
export const rampPackedAt = (g: Grid, x: number, y: number): number =>
  inBounds(g, x, y) ? g.ramp[idx(g, x, y)] : 0;

/**
 * Surface sampler for {@link import("./iso").pickCell}, bound to a grid.
 *
 * Returns null off-map rather than a zero surface: picking marches candidate
 * cells and accepts the first whose face contains the point, so a phantom
 * surface outside the world would be picked in preference to real ground
 * behind it.
 */
export const surfaceSampler = (g: Grid): SurfaceAt => (x, y): Surface | null => {
  if (!inBounds(g, x, y)) return null;
  const i = idx(g, x, y);
  const packed = g.ramp[i];
  return { height: g.height[i], ramp: rampDir(packed), rise: rampRise(packed) };
};

/**
 * Height, or `null` out of bounds.
 *
 * The null matters: {@link import("./iso").pickCell} walks candidate heights
 * and compares, so returning 0 for an off-map cell would let it match a
 * phantom cell outside the world.
 */
export const heightAt = (g: Grid, x: number, y: number): number | null =>
  inBounds(g, x, y) ? g.height[idx(g, x, y)] : null;

export function setTerrain(g: Grid, x: number, y: number, v: number) {
  if (inBounds(g, x, y)) g.terrain[idx(g, x, y)] = v;
}

export function setPaved(g: Grid, x: number, y: number, v: number) {
  if (inBounds(g, x, y)) g.paved[idx(g, x, y)] = v;
}

export function setRamp(g: Grid, x: number, y: number, v: RampDir) {
  if (inBounds(g, x, y)) g.ramp[idx(g, x, y)] = v;
}

/** Sets height and keeps the cached range correct (widen now, rescan on shrink). */
export function setHeight(g: Grid, x: number, y: number, v: number) {
  if (!inBounds(g, x, y)) return;
  const i = idx(g, x, y);
  const prev = g.height[i];
  if (prev === v) return;
  g.height[i] = v;
  if (v > g.maxHeight || v < g.minHeight) {
    // widening is O(1)
    g.maxHeight = Math.max(g.maxHeight, v);
    g.minHeight = Math.min(g.minHeight, v);
  } else if (prev === g.maxHeight || prev === g.minHeight) {
    // we may have removed the last cell at an extreme — rescan
    recomputeHeightRange(g);
  }
}

export function recomputeHeightRange(g: Grid) {
  let lo = 0, hi = 0;
  for (let i = 0; i < g.height.length; i++) {
    const v = g.height[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  g.minHeight = lo;
  g.maxHeight = hi;
}

/** Fill the whole map with one terrain material at height 0. */
export function fillTerrain(g: Grid, material: number) {
  g.terrain.fill(material);
}

/** Iterate every cell of one band (`x + y === band`), ascending in x. */
export function forEachInBand(
  g: Grid,
  band: number,
  fn: (x: number, y: number) => void,
) {
  const xLo = Math.max(0, band - (g.h - 1));
  const xHi = Math.min(g.w - 1, band);
  for (let x = xLo; x <= xHi; x++) fn(x, band - x);
}
