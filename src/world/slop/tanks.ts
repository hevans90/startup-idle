/**
 * World v2 — THE SLOP TANKS: one at each vibe coders' workplace, filled by
 * what its people make, by how many sit at its desks; drained by the sewers
 * that take from it, into the processors they feed and out of their
 * outfalls into the water; and SPILLED at its port when full — sludge on the
 * street, or pollution in the water if it stands in it. Live state, not
 * saved: a workplace starts with an empty tank. @see game/slop
 */
import { POLLUTION_PER_SLOP, SPILL_DEPTH, tankFor } from "../../game/slop";
import { WORKPLACES } from "../agents/commute";
import { idx, inBounds, type Grid, type Structure } from "../grid";
import { fluidIndexOf } from "../water/materials";
import { mainReports } from "../water/mains";
import { pollute } from "../water/pollution";
import { portsOf } from "../water/ports";
import { pourAt, type WaterField } from "../water/field";
import { fluidAt, ring } from "../events/sludge";

/** A workplace's tank: what it holds and can, what it fills by a second, and whether it is spilling. */
export type Tank = { level: number; capacity: number; rate: number; spilling: boolean };

const kept = new WeakMap<Grid, Map<number, Tank>>();
/** The tanks last stepped, for what reads one by its building alone: a label. */
let latest: Map<number, Tank> | null = null;
export const slopTankOf = (id: number): Tank | null => latest?.get(id) ?? null;

/** Each vibe workplace's tank on a map, by its id. */
export function tanksOf(g: Grid): Map<number, Tank> {
  let t = kept.get(g);
  if (!t) { t = new Map(); kept.set(g, t); }
  return t;
}

/** Water deep enough on a tile to take what is poured into it as pollution, not sludge. */
const WET = 0.5;
/** The water beside or on a tile, deepest first, or null: where an outfall or a spill goes in. Water, not sludge already spilt. */
function waterBy(g: Grid, field: WaterField, x: number, y: number): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null, most = WET;
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (!inBounds(g, x + dx, y + dy)) continue;
    const d = fluidAt(field, x + dx, y + dy, fluidIndexOf("water"));
    if (d >= most) { most = d; best = { x: x + dx, y: y + dy }; }
  }
  return best;
}

/** Put slop out at a tile: into water beside it as pollution, or onto the ground as sludge. */
export function release(g: Grid, field: WaterField, x: number, y: number, amount: number) {
  if (!(amount > 0)) return;
  const water = waterBy(g, field, x, y);
  if (water) pollute(field, water.x, water.y, amount * POLLUTION_PER_SLOP);
  else pourAt(field, x, y, amount * SPILL_DEPTH, fluidIndexOf("slop"));
}

/**
 * ONE FRAME OF SLOP: `making` a second, shared out among the workplaces by
 * the desks taken in each (evenly, with nobody seated anywhere); each sewer
 * draining the tanks it serves, as much as it carries, into the processors it
 * feeds — `process` says how much one takes — and the rest out of its
 * outfalls; and each tank over full spilling at its port. Run after the
 * mains, whose sewer reports it fills in with what they carried.
 */
export function stepSlop(
  g: Grid, field: WaterField | null, desks: ReadonlyMap<number, { used: number }> | null, making: number, dt: number,
  process: (building: number, amount: number) => number = () => 0,
): void {
  const tanks = tanksOf(g);
  latest = tanks;
  const places = [...g.structures.values()].filter((s) => !s.build && WORKPLACES.vibe_coder.includes(s.def));
  // GONE: a workplace taken down takes its tank with it.
  for (const id of tanks.keys()) if (!places.some((s) => s.id === id)) tanks.delete(id);
  if (!places.length) return;
  const seated = places.map((s) => desks?.get(s.id)?.used ?? 0);
  const all = seated.reduce((a, b) => a + b, 0);
  // FILLING, by who works there.
  for (const [k, s] of places.entries()) {
    const t = tanks.get(s.id) ?? { level: 0, capacity: 0, rate: 0, spilling: false };
    t.rate = making * (all > 0 ? seated[k] / all : 1 / places.length);
    t.capacity = tankFor(t.rate);
    t.level += t.rate * dt;
    tanks.set(s.id, t);
  }
  // DRAINED by the sewers: each its share of what it carries from every tank it serves.
  for (const r of mainReports().values()) {
    if (!r.sewer || r.state !== "flowing" || dt <= 0) continue;
    const from = r.sewer.sources.map((id) => tanks.get(id)).filter((t): t is Tank => !!t);
    const there = from.reduce((n, t) => n + t.level, 0);
    const take = Math.min(there, r.capacity * dt);
    if (take <= 0) { r.flow = 0; continue; }
    for (const t of from) t.level -= take * (t.level / there);
    r.flow = take / dt;
    // INTO THE PROCESSORS FIRST, as much as each takes; the rest out of the outfalls.
    let left = take;
    for (const o of r.outlets) if (left > 0) left -= Math.max(0, Math.min(left, process(o.building, left)));
    if (left > 0 && field && r.sewer.outfalls.length) {
      for (const cell of r.sewer.outfalls) release(g, field, cell % g.w, (cell / g.w) | 0, left / r.sewer.outfalls.length);
    }
  }
  // SPILLED, a full tank, at its port — or, built over, out of the nearest
  // gap round the building: it goes somewhere.
  for (const s of places) {
    const t = tanks.get(s.id)!;
    t.spilling = t.level > t.capacity;
    if (!t.spilling) continue;
    const over = t.level - t.capacity;
    t.level = t.capacity;
    const at = spillAt(g, s);
    if (field && at) release(g, field, at.x, at.y, over);
  }
}

/** Where a workplace's tank spills: in front of its slop port, or the nearest open tile round it; null boxed in. */
export function spillAt(g: Grid, s: Structure): { x: number; y: number } | null {
  const port = portsOf(g, s).find((p) => p.port.fluid === "slop");
  const open = (x: number, y: number) => inBounds(g, x, y) && g.structureAt[idx(g, x, y)] < 0;
  if (port && open(port.x, port.y)) return { x: port.x, y: port.y };
  const from = port ?? { x: s.x + s.w, y: s.y };
  return ring(g, s).filter((c) => open(c.x, c.y)).sort((a, b) => Math.abs(a.x - from.x) + Math.abs(a.y - from.y) - Math.abs(b.x - from.x) - Math.abs(b.y - from.y))[0] ?? null;
}

/** Clear the tanks: a new map, a reset. */
export const resetTanks = (g: Grid) => tanksOf(g).clear();
