/**
 * World v2 — A RIVER IN FLOOD: the water held where a river comes onto the
 * map rises for a while, runs down the channel, and over any bank too low to
 * hold it. Real water, from the same solver as the river itself.
 *
 * Which buildings it reached is asked of the water and not worked out from
 * the map: a house counts as flooded when the water against it stands
 * higher than it did before the flood, so a house that always stood by the
 * river is not flooded by the river being there. @see floodBaseline
 *
 * The event and its choices are the director's. @see stepEvents
 */
import { housedBy, residentsIn } from "../../game/housing";
import type { GeneratorId } from "../../state/generators.store";
import type { Grid, Structure } from "../grid";
import { idx } from "../grid";
import { structureDef } from "../structures/def";
import { fluidIndexOf } from "../water/materials";
import { drainAt, type WaterField } from "../water/field";
import { fluidAt, ring } from "./sludge";

/**
 * How far over its banks a flood comes, half steps: a river rises to its
 * lowest bank near where it comes on, and this much more. Never less than
 * MIN_RISE, nor more than MAX_RISE. @see floodPeak
 */
export const FLOOD_OVER = 2;
const MIN_RISE = 2, MAX_RISE = 12;
/** How near the river's head its banks are looked for, in tiles. */
const BANK_REACH = 8;
/** Seconds the water takes to rise, stays up, and takes to fall, at the head. */
export const FLOOD_UP = 15;
export const FLOOD_HOLD = 30;
export const FLOOD_DOWN = 15;
export const FLOOD_SECONDS = FLOOD_UP + FLOOD_HOLD + FLOOD_DOWN;
/** Half steps above its usual level the water against a building must stand to flood it. */
export const FLOODED = 1;

/** How far the river is risen, in half steps, `t` seconds after the flood struck, rising to `peak`. */
export function riseAt(t: number, peak: number): number {
  if (t <= 0 || t >= FLOOD_SECONDS) return 0;
  const k = t < FLOOD_UP ? t / FLOOD_UP : t < FLOOD_UP + FLOOD_HOLD ? 1 : (FLOOD_SECONDS - t) / FLOOD_DOWN;
  return Math.round(peak * k);
}

/**
 * HOW HIGH THIS MAP'S RIVER RISES, half steps over its usual level: over its
 * lowest bank near the head, by a little. A river in a gorge has to rise a
 * long way to flood anything and one in a meadow hardly at all, and a fixed
 * rise would be nothing to one and a lake to the other.
 */
export function floodPeak(g: Grid): number {
  let surface = -Infinity;
  const heads: number[] = [];
  for (let i = 0; i < g.inflow.length; i++) {
    if (g.inflow[i] <= 0) continue;
    heads.push(i);
    surface = Math.max(surface, g.height[i] + g.inflow[i]);
  }
  if (!heads.length) return 0;
  let bank = Infinity;
  for (const h of heads) {
    const hx = h % g.w, hy = (h / g.w) | 0;
    for (let y = Math.max(0, hy - BANK_REACH); y <= Math.min(g.h - 1, hy + BANK_REACH); y++) {
      for (let x = Math.max(0, hx - BANK_REACH); x <= Math.min(g.w - 1, hx + BANK_REACH); x++) {
        const z = g.height[idx(g, x, y)];
        if (z > surface && z < bank) bank = z;
      }
    }
  }
  const rise = Number.isFinite(bank) ? bank - surface + FLOOD_OVER : MIN_RISE;
  return Math.max(MIN_RISE, Math.min(MAX_RISE, rise));
}

/** Where the map's rivers come on: the middle of their inflow, or null with none. */
export function riverHead(g: Grid): { x: number; y: number } | null {
  let n = 0, sx = 0, sy = 0;
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (g.inflow[idx(g, x, y)] > 0) { n++; sx += x; sy += y; }
    }
  }
  return n ? { x: Math.round(sx / n), y: Math.round(sy / n) } : null;
}

/** Whether a building is one a flood can reach that matters: housing, or a port. */
const floodable = (s: Structure) => !!housedBy(s.def) || !!structureDef(s.def)?.port;

/** The deepest water against a building, half steps. */
function waterBy(field: WaterField, g: Grid, s: Structure, water: number): number {
  let most = 0;
  for (const t of ring(g, s)) most = Math.max(most, fluidAt(field, t.x, t.y, water));
  return most;
}

/** The map before a flood: how deep the water stood against each house and port, and which tiles were dry. */
export type FloodBase = { water: Map<number, number>; dry: Uint8Array };

export function floodBaseline(field: WaterField, g: Grid): FloodBase {
  const water = fluidIndexOf("water"), out = new Map<number, number>();
  for (const s of g.structures.values()) if (floodable(s)) out.set(s.id, waterBy(field, g, s, water));
  const dry = new Uint8Array(g.w * g.h);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) dry[idx(g, x, y)] = fluidAt(field, x, y, water) > 0 ? 0 : 1;
  return { water: out, dry };
}

/** Half steps a second that floodwater left on dry ground soaks away. */
const SOAK_RATE = 0.08;

/**
 * Floodwater left where the ground was dry, soaking away, for `dt` seconds.
 * Without it a flat field keeps a film of the flood for ever: nothing runs
 * off ground that is level. Returns the tiles still wet.
 */
export function soakAway(field: WaterField, g: Grid, dry: Uint8Array, dt: number): number {
  const water = fluidIndexOf("water");
  let wet = 0;
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (!dry[idx(g, x, y)] || fluidAt(field, x, y, water) <= 0) continue;
      drainAt(field, x, y, SOAK_RATE * dt);
      wet++;
    }
  }
  return wet;
}

/** The houses and ports with the water up against them higher than it was. */
export function floodedNow(field: WaterField, g: Grid, base: ReadonlyMap<number, number>): Set<number> {
  const water = fluidIndexOf("water"), out = new Set<number>();
  for (const s of g.structures.values()) {
    if (!floodable(s)) continue;
    if (waterBy(field, g, s, water) > (base.get(s.id) ?? 0) + FLOODED) out.add(s.id);
  }
  return out;
}

/** What the player did about the flood: kept the water out, cleared the houses, or neither. */
export type FloodShield = "sandbags" | "evacuate" | null;

/**
 * THE FLOOD AS IT STANDS, as the scene last found it: what is under water and
 * what was done about it. Live state, never saved — and read by the economy
 * and the ports between the scene's looks. @see setFloodState
 */
let state: { flooded: ReadonlySet<number>; shield: FloodShield } = { flooded: new Set(), shield: null };
export const setFloodState = (flooded: ReadonlySet<number>, shield: FloodShield) => { state = { flooded, shield }; };

/** Whether a port is shut: flooded with no sandbags, or damaged by a flood. @see damage */
export const portShut = (id: number) => (state.shield !== "sandbags" && state.flooded.has(id)) || isDamaged(id);

/** Houses miserable for it: flooded, with nothing done. @see MOOD.flooded */
export const floodMisery = (): ReadonlySet<number> => (state.shield ? new Set() : state.flooded);

/** Residents out of their flooded houses, by kind, while they are evacuated. */
export function evacuatedAway(g: Grid): Partial<Record<GeneratorId, number>> {
  const out: Partial<Record<GeneratorId, number>> = {};
  if (state.shield !== "evacuate") return out;
  for (const id of state.flooded) {
    const s = g.structures.get(id), h = s && housedBy(s.def);
    if (h) out[h.id] = (out[h.id] ?? 0) + residentsIn(s);
  }
  return out;
}

/** Seconds the repair crew takes over each damaged building, one at a time. */
export const REPAIR_SECONDS = 40;

/**
 * DAMAGED BY A FLOOD nobody did anything about: the houses and ports the water
 * reached, each producing nothing — its people off work, its quays shut —
 * until the repair crew has been round. One crew, one building at a time, in
 * the order the water reached them, and only once the water is down; so a
 * flood that reached a dozen leaves a street idle for minutes. Live state; not
 * saved. @see stepRepairs
 */
const damaged = new Map<number, number>();
/** The map the damage is on: another map has none. */
let damagedOn: Grid | null = null;

/** The buildings a flood reached, with nothing kept dry, marked damaged. */
export function damage(g: Grid, ids: Iterable<number>) {
  if (damagedOn !== g) { damaged.clear(); damagedOn = g; }
  for (const id of ids) if (!damaged.has(id)) damaged.set(id, REPAIR_SECONDS);
}

/**
 * The crew's work for `dt` seconds, on the first damaged building still
 * standing; none while `flooding`. Returns the ids repaired.
 */
export function stepRepairs(g: Grid, dt: number, flooding: boolean): number[] {
  const done: number[] = [];
  if (damagedOn !== g) damaged.clear();
  for (const id of damaged.keys()) if (!g.structures.has(id)) damaged.delete(id);
  if (flooding) return done;
  for (const [id, left] of damaged) {
    const t = left - dt;
    if (t > 0) { damaged.set(id, t); break; }
    damaged.delete(id);
    done.push(id);
    dt = -t;
  }
  return done;
}

/** Seconds until a building is repaired, its place in the queue counted; null when it is not damaged. */
export function repairedIn(id: number): number | null {
  let t = 0;
  for (const [d, left] of damaged) {
    t += left;
    if (d === id) return t;
  }
  return null;
}

export const isDamaged = (id: number) => damaged.has(id);

/** Residents off work for their homes being damaged, by kind. */
export function damagedAway(g: Grid): Partial<Record<GeneratorId, number>> {
  const out: Partial<Record<GeneratorId, number>> = {};
  for (const id of damaged.keys()) {
    const s = g.structures.get(id), h = s && housedBy(s.def);
    if (h) out[h.id] = (out[h.id] ?? 0) + residentsIn(s);
  }
  return out;
}
