/**
 * World v2 — THE SLOP PIT'S SLUDGE, on the map, in the real water: standing
 * in the pit as high as the pit is full, brimming over its rim when it
 * overflows — running downhill, thick and slow, into whatever is near — and
 * drying up in time once it has stopped. And the sludge trucks sent for it.
 * @see slop-overflow, stepEvents
 */
import { housedBy } from "../../game/housing";
import type { Grid, Structure } from "../grid";
import { inBounds, structureAt } from "../grid";
import type { Network } from "../roads/network";
import { placesOf, type Place } from "../agents/roads";
import { sendOnJob, type Town } from "../agents/town";
import { fluidIndexOf } from "../water/materials";
import { structureDef } from "../structures/def";
import { COLUMNS_PER_TILE, drainAt, pourAt, type WaterField } from "../water/field";

/** What one truck takes away, % of the pit. */
export const HAUL_LOAD = 12;
/** Seconds between one sludge truck setting off and the next. */
const TRUCK_GAP = 2.5;
/** Sludge poured into the full pit, half steps a second for each tile of it, while it overflows. */
export const OVERFLOW_RATE = 0.6;
/** How fast it dries once it has stopped, half steps a second, and how near the pit it is looked for. */
const DRY_RATE = 0.04;
const DRY_REACH = 16;
/** Deeper than this, in half steps, and a tile counts as under sludge. */
export const SLUDGED = 0.25;

const SLOP = () => fluidIndexOf("slop");

/** The door of the pit, and the way in off the map nearest it. */
function route(g: Grid, net: Network, pit: Structure): { door: Place; gate: Place } | null {
  const places = placesOf(g, net);
  const door = places.find((p) => p.kind === "door" && p.structure === pit.id);
  if (!door) return null;
  const gate = places.filter((p) => p.kind === "gateway" && p.net === door.net)
    .sort((a, b) => Math.abs(a.x - door.x) + Math.abs(a.y - door.y) - Math.abs(b.x - door.x) - Math.abs(b.y - door.y))[0];
  return gate ? { door, gate } : null;
}

/** Send `n` sludge trucks to the pit, a few seconds apart. Returns how many set off. */
export function sendSludgeTrucks(town: Town, g: Grid, net: Network, pit: Structure, n: number): number {
  const r = route(g, net, pit);
  if (!r) return 0;
  let sent = 0;
  for (let k = 0; k < n; k++) {
    const m = sendOnJob(town, g, "truck", r.gate, r.door, { site: pit.id, role: "haul" });
    if (!m) continue;
    m.wait = k * TRUCK_GAP;
    m.colour = 0x5f7d2a;
    sent++;
  }
  return sent;
}

/**
 * Sludge trucks that arrived since the last look: at the pit, a load taken
 * and off back out; back off the map, done. Run before `stepWorks`, which
 * clears the arrivals. Calls `haul` for each load and `back` for each truck
 * gone.
 */
export function stepHaulers(town: Town, g: Grid, net: Network, haul: (percent: number) => void, back: () => void) {
  for (const m of town.arrived) {
    if (m.job?.role === "haul") {
      haul(HAUL_LOAD);
      const pit = g.structures.get(m.job.site);
      const r = pit && route(g, net, pit);
      const out = r && sendOnJob(town, g, "truck", r.door, r.gate, { site: m.job.site, role: "haul-back" });
      if (out) { out.wait = 1.5; out.colour = m.colour; } else back();
    } else if (m.job?.role === "haul-back") back();
  }
}

/** The tiles round a structure's footprint, just outside it. */
export function ring(g: Grid, s: Structure): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let y = s.y - 1; y <= s.y + s.h; y++) {
    for (let x = s.x - 1; x <= s.x + s.w; x++) {
      const inside = x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h;
      if (!inside && inBounds(g, x, y)) out.push({ x, y });
    }
  }
  return out;
}

/** The tiles of a structure's footprint. */
const footprint = (s: Structure) => {
  const out: { x: number; y: number }[] = [];
  for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) out.push({ x, y });
  return out;
};

/**
 * How deep the sludge stands in a full pit, half steps: a little under the
 * rim. Brim-full to the half step, the solver's ripples carried it over the
 * edge with nobody pouring; only an overflow should. @see overflow
 */
const BRIM = 0.85;
const depthOf = (pit: Structure) => (structureDef(pit.def)?.basin ?? 0) * BRIM;

/**
 * THE PIT'S SLUDGE KEPT AS FULL AS THE PIT IS, in the water. What the slop
 * store says is the truth; the water is told the CHANGE since it was last
 * told, poured in or drained out, so nothing has to read back what the
 * device holds. The first time it sees a pit, or a field — just opened, a
 * map just loaded — it empties it and fills it to the level afresh. Returns what it
 * now holds, to be handed back next time. @see StructureDef.basin
 */
export type PitLevel = { id: number; fill: number; columns: object } | null;
export function syncPit(was: PitLevel, field: WaterField, pit: Structure, fill: number): PitLevel {
  const depth = depthOf(pit), tiles = footprint(pit);
  // A NEW FIELD has none of it: a map loaded, or the field rebuilt.
  if (!was || was.id !== pit.id || was.columns !== field.columns) {
    for (const t of tiles) drainAt(field, t.x, t.y, Infinity);
    if (fill > 0) for (const t of tiles) pourAt(field, t.x, t.y, (depth * fill) / 100, SLOP());
    return { id: pit.id, fill, columns: field.columns };
  }
  // EMPTIED: all of it, and what had brimmed over the rim with it.
  if (fill < 0.5 && was.fill >= 0.5) {
    for (const t of tiles) drainAt(field, t.x, t.y, Infinity);
    return { id: pit.id, fill, columns: field.columns };
  }
  const d = fill - was.fill;
  if (Math.abs(d) < 0.5) return was;
  for (const t of tiles) {
    if (d > 0) pourAt(field, t.x, t.y, (depth * d) / 100, SLOP());
    else drainAt(field, t.x, t.y, (depth * -d) / 100);
  }
  return { id: pit.id, fill, columns: field.columns };
}

/**
 * THE OVERFLOW, for `dt` seconds of it: more sludge into a pit that is full
 * already, so it brims over the rim and runs out by itself, wherever the
 * ground round it is open — never over a building, which to the water is a
 * wall.
 */
export function overflow(field: WaterField, pit: Structure, dt: number) {
  for (const t of footprint(pit)) pourAt(field, t.x, t.y, OVERFLOW_RATE * dt, SLOP());
}

/** How deep the sludge on a tile is, half steps, on the ground storey: its deepest column. */
export const sludgeAt = (field: WaterField, x: number, y: number): number => fluidAt(field, x, y, SLOP());

/** How deep one fluid on a tile is, half steps, on the ground storey: its deepest column. */
export function fluidAt(field: WaterField, x: number, y: number, material: number): number {
  const c = field.columns;
  let most = 0;
  for (let dy = 0; dy < COLUMNS_PER_TILE; dy++) {
    for (let dx = 0; dx < COLUMNS_PER_TILE; dx++) {
      const cx = x * COLUMNS_PER_TILE + dx, cy = y * COLUMNS_PER_TILE + dy;
      if (cx >= c.nx || cy >= c.ny) continue;
      const i = cy * c.nx + cx;
      if (c.material[i] === material && c.depth[i] > most) most = c.depth[i];
    }
  }
  return most;
}

/** Whether a tile is in a pit, whose sludge belongs there. */
const inPit = (g: Grid, x: number, y: number) => {
  const s = g.structures.get(structureAt(g, x, y));
  return !!s && (structureDef(s.def)?.basin ?? 0) > 0;
};

/** Houses with sludge on them or right against them. */
export function sludgedHouses(field: WaterField, g: Grid): Set<number> {
  const out = new Set<number>();
  for (const s of g.structures.values()) {
    if (!housedBy(s.def)) continue;
    for (const t of [...ring(g, s), { x: s.x, y: s.y }]) {
      // What is IN the pit is not on anybody's doorstep.
      if (!inPit(g, t.x, t.y) && sludgeAt(field, t.x, t.y) > SLUDGED) { out.add(s.id); break; }
    }
  }
  return out;
}

/** Sludge round the pit drying up a little, for `dt` seconds. */
export function dryUp(field: WaterField, g: Grid, pit: Structure, dt: number) {
  for (let y = Math.max(0, pit.y - DRY_REACH); y < Math.min(g.h, pit.y + pit.h + DRY_REACH); y++) {
    for (let x = Math.max(0, pit.x - DRY_REACH); x < Math.min(g.w, pit.x + pit.w + DRY_REACH); x++) {
      if (!inPit(g, x, y) && sludgeAt(field, x, y) > 0) drainAt(field, x, y, DRY_RATE * dt);
    }
  }
}
