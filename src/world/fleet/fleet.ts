/**
 * World v2 — THE COMPANY'S LORRIES. A fixed fleet, kept at the yard of the
 * company's own building: so many of them, more as the building grows —
 * flatbeds, and a tipper among them. EACH IS ONE LORRY, ALWAYS SOMEWHERE:
 * stood in its bay under the shed; drawn out, under the yard's crane and
 * loaded; out of the gate and on the road to the work; emptied there; on the
 * road home; in at the gate, swung round and backed into its bay. Nothing of
 * it appears or is taken away: off the road it drives a leg (@see legs), on
 * it it is the town's traffic, and it is the same mover throughout.
 *
 * A load for a site, a road or a line from the yard is a lorry of the fleet
 * that stands free, and with none free it waits for one. What comes from
 * elsewhere — off a ship, from the Data Centre, in over the map's edge — is
 * not the fleet's. @see plans/built-not-bought.md
 *
 * Nothing of this is saved: a town made new has its whole fleet in the yard.
 */
import { siteTrucks } from "../../game/site-trucks";
import {
  FLEET_FLATBED_COLOUR, FLEET_TIPPER_COLOUR, FLEET_TIPPER_EMPTY_COLOUR, PIPE_EMPTY_COLOUR, PIPE_LORRY_COLOUR,
  PLANT_CRANE_COLOUR, PLANT_LOADER_COLOUR, PLANT_MIXER_COLOUR, PLANT_PICKUP_COLOUR, PLANT_LOADER_EMPTY_COLOUR } from "../agents/cars/fleet";
import type { Place } from "../agents/roads";
import { setOff, type Mover, type Town } from "../agents/town";
import type { Grid, Structure } from "../grid";
import { YARD_BAY, YARD_DEFS, YARD_GATE, YARD_PARKING, hasYard } from "../landmarks/yard";
import { ghost, startLeg, stepLegs, type LegPoint } from "./legs";

/** Lorries a yard keeps, by what the building has grown to; and what each truck the equity tree adds, adds to it. */
export const FLEET_OF: Readonly<Record<string, number>> = { garage: 4, hq: 6, boardroom: 8, ipo: 10 };
export const FLEET_PER_TRUCK = 2;
/** Seconds the yard's crane takes over three lengths of pipe; over a lorry's load of pallets or of stone. */
export const YARD_PIPES = 6, YARD_PALLETS = 2.5;

/** What a lorry is: a flatbed, for pipe and pallets; a tipper, for stone. Either will take what the other does at a pinch, but pipe wants a bed. */
export type Body = "flat" | "tip";
/** What is put on one: pallets for a site, stone for a road, lengths of pipe for a line — a main's, a drain's, a sewer's. */
export type Load = "pallets" | "stone" | { pipes: "main" | "drain" | "sewer" };
/** One of the fleet: its mover — the same one, at home and away — its yard and its bay there, and whether it stands in it. */
export type FleetLorry = { m: Mover; yard: number; bay: number; body: Body; home: boolean; /** Stood behind another, further into the shed: not to be seen while it stands there. */ deep: boolean; /** On the road, or on a job: the town's traffic, or the job's, draws it. */ away?: boolean; /** Stood in its bay still, though sent for: waiting for the crane. */ waits?: boolean };
/**
 * A LOAD BEING SENT FROM A YARD: the lorry that takes it; where it is going and as what; and how far it has got —
 * waiting for the crane, drawing up to it, being loaded (seconds left, and in all), or on its way out of the gate.
 */
export type YardLoad = {
  lorry: FleetLorry; yard: number; from: Place; to: Place; job: NonNullable<Mover["job"]>; load: Load;
  phase: "queued" | "toBay" | "loading" | "out"; left: number; of: number;
};

const colourOf = (body: Body, load: Load | null) =>
  load === null ? (body === "tip" ? FLEET_TIPPER_EMPTY_COLOUR : PIPE_EMPTY_COLOUR)
    : typeof load === "object" ? PIPE_LORRY_COLOUR : body === "tip" ? FLEET_TIPPER_COLOUR : FLEET_FLATBED_COLOUR;

/** Whether a place is a yard's gate: the fleet's own, and not a ship's quay or the map's edge. */
export const isYard = (g: Grid, pl: Place | null | undefined): pl is Place =>
  !!pl && pl.structure !== undefined && YARD_DEFS.includes(g.structures.get(pl.structure)?.def ?? "") && !g.structures.get(pl.structure)?.build;

/** How many lorries the company has: its yards', and the equity tree's. Nought with no yard built. */
export function fleetSize(g: Grid): number {
  let n = 0;
  for (const s of g.structures.values()) if (!s.build && YARD_DEFS.includes(s.def)) n += (FLEET_OF[s.def] ?? 0) + Math.max(0, siteTrucks().trucks - 1) * FLEET_PER_TRUCK;
  return n;
}

/** How high a yard stands over the ground its building is on, half steps: its plinth. */
const levelOf = (s: Structure) => (s.def === "garage" ? 0.15 : 0.3);
/** A place in a yard, on the map: plot tiles — across, and from the back to the front — as the yard faces. */
export const inYardAt = (s: Structure, u: number, v: number) => ({ x: s.x - 0.5 + u, y: s.y - 0.5 + (s.facing === "N" ? s.h - v : v) });
/** The way a lorry faces stood nose to the gate. */
const outward = (s: Structure) => (s.facing === "N" ? -Math.PI / 2 : Math.PI / 2);
/** A lorry's bay: under the shed, nose out. Those past the shed's bays stand behind the others, further in. */
function bayOf(s: Structure, k: number) {
  const bays = YARD_PARKING[s.def] ?? [{ u: 4.3, v: 0.5 }], b = bays[k % bays.length];
  return { ...inYardAt(s, b.u, b.v), u: b.u, v: b.v, deep: k >= bays.length };
}

/**
 * THE FLEET AS THE MAP HAS IT: a lorry for each a yard keeps, made when its yard is built (or grows), stood in its
 * bay; those of a yard that is gone, gone with it; those at home, where their bay is now.
 */
export function ensureFleet(g: Grid, town: Town): void {
  const yards = [...g.structures.values()].filter((s) => !s.build && hasYard(s));
  town.fleet = town.fleet.filter((f) => yards.some((s) => s.id === f.yard));
  for (const s of yards) {
    const want = (FLEET_OF[s.def] ?? 0) + Math.max(0, siteTrucks().trucks - 1) * FLEET_PER_TRUCK, mine = town.fleet.filter((f) => f.yard === s.id);
    for (let k = mine.length; k < want; k++) {
      const at = bayOf(s, k), body: Body = k % 3 === 1 ? "tip" : "flat";
      town.fleet.push({ m: { ...ghost(town, g, at.x, at.y, outward(s), colourOf(body, null), levelOf(s)), fleet: true }, yard: s.id, bay: k, body, home: true, deep: at.deep });
    }
    for (const f of town.fleet) if (f.yard === s.id && f.home) { const at = bayOf(s, f.bay); f.m.x = at.x; f.m.y = at.y; f.m.heading = outward(s); f.m.z = g.height[Math.max(0, Math.min(g.w * g.h - 1, s.y * g.w + s.x))] + levelOf(s); }
  }
}

/** How many of the fleet stand in the yard, free to be sent — of a body, or of any. */
export function fleetFree(g: Grid, town: Town, body?: Body): number {
  ensureFleet(g, town);
  return town.fleet.filter((f) => f.home && (!body || f.body === body)).length;
}
/** How many are out. */
export const fleetBusy = (g: Grid, town: Town) => { ensureFleet(g, town); return town.fleet.filter((f) => !f.home).length; };
/** Whether a lorry stands free that will take a load: pipe wants a flatbed; anything else goes on whatever there is. */
export const lorryFor = (g: Grid, town: Town, load: Load) => fleetFree(g, town, typeof load === "object" ? "flat" : undefined) > 0;

/** The fleet's lorries that are to be seen and are not on the road: those in their bays (not the ones stood behind others), and those driving a leg. */
export function offRoad(town: Town): Mover[] {
  const out = new Set(town.legs.map((l) => l.m));
  // (In its bay — unless it stands behind another — or stood under the crane: wherever it is that is not the road.)
  for (const f of town.fleet) if (!f.away && !(((f.home || f.waits) && f.deep))) out.add(f.m);
  return [...out];
}

/**
 * Send for a load from a yard: the lorry that will take it — of the body it wants, if one stands free — is no
 * longer free, and waits its turn at the crane. False with none to send. @see stepYard
 */
export function queueYardLoad(g: Grid, town: Town, from: Place, to: Place, job: NonNullable<Mover["job"]>, load: Load): boolean {
  ensureFleet(g, town);
  const want: Body = load === "stone" ? "tip" : "flat", free = town.fleet.filter((f) => f.home && f.yard === from.structure);
  const lorry = free.find((f) => f.body === want) ?? (typeof load === "object" ? undefined : free[0]);
  if (!lorry) return false;
  lorry.home = false;
  lorry.waits = true;
  const of = typeof load === "object" ? YARD_PIPES : YARD_PALLETS;
  town.yard.push({ lorry, yard: from.structure!, from, to, job, load, phase: "queued", left: of, of });
  return true;
}
/** Loads at the yards for each job of a kind, by the job: waiting, loading, or on their way out of the gate. */
export function yardQueued(town: Town, role: NonNullable<Mover["job"]>["role"]): Map<number, number> {
  const out = new Map<number, number>();
  for (const q of town.yard) if (q.job.role === role) out.set(q.job.site, (out.get(q.job.site) ?? 0) + 1);
  return out;
}

/** The way through a yard, plot tiles: from the front of the shed round to the bay under the crane; and from the gate in, round, and to where a lorry backs from. */
const TO_BAY = [{ u: 4.36, v: 1.62 }, { u: YARD_BAY.u, v: YARD_BAY.v }];
const SWING = [{ u: 4.46, v: 2.3 }, { u: 4.42, v: 1.75 }, { u: 4.3, v: 1.42 }, { u: 4.1, v: 1.42 }, { u: 4.03, v: 1.6 }, { u: 4.03, v: 1.8 }];
const GATE_V = 3.0;

/** Bring a lorry home: from where it is, in at the gate, swung round, and backed into its bay. */
function bringHome(g: Grid, town: Town, f: FleetLorry, onRoad: boolean): void {
  const s = g.structures.get(f.yard);
  if (!s) { f.home = true; return; }
  const up = levelOf(s), at = bayOf(s, f.bay), pts: LegPoint[] = [];
  if (onRoad) pts.push({ ...inYardAt(s, YARD_GATE.u, GATE_V + 0.25), up: 0 }, { ...inYardAt(s, YARD_GATE.u, GATE_V - 0.1), up });
  for (const p of SWING) pts.push({ ...inYardAt(s, p.u, p.v), up });
  pts.push({ ...inYardAt(s, at.u, 1.32), up, rev: true }, { x: at.x, y: at.y, up, rev: true });
  f.m.colour = colourOf(f.body, null);
  startLeg(town, f.m, pts, () => { f.home = true; }, onRoad ? 0 : up);
}

/**
 * A FRAME OF THE YARDS. The fleet as the map has it; every leg a little further on; the lorries that have come
 * home in at the gate and backed into their bays; and each yard's loads: the first that waits drawn up under the
 * crane when it is free, the one under it loaded, the one loaded out of the gate and onto the road — the same
 * lorry, now the town's traffic. One with no way to go is counted as there, and put back in its bay.
 */
export function stepYard(town: Town, g: Grid, dt: number): void {
  ensureFleet(g, town);
  // HOME: a lorry of the fleet at the gate again. (One whose road was lifted from under it is simply back.)
  for (let k = town.arrived.length - 1; k >= 0; k--) {
    const m = town.arrived[k];
    // (A job's machine, home: in and under the shed.)
    // (Or a lorry that is not the fleet's, come back to a yard: likewise. One gone off the map's edge is gone.)
    if (m.job?.role === "haul-back" && !m.fleet) { town.arrived.splice(k, 1); if (!m.gone && (PLANT_PAINT.has(m.colour) || nearYard(g, m))) plantHome(g, town, m); continue; }
    if (m.job?.role !== "haul-back" || !m.fleet) continue;
    const f = town.fleet.find((q) => q.m.id === m.id);
    town.arrived.splice(k, 1);
    if (!f) continue;
    f.away = false;
    if (m.gone) { f.home = true; continue; }
    f.m.x = m.x; f.m.y = m.y; f.m.z = m.z; f.m.heading = m.heading;
    bringHome(g, town, f, true);
  }
  for (const q of [...town.yard]) {
    const s = g.structures.get(q.yard), f = q.lorry;
    if (!s) { town.yard = town.yard.filter((x) => x !== q); f.home = true; continue; }
    const up = levelOf(s), at = bayOf(s, f.bay);
    if (q.phase === "queued") {
      // (One at a time under the crane, and none drawn up while another is still pulling out from under it.)
      if (town.yard.some((x) => x.yard === q.yard && x !== q && (x.phase === "toBay" || x.phase === "loading" || (x.phase === "out" && x.left > -1.2)))) continue;
      // (Nor while a job's machine is on its way through the yard, under the crane and out at the gate.)
      if (yardBusy(town, q.yard)) continue;
      q.phase = "toBay";
      f.waits = false;
      f.m.colour = colourOf(f.body, null);
      startLeg(town, f.m, [{ ...inYardAt(s, at.u, 1.3), up }, ...TO_BAY.map((p) => ({ ...inYardAt(s, p.u, p.v), up }))], () => { q.phase = "loading"; }, up);
    } else if (q.phase === "loading") {
      q.left -= dt;
      if (q.left > 0) continue;
      q.phase = "out";
      f.m.colour = colourOf(f.body, q.load);
      // ITS WAY ON THE ROAD, found now: where that begins is where it drives out to.
      const next = setOff(town, g, "truck", q.from, q.to);
      if (!next) {
        // (No way there: the load is counted as come, and the lorry backs in again.)
        town.arrived.push({ job: q.job, gone: true } as Mover);
        town.yard = town.yard.filter((x) => x !== q);
        bringHome(g, town, f, false);
        continue;
      }
      startLeg(town, f.m, [{ ...inYardAt(s, YARD_GATE.u, GATE_V - 0.1), up }, { ...inYardAt(s, YARD_GATE.u, GATE_V + 0.2), up: 0 }, { x: next.x, y: next.y, up: 0 }], () => {
        // THE SAME LORRY, on the road: its number, its paint, its heading as it comes off the yard's ramp.
        next.id = f.m.id; next.colour = f.m.colour; next.fleet = true; next.job = q.job; next.heading = f.m.heading;
        town.movers.push(next);
        f.away = true;
        town.yard = town.yard.filter((x) => x !== q);
      }, up).join = next;
    } else if (q.phase === "out") q.left -= dt;
  }
  stepLegs(town, g, dt);
}

/** A lorry of the fleet with no way home — its job gone from under it, its road lifted: it is simply back in its bay. */
export function lorryLost(g: Grid, town: Town, id: number): void {
  const f = town.fleet.find((q) => q.m.id === id);
  if (f) { f.home = true; f.away = false; ensureFleet(g, town); }
}

/** The paint of a job's machine on the road: the crane travelling, a mixer, a low-loader, the gang's pickup. */
const PLANT_PAINT: ReadonlySet<number> = new Set([PLANT_CRANE_COLOUR, PLANT_MIXER_COLOUR, PLANT_LOADER_COLOUR, PLANT_PICKUP_COLOUR, PLANT_LOADER_EMPTY_COLOUR]);
/**
 * THE MACHINES ON THEIR WAY, a town's own — a map left with one in its yard must not leave the next map's yard busy for
 * good: `legs`, out of a yard to a job and not on the road yet, by the job; `yard`, through a yard, out or in, by the
 * yard — its lorries not drawn up under the crane meanwhile.
 */
const plantMoving = new WeakMap<Town, { legs: Map<string, number>; yard: Map<number, number> }>();
const movingOf = (town: Town) => {
  let m = plantMoving.get(town);
  if (!m) plantMoving.set(town, (m = { legs: new Map(), yard: new Map() }));
  return m;
};
export const plantComing = (town: Town, job: string) => (movingOf(town).legs.get(job) ?? 0) > 0;
const yardBusy = (town: Town, yard: number) => (movingOf(town).yard.get(yard) ?? 0) > 0;
const inYardNow = (town: Town, yard: number, by: number) => { const y = movingOf(town).yard; y.set(yard, Math.max(0, (y.get(yard) ?? 0) + by)); };
const legNow = (town: Town, job: string, by: number) => { const l = movingOf(town).legs; l.set(job, Math.max(0, (l.get(job) ?? 0) + by)); };
/** Tiles round a place in a yard within which another vehicle on the move is in the way of one setting off there. */
const YARD_CLEAR = 0.9;
/**
 * WHERE A JOB'S MACHINE IS KEPT, under a yard's shed: a bay of the fleet's that no lorry stands in now — and none
 * driving to or from it — else the first. (The machines do not crowd the lorries: one comes out of an empty bay.)
 */
function plantBay(town: Town, s: Structure) {
  const bays = YARD_PARKING[s.def] ?? [{ u: 4.3, v: 0.5 }];
  for (let k = 0; k < bays.length; k++) {
    const at = bayOf(s, k);
    if (town.fleet.some((f) => f.yard === s.id && f.bay === k && (f.home || f.waits))) continue;
    if (town.legs.some((l) => Math.hypot(l.m.x - at.x, l.m.y - at.y) < YARD_CLEAR)) continue;
    return at;
  }
  return bayOf(s, 0);
}
/** Whether a yard is clear for one of its machines to set off: nothing under its crane, and nothing on the move where it sets off or at its gate. */
function yardClear(town: Town, s: Structure, from: { x: number; y: number }): boolean {
  if (town.yard.some((x) => x.yard === s.id && (x.phase === "toBay" || x.phase === "loading" || (x.phase === "out" && x.left > -1.2)))) return false;
  if (yardBusy(town, s.id)) return false;
  const gate = inYardAt(s, YARD_GATE.u, GATE_V);
  return !town.legs.some((l) => Math.hypot(l.m.x - from.x, l.m.y - from.y) < YARD_CLEAR || Math.hypot(l.m.x - gate.x, l.m.y - gate.y) < YARD_CLEAR);
}

/**
 * A JOB'S MACHINE OUT OF THE YARD: from under the shed, where the company keeps them, round to the gate and onto
 * the road — and from there it is the town's traffic, to the job. With no way there it does not set out.
 */
export function plantOut(g: Grid, town: Town, from: Place, to: Place, job: NonNullable<Mover["job"]>, colour: number): "sent" | "wait" | "none" {
  const s = g.structures.get(from.structure!);
  if (!s) return "none";
  // (ONE AT A TIME THROUGH THE YARD: not while a lorry is under its crane, nor on top of anything on the move there.)
  const at = plantBay(town, s);
  if (!yardClear(town, s, at)) return "wait";
  const next = setOff(town, g, "truck", from, to);
  if (!next) return "none";
  const up = levelOf(s), m = ghost(town, g, at.x, at.y, outward(s), colour, up);
  const name = `${job.role}:${job.site}`;
  legNow(town, name, 1);
  inYardNow(town, s.id, 1);
  let out = false;
  const pts: LegPoint[] = [{ ...inYardAt(s, at.u, 1.3), up }, ...TO_BAY.map((p) => ({ ...inYardAt(s, p.u, p.v), up })), { ...inYardAt(s, YARD_GATE.u, GATE_V - 0.1), up }];
  // (Through the gate: the yard is free for the next.)
  pts.push({ ...inYardAt(s, YARD_GATE.u, GATE_V + 0.2), up: 0, on: () => { if (!out) { out = true; inYardNow(town, s.id, -1); } } }, { x: next.x, y: next.y, up: 0 });
  startLeg(town, m, pts, () => {
    if (!out) { out = true; inYardNow(town, s.id, -1); }
    next.id = m.id; next.colour = colour; next.job = job; next.heading = m.heading;
    town.movers.push(next);
    legNow(town, name, -1);
  }, up).join = next;
  return "sent";
}
/** Whether a vehicle stands at a yard's gate. */
const nearYard = (g: Grid, m: Mover) => { for (const s of g.structures.values()) if (!s.build && hasYard(s)) { const gate = inYardAt(s, YARD_GATE.u, GATE_V + 0.5); if (Math.hypot(gate.x - m.x, gate.y - m.y) < 1.3) return true; } return false; };
/** A job's machine home again: in at the gate and under the shed, where it is put away. */
function plantHome(g: Grid, town: Town, m: Mover): void {
  let yard: Structure | null = null, best = Infinity;
  for (const s of g.structures.values()) if (!s.build && hasYard(s)) { const d = Math.hypot(s.x - m.x, s.y - m.y); if (d < best) { best = d; yard = s; } }
  if (!yard) return;
  // (Into a bay no lorry stands in, and the yard busy till it is under the shed.)
  const up = levelOf(yard), at = plantBay(town, yard), id = yard.id;
  inYardNow(town, id, 1);
  startLeg(town, m, [{ ...inYardAt(yard, YARD_GATE.u, GATE_V + 0.25), up: 0 }, { ...inYardAt(yard, YARD_GATE.u, GATE_V - 0.1), up }, { ...inYardAt(yard, 4.42, 1.75), up }, { ...inYardAt(yard, at.u, 1.3), up }, { x: at.x, y: at.y, up }], () => inYardNow(town, id, -1), 0);
}

/** Seconds a lorry stands at a site or at a road's works while it is unloaded. */
export const UNLOADING = 3.5;
/** Tiles apart two lorries unloaded side by side stand. */
const BESIDE = 0.3;

/**
 * A LORRY THAT HAS COME WITH ITS LOAD PULLS IN, IS UNLOADED, AND GOES: off the road where it stopped, its nose in
 * at `spot` — the edge of the site, the head of the works — stood there while it is emptied; backed out onto the
 * road again; and away, to `home` (its yard, or out of the map): the same lorry, the town's traffic once more.
 * With no way home it stays where it backed out to, and — one of the fleet — is simply back in its bay.
 */
export function unloadAt(g: Grid, town: Town, m: Mover, at: Place, spot: { x: number; y: number }, home: Place | null, site: number): void {
  const from = { x: m.x, y: m.y }, empty = m.fleet ? (m.colour === FLEET_TIPPER_COLOUR ? FLEET_TIPPER_EMPTY_COLOUR : PIPE_EMPTY_COLOUR) : m.colour;
  const next = home ? setOff(town, g, "truck", at, home) : null;
  // (Pulled in BESIDE one unloading there already, not on top of it: across the way in by a lorry's width and a little.)
  const dl = Math.hypot(spot.x - from.x, spot.y - from.y) || 1, ax = -(spot.y - from.y) / dl, ay = (spot.x - from.x) / dl;
  const busy = (p: { x: number; y: number }) => town.legs.some((l) => Math.hypot(l.m.x - p.x, l.m.y - p.y) < BESIDE || l.pts.some((q, k) => k >= l.k && q.stop !== undefined && Math.hypot(q.x - p.x, q.y - p.y) < BESIDE));
  const into = [0, BESIDE, -BESIDE].map((o) => ({ x: spot.x + ax * o, y: spot.y + ay * o })).find((p) => !busy(p)) ?? spot;
  const pts: LegPoint[] = [{ x: into.x, y: into.y, stop: UNLOADING, colour: empty }, { x: from.x, y: from.y, rev: true }];
  if (next) pts.push({ x: next.x, y: next.y });
  const leg = startLeg(town, m, pts, () => {
    if (!next) { if (m.fleet) lorryLost(g, town, m.id); return; }
    next.id = m.id; next.colour = m.colour; next.job = { site, role: "haul-back" }; next.heading = m.heading;
    if (m.fleet) next.fleet = true;
    town.movers.push(next);
  });
  if (next) leg.join = next;
}
