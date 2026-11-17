/**
 * World v2 — A LINE'S PIPE, ON THE ROAD: each load of a main or a sewer sent for by its job leaves the company's
 * yard — the Garage and what it grows into — on a lorry, is driven through the town to the open road nearest the
 * start of the line, set down there, and the lorry driven home again. A line no road comes near, or with no way
 * to it from a yard, is supplied as it was: unseen, on a clock. @see jobs stepLine, roads/job-loads (a road's)
 */
import { idx, inBounds, type Grid } from "../grid";
import { placesOf, type Place } from "../agents/roads";
import { sendOnJob, type Mover, type Town } from "../agents/town";
import { find, type Network } from "../roads/network";
import { FLEET_TIPPER_COLOUR, FLEET_TIPPER_EMPTY_COLOUR, PIPE_EMPTY_COLOUR, PIPE_LORRY_COLOUR, PLANT_CRANE_COLOUR, PLANT_LOADER_COLOUR, PLANT_MIXER_COLOUR, PLANT_PICKUP_COLOUR } from "../agents/cars/fleet";
import { craneFree, fleetFree, isYard } from "../fleet/fleet";
import { LINE_HAUL, LINE_LAYS, LINE_PLANT, PLANT_GAP, PLANT_GATHER, TRACK_SPEED, YARD_LOADING, lineFront, type LineJob, type PlantKind } from "./jobs";

/** The Garage and what it grows into: the yard a load comes from. @see works depotFor */
export const YARDS: readonly string[] = ["garage", "hq", "boardroom", "ipo"];
/** How far from a line's first tile its lorries will set a load down, tiles. */
export const LINE_REACH = 8;

/** The open road a line's lorries drive to: the paved tile nearest its first, within reach. Null with none. */
export function lineHead(g: Grid, net: Network, j: Pick<LineJob, "cells">): Place | null {
  const c = j.cells[0];
  let best: Place | null = null, bestD = Infinity;
  for (let dy = -LINE_REACH; dy <= LINE_REACH; dy++) for (let dx = -LINE_REACH; dx <= LINE_REACH; dx++) {
    const x = c.x + dx, y = c.y + dy, d = Math.abs(dx) + Math.abs(dy);
    if (d > LINE_REACH || d >= bestD || !inBounds(g, x, y) || g.paved[idx(g, x, y)] === 0) continue;
    const n = find(net, idx(g, x, y));
    if (n >= 0) { best = { x, y, kind: "door", net: n }; bestD = d; }
  }
  return best;
}

/** The yard nearest a place on its roads; else where a road leaves the map. */
export function yardFor(g: Grid, places: readonly Place[], at: Place): Place | null {
  let best: Place | null = null, bestD = Infinity;
  for (const s of g.structures.values()) {
    if (!YARDS.includes(s.def) || s.build) continue;
    const pl = places.find((p) => p.structure === s.id && p.net === at.net), d = Math.abs(s.x - at.x) + Math.abs(s.y - at.y);
    if (pl && d < bestD) { best = pl; bestD = d; }
  }
  return best ?? places.find((p) => p.kind === "gateway" && p.net === at.net && (p.x !== at.x || p.y !== at.y)) ?? null;
}

/**
 * A LORRY THAT HAS BROUGHT ITS LOAD GOES HOME: the same lorry, from where it stopped, back to the yard it came from
 * — or out of the map. Nothing waits on it. Whether it set off.
 */
export function sendHome(town: Town, g: Grid, places: readonly Place[], m: Mover, at: Place): boolean {
  const home = yardFor(g, places, at);
  // (On from the lane it stopped in where that leads home; else turned round where it stands, onto the lane that does.)
  const job = { site: m.job?.site ?? 0, role: "haul-back" as const };
  const back = home && (sendOnJob(town, g, "truck", at, home, job, m) ?? sendOnJob(town, g, "truck", at, home, job));
  if (!back) return false;
  // (The same lorry: its model and its driver go by its number.)
  back.id = m.id;
  back.colour = m.colour;
  // (One of the fleet goes home as it is: emptied — a bare bed, a tipper with nothing in it.)
  if (m.fleet) { back.fleet = true; back.colour = m.colour === FLEET_TIPPER_COLOUR ? FLEET_TIPPER_EMPTY_COLOUR : PIPE_EMPTY_COLOUR; }
  return true;
}

/** Loads on their way to each line: on a lorry in the yard, on the road, or on its haul track. */
export function lineLorriesOut(town: Town, g?: Grid): Map<number, number> {
  const out = new Map<number, number>();
  for (const m of town.movers) if (m.job?.role === "line-load" && !town.arrived.includes(m)) out.set(m.job.site, (out.get(m.job.site) ?? 0) + 1);
  for (const j of g?.lineJobs ?? []) { const n = (j.yard?.length ?? 0) + (j.drive?.length ?? 0); if (n) out.set(j.id, (out.get(j.id) ?? 0) + n); }
  return out;
}

/** How far a lorry drives on a job's haul track between the road and the crane, tiles: the road to the line, and the line as far as the pipe has got. */
const trackRun = (j: LineJob, head: { x: number; y: number }) =>
  Math.abs(head.x - j.cells[0].x) + Math.abs(head.y - j.cells[0].y) + 1 + lineFront(j, LINE_LAYS[j.kind]);
/** How many lorries have been unloaded and are done with: three halves of a tile each. @see line-works (the same count) */
export const lineTripsDone = (j: LineJob) => Math.max(0, Math.floor((lineFront(j, LINE_LAYS[j.kind]) * 2 - 1) / 3));

/**
 * A FRAME OF A LINE'S HAULAGE, with a town to drive through. Its lorries that have reached the road by the line
 * turn up its haul track; those that have driven up it are there — their load counted in; those the crane has
 * emptied drive back down, and from the road, home; and the loads on lorries under the yard's crane are loaded,
 * and set off. Arrivals are taken off the town's list, which the sites read next. Whether anything changed.
 */
export function stepLineHaul(g: Grid, haul: { net: Network; town: Town }, dt: number): boolean {
  let changed = false, places: Place[] | null = null;
  for (let k = haul.town.arrived.length - 1; k >= 0; k--) {
    const m = haul.town.arrived[k];
    // (A machine that has got there is simply there. @see stepLinePlant)
    if (m.job?.role === "plant") { haul.town.arrived.splice(k, 1); changed = true; continue; }
    if (m.job?.role !== "line-load") continue;
    haul.town.arrived.splice(k, 1);
    const j = g.lineJobs.find((q) => q.id === m.job!.site);
    if (!j) continue;
    const of = trackRun(j, j.head ?? j.cells[0]) / TRACK_SPEED;
    (j.drive ??= []).push({ left: of, of });
    changed = true;
  }
  for (const j of g.lineJobs) {
    // UP THE TRACK, and there.
    for (let k = (j.drive?.length ?? 0) - 1; k >= 0; k--) {
      const d = j.drive![k];
      d.left -= dt;
      if (d.left <= 0) { j.drive!.splice(k, 1); j.delivered = Math.min(j.deliveries, j.delivered + 1); changed = true; }
    }
    // EMPTIED, and back down it; at the road, home.
    if (j.head && (j.gone ?? 0) < Math.min(lineTripsDone(j), j.delivered)) {
      const of = trackRun(j, j.head) / TRACK_SPEED;
      (j.back ??= []).push({ left: of, of });
      j.gone = (j.gone ?? 0) + 1;
    }
    for (let k = (j.back?.length ?? 0) - 1; k >= 0; k--) {
      const b = j.back![k];
      b.left -= dt;
      if (b.left > 0) continue;
      j.back!.splice(k, 1);
      const n = find(haul.net, idx(g, j.head!.x, j.head!.y));
      const at: Place | null = n >= 0 ? { x: j.head!.x, y: j.head!.y, kind: "door", net: n } : null, home = at && yardFor(g, places ??= placesOf(g, haul.net), at);
      const m = at && home ? sendOnJob(haul.town, g, "truck", at, home, { site: j.id, role: "haul-back" }) : null;
      if (m) { m.colour = PIPE_EMPTY_COLOUR; m.fleet = true; }
    }
    // UNDER THE YARD'S CRANE, and off.
    for (let k = (j.yard?.length ?? 0) - 1; k >= 0; k--) {
      j.yard![k] -= dt;
      if (j.yard![k] > 0) continue;
      j.yard!.splice(k, 1);
      changed = true;
      const head = lineHead(g, haul.net, j), from = head && yardFor(g, places ??= placesOf(g, haul.net), head);
      // (Its road gone since it was loaded: it comes as a load does with none. @see LINE_HAUL)
      const m = head && from ? sendOnJob(haul.town, g, "truck", from, head, { site: j.id, role: "line-load" }) : null;
      if (m) { m.colour = PIPE_LORRY_COLOUR; m.fleet = true; }
      else j.coming.push(LINE_HAUL);
    }
  }
  return changed;
}

/**
 * Send for a line's next load by road: a lorry is put under the yard's crane, to set off when it is loaded. False
 * with no road near the line or no way to it from a yard: it comes unseen, on the clock.
 */
export function sendLineLoad(g: Grid, haul: { net: Network; town: Town }, j: LineJob): boolean {
  const head = lineHead(g, haul.net, j);
  const from = head && yardFor(g, placesOf(g, haul.net), head);
  // (From a yard only: with none built, a line's pipe comes unseen.)
  if (!head || !isYard(g, from) || (from.x === head.x && from.y === head.y)) return false;
  j.head = { x: head.x, y: head.y };
  j.depot = from.structure;
  // (One at a time under the crane: the next is loaded when this one is.)
  (j.yard ??= []).push(YARD_LOADING + craneFree(g, haul.town, from.structure!));
  return true;
}

/**
 * Whether a line's next load may be sent for now: by road from a yard, only with a lorry of the fleet standing free
 * — else it waits for one; with no road or no yard it comes unseen, and may always be. @see stepLine
 */
export function lineLorryFree(g: Grid, haul: { net: Network; town: Town }, j: LineJob): boolean {
  const head = lineHead(g, haul.net, j);
  const from = head && yardFor(g, placesOf(g, haul.net), head);
  return !head || !isYard(g, from) || fleetFree(g, haul.town) > 0;
}

const PLANT_COLOUR: Readonly<Record<PlantKind, number>> = { crane: PLANT_CRANE_COLOUR, mixer: PLANT_MIXER_COLOUR, loader: PLANT_LOADER_COLOUR, pickup: PLANT_PICKUP_COLOUR };

/**
 * A FRAME OF A LINE'S MACHINES. A job by a road a yard is on is not worked till its machines have come from that
 * yard — the crane, a mixer, its diggers on low-loaders, the gang's pickup, one after another through the town —
 * and when it is done they gather at the road and go home the same way; only then is the job over. Says where it
 * has got to: `wait` (not worked yet), `work`, `leaving` (done, its machines going), `gone` (to be taken off the
 * map's list). `none` for a job nothing comes to by road: its machines are simply there, as they were.
 */
export function stepLinePlant(g: Grid, haul: { net: Network; town: Town }, j: LineJob, dt: number): "none" | "wait" | "work" | "leaving" | "gone" {
  if (j.plant === false || !LINE_PLANT[j.kind].length) return "none";
  const head = lineHead(g, haul.net, j), from = head && yardFor(g, placesOf(g, haul.net), head);
  const ok = !!head && isYard(g, from) && (from.x !== head.x || from.y !== head.y);
  if (!j.plant) {
    // (Under way already — a map loaded with it half laid — its machines are on it.)
    if (!ok || j.t > 0) { j.plant = ok ? { queue: [], t: 0, here: true } : false; return ok ? "work" : "none"; }
    j.head = { x: head!.x, y: head!.y };
    j.depot = from!.structure;
    j.plant = { queue: [...LINE_PLANT[j.kind]], t: 0, here: false };
  }
  const p = j.plant;
  const send = (kind: PlantKind, a: Place, b: Place) => { const m = sendOnJob(haul.town, g, "truck", a, b, { site: j.id, role: "plant" }); if (m) m.colour = PLANT_COLOUR[kind]; };
  if (p.leaving !== undefined) {
    p.leaving += dt;
    p.home ??= [...LINE_PLANT[j.kind]];
    if (p.leaving >= PLANT_GATHER && p.home.length) {
      p.t -= dt;
      if (p.t <= 0) { const kind = p.home.shift()!; if (ok) send(kind, head!, from!); p.t = PLANT_GAP; }
    }
    return p.home.length ? "leaving" : "gone";
  }
  if (p.here) return "work";
  // (Its road gone from under it since: they are counted as there.)
  if (!ok) { p.queue = []; p.here = true; return "work"; }
  p.t -= dt;
  if (p.queue.length && p.t <= 0) { send(p.queue.shift()!, from!, head!); p.t = PLANT_GAP; }
  const onRoad = haul.town.movers.some((m) => m.job?.role === "plant" && m.job.site === j.id && !haul.town.arrived.includes(m));
  if (!p.queue.length && !onRoad) p.here = true;
  return p.here ? "work" : "wait";
}
