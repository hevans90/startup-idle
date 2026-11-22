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
import { groundMode } from "./ground-mode";
import { fieldWater } from "./water-mode";
import { RAMP, VOID, idx, inBounds, rampDir, rampRise, structureAt, type Grid } from "../grid";
import type { SurfaceAt } from "../iso";

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
export const SHORE = 4, SHELF = 1.2;
/** How far under the water a shelf's corners are where it meets no land, half steps (or its bed, if that is nearer). */
const SHELF_DROP = 2.5;

/** Whether a cell is drawn flat at its own height (or its ramp's plane): something on it needs that. */
export function pinned(grid: Grid, x: number, y: number): boolean {
  // (With the ground drawn as the grid is — steps — every cell is.)
  return groundMode() === "steps" || built(grid, x, y);
}
/** Whether something stands on a cell that was made for flat ground: paving, a ramp, a deck, a main, a building. */
export function built(grid: Grid, x: number, y: number): boolean {
  const i = idx(grid, x, y);
  return !!grid.paved[i] || !!rampRise(grid.ramp[i]) || grid.deck[i] !== 0 || !!grid.main[i] || structureAt(grid, x, y) >= 0;
}

/** A road on the ground: paving that is not a bridge's deck. */
export function road(grid: Grid, x: number, y: number): boolean {
  if (!inBounds(grid, x, y)) return false;
  const i = idx(grid, x, y);
  return !!grid.paved[i] && grid.deck[i] === 0 && grid.terrain[i] !== VOID;
}
/**
 * A ROAD ON THE CONTINUOUS SURFACE IS NOT A ROW OF BLOCKS: where a corner `(X, Y)` of the grid is drawn for the road
 * tiles that meet there — the mean of what each says of it (its height, or its ramp's plane there), so every tile
 * of road at a corner has it at one height and a road that climbs a step a tile is one slope, with no wall between
 * its tiles and no ramp needed to join them. A bridge's deck at the corner holds it at the deck. Pure.
 */
export function roadCorner(grid: Grid, X: number, Y: number): number {
  let sum = 0, n = 0;
  for (let k = 0; k < 4; k++) {
    const cx = X - (k & 1), cy = Y - (k >> 1);
    if (!inBounds(grid, cx, cy)) continue;
    const i = idx(grid, cx, cy);
    if (!grid.paved[i] || grid.terrain[i] === VOID) continue;
    if (grid.deck[i] !== 0) return grid.deckZ[i];
    sum += cornerZ(grid, cx, cy, X - cx, Y - cy); n++;
  }
  return n ? sum / n : 0;
}
/**
 * A road tile's surface at `(u, v)` on it, half steps: through its four drawn corners, as the two triangles its top
 * is drawn and painted as — (0,0)-(1,0)-(1,1) where u ≥ v, (0,0)-(1,1)-(0,1) where not — so what drives on it is
 * on it, not over or under a tile whose corners are not on one plane. @see roadCorner, road-paint.ts CellPaint.zc
 */
export function roadZ(grid: Grid, x: number, y: number, u: number, v: number): number {
  const z00 = roadCorner(grid, x, y), z10 = roadCorner(grid, x + 1, y), z11 = roadCorner(grid, x + 1, y + 1), z01 = roadCorner(grid, x, y + 1);
  return u >= v ? z00 + u * (z10 - z00) + v * (z11 - z10) : z00 + u * (z11 - z01) + v * (z01 - z00);
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
  // (As one continuous surface the bed needs no shelf: it comes up to the bank of itself.)
  if (groundMode() !== "banks") return null;
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
  // (Deep enough that the water over it is water, not a bar of sand showing through it from bank to bank; never
  // deeper than the land is high, so the edge they share stays over the water.)
  return low === Infinity ? null : level - Math.min(SHELF, grid.pool[i], low * 0.9);
}
/**
 * The drawn height of a free cell's middle: its own; or, on a shelf, the mean of its corners — so a shelf is as
 * near a plane as its corners allow and the waterline crosses it straight, not in a tooth a tile.
 */
export function drawnCentre(grid: Grid, x: number, y: number): number {
  if (shelfOf(grid, x, y) === null) return grid.height[idx(grid, x, y)];
  return (drawnCorner(grid, x, y, 0, 0) + drawnCorner(grid, x, y, 1, 0) + drawnCorner(grid, x, y, 1, 1) + drawnCorner(grid, x, y, 0, 1)) / 4;
}

const near = [0, 0, 0, 0], reach = [0, 0, 0, 0], beds = [0, 0, 0, 0], wets = [false, false, false, false];

/**
 * THE CONTINUOUS SURFACE AT THE POINTS A BUILD KEEPS ASKING FOR, kept while a whole map's ground is being made.
 *
 * The ground is cut into quarters of a tile, and a build asks for the surface at the same quarter points over and
 * over: a corner by each of the four cells round it, for its texel and again for its quads; a tile's quads for a
 * ring of points into the tiles beside it. Each is a reading of the whole surface. Read only while
 * {@link withCorners} runs — nothing may change the map meanwhile — and kept after it only while every
 * cell it is read from is as it was: so nothing has to know when to forget it. Inside it the surface also reads every cell's middle from a
 * table, and looks for built ground to meet only where there is some.
 * Doubles, and only points that are a whole number of `1/fine` (a power of two, so the point asked for is the
 * point kept, to the bit): what is kept is exactly what would have been worked out.
 */
/** How finely the builds that share readings cut a tile, a side: the ground's mesh, its shade and the water's columns. @see withCorners */
export const SURFACE_FINE = 4;
type Kept = {
  grid: Grid; mode: string; fine: number; across: number; down: number;
  /** What the surface is read from, a cell: its height, its ramp, its deck's height, and whether it is void, paved, decked, on a main, under a building. The readings are kept for as long as none of it has changed. */
  from: Int32Array;
  /** The surface at every point that is a whole number of `1/fine`, a tile out past the map each way; NaN until asked. */
  at: Float64Array | null;
  /** And at the middle of every `1/fine` of a tile, where the ground there is bare: what the water's columns stand on and the shade is baked from. */
  mids: Float64Array | null;
  /** Every cell's height at its middle, two cells out past the map each way. @see midOf */
  mid: Float64Array;
  /** Whether any built ground is within a cell of each cell (one past the map's far edges): where none is, there is nothing for bare ground to meet. */
  meet: Uint8Array;
};
/** The readings of the last build, kept while the map has not changed since: a new map's water field and its ground ask for the same heights, one after the other. */
let kept: Kept | null = null;
/**
 * How far from a cell that changed a reading of the surface can differ, cells: the curve through the middles reads
 * two cells either side, a little to one side of the point (@see smoothRead); built ground is met within half a
 * tile, and a road's corner is the mean of the road tiles round it. Four, with room.
 */
const REACH = 4;
/** Forget the readings kept. For a test that must work the ground out afresh. */
export const forgetCorners = () => { kept = null; };
let keptRev = 0;
/**
 * Counts each time the readings kept were made afresh or any of them forgotten: inside {@link withCorners}, the
 * same number as last time says nothing the surface is read from has changed on this map since.
 */
export const cornersRev = () => keptRev;
/** The last few times the readings changed: at which count, and the cells within reach of what changed (none: all of them). */
const changes: { rev: number; box: readonly [number, number, number, number] | null }[] = [];
/**
 * WHERE THE GROUND HAS CHANGED since the count `rev` (@see cornersRev), asked inside {@link withCorners} for the
 * same map: a box of cells (x0, y0, x1, y1, not kept to the map) holding every cell a reading could differ on;
 * undefined where nothing has; null where it cannot be said — another map since, or too long ago — and so anywhere.
 */
export function cornersSince(grid: Grid, rev: number): readonly [number, number, number, number] | null | undefined {
  if (kept === null || kept.grid !== grid || rev > keptRev) return null;
  if (rev === keptRev) return undefined;
  if (!changes.length || changes[0].rev > rev + 1) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of changes) {
    if (c.rev <= rev) continue;
    if (c.box === null) return null;
    x0 = Math.min(x0, c.box[0]); y0 = Math.min(y0, c.box[1]); x1 = Math.max(x1, c.box[2]); y1 = Math.max(y1, c.box[3]);
  }
  return [x0, y0, x1, y1];
}
let lattice: Kept | null = null;
export function withCorners<T>(grid: Grid, fine: number, make: () => T): T {
  const was = lattice;
  // (Compared cell by cell, not by the map's `rev`: a write that forgot to count itself would leave the water
  // standing on ground that is no longer there.)
  const n = grid.w * grid.h, from = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    from[i] = (grid.height[i] + 512) | (grid.ramp[i] << 10) | (((grid.deckZ[i] + 128) & 255) << 18) | (grid.terrain[i] === VOID ? 1 << 26 : 0) | (grid.paved[i] ? 1 << 27 : 0)
      | (grid.deck[i] !== 0 ? 1 << 28 : 0) | (grid.main[i] ? 1 << 29 : 0) | (grid.structureAt[i] >= 0 ? 1 << 30 : 0);
  }
  let same = kept !== null && kept.grid === grid && kept.fine === fine && kept.mode === groundMode() && kept.from.length === n;
  // WHERE IT CHANGED, if it is the map the readings were kept for: a box round the cells that differ.
  let x0 = grid.w, y0 = grid.h, x1 = -1, y1 = -1;
  if (same) {
    const k = kept!.from;
    for (let i = 0; i < n; i++) if (k[i] !== from[i]) {
      const x = i % grid.w, y = (i / grid.w) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  const part = same && x1 >= 0 && (x1 - x0 + 1 + 2 * REACH) * (y1 - y0 + 1 + 2 * REACH) < n / 2;
  if (same && x1 >= 0 && !part) same = false;
  if (!same || part) {
    keptRev++;
    changes.push({ rev: keptRev, box: part ? [x0 - REACH, y0 - REACH, x1 + REACH, y1 + REACH] : null });
    if (changes.length > 16) changes.shift();
    const W = grid.w + 4, C = grid.w + 1;
    const isBuilt = (x: number, y: number) => x >= 0 && y >= 0 && x < grid.w && y < grid.h && grid.terrain[idx(grid, x, y)] !== VOID && built(grid, x, y);
    let mid: Float64Array, meet: Uint8Array;
    if (part) {
      // (The tables too: only the cells that changed, and those their middles and what is built on them are read by.)
      mid = kept!.mid; meet = kept!.meet;
      for (let y = Math.max(-2, y0 - 2); y <= Math.min(grid.h + 1, y1 + 2); y++) for (let x = Math.max(-2, x0 - 2); x <= Math.min(grid.w + 1, x1 + 2); x++) mid[(y + 2) * W + x + 2] = midOf(grid, x, y);
      for (let y = Math.max(0, y0 - 1); y <= Math.min(grid.h, y1 + 1); y++) for (let x = Math.max(0, x0 - 1); x <= Math.min(grid.w, x1 + 1); x++) {
        let m = 0;
        for (let dy = -1; dy <= 1 && !m; dy++) for (let dx = -1; dx <= 1; dx++) if (isBuilt(x - dx, y - dy)) { m = 1; break; }
        meet[y * C + x] = m;
      }
    } else {
      mid = new Float64Array(W * (grid.h + 4));
      for (let y = -2; y < grid.h + 2; y++) for (let x = -2; x < grid.w + 2; x++) mid[(y + 2) * W + x + 2] = midOf(grid, x, y);
      meet = new Uint8Array(C * (grid.h + 1));
      for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) {
        if (!isBuilt(x, y)) continue;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (x + dx >= 0 && y + dy >= 0) meet[(y + dy) * C + x + dx] = 1;
      }
    }
    const across = (grid.w + 2) * fine + 1, down = (grid.h + 2) * fine + 1;
    if (part) {
      // AN EDIT IS A FEW CELLS: only the readings within reach of them are forgotten, the rest of the map's kept.
      // One tile raised was every column of the water's floor read again, and every quad's corner of the bands redone.
      const k = kept!, at = k.at, mids = k.mids, cols = grid.w * fine, rows = grid.h * fine;
      if (at) {
        const i0 = Math.max(0, (x0 - REACH + 1) * fine), i1 = Math.min(across - 1, (x1 + 2 + REACH) * fine);
        const j0 = Math.max(0, (y0 - REACH + 1) * fine), j1 = Math.min(down - 1, (y1 + 2 + REACH) * fine);
        for (let j = j0; j <= j1; j++) at.fill(NaN, j * across + i0, j * across + i1 + 1);
      }
      if (mids) {
        const i0 = Math.max(0, (x0 - REACH) * fine), i1 = Math.min(cols, (x1 + 1 + REACH) * fine);
        const j0 = Math.max(0, (y0 - REACH) * fine), j1 = Math.min(rows, (y1 + 1 + REACH) * fine);
        for (let j = j0; j < j1; j++) mids.fill(NaN, j * cols + i0, j * cols + i1);
      }
      k.from = from; k.mid = mid; k.meet = meet;
    } else kept = { grid, from, mode: groundMode(), fine, across, down, at: null, mids: null, mid, meet };
  }
  lattice = kept;
  try { return make(); } finally { lattice = was; }
}

/** The drawn height of cell `(x, y)` at its corner `(u, v)`, half steps. */
export function drawnCorner(grid: Grid, x: number, y: number, u: number, v: number): number {
  if (pinned(grid, x, y)) return groundMode() === "smooth" && road(grid, x, y) ? roadCorner(grid, x + u, y + v) : cornerZ(grid, x, y, u, v);
  if (groundMode() === "smooth") return smoothAt(grid, x + u, y + v);
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
      wets[n] = wet(grid, j);
      reach[n++] = sh === null ? grid.height[j] : grid.height[j] + grid.pool[j] + 1;
    }
  }
  // Beside something pinned within reach: the free cell takes the whole slope.
  if (!Number.isNaN(held)) return held;
  // AS ONE SMOOTH FIELD (@see water-mode.ts) THE BED UNDER STANDING WATER IS ONE SURFACE: where no land meets a
  // corner, every wet cell there — on a shelf or out in the deep — puts it at the mean of their beds, so the shelf
  // runs down into the deep with no ledge under the water for it to break over.
  if (fieldWater() && wet(grid, idx(grid, x, y))) {
    let dry = false, sum = 0, m = 0;
    for (let k = 0; k < n; k++) { if (wets[k]) { sum += beds[k]; m++; } else if (Math.abs(reach[k] - own) <= CLIFF) dry = true; }
    if (!dry && m) return sum / m;
  }
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
  if (lands === 1 && m === 4) return level - 0.15;
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
  // (The continuous surface is asked for the point itself: the four corners first, each a whole reading of it, were
  // worked out and thrown away — five readings a point, and the shade's bake asks sixteen points a tile.)
  const held = pinned(grid, x, y);
  if (!held && groundMode() === "smooth") {
    const l = lattice;
    if (l !== null && l.grid === grid) {
      // (The middle of a quarter of a tile: asked for by the water's field, a column each, and again by the shade's bake.)
      const i = fx * l.fine - 0.5, j = fy * l.fine - 0.5, n = grid.w * l.fine;
      if (i === Math.floor(i) && j === Math.floor(j) && i >= 0 && j >= 0 && i < n && j < grid.h * l.fine) {
        const k = j * n + i, mids = l.mids ??= new Float64Array(n * grid.h * l.fine).fill(NaN);
        let z = mids[k];
        if (z !== z) { z = smoothAt(grid, fx, fy); mids[k] = z; }
        return z;
      }
    }
    return smoothAt(grid, fx, fy);
  }
  const c00 = drawnCorner(grid, x, y, 0, 0), c10 = drawnCorner(grid, x, y, 1, 0), c11 = drawnCorner(grid, x, y, 1, 1), c01 = drawnCorner(grid, x, y, 0, 1);
  if (held) return (c00 * (1 - a) + c10 * a) * (1 - b) + (c01 * (1 - a) + c11 * a) * b;
  const h = drawnCentre(grid, x, y), da = a - 0.5, db = b - 0.5, t = 2 * Math.max(Math.abs(da), Math.abs(db));
  if (t <= 0) return h;
  // Out along the ray from the middle to the edge it meets, and how far along that edge.
  let edge: number;
  if (Math.abs(da) >= Math.abs(db)) { const s = 0.5 + db / (2 * Math.abs(da)); edge = da > 0 ? c10 + (c11 - c10) * s : c00 + (c01 - c00) * s; }
  else { const s = 0.5 + da / (2 * Math.abs(db)); edge = db > 0 ? c01 + (c11 - c01) * s : c00 + (c10 - c00) * s; }
  return h + t * (edge - h);
}

/**
 * A cell's drawn corners where it is a bank — (0,0), (1,0), (1,1), (0,1), the order a cursor's tilt takes them (its
 * top, right, bottom and left) — or undefined where it is drawn level: what is outlined on bare ground follows it.
 */
export function bankCorners(grid: Grid, x: number, y: number): readonly [number, number, number, number] | undefined {
  if (!inBounds(grid, x, y) || pinned(grid, x, y) || drawnFlat(grid, x, y)) return undefined;
  return [drawnCorner(grid, x, y, 0, 0), drawnCorner(grid, x, y, 1, 0), drawnCorner(grid, x, y, 1, 1), drawnCorner(grid, x, y, 0, 1)];
}

/**
 * A SURFACE SAMPLER THAT KNOWS THE BANKS: `base`'s answer for a cell, with the fan the ground is drawn as where
 * that is a bank and `base` says the ground itself (not a deck, nor the water over it) — so what is pointed at is
 * what is seen. @see iso.ts pickCell
 */
export const drawnSampler = (grid: Grid, base: SurfaceAt): SurfaceAt => (x, y) => {
  const surf = base(x, y);
  if (!surf || surf.height !== grid.height[idx(grid, x, y)]) return surf;
  const c = bankCorners(grid, x, y);
  return c ? { ...surf, fan: [c[0], c[1], c[2], c[3], drawnCentre(grid, x, y)] } : surf;
};

/** How far a cliff's corner is moved in plan to straighten its line, tiles each way. A quarter makes a 1:1 stair of cliff a straight edge. */
export const CLIFF_EASE = 0.25;
const shiftOut: [number, number] = [0, 0];
/**
 * WHERE A CORNER OF THE GRID IS DRAWN, in plan, as a shift from where it is: a cliff that steps along the grid is
 * drawn straighter. Where three of the four bare cells round a corner stand together and the fourth stands apart
 * from them by a cliff — the tip of a step, or the pocket of one — the corner is moved a quarter of a tile into
 * the one that stands apart: tips are cut back and pockets filled, so a stair of them is one line. Every quad that
 * has the corner takes the same shift, so nothing opens. Nothing moves beside paving, a building, water or the
 * map's edge: what stands there was made for the grid as it is. (The same array every call.)
 */
export function cornerShift(grid: Grid, X: number, Y: number): readonly [number, number] {
  shiftOut[0] = 0; shiftOut[1] = 0;
  if (groundMode() !== "banks") return shiftOut;
  if (X <= 0 || Y <= 0 || X >= grid.w || Y >= grid.h) return shiftOut;
  let lo = Infinity, hi = -Infinity;
  const z = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const cx = X - (k & 1), cy = Y - (k >> 1), i = idx(grid, cx, cy);
    if (grid.terrain[i] === VOID || wet(grid, i) || pinned(grid, cx, cy)) return shiftOut;
    z[k] = drawnCorner(grid, cx, cy, X - cx, Y - cy);
    lo = Math.min(lo, z[k]); hi = Math.max(hi, z[k]);
  }
  if (hi - lo < 2) return shiftOut;
  // Two heights only, three cells at one and one at the other.
  let lows = 0, highs = 0, lone = -1;
  for (let k = 0; k < 4; k++) { if (z[k] === lo) lows++; else if (z[k] === hi) highs++; }
  if (lows + highs !== 4 || (lows !== 1 && highs !== 1)) return shiftOut;
  for (let k = 0; k < 4; k++) if (z[k] === (lows === 1 ? lo : hi)) lone = k;
  // (Cell k is at X − (k & 1), Y − (k >> 1): toward it is −x for the odd ones, −y for the upper two.)
  shiftOut[0] = lone & 1 ? -CLIFF_EASE : CLIFF_EASE;
  shiftOut[1] = lone >> 1 ? -CLIFF_EASE : CLIFF_EASE;
  return shiftOut;
}

/**
 * A cell's drawn shape, worked out once for many points on it: its corners (0,0), (1,0), (1,1), (0,1), its middle,
 * and whether it is a plane (pinned) — into `out` at `o`. @see fanHeight
 */
export function drawnFan(grid: Grid, x: number, y: number, out: Float32Array, o: number): void {
  out[o] = drawnCorner(grid, x, y, 0, 0); out[o + 1] = drawnCorner(grid, x, y, 1, 0);
  out[o + 2] = drawnCorner(grid, x, y, 1, 1); out[o + 3] = drawnCorner(grid, x, y, 0, 1);
  const flat = pinned(grid, x, y);
  out[o + 4] = flat ? 0 : drawnCentre(grid, x, y);
  out[o + 5] = flat ? 1 : 0;
}
/** The drawn height at `(a, b)` of a cell (each 0…1) whose shape is at `o` in `fan`. The same rule as `drawnHeight`. */
export function fanHeight(fan: Float32Array, o: number, a: number, b: number): number {
  const c00 = fan[o], c10 = fan[o + 1], c11 = fan[o + 2], c01 = fan[o + 3];
  if (fan[o + 5]) return (c00 * (1 - a) + c10 * a) * (1 - b) + (c01 * (1 - a) + c11 * a) * b;
  const h = fan[o + 4], da = a - 0.5, db = b - 0.5, t = 2 * Math.max(Math.abs(da), Math.abs(db));
  if (t <= 0) return h;
  let edge: number;
  if (Math.abs(da) >= Math.abs(db)) { const s = 0.5 + db / (2 * Math.abs(da)); edge = da > 0 ? c10 + (c11 - c10) * s : c00 + (c01 - c00) * s; }
  else { const s = 0.5 + da / (2 * Math.abs(db)); edge = db > 0 ? c01 + (c11 - c01) * s : c00 + (c10 - c00) * s; }
  return h + t * (edge - h);
}

// ─── ONE CONTINUOUS SURFACE ──────────────────────────────────────────────────

/** A cell's height at its middle, as the surface is drawn through it: its own, a ramp's at its middle. Off the map or void, the nearest cell's. */
function midOf(grid: Grid, x: number, y: number): number {
  const cx = Math.max(0, Math.min(grid.w - 1, x)), cy = Math.max(0, Math.min(grid.h - 1, y)), i = idx(grid, cx, cy);
  return grid.height[i] + rampRise(grid.ramp[i]) / 2;
}
/** The slope a curve takes through a point between two differences either side of it: none at a crest or a foot, and never more than the gentler asks — so it does not overshoot. */
const lean = (a: number, b: number) => (a * b <= 0 ? 0 : (2 * a * b) / (a + b));
/** A curve through p1 (t = 0) and p2 (t = 1), carrying on from p0 and toward p3: straight on an even slope, level on a level, an S down a step. */
function through(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const m1 = lean(p1 - p0, p2 - p1), m2 = lean(p2 - p1, p3 - p2), t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * p1 + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2 + (t3 - t2) * m2;
}
const row = [0, 0, 0, 0];
/** How near built ground a point of bare ground starts to be drawn to meet it, tiles. */
const MEET = 0.5;
/**
 * THE GROUND AS ONE CONTINUOUS SURFACE, at a point `(fx, fy)` (cells; a cell covers x…x+1), half steps. It goes
 * through every cell's own height at its middle and curves between them — along each row of middles, then across
 * the rows — with no choice anywhere between joining and parting: a big step is a steep face, a lone raised tile a
 * round hill. BUILT ground is flat (a ramp its plane) across its whole tile, and bare ground within `MEET` of it is
 * drawn to meet it at its edge: a cutting, an embankment. Pure.
 */
export function smoothAt(grid: Grid, fx: number, fy: number): number {
  const l = lattice;
  if (l !== null && l.grid === grid) {
    const i = (fx + 1) * l.fine, j = (fy + 1) * l.fine;
    if (i === Math.floor(i) && j === Math.floor(j) && i >= 0 && j >= 0 && i < l.across && j < l.down) {
      const k = j * l.across + i, at = l.at ??= new Float64Array(l.across * l.down).fill(NaN);
      let z = at[k];
      if (z !== z) { z = smoothRead(grid, fx, fy); at[k] = z; }
      return z;
    }
  }
  return smoothRead(grid, fx, fy);
}
function smoothRead(grid: Grid, fx: number, fy: number): number {
  // IT WANDERS: the bare ground is read a little to one side of the point, by a slow noise fixed to the map — so a
  // crest, a cliff's line and a shore, ruled straight along a row of tiles of one height, are not straight. Level
  // ground stays level; built ground and the meeting with it are where they are.
  const ax = fx * (1 / 2.3), ay = fy * (1 / 2.3), bx = fx * (1 / 0.83), by = fy * (1 / 0.83);
  return surface(grid, fx, fy,
    fx + WANDER * noise(ax + 11.3, ay + 4.1) + WANDER_FINE * noise(bx + 50.7, by + 9.2),
    fy + WANDER * noise(ax + 71.9, ay + 33.4) + WANDER_FINE * noise(bx + 3.3, by + 87.6));
}
/** The surface with no wander in it: through every cell's own height at its middle. @see smoothAt */
export const smoothPlain = (grid: Grid, fx: number, fy: number): number => surface(grid, fx, fy, fx, fy);
/** How far the bare ground is read to one side, tiles: a slow wander and a finer one over it. */
const WANDER = 0.2, WANDER_FINE = 0.07;
const hash = (x: number, y: number): number => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 2147483648 - 1;
};
/** Smooth noise, −1…1, fixed to the map. */
function noise(x: number, y: number): number {
  const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, a = u * u * (3 - 2 * u), b = v * v * (3 - 2 * v);
  return (hash(i, j) * (1 - a) + hash(i + 1, j) * a) * (1 - b) + (hash(i, j + 1) * (1 - a) + hash(i + 1, j + 1) * a) * b;
}
/** The surface at `(fx, fy)`, its bare ground read at `(qx, qy)`. */
function surface(grid: Grid, fx: number, fy: number, qx: number, qy: number): number {
  const px = Math.max(0, Math.min(grid.w, fx)), py = Math.max(0, Math.min(grid.h, fy));
  const gx = Math.max(0, Math.min(grid.w, qx)) - 0.5, gy = Math.max(0, Math.min(grid.h, qy)) - 0.5, i0 = Math.floor(gx), j0 = Math.floor(gy), tx = gx - i0, ty = gy - j0;
  const l = lattice !== null && lattice.grid === grid ? lattice : null;
  if (l !== null) {
    // (The middles from the build's table: the same sixteen numbers. @see withCorners)
    const M = l.mid, W = grid.w + 4;
    for (let r = 0, o = (j0 + 1) * W + i0 + 1; r < 4; r++, o += W) row[r] = through(M[o], M[o + 1], M[o + 2], M[o + 3], tx);
  } else for (let r = 0; r < 4; r++) {
    const j = j0 - 1 + r;
    row[r] = through(midOf(grid, i0 - 1, j), midOf(grid, i0, j), midOf(grid, i0 + 1, j), midOf(grid, i0 + 2, j), tx);
  }
  let z = through(row[0], row[1], row[2], row[3], ty);
  // BUILT GROUND NEAR BY: each such tile's own height at its nearest point, the nearer counting for far more.
  const cx = Math.floor(px), cy = Math.floor(py);
  if (l !== null && !l.meet[cy * (grid.w + 1) + cx]) return z;
  let near = 0, sum = 0, weight = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = cx + dx, y = cy + dy;
    if (!inBounds(grid, x, y) || grid.terrain[idx(grid, x, y)] === VOID || !built(grid, x, y)) continue;
    const nx = Math.max(x, Math.min(x + 1, px)), ny = Math.max(y, Math.min(y + 1, py)), d = Math.hypot(px - nx, py - ny);
    if (d >= MEET) continue;
    const a = nx - x, b = ny - y;
    const v = road(grid, x, y) ? roadZ(grid, x, y, a, b)
      : (cornerZ(grid, x, y, 0, 0) * (1 - a) + cornerZ(grid, x, y, 1, 0) * a) * (1 - b) + (cornerZ(grid, x, y, 0, 1) * (1 - a) + cornerZ(grid, x, y, 1, 1) * a) * b;
    const s = 1 - d / MEET, w = s * s * (3 - 2 * s), k = 1 / (d * d + 1e-6);
    near = Math.max(near, w); sum += v * k; weight += k;
  }
  if (weight > 0) z += (sum / weight - z) * near;
  return z;
}
