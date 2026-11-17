/**
 * World v2 — A ROAD JOB'S MATERIALS, on the road: each load sent for when the
 * job runs short, PAID FOR AS IT IS SENT, and brought by a lorry from the
 * company's yard — or from where a road leaves the map — to the job's head,
 * the open road nearest the work. A job no road reaches is supplied across
 * country, unseen and slower. One that cannot pay stands. @see jobs, works
 */
import { idx, inBounds, type Grid } from "../grid";
import { placesOf, type Place } from "../agents/roads";
import { sendOnJob, type Town } from "../agents/town";
import { find, type Network } from "./network";
import { GANGS, OVERLAND, loadPrice, materialTime, wantsLoad, type RoadJob } from "./jobs";

/** The Garage and what it grows into: the yard a load comes from. @see works depotFor */
const YARDS = ["garage", "hq", "boardroom", "ipo"];

/** The open road a job's lorries drive to: the last of it open, else a road its first cell stands on or beside. Null with none. */
export function headOf(g: Grid, net: Network, j: RoadJob): Place | null {
  const at = (x: number, y: number): Place | null => {
    if (!inBounds(g, x, y) || g.paved[idx(g, x, y)] === 0) return null;
    const n = find(net, idx(g, x, y));
    return n >= 0 ? { x, y, kind: "door", net: n } : null;
  };
  for (let k = j.opened - 1; k >= 0; k--) { const p = at(j.cells[k].x, j.cells[k].y); if (p) return p; }
  for (const c of j.cells) {
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) { const p = at(c.x + dx, c.y + dy); if (p) return p; }
  }
  return null;
}

/** Where a job's loads set off from, on the roads its head is on: the company's yard nearest it, else where a road leaves the map. */
function depotFor(g: Grid, places: readonly Place[], head: Place): Place | null {
  let best: Place | null = null, bestD = Infinity;
  for (const s of g.structures.values()) {
    if (!YARDS.includes(s.def) || s.build) continue;
    const pl = places.find((p) => p.structure === s.id && p.net === head.net), d = Math.abs(s.x - head.x) + Math.abs(s.y - head.y);
    if (pl && d < bestD) { best = pl; bestD = d; }
  }
  return best ?? places.find((p) => p.kind === "gateway" && p.net === head.net && (p.x !== head.x || p.y !== head.y)) ?? null;
}

/** Loads on their way to each job by road. */
export function lorriesOut(town: Town): Map<number, number> {
  const out = new Map<number, number>();
  for (const m of town.movers) if (m.job?.role === "road-load" && !town.arrived.includes(m)) out.set(m.job.site, (out.get(m.job.site) ?? 0) + 1);
  return out;
}

/**
 * A FRAME OF THE JOBS' LOADS: the lorries that have arrived unloaded (and
 * taken off the town's list of arrivals, which the building sites read
 * next); a load sent for by each job that wants one, if `spend` will pay for
 * it. With no `haul` — no town to drive through — every load comes at once.
 * Whether anything changed worth showing.
 */
export function stepRoadLoads(
  g: Grid, spend: (amount: number) => boolean, dt: number, haul?: { net: Network; town: Town },
): boolean {
  let changed = false;
  if (haul) {
    for (let k = haul.town.arrived.length - 1; k >= 0; k--) {
      const m = haul.town.arrived[k];
      if (m.job?.role !== "road-load") continue;
      haul.town.arrived.splice(k, 1);
      const j = g.roadJobs.find((q) => q.id === m.job!.site);
      if (j) { j.delivered = Math.min(j.deliveries, j.delivered + 1); changed = true; }
    }
  }
  const out = haul ? lorriesOut(haul.town) : new Map<number, number>();
  let places: Place[] | null = null;
  for (const j of g.roadJobs.slice(0, GANGS)) {
    const onWay = (out.get(j.id) ?? 0) + j.overland.length;
    if (!wantsLoad(j, onWay)) { if (j.stalled) { j.stalled = 0; changed = true; } continue; }
    if (!spend(loadPrice(j))) {
      // STALLED only once the work has run out of what it has.
      if ((j.tm ?? j.t) >= materialTime(j) - 1e-6 && onWay === 0) { if (!j.stalled) changed = true; j.stalled += dt; }
      continue;
    }
    if (j.stalled) { j.stalled = 0; changed = true; }
    if (!haul) { j.delivered++; changed = true; continue; }
    const head = headOf(g, haul.net, j);
    const from = head && depotFor(g, places ??= placesOf(g, haul.net), head);
    if (!head || !from || !sendOnJob(haul.town, g, "truck", from, head, { site: j.id, role: "road-load" })) j.overland.push(OVERLAND);
    changed = true;
  }
  return changed;
}
