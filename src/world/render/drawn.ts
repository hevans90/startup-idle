/**
 * World v2 — THE DRAWN SURFACE. The grid is flat cells in half steps, and
 * stays so for everything that is built, flows or is saved. What is DRAWN is
 * a surface fitted to it: every corner of the grid has a height taken from
 * the cells that meet there, so ground that steps a little is a bank, not a
 * wall. @see plans/terrain-quality.md
 *
 * A cell is PINNED — flat at its own height, a ramp at its own plane — where
 * something stands on it that was made for flat ground: paving, a building,
 * a deck, a main. Every other cell is FREE: its middle at its own height, each corner at the mean
 * of the free cells that meet there — those within `CLIFF` of one another;
 * a bigger step is a cliff, and each side keeps its own. A free cell beside
 * a pinned one takes the whole slope, a cutting or an embankment.
 *
 * THE SHORE. Standing water (`pool`) beside bare land a little over its level
 * is drawn on a SHELF: that tile's middle just under the water, not at its
 * bed, so the corners it shares with the land stand just over the water and
 * the ground goes under it part-way across the tile — along a line that cuts
 * a stepped bank's corners, which is the shoreline the water is cut to.
 * @see shelfOf, water-gpu.ts
 *
 * Pure: a corner is worked out from the cells round it and nothing kept.
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

/** Standing water on a cell. */
const wet = (grid: Grid, i: number) => grid.pool[i] > 0;
/** How far over water's level bare land may stand and still come down to it as a shore, half steps; how far under it a shelf's middle lies at most. */
export const SHORE = 4, SHELF = 0.6;
/** How far under the water a shelf's corners are where it meets no land, half steps (or its bed, if that is nearer). */
const SHELF_DROP = 2.5;

/** Whether a cell is drawn flat at its own height (or its ramp's plane): something on it needs that. */
export function pinned(grid: Grid, x: number, y: number): boolean {
  const i = idx(grid, x, y);
  return !!grid.paved[i] || !!rampRise(grid.ramp[i]) || grid.deck[i] !== 0 || !!grid.main[i] || structureAt(grid, x, y) >= 0;
}

/** Standing water with a drop beside it: a neighbour whose own surface is two half steps or more under this water's. */
function lipAt(grid: Grid, x: number, y: number): boolean {
  const i = idx(grid, x, y);
  if (!wet(grid, i)) return false;
  const level = grid.height[i] + grid.pool[i];
  for (let k = 0; k < 4; k++) {
    const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
    if (!inBounds(grid, nx, ny)) continue;
    const j = idx(grid, nx, ny);
    if (grid.terrain[j] !== VOID && grid.height[j] + grid.pool[j] <= level - 2) return true;
  }
  return false;
}

/**
 * A SHELF: the drawn height of the middle of a tile of standing water that has bare land beside it (corner to corner
 * counts) standing over its level by no more than `SHORE` — just under the water, and the less under it the lower
 * that land, so every corner they share stays over the water. Null for any other cell.
 */
export function shelfOf(grid: Grid, x: number, y: number): number | null {
  const i = idx(grid, x, y);
  if (!wet(grid, i) || pinned(grid, x, y)) return null;
  const level = grid.height[i] + grid.pool[i];
  // NOT AT A LIP, nor beside one: where the water goes over an edge its surface is drawn down to the sheet that
  // falls from it, and a shelf would hold it level and break the two apart.
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inBounds(grid, x + dx, y + dy) && lipAt(grid, x + dx, y + dy)) return null;
  let low = Infinity;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const nx = x + dx, ny = y + dy;
    if ((!dx && !dy) || !inBounds(grid, nx, ny)) continue;
    const j = idx(grid, nx, ny);
    if (grid.terrain[j] === VOID || wet(grid, j) || pinned(grid, nx, ny)) continue;
    const up = grid.height[j] - level;
    if (up > 0 && up <= SHORE && up < low) low = up;
  }
  return low === Infinity ? null : level - Math.min(SHELF, grid.pool[i], low * 0.3);
}
/** The drawn height of a free cell's middle: its own, or its shelf's. */
export function drawnCentre(grid: Grid, x: number, y: number): number {
  return shelfOf(grid, x, y) ?? grid.height[idx(grid, x, y)];
}

const near = [0, 0, 0, 0], reach = [0, 0, 0, 0], beds = [0, 0, 0, 0];

/** The drawn height of cell `(x, y)` at its corner `(u, v)`, half steps. */
export function drawnCorner(grid: Grid, x: number, y: number, u: number, v: number): number {
  if (pinned(grid, x, y)) return cornerZ(grid, x, y, u, v);
  // Its own middle; and what it is JOINED by — a shelf joins as the land a step over its water would, so the bank
  // beside it comes down to it and the deep bed beyond does not.
  const shelf = shelfOf(grid, x, y), h = shelf ?? grid.height[idx(grid, x, y)];
  const own = shelf === null ? h : grid.height[idx(grid, x, y)] + grid.pool[idx(grid, x, y)] + 1;
  // The four cells round this corner of the grid: what the pinned ones hold it at, and the free ones' middles.
  const X = x + u, Y = y + v;
  let held = NaN, n = 0;
  for (let k = 0; k < 4; k++) {
    const cx = X - (k & 1), cy = Y - (k >> 1);
    if (!inBounds(grid, cx, cy) || grid.terrain[idx(grid, cx, cy)] === VOID) continue;
    if (pinned(grid, cx, cy)) {
      const f = cornerZ(grid, cx, cy, X - cx, Y - cy);
      if (Math.abs(f - h) <= CLIFF && !(Math.abs(held - h) <= Math.abs(f - h))) held = f;
    } else {
      const j = idx(grid, cx, cy), sh = shelfOf(grid, cx, cy);
      near[n] = sh ?? grid.height[j];
      beds[n] = grid.height[j];
      reach[n++] = sh === null ? grid.height[j] : grid.height[j] + grid.pool[j] + 1;
    }
  }
  // Beside something pinned within reach: the free cell takes the whole slope.
  if (!Number.isNaN(held)) return held;
  // Else the mean of the free cells that join it: its own, and any reached from it by steps no bigger than a cliff.
  let lo = own, hi = own, grew = true;
  while (grew) {
    grew = false;
    for (let k = 0; k < n; k++) {
      const q = reach[k];
      if (q < lo && lo - q <= CLIFF) { lo = q; grew = true; }
      if (q > hi && q - hi <= CLIFF) { hi = q; grew = true; }
    }
  }
  let sum = 0, m = 0, lands = 0, bed = -Infinity, level = -Infinity;
  for (let k = 0; k < n; k++) if (reach[k] >= lo && reach[k] <= hi) {
    sum += near[k]; m++;
    if (reach[k] === near[k]) lands++; else { bed = Math.max(bed, beds[k]); level = Math.max(level, reach[k] - 1); }
  }
  const land = lands > 0;
  // (The tip of a point of land, water on three sides: just under the water, or a spur of it stands out along the tiles' edge.)
  if (lands === 1 && m === 4) return Math.min(sum / m, level - 0.15);
  // A shelf's corners out in the water, where no land meets it, go on down: the shelf is a slope into the deep, not a ledge.
  // (No lower than the highest bed of the shelves that meet there, so they all say the same.)
  if (shelf !== null && !land) return Math.max(bed, own - 1 - SHELF_DROP);
  return m ? sum / m : h;
}

/** Whether a cell is drawn as one level top: pinned, or free with every corner at its own height. */
export function drawnFlat(grid: Grid, x: number, y: number): boolean {
  if (pinned(grid, x, y)) return true;
  const h = drawnCentre(grid, x, y);
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
  const h = drawnCentre(grid, x, y), da = a - 0.5, db = b - 0.5, t = 2 * Math.max(Math.abs(da), Math.abs(db));
  if (t <= 0) return h;
  // Out along the ray from the middle to the edge it meets, and how far along that edge.
  let edge: number;
  if (Math.abs(da) >= Math.abs(db)) { const s = 0.5 + db / (2 * Math.abs(da)); edge = da > 0 ? c10 + (c11 - c10) * s : c00 + (c01 - c00) * s; }
  else { const s = 0.5 + da / (2 * Math.abs(db)); edge = db > 0 ? c01 + (c11 - c01) * s : c00 + (c10 - c00) * s; }
  return h + t * (edge - h);
}
