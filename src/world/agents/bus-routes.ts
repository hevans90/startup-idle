/**
 * World v2 — THE BUS ROUTES: loops of stops along the streets with the most
 * doors on them, one a ~40 buildings, worked out again when the roads change
 * or the town grows. A route is its stops in the order a bus calls at them:
 * round and round where the lanes go back to the first, else a line from the
 * edge of the map and off it again. @see lanes/graph Stop, town stepBuses
 *
 * Pure: from the lane graph's stop sites and the town's doors.
 */
import { routeLanes } from "./lanes/drive";
import type { LaneGraph, Stop } from "./lanes/graph";
import type { Place } from "./roads";

/** Doors to a route, and the fewest a town has before it has one; at most this many routes. */
export const DOORS_A_ROUTE = 40;
const MIN_DOORS = 15;
const MAX_ROUTES = 4;
/** A stop worth calling at has this many doors within `NEAR` tiles of it. */
const NEAR = 3;
const MIN_SCORE = 2;
/** Stops on a route: at most, and at least this far apart, tiles; routes' first stops at least this far apart. */
const MAX_STOPS = 10;
const STOP_APART = 4;
const SEED_APART = 10;

/** The routes' liveries, in turn. */
export const ROUTE_COLOURS = [0xd8322b, 0x2b7bd8, 0x2fa05a, 0xe0962a] as const;

/** A route: its stops in the order called at, its livery, and whether it goes round (else a line, edge to edge). */
export type Route = { id: number; stops: number[]; colour: number; loop: boolean };

/** How far from a stop to a place, tiles along the axes. */
export const stopTo = (s: Stop, p: { x: number; y: number }) => Math.abs(s.wait.x - p.x) + Math.abs(s.wait.y - p.y);

/** How many routes a town of so many doors has. */
export const routesFor = (doors: number) => (doors < MIN_DOORS ? 0 : Math.max(1, Math.min(MAX_ROUTES, Math.round(doors / DOORS_A_ROUTE))));

/** How far a bus drives from one stop to the next, tiles along its lanes; Infinity if there is no way. */
function wayLen(G: LaneGraph, a: Stop, b: Stop): number {
  const r = routeLanes(G, [{ lane: a.lane, s: a.s }], [{ lane: b.lane, s: b.s }]);
  if (!r) return Infinity;
  return r.lanes.reduce((n, l) => n + G.lanes[l].len, 0) - r.s0 - (G.lanes[r.lanes[r.lanes.length - 1]].len - r.s1);
}

export function routesOf(G: LaneGraph, places: readonly Place[]): Route[] {
  const doors = places.filter((p) => p.kind === "door" && !p.building);
  const R = routesFor(doors.length);
  if (!R || !G.stops.length) return [];
  // Each stop by the doors near it, the best first.
  const score = new Map<number, number>();
  for (const s of G.stops) score.set(s.id, doors.filter((d) => stopTo(s, d) <= NEAR).length);
  const good = G.stops.filter((s) => score.get(s.id)! >= MIN_SCORE).sort((a, b) => score.get(b.id)! - score.get(a.id)! || a.id - b.id);
  // THE FIRST STOP of each route: the best, then the best well away from those already taken.
  const dist = (a: Stop, b: Stop) => Math.hypot(a.x - b.x, a.y - b.y);
  const seeds: Stop[] = [];
  for (const s of good) {
    if (seeds.length >= R) break;
    if (seeds.every((q) => dist(q, s) >= SEED_APART)) seeds.push(s);
  }
  // Every other stop to the route whose first stop is nearest, best first, not too near another on it.
  const members = seeds.map((s) => [s]);
  for (const s of good) {
    if (seeds.includes(s)) continue;
    let k = 0;
    for (let i = 1; i < seeds.length; i++) if (dist(seeds[i], s) < dist(seeds[k], s)) k = i;
    const m = members[k];
    if (m.length < MAX_STOPS && m.every((q) => dist(q, s) >= STOP_APART)) m.push(s);
  }
  // IN ORDER: from whichever of them calls at the most, each time on to the
  // nearest left by the lanes — one it cannot drive to left out. Round and
  // round if the last has a way back to the first; else a line, in from the
  // edge of the map and out again.
  const routes: Route[] = [];
  for (const m of members) {
    const len = new Map<string, number>();
    const way = (a: Stop, b: Stop) => { const k = `${a.id},${b.id}`; let c = len.get(k); if (c === undefined) len.set(k, (c = wayLen(G, a, b))); return c; };
    let order: Stop[] = [], total = Infinity;
    for (const first of m) {
      const o = [first], left = m.filter((s) => s !== first);
      let n = 0;
      while (left.length) {
        const at = o[o.length - 1];
        let best = -1, bc = Infinity;
        left.forEach((s, i) => { const c = way(at, s); if (c < bc) { bc = c; best = i; } });
        if (best < 0) break;
        o.push(left.splice(best, 1)[0]);
        n += bc;
      }
      if (o.length > order.length || (o.length === order.length && n < total)) { order = o; total = n; }
    }
    if (order.length < 2) continue;
    const loop = way(order[order.length - 1], order[0]) < Infinity;
    routes.push({ id: routes.length, stops: order.map((s) => s.id), colour: ROUTE_COLOURS[routes.length % ROUTE_COLOURS.length], loop });
  }
  return routes;
}
