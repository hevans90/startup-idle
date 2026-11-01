/**
 * World v2 — POLLUTION IN THE WATER: a field beside the water's own, a mass
 * of slop a tile, kept for each water field. Stepped a few times a second on
 * the water as it stands — read from the columns, never written to them — so
 * neither solver knows it is there:
 *  - CARRIED down the surface's slope to the wet tiles beside it, which is how
 *    a river runs; off the map where the river leaves it;
 *  - SHARED with wet neighbours by how much more fouled it is, which is how it
 *    dilutes; and with the clean water coming in at an open edge;
 *  - FADING, slowly in water and fast on dry ground.
 * What the game reads is each tile's LEVEL, nought to one, and the renderer
 * the same as bytes. @see game/pollution
 */
import {
  ADVECT, DIFFUSE, DRY_SECONDS, MOST_OUT, POLLUTED, POLLUTION_STEP, POLLUTION_WET, SETTLE_SECONDS, TRACE, levelOf,
} from "../../game/pollution";
import type { ColumnField } from "../../fluid/columns";
import { housedBy } from "../../game/housing";
import { inBounds, type Grid } from "../grid";
import { WATER_REACH } from "../agents/mood-rules";
import { COLUMNS_PER_TILE, type WaterField } from "./field";

export type Pollution = {
  w: number; h: number;
  /** Slop on each tile. */
  mass: Float32Array;
  /** Each tile's level as a byte, 0–255, for the renderer; and a count bumped when it changes. */
  level: Uint8Array;
  rev: number;
  /** Seconds owed to the next step. */
  owed: number;
};

const fields = new WeakMap<ColumnField, Pollution>();

/** The pollution kept for a water field's columns, made clean the first time it is asked for. */
export function pollutionOf(columns: ColumnField): Pollution {
  let p = fields.get(columns);
  if (!p) {
    const w = Math.ceil(columns.nx / COLUMNS_PER_TILE), h = Math.ceil(columns.ny / COLUMNS_PER_TILE);
    p = { w, h, mass: new Float32Array(w * h), level: new Uint8Array(w * h), rev: 0, owed: 0 };
    fields.set(columns, p);
  }
  return p;
}

/** Pour `amount` of slop into the water at a tile: an outfall, or a spill reaching it. */
export function pollute(field: WaterField, x: number, y: number, amount: number) {
  const p = pollutionOf(field.columns);
  if (x < 0 || y < 0 || x >= p.w || y >= p.h || !(amount > 0)) return;
  p.mass[y * p.w + x] += amount;
}

/** Depth and surface of a tile, the mean of its columns in the open (the lowest storey), read straight from them. */
function tileWater(c: ColumnField, x: number, y: number): { depth: number; surface: number } {
  let d = 0, s = 0, n = 0, wet = 0;
  const cx0 = x * COLUMNS_PER_TILE, cy0 = y * COLUMNS_PER_TILE;
  for (let dy = 0; dy < COLUMNS_PER_TILE; dy++) {
    for (let dx = 0; dx < COLUMNS_PER_TILE; dx++) {
      const cx = cx0 + dx, cy = cy0 + dy;
      if (cx >= c.nx || cy >= c.ny) continue;
      const i = cy * c.nx + cx, depth = c.depth[i];
      d += depth;
      n++;
      if (depth > c.params.dryDepth) { s += c.ground[i] + depth; wet++; }
    }
  }
  return { depth: n ? d / n : 0, surface: wet ? s / wet : -Infinity };
}

/** How fouled the water on a tile is, nought to one. */
export function pollutionAt(field: WaterField, x: number, y: number): number {
  const p = pollutionOf(field.columns);
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return 0;
  const i = y * p.w + x;
  if (p.mass[i] <= TRACE) return 0;
  return levelOf(p.mass[i], tileWater(field.columns, x, y).depth);
}

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** Advance the pollution `dt` seconds: whole steps of `POLLUTION_STEP`, the rest owed to the next call. */
export function stepPollution(field: WaterField, dt: number) {
  const p = pollutionOf(field.columns);
  p.owed += dt;
  while (p.owed >= POLLUTION_STEP) {
    p.owed -= POLLUTION_STEP;
    stepOnce(field.columns, p, POLLUTION_STEP);
  }
}

/** One step. Only tiles with slop on them, and their neighbours, are read. */
function stepOnce(c: ColumnField, p: Pollution, dt: number) {
  const { w, h, mass } = p;
  // CLEAN WATER, which is nearly always: nothing to do.
  if (!mass.some((m) => m > TRACE)) return;
  // THE WATER, read once a tile, as it is needed.
  const depth = new Float32Array(w * h).fill(NaN), surface = new Float32Array(w * h);
  const read = (i: number) => {
    if (Number.isNaN(depth[i])) { const t = tileWater(c, i % w, (i / w) | 0); depth[i] = t.depth; surface[i] = t.surface; }
    return depth[i];
  };
  const next = mass.slice();
  const settle = Math.exp(-dt / SETTLE_SECONDS), soak = Math.exp(-dt / DRY_SECONDS);
  let changed = false;
  for (let i = 0; i < mass.length; i++) {
    const m = mass[i];
    if (m <= TRACE) continue;
    changed = true;
    const x = i % w, y = (i / w) | 0, d = read(i);
    // ON DRY GROUND it soaks in and goes; it is not carried.
    if (d < POLLUTION_WET) { next[i] -= m * (1 - soak); continue; }
    const s = surface[i], conc = m / d;
    // CARRIED: down the slope of the water to each lower wet neighbour; off the
    // map at an open edge where the water runs that way.
    const outs: [number, number][] = [];
    let total = 0;
    for (const [dx, dy] of SIDES) {
      const nx = x + dx, ny = y + dy;
      let slope: number;
      let j = -1;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
        if (!c.openEdge) continue;
        // The water beyond the edge continues the slope from the tile across.
        const bx = x - dx, by = y - dy;
        const back = bx >= 0 && by >= 0 && bx < w && by < h && read(by * w + bx) >= POLLUTION_WET ? surface[by * w + bx] : s;
        slope = back - s;
      } else {
        j = ny * w + nx;
        if (read(j) < POLLUTION_WET) continue;
        slope = s - surface[j];
      }
      if (!(slope > 0)) continue;
      const f = ADVECT * slope * dt;
      outs.push([j, f]);
      total += f;
    }
    const scale = total > MOST_OUT ? MOST_OUT / total : 1;
    for (const [j, f] of outs) {
      const move = m * f * scale;
      next[i] -= move;
      if (j >= 0) next[j] += move;
    }
    // SHARED with wet neighbours less fouled than it, a pair at a time from the
    // fouler side; and with the clean water at an open edge.
    for (const [dx, dy] of SIDES) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
        if (c.openEdge) next[i] -= Math.min(m * 0.25, DIFFUSE * dt * conc * d);
        continue;
      }
      const j = ny * w + nx, dj = read(j);
      if (dj < POLLUTION_WET) continue;
      const cj = mass[j] / dj;
      if (cj >= conc) continue;
      const move = Math.min(m * 0.2, DIFFUSE * dt * (conc - cj) * Math.min(d, dj));
      next[i] -= move;
      next[j] += move;
    }
    // AND SETTLING, slowly.
    next[i] -= m * (1 - settle);
  }
  if (!changed) return;
  for (let i = 0; i < next.length; i++) {
    const m = next[i] > TRACE ? next[i] : 0;
    mass[i] = m;
    const b = m > 0 ? Math.round(levelOf(m, read(i)) * 255) : 0;
    if (b !== p.level[i]) { p.level[i] = b; p.rev++; }
  }
}

/** Houses with fouled water in view: polluted past `POLLUTED` within reach of the house. @see MOOD.polluted */
export function fouledHouses(field: WaterField, g: Grid): Set<number> {
  const out = new Set<number>();
  const p = pollutionOf(field.columns);
  if (!p.mass.some((m) => m > TRACE)) return out;
  for (const s of g.structures.values()) {
    if (!housedBy(s.def) || s.build) continue;
    search: for (let y = s.y - WATER_REACH; y < s.y + s.h + WATER_REACH; y++) {
      for (let x = s.x - WATER_REACH; x < s.x + s.w + WATER_REACH; x++) {
        if (inBounds(g, x, y) && x < p.w && y < p.h && p.mass[y * p.w + x] > TRACE && pollutionAt(field, x, y) > POLLUTED) { out.add(s.id); break search; }
      }
    }
  }
  return out;
}

/**
 * SAVED WITH THE MAP: the slop on each tile, as a file read it, kept with its
 * grid until a water field is made for that grid. @see serializeWorld, loadGrid
 */
const saved = new WeakMap<Grid, Float32Array>();
export const stashPollution = (g: Grid, mass: Float32Array) => { saved.set(g, mass); };
/** Put a loaded map's pollution into the field made for it; nothing if it was saved clean. */
export function restorePollution(field: WaterField, g: Grid) {
  const mass = saved.get(g);
  if (!mass) return;
  saved.delete(g);
  const p = pollutionOf(field.columns);
  if (mass.length === p.mass.length) p.mass.set(mass);
  p.rev++;
}

/** Clear every tile: a new map, a reset. */
export function resetPollution(field: WaterField) {
  const p = pollutionOf(field.columns);
  p.mass.fill(0);
  p.level.fill(0);
  p.rev++;
}
