/**
 * World v2 — A LINE'S PIPE, ON THE ROAD: each load of a main or a sewer sent for by its job leaves the company's
 * yard — the Garage and what it grows into — on a lorry, is driven through the town to the open road nearest the
 * start of the line, set down there, and the lorry driven home again. A line no road comes near, or with no way
 * to it from a yard, is supplied as it was: unseen, on a clock. @see jobs stepLine, roads/job-loads (a road's)
 */
import { idx, inBounds, type Grid } from "../grid";
import { placesOf, type Place } from "../agents/roads";
import { sendOnJob, setOff, type Mover, type Town } from "../agents/town";
import { find, type Network } from "../roads/network";
import { FLEET_TIPPER_COLOUR, FLEET_TIPPER_EMPTY_COLOUR, PIPE_EMPTY_COLOUR, halfLength } from "../agents/cars/fleet";
import { roomOrWaited } from "../fleet/legs";
import { channelTo, steadyRivers } from "../boats/quay";
import { isYard, lorryFor, lorryLost, queueYardLoad, yardQueued } from "../fleet/fleet";
import { stepPlant } from "../fleet/plant";
import { LINE_LAYS, LINE_PLANT, TRACK_SPEED, lineFront, type LineJob } from "./jobs";

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
  const out = yardQueued(town, "line-load");
  for (const m of town.movers) if (m.job?.role === "line-load" && !town.arrived.includes(m)) out.set(m.job.site, (out.get(m.job.site) ?? 0) + 1);
  for (const j of g?.lineJobs ?? []) { const n = j.drive?.length ?? 0; if (n) out.set(j.id, (out.get(j.id) ?? 0) + n); }
  return out;
}

/** How far a lorry drives on a job's haul track between the road and the crane, tiles: the road to the line, and the line as far as the pipe has got. */
const trackRun = (j: LineJob, head: { x: number; y: number }) =>
  Math.abs(head.x - j.cells[0].x) + Math.abs(head.y - j.cells[0].y) + 1 + lineFront(j, LINE_LAYS[j.kind]);
/** How many lorries have been unloaded and are done with: three halves of a tile each. @see line-works (the same count) */
export const lineTripsDone = (j: LineJob) => Math.max(0, Math.floor((lineFront(j, LINE_LAYS[j.kind]) * 2 - 1) / 3));

/** The lorries waiting at the road to go home, each already found its way: held till its turn off the track is done. By job and lorry. */
const leaving = new Map<string, Mover>();

/**
 * A FRAME OF A LINE'S HAULAGE, with a town to drive through. Its lorries that have reached the road by the line
 * turn up its haul track — the same lorry, from where it stopped; those that have driven up it are there — their
 * load counted in; those the crane has emptied drive back down, and at the road ARE the traffic again, home.
 * Arrivals are taken off the town's list, which the sites read next. Whether anything changed.
 */
export function stepLineHaul(g: Grid, haul: { net: Network; town: Town }, dt: number): boolean {
  let changed = false, places: Place[] | null = null;
  for (let k = haul.town.arrived.length - 1; k >= 0; k--) {
    const m = haul.town.arrived[k];
    if (m.job?.role !== "line-load") continue;
    haul.town.arrived.splice(k, 1);
    const j = g.lineJobs.find((q) => q.id === m.job!.site);
    if (!j) { lorryLost(g, haul.town, m.id); continue; }
    const of = trackRun(j, j.head ?? j.cells[0]) / TRACK_SPEED;
    (j.drive ??= []).push({ left: of, of, id: m.id, at: { x: m.x, y: m.y, heading: m.heading } });
    changed = true;
  }
  for (const j of g.lineJobs) {
    // UP THE TRACK, and there.
    for (let k = (j.drive?.length ?? 0) - 1; k >= 0; k--) {
      const d = j.drive![k];
      d.left -= dt;
      if (d.left <= 0) { j.drive!.splice(k, 1); j.delivered = Math.min(j.deliveries, j.delivered + 1); (j.ids ??= []).push(d.id); changed = true; }
    }
    // EMPTIED, and back down it: its way home found as it sets off, so that where the track ends is where that begins.
    if (j.head && (j.gone ?? 0) < Math.min(lineTripsDone(j), j.delivered)) lineLorryBack(g, haul, j, places ??= placesOf(g, haul.net));
    for (let k = (j.back?.length ?? 0) - 1; k >= 0; k--) {
      const b = j.back![k];
      b.left -= dt;
      if (b.left > 0) continue;
      // AT THE ROAD: the same lorry, the town's traffic again — when there is room on it. (With no way home, it is simply back.)
      const next = leaving.get(`${j.id}:${b.id}`);
      if (next && !roomOrWaited(haul.town, `line:${j.id}:${b.id}`, next, halfLength({ ...next, colour: PIPE_EMPTY_COLOUR }), dt)) { b.left = 0; continue; }
      j.back!.splice(k, 1);
      leaving.delete(`${j.id}:${b.id}`);
      if (!next) { lorryLost(g, haul.town, b.id); continue; }
      next.id = b.id; next.colour = PIPE_EMPTY_COLOUR; next.fleet = true; next.job = { site: j.id, role: "haul-back" };
      haul.town.movers.push(next);
    }
  }
  return changed;
}

/** Send the next of a job's emptied lorries back down its track: the one longest there. */
export function lineLorryBack(g: Grid, haul: { net: Network; town: Town }, j: LineJob, places: readonly Place[]): void {
  const trip = j.gone ?? 0, id = j.ids?.[trip] ?? -1, of = trackRun(j, j.head!) / TRACK_SPEED;
  const n = find(haul.net, idx(g, j.head!.x, j.head!.y));
  const at: Place | null = n >= 0 ? { x: j.head!.x, y: j.head!.y, kind: "door", net: n } : null, home = at && yardFor(g, places, at);
  const next = at && home ? setOff(haul.town, g, "truck", at, home) : null;
  if (next) leaving.set(`${j.id}:${id}`, next);
  (j.back ??= []).push({ left: of, of, id, ...(next ? { to: { x: next.x, y: next.y, heading: next.heading } } : {}) });
  j.gone = trip + 1;
}

/**
 * Send for a line's next load by road: a lorry of the fleet is sent to the yard's crane, to set off when it is
 * loaded. False with no road near the line, no yard, or no flatbed standing free: it comes unseen, on the clock.
 */
export function sendLineLoad(g: Grid, haul: { net: Network; town: Town }, j: LineJob): boolean {
  const head = lineHead(g, haul.net, j);
  const from = head && yardFor(g, placesOf(g, haul.net), head);
  // (From a yard only: with none built, a line's pipe comes unseen.)
  if (!head || !isYard(g, from) || (from.x === head.x && from.y === head.y)) return false;
  if (!queueYardLoad(g, haul.town, from, head, { site: j.id, role: "line-load" }, { pipes: j.kind === "dredge" ? "main" : j.kind })) return false;
  j.head = { x: head.x, y: head.y };
  j.depot = from.structure;
  return true;
}

/**
 * Whether a line's next load may be sent for now: by road from a yard, only with a lorry of the fleet standing free
 * — else it waits for one; with no road or no yard it comes unseen, and may always be. @see stepLine
 */
export function lineLorryFree(g: Grid, haul: { net: Network; town: Town }, j: LineJob): boolean {
  const head = lineHead(g, haul.net, j);
  const from = head && yardFor(g, placesOf(g, haul.net), head);
  return !head || !isYard(g, from) || lorryFor(g, haul.town, { pipes: "main" });
}

/**
 * A FRAME OF A LINE'S MACHINES: from the yard before it is worked, and home when it is done — its lorries let off
 * its track first. @see fleet/plant stepPlant
 */
export function stepLinePlant(g: Grid, haul: { net: Network; town: Town }, j: LineJob, dt: number): "none" | "wait" | "work" | "leaving" | "gone" {
  if (j.plant === false || !LINE_PLANT[j.kind].length) return "none";
  const head = lineHead(g, haul.net, j);
  if (!j.plant && head) { j.head = { x: head.x, y: head.y }; const from = yardFor(g, placesOf(g, haul.net), head); if (isYard(g, from)) j.depot = from.structure; }
  // (Whatever lorries are still on it are let off first: each back down the track and home.)
  if (j.plant && j.plant.leaving !== undefined && j.head) { const places = placesOf(g, haul.net); while ((j.gone ?? 0) < j.delivered) lineLorryBack(g, haul, j, places); }
  return stepPlant(g, haul, j, { id: j.id, role: "plant" }, head, LINE_PLANT[j.kind], j.t > 0, dt, !!(j.back?.length || j.drive?.length));
}

/** Tiles a second a dredger makes under way. */
export const BARGE_SPEED = 1.1;
/**
 * A FRAME OF A CHANNEL'S DREDGER, which comes by water: in from where its river comes into the map to the channel's
 * first tile before a grab is lowered (`wait`), at work (`work`), and — the channel dug, `barge.out` set by its
 * owner — away again down the river from where it finished (`leaving`, then `gone`). `none` with no way by water.
 */
export function stepBarge(g: Grid, j: LineJob, dt: number): "none" | "wait" | "work" | "leaving" | "gone" {
  if (j.barge === false) return "none";
  if (!j.barge) {
    // (Under way already when first looked at — a map loaded with it half dug: it is there.)
    const path = j.t > 0 ? [] : channelTo(steadyRivers(g), j.cells[0]);
    if (path.length < 2) { j.barge = false; return "none"; }
    j.barge = { path, s: 0 };
  }
  const b = j.barge, end = b.path.length - 1;
  if (b.out) { b.s -= BARGE_SPEED * dt; return b.s <= 0 ? "gone" : "leaving"; }
  if (b.s < end) b.s = Math.min(end, b.s + BARGE_SPEED * dt);
  return b.s < end ? "wait" : "work";
}
/** The channel dug: its dredger is to sail away — from its last tile, down the river. False with no way: it is simply gone. */
export function bargeAway(g: Grid, j: LineJob): boolean {
  if (!j.barge) return false;
  const path = channelTo(steadyRivers(g), j.cells[j.cells.length - 1]);
  if (path.length < 2) return false;
  j.barge = { path, s: path.length - 1, out: true };
  return true;
}
