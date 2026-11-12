/**
 * World v2 — THE SLOP TANKS: one at each vibe coders' workplace, filled by
 * what its people make, by how many sit at its desks; drained by the sewers
 * that take from it, into the processors they feed and out of their
 * outfalls into the water; and SPILLED at its port when full — slop on the
 * street, or mixed into the water if it stands in it. Live state, not
 * saved with the map: what each holds. @see game/slop, serializeWorld
 */
import { SPILL_DEPTH, setSlopMaking, setSlopSpilling, tankFor } from "../../game/slop";
import { PROCESS_RATE, processorKind, setProcessorUse, type ProcessorKind } from "../../game/processors";
import { WORKPLACES } from "../agents/commute";
import { idx, inBounds, type Grid, type Structure } from "../grid";
import { fluidIndexOf } from "../water/materials";
import { backedUpCell, mainReportsFor, stormOnDevice } from "../water/mains";
import { loadSlop, loaderBerths, loaderGone, loaderRoom, loadersOf } from "../boats/slop-loader";
import { portsOf } from "../water/ports";
import { wantDepth } from "../../fluid/columns";
import { COLUMNS_PER_TILE, depthAt, drainAt, pourAt, type WaterField } from "../water/field";
import { ring } from "../events/sludge";
import { stepSewers } from "../sewers/flow";

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

/** A tank filled by a share of what it holds, to the brim and no further: a hackathon's mess. @see HACKATHON_SLOP */
export function slopSpike(g: Grid, id: number, share: number): void {
  const t = tanksOf(g).get(id);
  if (t) t.level = Math.min(t.capacity, t.level + t.capacity * share);
}

/** Every full tank emptied, hauled away by hand: spilling no more. @see DILIGENCE "mop" */
export function emptyFull(g: Grid): void {
  for (const t of tanksOf(g).values()) if (t.spilling) { t.level = 0; t.spilling = false; }
}

/** Water deep enough on a tile for what is let out beside it to go into. */
const WET = 0.5;
/**
 * How deep the water on a tile is, half steps, on the ground storey: its
 * deepest column that is more water than slop. By its strength, not by what
 * the column is called: slop just let into a lake has not been mixed in yet.
 */
function mostlyWater(field: WaterField, x: number, y: number): number {
  const c = field.columns;
  let most = 0;
  for (let dy = 0; dy < COLUMNS_PER_TILE; dy++) for (let dx = 0; dx < COLUMNS_PER_TILE; dx++) {
    const cx = x * COLUMNS_PER_TILE + dx, cy = y * COLUMNS_PER_TILE + dy;
    if (cx >= c.nx || cy >= c.ny) continue;
    const i = cy * c.nx + cx;
    if (c.foul[i] < 0.5 && c.depth[i] > most) most = c.depth[i];
  }
  return most;
}

/** The water beside or on a tile, deepest first, or null: where an outfall or a spill goes in. Water, not sludge already spilt. */
function waterBy(g: Grid, field: WaterField, x: number, y: number): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null, most = WET;
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (!inBounds(g, x + dx, y + dy)) continue;
    const d = mostlyWater(field, x + dx, y + dy);
    if (d >= most) { most = d; best = { x: x + dx, y: y + dy }; }
  }
  return best;
}

/**
 * Put what a sewer carries out at a tile: into the water beside it if there
 * is any, or onto the ground. `strength` is how much of it is slop; the rest
 * is storm water, and goes out as water.
 */
export function release(g: Grid, field: WaterField, x: number, y: number, amount: number, strength = 1) {
  if (!(amount > 0)) return;
  if (strength < 1) {
    const at = waterBy(g, field, x, y) ?? { x, y };
    pourAt(field, at.x, at.y, amount * SPILL_DEPTH * (1 - Math.max(0, strength)), fluidIndexOf("water"));
    amount *= Math.max(0, strength);
    if (!(amount > 0)) return;
  }
  // ONE THING, wherever it goes: slop, poured. In water it mixes and the water carries it. @see ColumnField.foul
  const at = waterBy(g, field, x, y) ?? { x, y };
  pourAt(field, at.x, at.y, amount * SPILL_DEPTH, fluidIndexOf("slop"));
}

/** How high the water's surface stands on a tile, in the ground's half steps: its highest wet column's; −∞ where it is dry. */
function surfaceOn(field: WaterField, x: number, y: number): number {
  const c = field.columns;
  let top = -Infinity;
  for (let dy = 0; dy < COLUMNS_PER_TILE; dy++) for (let dx = 0; dx < COLUMNS_PER_TILE; dx++) {
    const cx = x * COLUMNS_PER_TILE + dx, cy = y * COLUMNS_PER_TILE + dy;
    if (cx >= c.nx || cy >= c.ny) continue;
    const i = cy * c.nx + cx;
    wantDepth(c, i);
    if (c.depth[i] > c.params.dryDepth) top = Math.max(top, c.ground[i] + c.depth[i]);
  }
  return top;
}

/** Take so much depth off a tile's standing water: what went, as a depth over the tile, and how much of it was slop. */
function drainTile(field: WaterField, x: number, y: number, depth: number): { depth: number; strength: number } {
  const c = field.columns;
  const sum = () => {
    let d = 0, m = 0;
    for (let dy = 0; dy < COLUMNS_PER_TILE; dy++) for (let dx = 0; dx < COLUMNS_PER_TILE; dx++) {
      const cx = x * COLUMNS_PER_TILE + dx, cy = y * COLUMNS_PER_TILE + dy;
      if (cx >= c.nx || cy >= c.ny) continue;
      const i = cy * c.nx + cx;
      d += c.depth[i]; m += c.depth[i] * c.foul[i];
    }
    return { d, m };
  };
  const was = sum();
  drainAt(field, x, y, depth);
  const now = sum();
  return { depth: (was.d - now.d) / (COLUMNS_PER_TILE * COLUMNS_PER_TILE), strength: was.d > 0 ? was.m / was.d : 0 };
}

/**
 * ONE FRAME OF SLOP: `perCoder` a second from each desk taken at each
 * workplace — nobody without a desk makes any, so a workplace makes no more
 * than its desks allow; each sewer
 * draining the tanks it serves, as much as it carries, into the processors it
 * feeds — each up to `PROCESS_RATE` a second — and the rest out of its
 * outfalls; each tank over full spilling at its port; and how busy each kind
 * of processor has been, for the economy. Run after the mains, whose sewer
 * reports it fills in with what they carried.
 */
export function stepSlop(
  g: Grid, field: WaterField | null, desks: ReadonlyMap<number, { used: number }> | null, perCoder: number, dt: number,
  pay: (seconds: number) => boolean = () => true,
): void {
  const tanks = tanksOf(g);
  latest = tanks;
  const places = [...g.structures.values()].filter((s) => !s.build && WORKPLACES.vibe_coder.includes(s.def));
  // GONE: a workplace taken down takes its tank with it.
  for (const id of tanks.keys()) if (!places.some((s) => s.id === id)) tanks.delete(id);
  // FILLING, by who sits at its desks.
  let making = 0;
  for (const s of places) {
    const t = tanks.get(s.id) ?? { level: 0, capacity: 0, rate: 0, spilling: false };
    t.rate = perCoder * (desks?.get(s.id)?.used ?? 0);
    making += t.rate;
    t.capacity = tankFor(t.rate);
    t.level += t.rate * dt;
    tanks.set(s.id, t);
  }
  setSlopMaking(making);
  // What each processor has taken this frame. @see PROCESS_RATE
  const taken = new Map<number, number>();
  // A PORT'S SLOP LOADER takes it as a processor does: as fast as it loads, and no more than its tank has room for. @see slop-loader
  const loader = (id: number) => { const s = g.structures.get(id); return s && loaderBerths(s) > 0 ? s : null; };
  const roomLeft = (id: number) => {
    const port = loader(id);
    return Math.max(0, (port ? loaderRoom(g, port, dt) : PROCESS_RATE * dt) - (taken.get(id) ?? 0));
  };
  // DRAINED by the sewers: each its share of what it carries from every tank it serves.
  for (const r of mainReportsFor(g).values()) {
    // A LATERAL into a manhole drains under the ground, below. @see stepSewers
    if (!r.sewer || r.sewer.node !== undefined || (r.state !== "flowing" && r.state !== "backed-up") || dt <= 0) continue;
    const from = r.sewer.sources.map((id) => tanks.get(id)).filter((t): t is Tank => !!t);
    const there = from.reduce((n, t) => n + t.level, 0);
    // AS MUCH AS IT CAN PUT SOMEWHERE: what its processors have room for, and
    // with an outfall, all it carries. Backed up, the rest stays in the tanks.
    // Each processor once, though a sewer meet both its inlets.
    const sinks = [...new Map(r.outlets.filter((o) => processorKind(g.structures.get(o.building)?.def ?? "") || loader(o.building)).map((o) => [o.building, o])).values()];
    const roomOf = roomLeft;
    // BACKED UP, it puts it all in the street: as much as it carries. @see setBackedUp
    const manhole = r.state === "backed-up" ? backedUpCell() : null;
    const room = r.sewer.outfalls.length || manhole !== null ? Infinity : sinks.reduce((n, o) => n + roomOf(o.building), 0);
    const take = Math.min(there, r.capacity * dt, room);
    if (take <= 0) { r.flow = 0; continue; }
    for (const t of from) t.level -= take * (t.level / there);
    r.flow = take / dt;
    if (manhole !== null) {
      if (field) release(g, field, manhole % g.w, (manhole / g.w) | 0, take);
      continue;
    }
    // INTO THE PROCESSORS FIRST, as much as each takes; the rest out of the outfalls.
    let left = take;
    for (const o of sinks) {
      if (left <= 0) break;
      const into = Math.min(left, roomOf(o.building));
      taken.set(o.building, (taken.get(o.building) ?? 0) + into);
      left -= into;
    }
    if (left > 0 && field && r.sewer.outfalls.length) {
      for (const cell of r.sewer.outfalls) release(g, field, cell % g.w, (cell / g.w) | 0, left / r.sewer.outfalls.length);
    }
  }
  // DOWN THE LATERALS AND UNDER THE GROUND: to the processors, the outfalls, or up at a manhole.
  stepSewers(g, tanks, dt, {
    pay, backedUp: backedUpCell(),
    room: roomLeft,
    take: (id, amount) => taken.set(id, (taken.get(id) ?? 0) + amount),
    release: (x, y, amount, strength) => { if (field) release(g, field, x, y, amount, strength); },
    // STORM DRAINS and drowned outfalls ask the water itself. @see SEWER_GRATE
    ...(field ? {
      standing: (x: number, y: number) => depthAt(field, x, y),
      drain: (x: number, y: number, depth: number) => drainTile(field, x, y, depth),
      storm: (x: number, y: number, room: number) => stormOnDevice(g, y * g.w + x, room),
      surface: (x: number, y: number) => surfaceOn(field, x, y),
    } : {}),
  });
  // INTO THE LOADERS, what the sewers brought them; and one whose port is gone, or refitted, puts what it held on the ground there.
  for (const [id, amount] of taken) { const port = loader(id); if (port) loadSlop(g, port, amount); }
  for (const id of [...loadersOf(g).keys()]) {
    if (loader(id)) continue;
    const had = loaderGone(g, id), s = g.structures.get(id), at = s ? spillAt(g, s) : null;
    if (had > 0 && field && at) release(g, field, at.x, at.y, had);
  }
  // SPILLED, a full tank, at its port — or, built over, out of the nearest
  // gap round the building: it goes somewhere.
  for (const s of places) {
    const t = tanks.get(s.id)!;
    // NOTHING COMING IN, nothing pushed out: a tank read from a file before
    // the economy says what is made keeps what it holds. @see setSlopRate
    t.spilling = t.rate > 0 && t.level > t.capacity;
    if (!t.spilling) continue;
    const over = t.level - t.capacity;
    t.level = t.capacity;
    const at = spillAt(g, s);
    if (field && at) release(g, field, at.x, at.y, over);
  }
  setSlopSpilling(places.some((s) => tanks.get(s.id)!.spilling));
  // HOW BUSY each processor is, smoothed over a few seconds, and each kind's in all.
  const use: Record<ProcessorKind, number> = { refinery: 0, dataplant: 0, contentfarm: 0 };
  const seen = new Set<number>();
  for (const s of g.structures.values()) {
    const k = processorKind(s.def);
    if (!k || s.build) continue;
    seen.add(s.id);
    const now = dt > 0 ? (taken.get(s.id) ?? 0) / (PROCESS_RATE * dt) : 0;
    const was = busy.get(s.id) ?? 0;
    const b = was + (now - was) * Math.min(1, dt / BUSY_SECONDS);
    busy.set(s.id, b);
    use[k] += b;
  }
  for (const id of busy.keys()) if (!seen.has(id)) busy.delete(id);
  setProcessorUse(use);
}

/** Seconds a processor's busyness takes to come round to what it is taking. */
const BUSY_SECONDS = 3;
/** How busy each processor has been, nought to one, by id. Live state; not saved. */
const busy = new Map<number, number>();
export const processorBusy = (id: number) => busy.get(id) ?? 0;

/** Where a workplace's tank spills: in front of its slop port, or the nearest open tile round it; null boxed in. */
export function spillAt(g: Grid, s: Structure): { x: number; y: number } | null {
  const port = portsOf(g, s).find((p) => p.port.fluid === "slop");
  const open = (x: number, y: number) => inBounds(g, x, y) && g.structureAt[idx(g, x, y)] < 0;
  if (port && open(port.x, port.y)) return { x: port.x, y: port.y };
  const from = port ?? { x: s.x + s.w, y: s.y };
  return ring(g, s).filter((c) => open(c.x, c.y)).sort((a, b) => Math.abs(a.x - from.x) + Math.abs(a.y - from.y) - Math.abs(b.x - from.x) - Math.abs(b.y - from.y))[0] ?? null;
}

/** What each tank holds, by its workplace, for the file. */
export const tankLevels = (g: Grid): { id: number; level: number }[] =>
  [...tanksOf(g)].filter(([, t]) => t.level > 0).map(([id, t]) => ({ id, level: t.level }));
/** Fill a loaded map's tanks as the file had them; stepped, they learn the rest. */
export function restoreTanks(g: Grid, levels: readonly { id: number; level: number }[]) {
  const tanks = tanksOf(g);
  for (const { id, level } of levels) tanks.set(id, { level, capacity: 0, rate: 0, spilling: false });
}

/** Clear the tanks: a new map, a reset. */
export const resetTanks = (g: Grid) => tanksOf(g).clear();
