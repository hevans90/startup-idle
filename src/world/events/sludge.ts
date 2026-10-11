/**
 * World v2 — THE SLOP PIT'S OVERFLOW, on the map: sludge trucks sent for, and
 * the sludge itself, poured over the pit's rim into the real water — where it
 * runs downhill, thick and slow, into whatever is near — and drying up in
 * time once it has stopped. @see slop-overflow, stepEvents
 */
import { housedBy } from "../../game/housing";
import type { Grid, Structure } from "../grid";
import { inBounds, structureAt } from "../grid";
import type { Network } from "../roads/network";
import { placesOf, type Place } from "../agents/roads";
import { sendOnJob, type Town } from "../agents/town";
import { fluidIndexOf } from "../water/materials";
import { COLUMNS_PER_TILE, drainAt, pourAt, type WaterField } from "../water/field";

/** What one truck takes away, % of the pit. */
export const HAUL_LOAD = 12;
/** Seconds between one sludge truck setting off and the next. */
const TRUCK_GAP = 2.5;
/** Sludge poured over the rim, half steps a second for each tile of it, while it overflows. */
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

/** Pour the overflow over the pit's rim, for `dt` seconds of it. */
export function overflow(field: WaterField, g: Grid, pit: Structure, dt: number) {
  // ONTO OPEN GROUND ONLY. To the water a building is a block standing
  // SOLID_LIFT over its ground, and sludge poured onto one landed on its roof
  // and fell off every side of it: a fountain over the pit. And not where it
  // already lies deep — what is there will run on from there by itself.
  const tiles = ring(g, pit).filter((t) => structureAt(g, t.x, t.y) < 0 && sludgeAt(field, t.x, t.y) < POUR_DEPTH);
  if (!tiles.length) return;
  const each = (OVERFLOW_RATE * dt * (pit.w * pit.h)) / tiles.length;
  for (const t of tiles) pourAt(field, t.x, t.y, each, SLOP());
}
/** Sludge this deep on a tile, half steps, and no more is poured onto it. */
const POUR_DEPTH = 2;

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

/** Houses with sludge on them or right against them. */
export function sludgedHouses(field: WaterField, g: Grid): Set<number> {
  const out = new Set<number>();
  for (const s of g.structures.values()) {
    if (!housedBy(s.def)) continue;
    for (const t of [...ring(g, s), { x: s.x, y: s.y }]) {
      if (sludgeAt(field, t.x, t.y) > SLUDGED) { out.add(s.id); break; }
    }
  }
  return out;
}

/** Sludge round the pit drying up a little, for `dt` seconds. */
export function dryUp(field: WaterField, g: Grid, pit: Structure, dt: number) {
  for (let y = Math.max(0, pit.y - DRY_REACH); y < Math.min(g.h, pit.y + pit.h + DRY_REACH); y++) {
    for (let x = Math.max(0, pit.x - DRY_REACH); x < Math.min(g.w, pit.x + pit.w + DRY_REACH); x++) {
      if (sludgeAt(field, x, y) > 0) drainAt(field, x, y, DRY_RATE * dt);
    }
  }
}
