/**
 * World v2 — POLLUTION IN THE WATER, read off the water itself. The solver
 * carries how fouled each column is (`ColumnField.foul`), by its own moves:
 * slop let out into a river goes where the river goes, over its falls and off
 * the map with it; a level lake holds it. Nothing here moves any of it. What
 * this keeps is what the game and the renderer read — each TILE's level,
 * nought to one, looked at a few times a second, and the same as bytes.
 * @see game/pollution, fluid/columns
 */
import { FULL, POLLUTED, POLLUTION_STEP, POLLUTION_WET, levelOf } from "../../game/pollution";
import type { ColumnField } from "../../fluid/columns";
import { housedBy } from "../../game/housing";
import { MAIN_END, inBounds, type Grid } from "../grid";
import { WATER_REACH } from "../agents/mood-rules";
import { COLUMNS_PER_TILE, type WaterField } from "./field";

export type Pollution = {
  w: number; h: number;
  /** Each tile's level as a byte, 0–255, for the renderer; and a count bumped when it changes. */
  level: Uint8Array;
  rev: number;
  /** Whether any tile is fouled at all. */
  any: boolean;
  /** Seconds owed to the next look. */
  owed: number;
};

const fields = new WeakMap<ColumnField, Pollution>();

/** The levels kept for a water field's columns, clean till first looked at. */
export function pollutionOf(columns: ColumnField): Pollution {
  let p = fields.get(columns);
  if (!p) {
    const w = Math.ceil(columns.nx / COLUMNS_PER_TILE), h = Math.ceil(columns.ny / COLUMNS_PER_TILE);
    p = { w, h, level: new Uint8Array(w * h), rev: 0, any: false, owed: 0 };
    fields.set(columns, p);
  }
  return p;
}

/**
 * A tile's water in the open (the lowest storey): its mean depth, the mean
 * surface of its wet columns, and how fouled it is — its columns' strengths,
 * weighed by how much each holds.
 */
function tileWater(c: ColumnField, x: number, y: number): { depth: number; surface: number; foul: number } {
  let d = 0, s = 0, n = 0, wet = 0, m = 0;
  const cx0 = x * COLUMNS_PER_TILE, cy0 = y * COLUMNS_PER_TILE;
  for (let dy = 0; dy < COLUMNS_PER_TILE; dy++) {
    for (let dx = 0; dx < COLUMNS_PER_TILE; dx++) {
      const cx = cx0 + dx, cy = cy0 + dy;
      if (cx >= c.nx || cy >= c.ny) continue;
      const i = cy * c.nx + cx, depth = c.depth[i];
      d += depth;
      m += depth * c.foul[i];
      n++;
      if (depth > c.params.dryDepth) { s += c.ground[i] + depth; wet++; }
    }
  }
  return { depth: n ? d / n : 0, surface: wet ? s / wet : -Infinity, foul: d > 0 ? m / d : 0 };
}

/** How fouled the water on a tile is, nought to one, as it stands now. */
export function pollutionAt(field: WaterField, x: number, y: number): number {
  const p = pollutionOf(field.columns);
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return 0;
  const t = tileWater(field.columns, x, y);
  return levelOf(t.foul, t.depth);
}

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** Look at the water again when `POLLUTION_STEP` has gone by: every tile's level, for the renderer and the town. */
export function stepPollution(field: WaterField, dt: number) {
  const p = pollutionOf(field.columns);
  p.owed += dt;
  if (p.owed < POLLUTION_STEP) return;
  p.owed %= POLLUTION_STEP;
  readLevels(field.columns, p);
}

/** Every tile's level, read off the columns. Clean water, which is nearly always, is one glance. */
function readLevels(c: ColumnField, p: Pollution) {
  if (!c.fouled) {
    if (p.any) { p.level.fill(0); p.any = false; p.rev++; }
    return;
  }
  let any = false;
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      const t = tileWater(c, x, y);
      const b = t.foul > 0 ? Math.round(levelOf(t.foul, t.depth) * 255) : 0;
      if (b) any = true;
      if (b !== p.level[y * p.w + x]) { p.level[y * p.w + x] = b; p.rev++; }
    }
  }
  p.any = any;
  // On the device nothing else says the last of it has gone; a readback with any in it says so again.
  if (!any && c.arrivals) c.fouled = false;
}

/** Houses with fouled water in view: polluted past `POLLUTED` within reach of the house. @see MOOD.polluted */
export function fouledHouses(field: WaterField, g: Grid): Set<number> {
  const out = new Set<number>();
  const p = pollutionOf(field.columns);
  if (!p.any) return out;
  for (const s of g.structures.values()) {
    if (!housedBy(s.def) || s.build) continue;
    search: for (let y = s.y - WATER_REACH; y < s.y + s.h + WATER_REACH; y++) {
      for (let x = s.x - WATER_REACH; x < s.x + s.w + WATER_REACH; x++) {
        if (inBounds(g, x, y) && x < p.w && y < p.h && p.level[y * p.w + x] > POLLUTED * 255) { out.add(s.id); break search; }
      }
    }
  }
  return out;
}

/**
 * UPSTREAM OF THE TOWN: every wet tile whose water runs down — or lies level,
 * as a lake does — to water the town uses: beside an intake, or in view of a
 * house. Slop let out there reaches them; an outfall belongs somewhere else.
 * By tile index. @see routeSewer
 */
export function upstreamOfTown(field: WaterField, g: Grid): Set<number> {
  const c = field.columns, w = g.w;
  const memo = new Map<number, { depth: number; surface: number }>();
  const at = (i: number) => {
    let t = memo.get(i);
    if (!t) { t = tileWater(c, i % w, (i / w) | 0); memo.set(i, t); }
    return t;
  };
  const wet = (i: number) => at(i).depth >= POLLUTION_WET;
  const out = new Set<number>(), queue: number[] = [];
  const seed = (x: number, y: number) => {
    if (!inBounds(g, x, y)) return;
    const i = y * w + x;
    if (!out.has(i) && wet(i)) { out.add(i); queue.push(i); }
  };
  // WHAT THE TOWN USES: the water by each intake, and in each house's view.
  for (let i = 0; i < g.mainEnd.length; i++) {
    if (g.mainEnd[i] !== MAIN_END.intake) continue;
    const x = i % w, y = (i / w) | 0;
    seed(x, y);
    for (const [dx, dy] of SIDES) seed(x + dx, y + dy);
  }
  for (const s of g.structures.values()) {
    if (!housedBy(s.def) || s.build) continue;
    for (let y = s.y - WATER_REACH; y < s.y + s.h + WATER_REACH; y++) {
      for (let x = s.x - WATER_REACH; x < s.x + s.w + WATER_REACH; x++) seed(x, y);
    }
  }
  // AND UP FROM THEM: to each wet neighbour whose surface is no lower.
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q], x = i % w, y = (i / w) | 0, s = at(i).surface;
    for (const [dx, dy] of SIDES) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(g, nx, ny)) continue;
      const j = ny * w + nx;
      if (out.has(j) || !wet(j) || at(j).surface < s - 1e-6) continue;
      out.add(j);
      queue.push(j);
    }
  }
  return out;
}

/**
 * SAVED WITH THE MAP: how much fouling stands on each tile — its level by its
 * depth, as maps have always carried it — or null for clean water; and as a
 * file read it, kept with its grid until a water field is made for that grid.
 * @see serializeWorld, loadGrid
 */
export function pollutionSaved(field: WaterField): Float32Array | null {
  const c = field.columns, p = pollutionOf(c);
  if (!c.fouled) return null;
  const out = new Float32Array(p.w * p.h);
  let any = false;
  for (let i = 0; i < out.length; i++) {
    const t = tileWater(c, i % p.w, (i / p.w) | 0);
    if (t.depth < POLLUTION_WET || t.foul <= 0) continue;
    out[i] = (t.foul / FULL) * t.depth;
    any = true;
  }
  return any ? out : null;
}
const saved = new WeakMap<Grid, Float32Array>();
export const stashPollution = (g: Grid, mass: Float32Array) => { saved.set(g, mass); };
/** Put a loaded map's pollution into the water made for it; nothing if it was saved clean. */
export function restorePollution(field: WaterField, g: Grid) {
  const mass = saved.get(g);
  if (!mass) return;
  saved.delete(g);
  const c = field.columns, p = pollutionOf(c);
  if (mass.length !== p.w * p.h) return;
  for (let i = 0; i < mass.length; i++) {
    if (!(mass[i] > 0)) continue;
    const x = i % p.w, y = (i / p.w) | 0, t = tileWater(c, x, y);
    if (t.depth < POLLUTION_WET) continue;
    setFoul(field, x, y, Math.min(1, (mass[i] / t.depth) * FULL));
  }
  readLevels(c, p);
}

/** Set how fouled a tile's standing water is, every wet column of it alike. For a loaded map, and for tests. */
export function setFoul(field: WaterField, x: number, y: number, strength: number) {
  const c = field.columns;
  for (let dy = 0; dy < COLUMNS_PER_TILE; dy++) {
    for (let dx = 0; dx < COLUMNS_PER_TILE; dx++) {
      const cx = x * COLUMNS_PER_TILE + dx, cy = y * COLUMNS_PER_TILE + dy;
      if (cx >= c.nx || cy >= c.ny) continue;
      const i = cy * c.nx + cx;
      if (c.depth[i] > c.params.dryDepth) c.foul[i] = strength;
    }
  }
  if (strength > 0) c.fouled = true;
}

/** How much fouling stands on the map in all, in half steps over a tile: every column's depth by its strength. For sums. */
export function foulingIn(field: WaterField): number {
  const c = field.columns;
  let m = 0;
  for (let i = 0; i < c.depth.length; i++) m += c.depth[i] * c.foul[i];
  return m / (COLUMNS_PER_TILE * COLUMNS_PER_TILE);
}

/** Every column clean: a new map, a reset. */
export function resetPollution(field: WaterField) {
  const p = pollutionOf(field.columns);
  field.columns.foul.fill(0);
  field.columns.fouled = false;
  p.level.fill(0);
  p.any = false;
  p.rev++;
}
