/**
 * World v2 — THE DRAWN SURFACE. The grid is flat cells in half steps, and
 * stays so for everything that is built, flows or is saved. What is DRAWN is
 * a surface fitted to it: every corner of the grid has a height taken from
 * the cells that meet there, so ground that steps a little is a bank, not a
 * wall. @see plans/terrain-quality.md
 *
 * A cell is PINNED — flat at its own height, a ramp at its own plane — where
 * something stands on it that was made for flat ground: paving, a building,
 * a deck, a main. WATER stands level, so the ground beside it comes down to
 * its level at the tile's edge, and its bed is drawn flat as it is. Every
 * other cell is FREE: its middle at its own height, each corner at the mean
 * of the free cells that meet there — those within `CLIFF` of one another;
 * a bigger step is a cliff, and each side keeps its own. A free cell beside
 * a pinned one takes the whole slope, a cutting or an embankment.
 *
 * Pure: a corner is worked out from the four cells round it and nothing kept.
 */
import { RAMP, VOID, idx, inBounds, rampDir, rampRise, structureAt, type Grid } from "../grid";

/** The biggest step, in half steps, drawn as a bank. Over it is a cliff. */
export const CLIFF = 3;

/**
 * A cell's own height at a corner `(u, v)` of it (each 0 or 1), in half
 * steps: its height, or on a ramp its height plus the rise toward the corner.
 * @see surfaceHeight in iso.ts, the same rule
 */
export function cornerZ(grid: Grid, x: number, y: number, u: number, v: number): number {
  const i = idx(grid, x, y), h = grid.height[i], r = grid.ramp[i];
  const rise = rampRise(r);
  if (!rise) return h;
  const d = rampDir(r);
  const t = d === RAMP.S ? u : d === RAMP.N ? 1 - u : d === RAMP.W ? v : 1 - v;
  return h + rise * t;
}

/** Standing water on a cell, with nothing built in it. */
const wet = (grid: Grid, i: number) => grid.pool[i] > 0;

/** Whether a cell is drawn flat at its own height (or its ramp's plane): something on it needs that. */
export function pinned(grid: Grid, x: number, y: number): boolean {
  const i = idx(grid, x, y);
  return !!grid.paved[i] || !!rampRise(grid.ramp[i]) || grid.deck[i] !== 0 || !!grid.main[i] || wet(grid, i) || structureAt(grid, x, y) >= 0;
}

/** What a cell holds a corner of itself at, for the free cells that meet it there: a pinned cell its own height, water its level. */
function heldAt(grid: Grid, x: number, y: number, u: number, v: number): number {
  const i = idx(grid, x, y);
  return wet(grid, i) && !grid.paved[i] && grid.deck[i] === 0 && structureAt(grid, x, y) < 0 ? grid.height[i] + grid.pool[i] : cornerZ(grid, x, y, u, v);
}

const near = [0, 0, 0, 0];

/** The drawn height of cell `(x, y)` at its corner `(u, v)`, half steps. */
export function drawnCorner(grid: Grid, x: number, y: number, u: number, v: number): number {
  if (pinned(grid, x, y)) return cornerZ(grid, x, y, u, v);
  const h = grid.height[idx(grid, x, y)];
  // The four cells round this corner of the grid: what the pinned ones hold it at, and the free ones' heights.
  const X = x + u, Y = y + v;
  let held = NaN, n = 0;
  for (let k = 0; k < 4; k++) {
    const cx = X - (k & 1), cy = Y - (k >> 1);
    if (!inBounds(grid, cx, cy) || grid.terrain[idx(grid, cx, cy)] === VOID) continue;
    if (pinned(grid, cx, cy)) {
      const f = heldAt(grid, cx, cy, X - cx, Y - cy);
      if (Math.abs(f - h) <= CLIFF && !(Math.abs(held - h) <= Math.abs(f - h))) held = f;
    } else near[n++] = grid.height[idx(grid, cx, cy)];
  }
  // Beside something pinned within reach: the free cell takes the whole slope.
  if (!Number.isNaN(held)) return held;
  // Else the mean of the free cells that join it: its own, and any reached from it by steps no bigger than a cliff.
  let lo = h, hi = h, grew = true;
  while (grew) {
    grew = false;
    for (let k = 0; k < n; k++) {
      const q = near[k];
      if (q < lo && lo - q <= CLIFF) { lo = q; grew = true; }
      if (q > hi && q - hi <= CLIFF) { hi = q; grew = true; }
    }
  }
  let sum = 0, m = 0;
  for (let k = 0; k < n; k++) if (near[k] >= lo && near[k] <= hi) { sum += near[k]; m++; }
  return m ? sum / m : h;
}

/** Whether a cell is drawn as one level top: pinned, or free with every corner at its own height. */
export function drawnFlat(grid: Grid, x: number, y: number): boolean {
  if (pinned(grid, x, y)) return true;
  const h = grid.height[idx(grid, x, y)];
  return drawnCorner(grid, x, y, 0, 0) === h && drawnCorner(grid, x, y, 1, 0) === h && drawnCorner(grid, x, y, 1, 1) === h && drawnCorner(grid, x, y, 0, 1) === h;
}

/**
 * THE DRAWN HEIGHT AT A POINT `(fx, fy)` on the ground, cells (a cell covers x…x+1): what stands on bare ground
 * stands at this. A pinned cell's is its plane; a free one's a fan from its middle, at its own height, to its corners.
 */
export function drawnHeight(grid: Grid, fx: number, fy: number): number {
  const x = Math.max(0, Math.min(grid.w - 1, Math.floor(fx))), y = Math.max(0, Math.min(grid.h - 1, Math.floor(fy)));
  const a = Math.max(0, Math.min(1, fx - x)), b = Math.max(0, Math.min(1, fy - y));
  const c00 = drawnCorner(grid, x, y, 0, 0), c10 = drawnCorner(grid, x, y, 1, 0), c11 = drawnCorner(grid, x, y, 1, 1), c01 = drawnCorner(grid, x, y, 0, 1);
  if (pinned(grid, x, y)) return (c00 * (1 - a) + c10 * a) * (1 - b) + (c01 * (1 - a) + c11 * a) * b;
  const h = grid.height[idx(grid, x, y)], da = a - 0.5, db = b - 0.5, t = 2 * Math.max(Math.abs(da), Math.abs(db));
  if (t <= 0) return h;
  // Out along the ray from the middle to the edge it meets, and how far along that edge.
  let edge: number;
  if (Math.abs(da) >= Math.abs(db)) { const s = 0.5 + db / (2 * Math.abs(da)); edge = da > 0 ? c10 + (c11 - c10) * s : c00 + (c01 - c00) * s; }
  else { const s = 0.5 + da / (2 * Math.abs(db)); edge = db > 0 ? c01 + (c11 - c01) * s : c00 + (c10 - c00) * s; }
  return h + t * (edge - h);
}
