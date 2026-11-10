/**
 * World v2 — BUSES ON THEIR ROUTES: each route's buses round its stops,
 * pulling in at each a few seconds; walkers going a long way walking to a
 * stop near them, waiting there, getting on, and off at the stop nearest
 * where they are going, to walk the rest. @see bus-routes, town stepTown
 *
 * Live, not saved, like the rest of the town.
 */
import { NEIGHBOUR } from "../../iso/dir";
import type { Grid } from "../grid";
import { routesOf, stopTo, type Route } from "./bus-routes";
import type { LaneGraph, Stop } from "./lanes/graph";
import type { Kerbside } from "./lanes/walk";
import type { Place } from "./roads";
import { along, setOff, type Mover, type Town } from "./town";
import { hash } from "./walker-life";

/** A trip this long or longer, tiles along the axes, may go by bus: the share that do, if a route serves it. */
export const BUS_TRIP = 12;
export const BUS_TAKE = 0.6;
/** The furthest anyone walks to a stop, or from one, tiles along the axes. */
export const WALK_TO_STOP = 6;
/** Seconds a bus stands at a stop, least and most, and at most while people are still getting on. */
const DWELL = [3, 5] as const;
const DWELL_MAX = 9;
/** Seconds between one getting on and the next; seats on a bus. */
const BOARD_GAP = 0.45;
const SEATS = 30;
/** Seconds between buses setting off onto their routes; and how long anybody waits at a stop. */
const BUS_EVERY = 8;
const PATIENCE = 120;
/** People waiting at a stop stand this far apart along the kerb, tiles. */
const QUEUE = 0.07;

/** On a bus: who, and at which of its route's stops each gets off, to walk on to where. */
export type Rider = { off: number; to: Place };
/**
 * A route bus's leg, stop to stop: its route, the stop it is going to, the
 * one it is leaving, who is on, and how long it has stood; and how far in at
 * the kerb it stands at each stop. @see town restSide
 */
export type BusLeg = { route: number; k: number; at?: number; riders: Rider[]; board: number; dwell: number; from?: number; to: number };
/** Going by bus: the route, the stops on and off, where to after, and how long they have waited at the stop. */
export type Ride = { route: number; on: number; off: number; to: Place; waited: number };

/** The routes, for the lanes and the doors (by tens) they were worked out for. */
export type Buses = { G: LaneGraph; doors: number; routes: Route[]; until: number };

const stopOf = (G: LaneGraph, r: Route, k: number): Stop | undefined => G.stops[r.stops[k]];

/** Where people get off a bus, or wait for one: the kerb by the stop. */
export function kerbAt(g: Grid, s: Stop): Kerbside {
  const [dx, dy] = NEIGHBOUR[s.kerb];
  return { kind: "kerb", x: s.cell % g.w, y: (s.cell / g.w) | 0, d: s.kerb, by: { x: s.wait.x - dx * 0.04, y: s.wait.y - dy * 0.04 } };
}
/** A stop as a place a bus drives to: its cell. */
const placeAt = (g: Grid, s: Stop, net: number): Place => ({ kind: "door", x: s.cell % g.w, y: (s.cell / g.w) | 0, net });

/** The town's routes, worked out again if the lanes or how many doors there are have changed. */
export function busesOf(t: Town, G: LaneGraph): Buses {
  // (By tens of doors: not a new set of routes for every house built.)
  const doors = Math.floor(t.places.filter((p) => p.kind === "door" && !p.building).length / 10);
  if (!t.buses || t.buses.G !== G || t.buses.doors !== doors) {
    t.buses = { G, doors, routes: routesOf(G, t.places), until: t.buses?.until ?? 0 };
  }
  return t.buses;
}

/**
 * BY BUS, IF IT IS WORTH IT: a trip long enough, from near a stop to near
 * another on the same route — the route with the least walking. Null if none.
 */
export function busTrip(t: Town, G: LaneGraph, from: Place, to: Place): Omit<Ride, "waited"> | null {
  if (Math.abs(from.x - to.x) + Math.abs(from.y - to.y) < BUS_TRIP) return null;
  const B = t.buses;
  if (!B || B.G !== G) return null;
  let best: Omit<Ride, "waited"> | null = null, bw = Infinity;
  for (const r of B.routes) {
    let on = -1, off = -1, won = WALK_TO_STOP + 1e-6, woff = WALK_TO_STOP + 1e-6;
    r.stops.forEach((id, k) => {
      const s = G.stops[id];
      if (!s) return;
      const a = stopTo(s, from), b = stopTo(s, to);
      if (a < won) { won = a; on = k; }
      if (b < woff) { woff = b; off = k; }
    });
    if (on < 0 || off < 0 || on === off || (!r.loop && off < on) || won + woff >= bw) continue;
    bw = won + woff;
    best = { route: r.id, on, off, to };
  }
  return best;
}

/** The town's gateways, the nearest to a point first: where a bus comes on from, or goes off at. */
function gatewaysBy(t: Town, p: { x: number; y: number }): Place[] {
  const d = (q: Place) => Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
  return t.places.filter((q) => q.kind === "gateway").sort((a, b) => d(a) - d(b));
}

/**
 * A STEP OF THE BUSES, before anybody moves: buses set off onto routes short
 * of theirs — in from the nearest edge of the map to the first stop, or with
 * no road in, stood at it; whoever
 * waits at a stop where a bus of their route stands gets on, one at a time,
 * the bus waiting for them; and anybody waiting too long gives up.
 * `extra`, buses more on each route: the shuttle bus card's. Answers those
 * who got on, or gave up, for the town to take off its pavements.
 */
export function stepBuses(t: Town, g: Grid, G: LaneGraph, h: number, extra: { n: number; colour: number } | null): Set<Mover> {
  const B = busesOf(t, G), gone = new Set<Mover>();
  const live = new Map<number, Mover[]>();
  for (const m of t.movers) if (m.bus && m.bus.k >= 0) { const l = live.get(m.bus.route); if (l) l.push(m); else live.set(m.bus.route, [m]); }
  // ONTO THE ROUTES, one bus at a time.
  B.until -= h;
  if (B.until <= 0) {
    for (const r of B.routes) {
      const have = live.get(r.id)?.length ?? 0, want = 1 + (r.stops.length >= 6 ? 1 : 0) + (extra?.n ?? 0);
      if (have >= want) continue;
      const first = stopOf(G, r, 0);
      if (!first) continue;
      const colour = have >= want - (extra?.n ?? 0) && extra ? extra.colour : r.colour;
      let m: Mover | null = null;
      for (const from of gatewaysBy(t, first)) if ((m = setOff(t, g, "bus", from, placeAt(g, first, from.net), colour, undefined, { goal: { lane: first.lane, s: first.s } }))) break;
      if (m) m.bus = { route: r.id, k: 0, riders: [], board: 0, dwell: 0, to: first.side };
      else {
        // NO WAY IN from the edge of the map: it starts out stood at the first stop.
        const second = stopOf(G, r, 1);
        if (!second) continue;
        m = setOff(t, g, "bus", placeAt(g, first, 0), placeAt(g, second, 0), colour, undefined, { start: { lane: first.lane, s: first.s }, goal: { lane: second.lane, s: second.s } });
        if (!m) continue;
        m.bus = { route: r.id, k: 1, at: 0, riders: [], board: 0, dwell: 0, from: first.side, to: second.side };
        m.wait = DWELL[1];
        const p = along(m, m.s);
        m.side = m.sideTo = first.side;
        m.x = p.x - p.dy * first.side; m.y = p.y + p.dx * first.side;
      }
      if (t.movers.some((o) => o.kind !== "person" && Math.hypot(o.x - m!.x, o.y - m!.y) < 1)) continue;
      t.movers.push(m);
      B.until = BUS_EVERY;
      break;
    }
  }
  // WAITING, and GETTING ON where a bus stands.
  const standing = new Map<string, Mover>();
  for (const m of t.movers) if (m.bus && m.bus.at !== undefined && (m.wait ?? 0) > 0) standing.set(`${m.bus.route},${m.bus.at}`, m);
  for (const w of t.movers) {
    if (!w.atStop || !w.ride) continue;
    const r = w.ride;
    const bus = standing.get(`${r.route},${r.on}`);
    if (bus && bus.bus!.riders.length < SEATS) {
      const L = bus.bus!;
      L.board -= h;
      if (L.board <= 0 && !gone.has(w)) {
        L.riders.push({ off: r.off, to: r.to });
        L.board = BOARD_GAP;
        gone.add(w);
      }
      // (It waits while there are people still to get on, a while.)
      if (L.dwell < DWELL_MAX) bus.wait = Math.max(bus.wait ?? 0, BOARD_GAP + 0.05);
      continue;
    }
    r.waited += h;
    if (r.waited > PATIENCE || !B.routes[r.route]) gone.add(w);
  }
  for (const m of t.movers) if (m.bus && (m.wait ?? 0) > 0) m.bus.dwell += h;
  return gone;
}

/**
 * A BUS AT A STOP: on to the next it can drive to — round, or along its line;
 * past the end of a line, off the map at the nearest way out — standing here
 * a few seconds first; and whoever's stop this is gets off and walks on, one
 * after another, with anybody for a stop it cannot get to. Its way on is a
 * new leg, the same bus, to be put on the roads; null if it has nowhere to go.
 */
export function busArrives(t: Town, g: Grid, G: LaneGraph, m: Mover): Mover | null {
  const L = m.bus!, B = t.buses, r = B && B.G === G ? B.routes[L.route] : undefined;
  const here = r && stopOf(G, r, L.k);
  if (!r || !here) return null;
  const n = r.stops.length, start = { start: { lane: here.lane, s: here.s } };
  let next = -1, on: Mover | null = null;
  for (let j = 1; j < n && !on; j++) {
    const k = L.k + j;
    if (!r.loop && k >= n) break;
    const s = stopOf(G, r, k % n);
    if (s && (on = setOff(t, g, "bus", placeAt(g, here, 0), placeAt(g, s, 0), m.colour, m, { ...start, goal: { lane: s.lane, s: s.s } }))) next = k % n;
  }
  if (!on) for (const out of gatewaysBy(t, here)) if ((on = setOff(t, g, "bus", placeAt(g, here, out.net), out, m.colour, m, start))) break;
  // OFF HERE: whoever's stop it is, or one it is not going on to.
  const ahead = (k: number) => (r.loop ? (k - L.k + n) % n : k - L.k);
  const kerb = kerbAt(g, here);
  let w = 0;
  L.riders = L.riders.filter((p) => {
    if (next >= 0 && ahead(p.off) >= ahead(next)) return true;
    const walker = setOff(t, g, "person", kerb, p.to);
    if (walker) { walker.wait = 0.4 + w++ * 0.5; t.movers.push(walker); }
    return false;
  });
  if (!on) return null;
  on.bus = { route: L.route, k: next, at: L.k, riders: L.riders, board: 0, dwell: 0, from: here.side, to: next >= 0 ? stopOf(G, r, next)!.side : 0 };
  on.wait = DWELL[0] + (DWELL[1] - DWELL[0]) * hash(m.id, L.k, 0xb05);
  // (The same bus, where the last leg left it, in at the kerb: its look, and where it is drawn, go on.)
  on.id = m.id;
  on.side = m.side; on.sideTo = here.side; on.x = m.x; on.y = m.y; on.heading = m.heading;
  on.leaving = true;
  return on;
}

/** Waiting at a stop, in the queue there: along the kerb from the others, facing the road. */
export function queueAt(t: Town, g: Grid, G: LaneGraph, w: Mover): void {
  const r = w.ride!, B = t.buses, route = B && B.G === G ? B.routes[r.route] : undefined;
  const s = route && stopOf(G, route, r.on);
  w.atStop = true;
  w.speed = 0;
  if (!s) return;
  const n = t.movers.filter((o) => o !== w && o.atStop && o.ride?.route === r.route && o.ride.on === r.on).length;
  const [dx, dy] = NEIGHBOUR[s.kerb];
  // Along the kerb, the way the bus comes from, one after another.
  const ax = Math.cos(s.heading), ay = Math.sin(s.heading), along = 0.06 - n * QUEUE;
  w.x = s.wait.x + ax * along; w.y = s.wait.y + ay * along;
  w.heading = Math.atan2(-dy, -dx);
  void g;
}
