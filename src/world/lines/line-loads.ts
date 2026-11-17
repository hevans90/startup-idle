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
import type { LineJob } from "./jobs";

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
  const back = home && sendOnJob(town, g, "truck", at, home, { site: m.job?.site ?? 0, role: "haul-back" }, m);
  if (!back) return false;
  // (The same lorry: its model and its driver go by its number.)
  back.id = m.id;
  back.colour = m.colour;
  return true;
}

/** Loads on their way to each line by road. */
export function lineLorriesOut(town: Town): Map<number, number> {
  const out = new Map<number, number>();
  for (const m of town.movers) if (m.job?.role === "line-load" && !town.arrived.includes(m)) out.set(m.job.site, (out.get(m.job.site) ?? 0) + 1);
  return out;
}

/**
 * THE LORRIES THAT HAVE GOT THERE: each one's load counted in to its job, and the lorry sent home. Taken off the
 * town's list of arrivals, which the sites read next. Whether any came.
 */
export function takeLineLoads(g: Grid, haul: { net: Network; town: Town }): boolean {
  let changed = false, places: Place[] | null = null;
  for (let k = haul.town.arrived.length - 1; k >= 0; k--) {
    const m = haul.town.arrived[k];
    if (m.job?.role !== "line-load") continue;
    haul.town.arrived.splice(k, 1);
    const j = g.lineJobs.find((q) => q.id === m.job!.site);
    if (!j) continue;
    j.delivered = Math.min(j.deliveries, j.delivered + 1);
    changed = true;
    const head = lineHead(g, haul.net, j);
    if (head && !m.gone) sendHome(haul.town, g, places ??= placesOf(g, haul.net), m, head);
  }
  return changed;
}

/** Send a line's next load from the yard to its head by road. False with no road near it or no way there. */
export function sendLineLoad(g: Grid, haul: { net: Network; town: Town }, j: LineJob): boolean {
  const head = lineHead(g, haul.net, j);
  const from = head && yardFor(g, placesOf(g, haul.net), head);
  return !!(head && from && (from.x !== head.x || from.y !== head.y) && sendOnJob(haul.town, g, "truck", from, head, { site: j.id, role: "line-load" }));
}
