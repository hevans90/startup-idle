/**
 * STRANDED WATER SOAKS AWAY. Water on level land stops — it is held there on purpose, or a spill would spread for
 * ever — and nothing took it off again: a spill on a field stood for good, and the rain kept it up.
 *
 * So every look ({@link LOOK_SECONDS}) the water is sorted, by the tile:
 *
 * - FED: joined by water to an inflow at the map's edge or a running spring. A river and all that is one with it,
 *   a flood over its banks too, till it is cut off. Left alone.
 * - HELD: in a hollow the land makes, at least {@link HOLLOW} deep. A lake or a pond, up to the level it would spill
 *   at; what lies outside that level is not it. (Worked out by filling the land to where it spills, from the edges
 *   in; a building is no part of it, or every yard would be a pond.)
 * - STRANDED: anything else, once it has been so for {@link AGE} looks. It soaks in, slower where paved, through the
 *   solver as any drain is.
 *
 * Only water: sludge and the rest are cleared up by hand. Not in a basin, and not on a deck. @see soakAway
 */
import { addWater } from "../../fluid/columns";
import { idx, structureAt, type Grid } from "../grid";
import { inPit } from "../events/sludge";
import { COLUMNS_PER_TILE, type WaterField } from "./field";
import { fluidIndexOf } from "./materials";

/** Seconds between looks. */
export const LOOK_SECONDS = 2;
/** And between soakings of what the last one found. */
export const SOAK_SECONDS = 0.25;
/** Half steps a second that soak into open ground, and through paving. */
export const SOAK_RATE = 0.08, PAVED_RATE = 0.03;
/** The least depth of a hollow that holds its water, half steps. */
export const HOLLOW = 0.75;
/** Looks water is stranded for before it soaks: a wave's gap in a river is not a puddle. */
export const AGE = 3;
/** A tile with less than this is no part of a body of water, half steps. */
const FILM = 0.05;
/** A column's floor this near a hollow's spill level counts as at it. */
const NEAR = 0.02;

export type Stranded = {
  /** Looks each tile's water has been stranded for; 0 where there is none, or it is not. */
  age: Uint8Array;
  /** How the land lies, a tile's middle height, and the spill level of any hollow in or beside a tile (−∞ none). */
  floor: Float32Array;
  level: Float32Array;
  /** Whether the levels are behind the land. */
  stale: boolean;
  /** The columns soaking since the last look, and how fast each does, half steps a second. */
  cells: number[];
  rates: number[];
};

export const createStranded = (g: Grid): Stranded => ({
  age: new Uint8Array(g.w * g.h),
  floor: new Float32Array(g.w * g.h).fill(NaN),
  level: new Float32Array(g.w * g.h),
  stale: true, cells: [], rates: [],
});

/** Whether the water on a tile is stranded: no sink for the rain. @see catchment */
export const strandedAt = (s: Stranded, i: number) => s.age[i] >= AGE;

const around = (g: Grid, i: number, each: (j: number) => void) => {
  const x = i % g.w, y = (i / g.w) | 0;
  for (let ny = Math.max(0, y - 1); ny <= Math.min(g.h - 1, y + 1); ny++)
    for (let nx = Math.max(0, x - 1); nx <= Math.min(g.w - 1, x + 1); nx++) if (nx !== x || ny !== y) each(ny * g.w + nx);
};

/**
 * THE LEVEL EACH TILE WOULD FILL TO before its water found a way off the map: from the edges in, the lowest first.
 * With the edge walled in there is no way off, and everywhere fills for ever.
 */
export function fillLevels(g: Grid, floor: Float32Array, openEdge: boolean): Float32Array {
  const n = g.w * g.h, fill = new Float32Array(n).fill(Infinity);
  if (!openEdge) return fill;
  // A binary heap of tiles by level.
  const heap = new Int32Array(n);
  let size = 0;
  const push = (i: number) => {
    let k = size++;
    while (k > 0) {
      const up = (k - 1) >> 1;
      if (fill[heap[up]] <= fill[i]) break;
      heap[k] = heap[up]; k = up;
    }
    heap[k] = i;
  };
  const pop = () => {
    const top = heap[0], i = heap[--size];
    let k = 0;
    for (;;) {
      let c = 2 * k + 1;
      if (c >= size) break;
      if (c + 1 < size && fill[heap[c + 1]] < fill[heap[c]]) c++;
      if (fill[heap[c]] >= fill[i]) break;
      heap[k] = heap[c]; k = c;
    }
    heap[k] = i;
    return top;
  };
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    if (x > 0 && y > 0 && x < g.w - 1 && y < g.h - 1) continue;
    const i = idx(g, x, y);
    fill[i] = floor[i];
    push(i);
  }
  // Four ways: water does not pass between two tiles by their corner.
  while (size) {
    const i = pop(), x = i % g.w, y = (i / g.w) | 0;
    const to = (j: number) => { if (fill[j] === Infinity) { fill[j] = Math.max(floor[j], fill[i]); push(j); } };
    if (x > 0) to(i - 1);
    if (x < g.w - 1) to(i + 1);
    if (y > 0) to(i - g.w);
    if (y < g.h - 1) to(i + g.w);
  }
  return fill;
}

/** The spill level of the hollow in or beside each tile, −∞ with none; only a hollow somewhere {@link HOLLOW} deep. */
function hollows(g: Grid, s: Stranded, openEdge: boolean) {
  const fill = fillLevels(g, s.floor, openEdge), n = fill.length, seen = new Uint8Array(n);
  s.level.fill(-Infinity);
  for (let i = 0; i < n; i++) {
    if (seen[i] || !(fill[i] > s.floor[i])) continue;
    const of = [i];
    let deep = 0;
    seen[i] = 1;
    for (let k = 0; k < of.length; k++) {
      deep = Math.max(deep, fill[of[k]] - s.floor[of[k]]);
      around(g, of[k], (j) => { if (!seen[j] && fill[j] > s.floor[j]) { seen[j] = 1; of.push(j); } });
    }
    if (deep < HOLLOW) continue;
    for (const j of of) {
      s.level[j] = Math.max(s.level[j], fill[j]);
      around(g, j, (k) => { s.level[k] = Math.max(s.level[k], fill[j]); });
    }
  }
  s.stale = false;
}

/**
 * What was found, soaking for `seconds`: called often, so that a puddle goes down and does not drop. Less than is
 * asked for where there is less; nothing where it has run off since.
 */
export function soakStranded(s: Stranded, field: WaterField, seconds: number): void {
  const c = field.columns;
  for (let n = 0; n < s.cells.length; n++) {
    const k = s.cells[n];
    if (c.depth[k] > 0) addWater(c, k % c.nx, (k / c.nx) | 0, -s.rates[n] * seconds);
  }
}

/** One look: what is stranded now, and which of its columns are to soak. Returns the tiles that are. */
export function findStranded(s: Stranded, field: WaterField, g: Grid): number {
  s.cells.length = s.rates.length = 0;
  const c = field.columns, n = g.w * g.h, water = fluidIndexOf("water"), C = COLUMNS_PER_TILE;
  const deep = new Float32Array(n);
  let any = false;
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const i = idx(g, x, y);
    let sum = 0, most = 0;
    for (let dy = 0; dy < C; dy++) for (let dx = 0; dx < C; dx++) {
      const k = (y * C + dy) * c.nx + x * C + dx;
      sum += c.ground[k];
      if (c.depth[k] > most && c.material[k] === water) most = c.depth[k];
    }
    const floor = structureAt(g, x, y) >= 0 ? g.height[i] : sum / (C * C);
    if (s.floor[i] !== floor) { s.floor[i] = floor; s.stale = true; }
    if (most > 0) any = true;
    deep[i] = most;
  }
  if (!any) { s.age.fill(0); return 0; }
  // FED, out from every inflow and spring, over the water; and the film at its edge with it.
  const fed = new Uint8Array(n), list: number[] = [];
  for (let i = 0; i < n; i++) if ((g.inflow[i] > 0 || g.source[i] > 0) && deep[i] > 0) { fed[i] = 1; list.push(i); }
  for (let k = 0; k < list.length; k++) {
    const i = list[k];
    around(g, i, (j) => { if (!fed[j] && deep[j] > 0) { fed[j] = 1; if (deep[j] > FILM) list.push(j); } });
  }
  let soaked = 0;
  for (let i = 0; i < n; i++) {
    if (deep[i] <= 0 || fed[i] || inPit(g, i % g.w, (i / g.w) | 0)) { s.age[i] = 0; continue; }
    if (s.stale) hollows(g, s, c.openEdge);
    const x = i % g.w, y = (i / g.w) | 0, level = s.level[i] - NEAR;
    // Any of it outside a hollow's level.
    let out = false;
    for (let dy = 0; dy < C && !out; dy++) for (let dx = 0; dx < C; dx++) {
      const k = (y * C + dy) * c.nx + x * C + dx;
      if (c.depth[k] > 0 && c.ground[k] >= level) { out = true; break; }
    }
    if (!out) { s.age[i] = 0; continue; }
    if (s.age[i] < AGE) { s.age[i]++; if (s.age[i] < AGE) continue; }
    soaked++;
    const rate = g.paved[i] ? PAVED_RATE : SOAK_RATE;
    for (let dy = 0; dy < C; dy++) for (let dx = 0; dx < C; dx++) {
      const k = (y * C + dy) * c.nx + x * C + dx;
      if (c.depth[k] <= 0 || c.material[k] !== water || c.ground[k] < level) continue;
      s.cells.push(k);
      s.rates.push(rate);
    }
  }
  return soaked;
}
