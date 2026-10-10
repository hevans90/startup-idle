/**
 * World v2 — the map's rivers, as boats and seaports see them.
 *
 * A RIVER is water that comes in over the map's edge: the tiles deep enough to
 * float a boat that are joined, a side at a time, to a tile with an inflow.
 * A lake is not one, nor a puddle, however deep — nothing arrives on them and
 * nothing leaves. Each river is its own component, so a seaport on one does
 * not send boats down another. @see Grid.inflow
 *
 * Where a river comes in is where its boats appear (its SOURCES, the inflow
 * tiles), and where it reaches the rim anywhere else is where they go (its
 * EXITS). Every river tile knows how many steps it is from an exit, so a boat
 * under way can find the way out round any bend by going downhill on that
 * count — the current alone stalls in a pool or a slack reach. @see downstream
 *
 * PURE: a grid and a depth per tile in, a map out. The store reads the depth
 * from the water; a fixture, built before there is any water, from the pool
 * it was filled with. Recomputed now and then rather than kept up to date,
 * because the water it depends on never stops moving. @see stepTraffic
 */
import { COLUMNS_PER_TILE } from "../water/field";
import type { ColumnField } from "../../fluid/columns";
import { footprintCells, inBounds, type Grid } from "../grid";

/** Deeper than this, in half steps, and a tile is navigable river. */
export const RIVER_DEPTH = 1;
/** Half steps under a river's highest-held inflow that an inflow still counts as a source. */
const SOURCE_SLACK = 0.5;
/** How far down a river, in steps along it, the rim has to be to be a way out. */
const EXIT_FROM_SOURCE = 8;

export type RiverMap = {
  w: number;
  h: number;
  /** Which river a tile is in, from 1; nought for none. */
  river: Int32Array;
  /** Steps to the nearest exit of its river; Infinity off the river or with no exit. */
  toExit: Float32Array;
  /** Inflow tiles, per river. */
  sources: { x: number; y: number; river: number }[];
  /** Exit tiles, per river. */
  exits: { x: number; y: number; river: number }[];
};

/**
 * Whether any river tile lies within `d` tiles — along either axis, the
 * square round it — of a footprint.
 */
export function riverWithin(r: RiverMap, x0: number, y0: number, w: number, h: number, d: number): boolean {
  for (let y = Math.max(0, y0 - d); y < Math.min(r.h, y0 + h + d); y++) {
    for (let x = Math.max(0, x0 - d); x < Math.min(r.w, x0 + w + d); x++) {
      if (r.river[y * r.w + x] > 0) return true;
    }
  }
  return false;
}

/**
 * Whether a map has a RIVER on it at all: water fed over the map's edge, not
 * a lake. Read off the standing water, so it needs no running water field.
 * @see Grid.inflow
 */
export const hasRiver = (g: Grid): boolean => mapRiver(g, poolDepthOf(g)).sources.length > 0;

/** The mean depth over a tile's columns, storey nought. */
export function tileDepthOf(c: ColumnField): (i: number, x: number, y: number) => number {
  const n = COLUMNS_PER_TILE;
  return (_i, x, y) => {
    let s = 0;
    for (let j = 0; j < n; j++) {
      const row = (y * n + j) * c.nx + x * n;
      for (let k = 0; k < n; k++) s += c.depth[row + k];
    }
    return s / (n * n);
  };
}

/** A grid's own standing water as a depth per tile, for a map with no field yet. */
export const poolDepthOf = (g: Grid) => (i: number) => g.pool[i];

const onRim = (g: Grid, x: number, y: number) => x === 0 || y === 0 || x === g.w - 1 || y === g.h - 1;

const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

export function mapRiver(
  g: Grid, depthAt: (i: number, x: number, y: number) => number, minDepth = RIVER_DEPTH,
): RiverMap {
  const n = g.w * g.h;
  const deep = new Uint8Array(n);
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const i = y * g.w + x;
      // A STRUCTURE'S FOOTPRINT is never river, whatever is under it.
      if (g.structureAt[i] < 0 && depthAt(i, x, y) > minDepth) deep[i] = 1;
    }
  }
  const river = new Int32Array(n);
  const toExit = new Float32Array(n).fill(Infinity);
  const sources: RiverMap["sources"] = [];
  const exits: RiverMap["exits"] = [];
  let label = 0;
  const queue = new Int32Array(n);

  for (let i0 = 0; i0 < n; i0++) {
    if (!deep[i0] || river[i0] || g.inflow[i0] === 0) continue;
    // A NEW RIVER, flooded out from this inflow over every deep tile it touches.
    label++;
    let head = 0, tail = 0;
    queue[tail++] = i0;
    river[i0] = label;
    const members: number[] = [];
    while (head < tail) {
      const i = queue[head++];
      members.push(i);
      const x = i % g.w, y = (i / g.w) | 0;
      for (const [dx, dy] of STEPS) {
        const nx = x + dx, ny = y + dy;
        if (!inBounds(g, nx, ny)) continue;
        const j = ny * g.w + nx;
        if (deep[j] && !river[j]) { river[j] = label; queue[tail++] = j; }
      }
    }
    // Its sources and its exits: an inflow is where it comes in, and the rim
    // well down the river from it is where it goes out.
    //
    // WELL DOWN IT, by the river's own path: a river is often wider at the rim
    // than the inflow that feeds it, and the tiles either side of the inflow
    // touch the rim too. Counted as exits, they were the nearest way out of
    // the river for every boat that came in, and each one turned round and
    // left by the edge it had just arrived over.
    //
    // THE HIGHEST-HELD INFLOWS ONLY. An edge can be held at a level where a
    // river LEAVES as well as where it comes in — held lower, so it is the way
    // the water goes, and a river drained by a bare open edge runs too shallow
    // at the rim to float a boat out. Water comes in where it is held highest;
    // an inflow held lower than that is an exit like any other rim tile.
    let top = -Infinity;
    for (const i of members) if (g.inflow[i] !== 0) top = Math.max(top, g.height[i] + g.inflow[i]);
    const isSource = (i: number) => g.inflow[i] !== 0 && g.height[i] + g.inflow[i] >= top - SOURCE_SLACK;
    const fromSource = new Map<number, number>();
    head = 0; tail = 0;
    for (const i of members) {
      if (!isSource(i)) continue;
      sources.push({ x: i % g.w, y: (i / g.w) | 0, river: label });
      fromSource.set(i, 0);
      queue[tail++] = i;
    }
    while (head < tail) {
      const i = queue[head++];
      const x = i % g.w, y = (i / g.w) | 0;
      for (const [dx, dy] of STEPS) {
        const nx = x + dx, ny = y + dy;
        if (!inBounds(g, nx, ny)) continue;
        const j = ny * g.w + nx;
        if (river[j] === label && !fromSource.has(j)) { fromSource.set(j, fromSource.get(i)! + 1); queue[tail++] = j; }
      }
    }
    head = 0; tail = 0;
    for (const i of members) {
      const x = i % g.w, y = (i / g.w) | 0;
      if (isSource(i) || !onRim(g, x, y) || !((fromSource.get(i) ?? Infinity) >= EXIT_FROM_SOURCE)) continue;
      exits.push({ x, y, river: label });
      toExit[i] = 0;
      queue[tail++] = i;
    }
    // Steps to the way out, over this river's tiles.
    while (head < tail) {
      const i = queue[head++];
      const x = i % g.w, y = (i / g.w) | 0;
      for (const [dx, dy] of STEPS) {
        const nx = x + dx, ny = y + dy;
        if (!inBounds(g, nx, ny)) continue;
        const j = ny * g.w + nx;
        if (river[j] === label && toExit[j] === Infinity) { toExit[j] = toExit[i] + 1; queue[tail++] = j; }
      }
    }
  }
  return { w: g.w, h: g.h, river, toExit, sources, exits };
}

/** Which river a tile is in, from 1, or nought. */
export const riverAt = (r: RiverMap, x: number, y: number) =>
  x < 0 || y < 0 || x >= r.w || y >= r.h ? 0 : r.river[y * r.w + x];

/**
 * The rivers a footprint stands on the BANK of: those a tile orthogonally
 * beside it is in. Empty when it touches none — or when it stands IN one,
 * which is not the bank. @see validatePlacement
 */
export function riversBeside(r: RiverMap, x0: number, y0: number, w: number, h: number): number[] {
  const out = new Set<number>();
  for (const c of footprintCells(x0, y0, w, h)) {
    if (riverAt(r, c.x, c.y)) return [];
    for (const [dx, dy] of STEPS) {
      const nx = c.x + dx, ny = c.y + dy;
      if (nx >= x0 && nx < x0 + w && ny >= y0 && ny < y0 + h) continue;
      const k = riverAt(r, nx, ny);
      if (k) out.add(k);
    }
  }
  return [...out];
}

/**
 * Which way is downstream at a point, in tile coordinates, as a unit vector:
 * down the steps-to-exit count across the tiles round it. Null off a river,
 * or on one with nowhere to go.
 */
export const downstream = (r: RiverMap, x: number, y: number) =>
  downhill(r.toExit, r.w, r.h, x, y, true);

/**
 * Which way is down a steps-to-somewhere count at a point, as a unit vector.
 *
 * Weighted over the tile's four neighbours rather than toward the least, so a
 * boat crossing from one tile to the next turns smoothly and does not snap
 * between the axes. With `outAtZero`, off the map from a tile at nought is
 * the way to go: the way out of the map, for an exit.
 */
export function downhill(
  field: Float32Array, w: number, h: number, x: number, y: number, outAtZero = false,
): { x: number; y: number } | null {
  const tx = Math.round(x), ty = Math.round(y);
  if (tx < 0 || ty < 0 || tx >= w || ty >= h) return null;
  const here = field[ty * w + tx];
  if (!Number.isFinite(here)) return null;
  let vx = 0, vy = 0;
  for (const [dx, dy] of STEPS) {
    const nx = tx + dx, ny = ty + dy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
      if (outAtZero && here === 0) { vx += dx; vy += dy; }
      continue;
    }
    const d = field[ny * w + nx];
    if (!Number.isFinite(d)) continue;
    vx += (here - d) * dx;
    vy += (here - d) * dy;
  }
  const m = Math.hypot(vx, vy);
  return m > 1e-6 ? { x: vx / m, y: vy / m } : null;
}

/**
 * Steps from the nearest of some river tiles to every other tile of their
 * river; Infinity elsewhere. The tiles are taken to be on one river.
 */
export function stepsFrom(r: RiverMap, seeds: readonly { x: number; y: number }[]): Float32Array {
  const out = new Float32Array(r.w * r.h).fill(Infinity);
  const label = seeds.length ? riverAt(r, seeds[0].x, seeds[0].y) : 0;
  if (!label) return out;
  const queue = new Int32Array(r.w * r.h);
  let head = 0, tail = 0;
  for (const s of seeds) {
    const i = s.y * r.w + s.x;
    if (r.river[i] !== label || out[i] === 0) continue;
    out[i] = 0;
    queue[tail++] = i;
  }
  while (head < tail) {
    const i = queue[head++];
    const cx = i % r.w, cy = (i / r.w) | 0;
    for (const [dx, dy] of STEPS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= r.w || ny >= r.h) continue;
      const j = ny * r.w + nx;
      if (r.river[j] === label && out[j] === Infinity) { out[j] = out[i] + 1; queue[tail++] = j; }
    }
  }
  return out;
}

/** A place a boat ties up: its river tile, and the point in it it moors at. */
export type BerthSpot = { tx: number; ty: number; x: number; y: number; river: number };

/**
 * Where boats tie up at a structure on a river's bank: up to `n` river tiles
 * beside it, all along ONE side — the side with the most river beside it,
 * which is its quay — spread out along that side. Empty if no river is beside
 * it. Each point is in its tile, drawn in toward the quay. @see traffic
 */
export function berthsBeside(
  r: RiverMap, x0: number, y0: number, w: number, h: number, n: number,
): BerthSpot[] {
  const sides = new Map<string, BerthSpot[]>();
  for (const c of footprintCells(x0, y0, w, h)) {
    for (const [dx, dy] of STEPS) {
      const nx = c.x + dx, ny = c.y + dy;
      if (nx >= x0 && nx < x0 + w && ny >= y0 && ny < y0 + h) continue;
      const river = riverAt(r, nx, ny);
      if (!river) continue;
      const key = `${dx},${dy}`;
      const list = sides.get(key) ?? [];
      list.push({ tx: nx, ty: ny, x: nx - dx * BERTH_IN, y: ny - dy * BERTH_IN, river });
      sides.set(key, list);
    }
  }
  let quay: BerthSpot[] = [];
  for (const list of sides.values()) if (list.length > quay.length) quay = list;
  quay.sort((a, b) => a.tx - b.tx || a.ty - b.ty);
  if (quay.length <= n) return quay;
  // Spread along it: the middle for one, the ends and between for more.
  if (n === 1) return [quay[(quay.length - 1) >> 1]];
  return Array.from({ length: n }, (_, k) => quay[Math.round((k * (quay.length - 1)) / (n - 1))]);
}

/** How far in from its tile's middle toward the quay a boat ties up, tiles. */
const BERTH_IN = 0.2;

/** Whether a tile index is an exit — for a boat to leave the map by. */
export const isExit = (r: RiverMap, x: number, y: number) => {
  const tx = Math.round(x), ty = Math.round(y);
  return tx >= 0 && ty >= 0 && tx < r.w && ty < r.h && r.toExit[ty * r.w + tx] === 0;
};
