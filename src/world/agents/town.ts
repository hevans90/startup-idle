/**
 * World v2 — the town's traffic: cars and people going about the roads.
 *
 * Nobody wanders aimlessly. Everyone is on a TRIP, from one place to another
 * on the same road network — a door of a building, or a gateway where a road
 * leaves the map — along the cheapest route there. A car drives it in the
 * right-hand lane; a person walks it along the kerb. On arrival they go in,
 * or off the map, and somebody else sets out. @see placesOf, routeBetween
 *
 * HOW MANY is the town's size: more buildings, more trips. A road with
 * buildings on it has people on its pavements; a road with gateways at both
 * ends has through traffic even with nothing built on it.
 *
 * DRIVING, as a driver does it:
 *  - up to a cruising speed of its own, and slower into a bend the sharper
 *    the bend is, and to a stop at the end of the trip;
 *  - behind the car in front, never into it: anything in its lane ahead closer
 *    than a car's length and a gap brings it down, to a standstill if need be;
 *  - at a crossing, two cars each waiting on the other is settled by the one
 *    that has been on the road longest going first — the lower id;
 *  - and a car that has sat still a long while with nothing moving creeps on,
 *    so a knot the rules above did not foresee cannot stop the town for good.
 * People keep to the kerb, a pace of their own, and out of the cars' lanes.
 *
 * Nothing here touches the grid. It is live state like the boats, made fresh
 * for every map, and not saved. @see world/boats
 */
import { residentsIn } from "../../game/housing";
import type { Grid } from "../grid";
import { liveCommutes } from "./commute";
import { AI_TRUCK_COLOUR, BUS_COLOUR, halfLength, SHUTTLE_COLOUR, VAN_COLOUR } from "./cars/fleet";
import { HEIGHT_UNIT, HH, HW } from "../iso";
import { STEP_TILES } from "./people/people-format";
import { isPaved } from "../roads/mask";
import type { Network } from "../roads/network";
import {
  outward, placesOf, roadHeightAt, routeBetween, walkLine, type Cell, type Place,
} from "./roads";
import {
  buildTraffic, inside, lightOf, lineOf, LANE_CLEAR, PATIENT, roadKey, roundTo, routeLanes, spotsAt, yieldsTo, zoneOn,
  type Spot, type Traffic,
} from "./lanes/drive";
import type { LaneGraph } from "./lanes/graph";

export type Mover = {
  id: number;
  kind: "car" | "person" | "truck" | "bus" | "limo";
  /**
   * WORK, if it is on some: a builder walking to a site or home from it, a
   * builder at work on one, or a load of materials on its way. Movers on a
   * job are not the town's trips: they are counted apart, reported when they
   * arrive, and a builder at work stands where it is. @see world/projects
   */
  job?: { site: number; role: "builder" | "home" | "working" | "truck" | "arrive" | "leave" | "moving-in" | "haul" | "haul-back" | "clean-go" | "clean" | "cleaning" | "clean-back" | "leader" };
  /**
   * Seconds to stand where it is before going on: a bus at a stop, letting
   * its passengers off. @see world/agents/arrivals
   */
  wait?: number;
  /** The cells of its route, and the line it follows through them. */
  path: Cell[];
  line: Cell[];
  /** Distance along the line at each point of it. */
  at: Float32Array;
  /** How far along it is, and how fast it is going, tiles and tiles a second. */
  s: number;
  speed: number;
  /** The speed it likes to go at. */
  cruise: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  /** Seconds it has stood still. A car stood still this long is gone. @see STALLED */
  stuck: number;
  colour: number;
  /** A phase of its own, for a walker's step. */
  phase: number;
  /**
   * How steeply a vehicle is tilted along its heading, half steps a tile: the
   * road's rise from its tail to its nose. A lorry drawn level on a ramp put
   * one end into the road. @see town-render
   */
  pitch?: number;
  /**
   * SAT ON A BENCH, a walker for a while: where and facing which way, the
   * seat's key, and seconds left. Their place on their line waits for them.
   * @see Seat
   */
  sit?: { x: number; y: number; heading: number; seat: string; left: number };
  /** The bench they last sat on, so they don't sit straight back down on it. */
  sat?: string;
  /** ON THE LANES, a vehicle: its route and where it is on it. @see Drive */
  drive?: Drive;
  /** Taken off the roads without arriving: its way there is gone. */
  gone?: boolean;
};

/**
 * A vehicle's way along the lanes: the graph it was planned on, its lanes,
 * where along its line each begins, which it is on, the last junction lane
 * it has been let onto, the conflict zones it holds, how long it has waited
 * at a line, and where it is going — to plan again when the roads change.
 */
export type Drive = {
  graph: LaneGraph;
  lanes: number[];
  start: number[];
  k: number;
  let: number;
  claims: { zone: number; lane: number }[];
  waited: number;
  to: Place;
  end: Spot;
};

/** A place on a bench: which bench and which place on it, where, facing which way. Set by the scene. @see street-props */
export type Seat = { key: string; bench: string; x: number; y: number; heading: number };

export type Town = {
  /**
   * How busy the streets are at this hour, against an ordinary one, and the
   * share of trips that are to work and home. Set by the scene. @see busyness
   */
  busy?: { traffic: number; commute: number };
  /**
   * The culture deck, on the streets: the share working from home, off the
   * roads; Shuttle Bus's buses among the cars; Hire to Fire's moving vans.
   * Set by the scene. @see game/culture
   */
  culture?: { remote: number; shuttle: boolean; vans: boolean };
  /** People out for a stroll, over the town's own: one a home on the finest streets. Set by the scene. @see liveBeauty */
  strollers?: number;
  /** The benches' seats, by the cell they are on. Set by the scene. @see seatsByCell */
  seats?: Map<number, Seat[]>;
  /** The lanes, and who holds which junction's zones. Built as the roads change. @see trafficOf */
  traffic?: Traffic;
  movers: Mover[];
  /** Movers on a job that arrived since the last look. @see stepWorks */
  arrived: Mover[];
  next: number;
  t: number;
  places: Place[];
  /** The grid revision the places were found at. */
  placesAt: number;
  untilCar: number;
  untilPerson: number;
  /** A small random sequence of its own, so a town is the same every time. */
  seed: number;
};

export const createTown = (): Town => ({
  movers: [], arrived: [], next: 1, t: 0, places: [], placesAt: -1, untilCar: 0, untilPerson: 0, seed: 0x2f6e2b1,
});

/** A person's leg, half steps long, and how far it swings either side of straight down. */
export const LEG = 0.5;
/** A tile along the ground in half steps' height, on the screen: so a swing can be put in either. */
export const HALF_STEP_IN_TILES = HEIGHT_UNIT / Math.hypot(HW, HH);
/**
 * Tiles a person covers in one step: a real one. Their phase goes on by π a
 * step, so the feet keep pace with the ground and do not skate; the drawn
 * person's legs swing just far enough to reach it. @see town-render, STEP_M
 */
export const STRIDE = STEP_TILES;
export const SWING = Math.asin(STRIDE / (2 * LEG * HALF_STEP_IN_TILES));

/** At most this many cars and people. */
export const MAX_CARS = 40;
export const MAX_PEOPLE = 50;
/**
 * People living on the map to a car on its roads: cars follow the headcount,
 * not how many buildings it is spread over. People a building brings, and
 * cars a road out of the map does.
 */
const RESIDENTS_PER_CAR = 4;
const PEOPLE_PER_BUILDING = 2;
const CARS_FOR_GATEWAYS = 3;
/** Seconds between setting one more off, while there are fewer than there should be. */
const CAR_EVERY = 0.4;
const PERSON_EVERY = 0.3;

/**
 * THE CAPS IN FORCE: the game's, unless a stress scene raises them — the
 * `bigtown` fixture with `?crowd=N`, to measure a town far busier than any
 * the game fields. `every` divides the time between setting off, so a crowd
 * arrives in seconds rather than minutes. @see seedFixtureCompany
 */
export const townCaps = { cars: MAX_CARS, people: MAX_PEOPLE, every: 1 };
export function setTownCaps(c: Partial<typeof townCaps>) { Object.assign(townCaps, c); }

/** Cruising speeds, tiles a second, and how much they vary one to the next. */
const CAR_CRUISE = 1.6;
const TRUCK_CRUISE = 1.15;
const TRUCK_COLOUR = 0xd98c2b;
const BUS_CRUISE = 1.2;
const LIMO_CRUISE = 1.45;
const LIMO_COLOUR = 0x17181c;
export { AI_TRUCK_COLOUR, VAN_COLOUR };
/** The share of the town's car trips Shuttle Bus's buses take. */
const SHUTTLE_SHARE = 0.12;
/** The share of the town's car trips Hire to Fire's moving vans take. */
const VAN_SHARE = 0.12;
const PERSON_CRUISE = 0.45;
const SPREAD = 0.2;
/** Tiles a second squared. */
const ACCEL = 2.5;
const BRAKE = 4;
/**
 * The gap a car keeps to the one in front, nose to tail, tiles, on top of
 * half of each one's length: by their models, so a bus keeps a bus's room.
 * Two cars of the old box's length, 0.38 tiles, kept 0.5 middle to middle.
 * @see cars/fleet.ts
 */
const GAP = 0.12;
const spacing = (m: Mover, o: Mover) => halfLength(m) + halfLength(o) + GAP;
/**
 * Seconds a vehicle stands still before it is taken off the road: a knot the
 * junction rules did not foresee comes undone, and nobody drives through
 * anybody to undo it.
 */
const STALLED = 45;
/** How far short of a junction's edge a car waiting there stops, nose to edge, tiles. */
const STOP_BACK = 0.12;
/** How far along its way a driver looks for the car in front, tiles. */
const FOLLOW = 2.5;
/** A trip's ends at least this far apart, tiles along the axes. */
const MIN_TRIP = 3;
/**
 * Nearer than this to where it would start, a car already there holds the
 * next back: a car's stopping distance from a cruise and its gap, so one
 * pulling out of a door cannot appear under the nose of one coming down the
 * lane too fast to stop for it.
 */
const START_CLEAR = 1;
/** How far beyond the rim a car going off the map drives before it is gone. */
const OFF_MAP = 0.7;

/** Car paint, as often as it is on real roads: mostly white, black, grey and silver. */
const CAR_COLOURS = ([
  [0xf2f0ea, 14], [0xe4e6e3, 6], [0x26282b, 12], [0x3b3e42, 5], [0x7c8691, 9], [0x5a6068, 5], [0xb8bec4, 10],
  [0x2e6fb5, 5], [0x1f3a66, 4], [0x7fa6c9, 1], [0xc0392b, 6], [0x7a1f24, 2], [0x3f8f4f, 1], [0x24452f, 1],
  [0xcdbb98, 2], [0x6b4a32, 1], [0xe8b931, 1], [0xe0702a, 1],
] as const).flatMap(([c, n]) => Array<number>(n).fill(c));
const SHIRTS = [0xd35454, 0x4a7fc1, 0xe6c35c, 0x5aa36b, 0x9b6bc2, 0xe08a3c, 0xf0f0f0];

/** A number in [0, 1), the next in the town's own sequence. */
function rand(t: Town): number {
  t.seed = (t.seed + 0x6d2b79f5) | 0;
  let r = Math.imul(t.seed ^ (t.seed >>> 15), 1 | t.seed);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(t: Town, list: readonly T[]) => list[Math.floor(rand(t) * list.length)];

/** Where along a line a distance is, and which way the line goes there. */
function along(m: Mover, s: number) {
  const { line, at } = m;
  if (line.length === 1) return { x: line[0].x, y: line[0].y, dx: 1, dy: 0 };
  let k = 1;
  while (k < line.length - 1 && at[k] < s) k++;
  const a = line[k - 1], b = line[k];
  const len = at[k] - at[k - 1] || 1;
  const f = Math.max(0, Math.min(1, (s - at[k - 1]) / len));
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, dx: (b.x - a.x) / len, dy: (b.y - a.y) / len };
}

/** Set off on a trip, or null if there is no way there. */
/** Cars and trucks: they drive, keep right and keep their distance. */
const drives = (m: { kind: Mover["kind"] }) => m.kind !== "person";

function setOff(t: Town, g: Grid, kind: Mover["kind"], from: Place, to: Place, colour?: number, after?: Mover): Mover | null {
  let path: Cell[], line: Cell[], drive: Drive | undefined;
  if (kind !== "person") {
    const way = driveWay(t, g, from, to, after);
    if (!way) return null;
    ({ path, line, drive } = way);
  } else {
    const p = routeBetween(g, from, to, false);
    if (!p || p.length < 2) return null;
    path = p;
    line = walkLine(g, path, (rand(t) - 0.5) * 0.08);
    // OFF THE MAP AND ON AGAIN: a trip from a gateway comes in from beyond the
    // rim, and one to a gateway walks on past it.
    if (from.kind === "gateway") {
      const o = outward(g, from);
      line.unshift({ x: line[0].x + o.x * OFF_MAP, y: line[0].y + o.y * OFF_MAP });
    }
    if (to.kind === "gateway") {
      const o = outward(g, to), end = line[line.length - 1];
      line.push({ x: end.x + o.x * OFF_MAP, y: end.y + o.y * OFF_MAP });
    }
  }
  const at = new Float32Array(line.length);
  for (let k = 1; k < line.length; k++) at[k] = at[k - 1] + Math.hypot(line[k].x - line[k - 1].x, line[k].y - line[k - 1].y);
  const base = kind === "car" ? CAR_CRUISE : kind === "truck" ? TRUCK_CRUISE : kind === "bus" ? BUS_CRUISE
    : kind === "limo" ? LIMO_CRUISE : PERSON_CRUISE;
  const m: Mover = {
    id: t.next++, kind, path, line, at, s: 0, speed: 0,
    cruise: base * (1 + (rand(t) - 0.5) * 2 * SPREAD),
    x: line[0].x, y: line[0].y, z: roadHeightAt(g, line[0].x, line[0].y), heading: 0,
    stuck: 0,
    colour: colour ?? (kind === "truck" ? TRUCK_COLOUR : kind === "bus" ? BUS_COLOUR : kind === "limo" ? LIMO_COLOUR
      : pick(t, kind === "car" ? CAR_COLOURS : SHIRTS)),
    phase: rand(t) * Math.PI * 2,
    ...(drive ? { drive } : {}),
  };
  const p = along(m, 0);
  m.heading = after ? after.heading : Math.atan2(p.dy, p.dx);
  return m;
}

/** The lanes, built for the roads as they are now. */
export function trafficOf(t: Town, g: Grid): Traffic {
  const key = roadKey(g);
  if (!t.traffic || t.traffic.key !== key) t.traffic = buildTraffic(g, key);
  return t.traffic;
}

/**
 * A VEHICLE'S WAY from one place to another along the lanes: its line, the
 * cells it crosses, and its route — or null if there is none. From beyond the
 * rim it comes on along the lane in, and to beyond it drives on off it. One
 * going on from where another stopped — a bus from stop to stop — starts
 * where that one ended. Planned from where it is, `at`, when the roads change.
 */
function driveWay(t: Town, g: Grid, from: Place, to: Place, after?: Mover, at?: { x: number; y: number; heading: number }) {
  const T = trafficOf(t, g);
  const prior = after?.drive && after.drive.graph === T.G ? [after.drive.end] : null;
  let starts = prior ?? spotsAt(T, g, at ?? from, !at && from.kind === "gateway" ? "start" : null);
  if (at) {
    // Planned again under way: the lanes going the way it is facing.
    const ahead = starts.filter((sp) => {
      const l = T.G.lanes[sp.lane], k = Math.min(l.pts.length - 1, 1);
      const h = { x: l.pts[k].x - l.pts[0].x, y: l.pts[k].y - l.pts[0].y };
      return h.x * Math.cos(at.heading) + h.y * Math.sin(at.heading) > 0;
    });
    if (ahead.length) starts = ahead;
  }
  const goals = spotsAt(T, g, to, to.kind === "gateway" ? "end" : null);
  const r = routeLanes(T.G, starts, goals);
  if (!r) return null;
  const { pts, start } = lineOf(T.G, r);
  if (pts.length < 2) return null;
  const line: Cell[] = pts.slice();
  let shift = 0;
  if (!at && !prior && from.kind === "gateway") {
    const h = norm2(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    line.unshift({ x: pts[0].x - h.x * OFF_MAP, y: pts[0].y - h.y * OFF_MAP });
    shift = OFF_MAP;
  }
  if (to.kind === "gateway") {
    const n = pts.length, h = norm2(pts[n - 1].x - pts[n - 2].x, pts[n - 1].y - pts[n - 2].y);
    line.push({ x: pts[n - 1].x + h.x * OFF_MAP, y: pts[n - 1].y + h.y * OFF_MAP });
  }
  // The cells it crosses, for the road going from under it.
  const path: Cell[] = [];
  for (const p of line) {
    const c = { x: Math.min(g.w - 1, Math.max(0, Math.round(p.x))), y: Math.min(g.h - 1, Math.max(0, Math.round(p.y))) };
    const last = path[path.length - 1];
    if (!last || last.x !== c.x || last.y !== c.y) path.push(c);
  }
  if (path.length < 2) path.push(path[0]);
  const drive: Drive = {
    graph: T.G, lanes: r.lanes, start: start.map((s) => s + shift), k: 0, let: 0, claims: [], waited: 0, to,
    end: { lane: r.lanes[r.lanes.length - 1], s: r.s1 },
  };
  return { path, line, drive };
}

const norm2 = (x: number, y: number) => { const l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; };

/** A trip's two ends: on one network, far enough apart, and with a door at one end at least for a person. */
function tripFor(t: Town, kind: Mover["kind"]): [Place, Place] | null {
  const places = t.places;
  if (places.length < 2) return null;
  for (let tries = 0; tries < 8; tries++) {
    const open = places.filter((p) => !p.building);
    const from = pick(t, kind === "person" ? open.filter((p) => p.kind === "door") : open);
    if (!from) return null;
    const ends = places.filter((p) => p !== from && p.net === from.net && !p.building
      && Math.abs(p.x - from.x) + Math.abs(p.y - from.y) >= MIN_TRIP);
    if (ends.length) return [from, pick(t, ends)];
  }
  return null;
}

/**
 * A COMMUTE, as a trip: someone from a house with people in it to the
 * workplace they go to, or home again — on foot if it is near, in a car if it
 * is not. Null when there is no such trip to make, or the kind does not suit:
 * a long way is not walked, nor a short one driven. @see liveCommutes
 */
function commuteTrip(t: Town, g: Grid, net: Network, kind: Mover["kind"]): [Place, Place] | null {
  const commutes = liveCommutes(g, net);
  const doors = new Map<number, Place>();
  for (const p of t.places) if (p.kind === "door" && p.structure !== undefined && !p.building) doors.set(p.structure, p);
  const trips: [Place, Place][] = [];
  for (const [house, c] of commutes) {
    if (c.to === null || c.tiles === null || c.tiles < MIN_TRIP) continue;
    if ((kind === "person") !== (c.tiles <= WALK_TO_WORK)) continue;
    const s = g.structures.get(house);
    if (!s || !residentsIn(s)) continue;
    const home = doors.get(house), work = doors.get(c.to);
    if (home && work) trips.push([home, work]);
  }
  if (!trips.length) return null;
  const [home, work] = pick(t, trips);
  return rand(t) < 0.5 ? [home, work] : [work, home];
}
/** Of the town's trips, the share that are people going to work or home; and the farthest anyone walks there, tiles. */
const COMMUTE_SHARE = 0.6;
const WALK_TO_WORK = 12;

/** How many cars and people a town this size has: cars by who lives at its doors. @see RESIDENTS_PER_CAR */
export function wanted(places: readonly Place[], g: Grid): { cars: number; people: number } {
  const doors = places.filter((p) => p.kind === "door").length;
  const gateways = places.length - doors;
  if (places.length < 2) return { cars: 0, people: 0 };
  let residents = 0;
  for (const p of places) {
    const s = p.kind === "door" && p.structure !== undefined ? g.structures.get(p.structure) : undefined;
    if (s) residents += residentsIn(s);
  }
  return {
    cars: Math.min(townCaps.cars, Math.round(residents / RESIDENTS_PER_CAR + (gateways >= 2 ? CARS_FOR_GATEWAYS : 0))),
    people: doors ? Math.min(townCaps.people, Math.round(doors * PEOPLE_PER_BUILDING)) : 0,
  };
}

/**
 * THE TRAFFIC, a step: who is on which lane and how far along, who is about
 * to be let onto which junction lane, and the zones let go by those past them.
 */
type Onto = { m: Mover; s: number };
function trafficNow(T: Traffic, cars: readonly Mover[]) {
  const on = new Map<number, Onto[]>();
  const coming = new Map<number, { m: Mover; d: number }[]>();
  for (const m of cars) {
    const d = m.drive;
    if (!d || d.graph !== T.G) continue;
    while (d.k + 1 < d.lanes.length && m.s >= d.start[d.k + 1]) d.k++;
    // LET IN AND STILL WAITING at its line — held up by something on the far
    // side the rules did not see coming: it gives its place back.
    if (d.let > d.k && m.stuck > 3) { letGo(T, m, true); d.let = d.k; }
    const lane = d.lanes[d.k];
    const list = on.get(lane);
    const o = { m, s: m.s - d.start[d.k] };
    if (list) list.push(o); else on.set(lane, [o]);
    const q = d.k + 1;
    if (q < d.lanes.length && d.let < q && inside(T.G.lanes[d.lanes[q]])) {
      const c = coming.get(d.lanes[q]);
      const e = { m, d: d.start[q] - m.s };
      if (c) c.push(e); else coming.set(d.lanes[q], [e]);
    }
    letGo(T, m, false);
  }
  return { on, coming };
}

/** Let go the zones a vehicle is past — or all of them. */
function letGo(T: Traffic, m: Mover, all: boolean) {
  const d = m.drive;
  if (!d || !d.claims.length) return;
  const half = halfLength(m);
  d.claims = d.claims.filter(({ zone, lane }) => {
    if (!all) {
      const j = d.lanes.indexOf(lane, Math.max(0, d.k - 1));
      const past = j < 0 || d.k > j || (d.k === j && m.s - d.start[j] > zoneOn(T, zone, lane).s + LANE_CLEAR + 2 * half);
      if (!past) return true;
    }
    const c = T.claims.get(zone);
    if (c) { c.cars.delete(m.id); if (!c.cars.size) T.claims.delete(zone); }
    return false;
  });
}

/**
 * The fastest a vehicle on the lanes may go: behind whatever is ahead on its
 * way, and short of a junction it has not been let into. @see mayEnter
 */
function driveLimit(t: Town, T: Traffic, m: Mover, now: ReturnType<typeof trafficNow>, h: number): number {
  const d = m.drive!;
  const G = T.G;
  let limit = Infinity;
  // FOLLOWING: the nearest thing ahead on its own lanes, or one just gone
  // off the same lane onto another curve, still in the way.
  for (let j = d.k; j < d.lanes.length && d.start[j] - m.s < FOLLOW; j++) {
    for (const o of now.on.get(d.lanes[j]) ?? []) {
      if (o.m === m) continue;
      const gap = d.start[j] + o.s - m.s;
      if (gap > 0 && gap < FOLLOW + 1) limit = Math.min(limit, Math.max(0, (gap - spacing(m, o.m)) * 2.5));
    }
    if (j > 0) {
      for (const sib of G.lanes[d.lanes[j - 1]].next) {
        if (sib === d.lanes[j]) continue;
        for (const o of now.on.get(sib) ?? []) {
          if (o.m === m || o.s > 0.8) continue;
          const gap = d.start[j] + o.s - m.s;
          if (gap > 0) limit = Math.min(limit, Math.max(0, (gap - spacing(m, o.m)) * 2.5));
        }
      }
    }
    // MERGING: one coming onto this lane from another, nearer the join than
    // this one is, goes first; the farther of the two waits for it.
    if (j > d.k) {
      const mine = d.start[j] - m.s;
      for (const p of T.into.get(d.lanes[j]) ?? []) {
        if (p === d.lanes[j - 1]) continue;
        const pl = G.lanes[p];
        for (const o of now.on.get(p) ?? []) {
          const left = pl.len - o.s;
          if (o.m === m || left > 1 || left >= mine) continue;
          limit = Math.min(limit, Math.max(0, (mine - left - spacing(m, o.m)) * 2.5));
        }
      }
    }
  }
  // AT A JUNCTION: wait at the line until let in. Round a roundabout,
  // nobody stops for anybody but the car in front.
  const q = d.k + 1;
  const ringing = G.lanes[d.lanes[d.k]].kind === "ring" || G.lanes[d.lanes[d.k]].kind === "entry";
  if (q < d.lanes.length && d.let < q && inside(G.lanes[d.lanes[q]]) && !ringing) {
    const toLine = d.start[q] - m.s;
    const stopping = (m.speed * m.speed) / (2 * BRAKE);
    if (toLine <= stopping + halfLength(m) + (G.lanes[d.lanes[d.k]].hold ?? STOP_BACK) + 0.8) {
      if (mayEnter(t, T, m, q, toLine, stopping, now)) {
        const y = G.lanes[d.lanes[q]];
        for (const z of y.zones) {
          const c = T.claims.get(z);
          if (c && c.cars.size) c.cars.add(m.id);
          else T.claims.set(z, { lane: y.id, cars: new Set([m.id]) });
          d.claims.push({ zone: z, lane: y.id });
        }
        d.let = q;
        d.waited = 0;
      } else {
        // Its nose at the lane's hold point, short of the line, clear of the junction's curves.
        const back = G.lanes[d.lanes[d.k]].hold ?? STOP_BACK;
        limit = Math.min(limit, Math.sqrt(2 * BRAKE * Math.max(0, toLine - halfLength(m) - back)));
        if (m.speed < 0.1) d.waited += h;
      }
    }
  }
  return limit;
}

/** Whether a vehicle at the line may take the junction lane `q` of its way. @see Traffic */
function mayEnter(t: Town, T: Traffic, m: Mover, q: number, toLine: number, stopping: number, now: ReturnType<typeof trafficNow>): boolean {
  const d = m.drive!, G = T.G;
  const y = G.lanes[d.lanes[q]];
  // Only the car at the front of the queue.
  const mine = m.s - d.start[d.k];
  for (const o of now.on.get(d.lanes[d.k]) ?? []) if (o.m !== m && o.s > mine) return false;
  // Its zones free, or held by cars on the same curve.
  for (const z of y.zones) {
    const c = T.claims.get(z);
    if (c && c.cars.size && c.lane !== y.id) return false;
  }
  const fromStreet = G.lanes[d.lanes[q - 1]]?.kind === "street";
  if (!fromStreet) return true;
  // ROOM on the far side, past the junction.
  let r = q;
  while (r < d.lanes.length && G.lanes[d.lanes[r]].kind !== "street") r++;
  if (r < d.lanes.length) {
    const need = 2 * halfLength(m) + GAP;
    for (const o of now.on.get(d.lanes[r]) ?? []) if (o.m !== m && o.s - halfLength(o.m) < need && o.m.speed < 0.5) return false;
  }
  const J = G.junctions[y.junction!];
  // ONTO A ROUNDABOUT: nobody on the ring near its port, nor coming round to it soon.
  if (J.kind === "roundabout") {
    const port = Math.atan2(y.pts[y.pts.length - 1].y - J.centre.y, y.pts[y.pts.length - 1].x - J.centre.x);
    for (const [lane, list] of now.on) {
      const l = G.lanes[lane];
      if (l.junction !== J.id || (l.kind !== "ring" && l.kind !== "entry")) continue;
      for (const o of list) {
        if (o.m === m || lane === y.id) continue;
        const dist = l.kind === "entry" ? l.len - o.s : roundTo(T, J.id, o.m, port);
        const back = 2 * Math.PI * Math.hypot(o.m.x - J.centre.x, o.m.y - J.centre.y) - dist;
        if (back < spacing(m, o.m) + 0.15 || dist < Math.max(1.4, o.m.speed * 2.5)) return false;
      }
    }
    return true;
  }
  // THE LIGHTS.
  if (J.kind === "signals" && y.arm !== undefined) {
    const light = lightOf(T, J.id, y.arm, t.t);
    if (light === "red") return false;
    if (light === "amber" && toLine > stopping + 0.1) return false;
  }
  // GIVING WAY to whoever has the right of it, coming on.
  if (d.waited < PATIENT) {
    for (const z of y.zones) {
      const b = G.lanes[zoneOn(T, z, y.id).other];
      if (!yieldsTo(T, y, b)) continue;
      for (const c of now.coming.get(b.id) ?? []) {
        if (c.m !== m && c.m.speed > 0.25 && c.d < Math.max(1.2, c.m.speed * 2.5)) return false;
      }
    }
  }
  return true;
}

/** The fastest a mover may take the line where it is: slower into a bend, and to a stop at the end. */
function lineLimit(m: Mover): number {
  const total = m.at[m.at.length - 1];
  const left = total - m.s;
  let v = Math.sqrt(2 * BRAKE * Math.max(0, left)) + 0.05;
  if (m.kind === "car" || m.kind === "bus" || m.kind === "limo") {
    const a = along(m, m.s), b = along(m, Math.min(total, m.s + 0.6));
    const turn = Math.abs(Math.atan2(a.dx * b.dy - a.dy * b.dx, a.dx * b.dx + a.dy * b.dy));
    v = Math.min(v, m.cruise * (1 - 0.6 * Math.min(1, turn / (Math.PI / 2))));
  }
  return Math.min(v, m.cruise);
}

/**
 * Re-find the places when the map has changed, set off whoever is missing,
 * move everybody on, and take in whoever has arrived — or whose road is gone.
 */
export function stepTown(t: Town, g: Grid, net: Network, revision: number, dt: number): void {
  if (dt <= 0) return;
  const h = Math.min(dt, 1 / 20);
  t.t += h;
  if (t.placesAt !== revision) {
    t.places = placesOf(g, net);
    t.placesAt = revision;
    // THE ROADS CHANGED: everyone on them plans their way again from where they are.
    const was = t.traffic;
    const T = trafficOf(t, g);
    if (was && was !== T) {
      for (const m of t.movers) {
        if (!m.drive) continue;
        const way = driveWay(t, g, m.drive.to, m.drive.to, undefined, { x: m.x, y: m.y, heading: m.heading });
        if (!way) { m.gone = true; continue; }
        m.path = way.path; m.line = way.line; m.drive = way.drive;
        m.at = new Float32Array(m.line.length);
        for (let k = 1; k < m.line.length; k++) m.at[k] = m.at[k - 1] + Math.hypot(m.line[k].x - m.line[k - 1].x, m.line[k].y - m.line[k - 1].y);
        m.s = 0;
      }
    }
  }

  // SETTING OFF, one at a time, while the town is short.
  const base = wanted(t.places.filter((p) => !p.building), g);
  const busy = t.busy ?? { traffic: 1, commute: COMMUTE_SHARE };
  const culture = t.culture ?? { remote: 0, shuttle: false, vans: false };
  // Those at home are off the roads: fewer cars, the same people on foot.
  // The cap holds at the rush too.
  const want = { cars: Math.min(townCaps.cars, Math.round(base.cars * busy.traffic * (1 - culture.remote))), people: Math.min(townCaps.people, Math.round((base.people + (t.strollers ?? 0)) * busy.traffic)) };
  // Everything that drives keeps its distance from everything else that does;
  // only the town's own trips count towards how many trips it has.
  const cars = t.movers.filter(drives);
  const tripCars = cars.filter((m) => !m.job).length;
  const people = t.movers.filter((m) => m.kind === "person" && !m.job).length;
  t.untilCar -= h;
  if (t.untilCar <= 0 && tripCars < want.cars) {
    t.untilCar = CAR_EVERY / townCaps.every;
    const trip = (rand(t) < busy.commute ? commuteTrip(t, g, net, "car") : null) ?? tripFor(t, "car");
    // A car's trip taken by a shuttle bus, or a moving van, as the cards say.
    // Rolled only with one of them in force: the town's sequence as it was without.
    const r = culture.shuttle || culture.vans ? rand(t) : 0.5;
    const [kind, colour] = culture.shuttle && r < SHUTTLE_SHARE ? ["bus", SHUTTLE_COLOUR] as const
      : culture.vans && r > 1 - VAN_SHARE ? ["truck", VAN_COLOUR] as const : ["car", undefined] as const;
    const m = trip && setOff(t, g, kind, ...trip, colour);
    if (m && !cars.some((o) => Math.hypot(o.x - m.x, o.y - m.y) < START_CLEAR)) t.movers.push(m);
  }
  t.untilPerson -= h;
  if (t.untilPerson <= 0 && people < want.people) {
    t.untilPerson = PERSON_EVERY / townCaps.every;
    const trip = (rand(t) < busy.commute ? commuteTrip(t, g, net, "person") : null) ?? tripFor(t, "person");
    const m = trip && setOff(t, g, "person", ...trip);
    if (m) t.movers.push(m);
  }

  // MOVING, each vehicle minding the lanes it is on. @see driveLimit
  const T = trafficOf(t, g);
  const now = trafficNow(T, cars);
  const taken = new Set<string>();
  for (const m of t.movers) if (m.sit) taken.add(m.sit.seat);
  for (const m of t.movers) {
    // SAT DOWN, until they've had their rest.
    if (m.sit) {
      m.sit.left -= h;
      if (m.sit.left > 0) continue;
      m.sat = m.sit.seat.slice(0, m.sit.seat.lastIndexOf(":"));
      m.sit = undefined;
      m.speed = 0;
    }
    // AT WORK on a site: standing, swinging a hammer. @see town-render
    if (atWork(m)) { m.phase += h * WORK_RATE; continue; }
    // AT A STOP: standing, then on its way.
    if (m.wait && m.wait > 0) { m.wait -= h; m.speed = 0; continue; }
    const limit = Math.min(lineLimit(m), m.drive && m.drive.graph === T.G ? driveLimit(t, T, m, now, h) : Infinity);
    if (m.speed < limit) m.speed = Math.min(limit, m.speed + ACCEL * h);
    else m.speed = Math.max(limit, m.speed - BRAKE * h);
    if (drives(m)) {
      if (m.speed < 0.05) m.stuck += h; else m.stuck = 0;
      if (m.stuck > STALLED) m.gone = true;
    }
    m.s += m.speed * h;
    const p = along(m, m.s);
    m.x = p.x;
    m.y = p.y;
    m.z = roadHeightAt(g, p.x, p.y);
    if (drives(m)) {
      // Nose and tail, half a vehicle either way along the way it goes.
      const half = halfLength(m);
      const zf = roadHeightAt(g, p.x + p.dx * half, p.y + p.dy * half);
      const zb = roadHeightAt(g, p.x - p.dx * half, p.y - p.dy * half);
      m.pitch = (zf - zb) / (2 * half);
      m.z = (zf + zb) / 2;
    }
    // Facing the way it goes, turned in over a moment, not snapped round.
    const want2 = Math.atan2(p.dy, p.dx);
    let d = want2 - m.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    m.heading += d * Math.min(1, h * (drives(m) ? 10 : 14));
    if (m.kind === "person") {
      m.phase += (h * m.speed * Math.PI) / STRIDE;
      if (!m.job && t.seats) sitDown(m, t.seats, taken, g);
    }
  }

  // ARRIVING, and the road going from under somebody.
  t.movers = t.movers.filter((m) => {
    if (atWork(m)) return true;     // the site lets them go. @see stepWorks, stepCleanup
    if (m.gone) { letGo(T, m, true); return false; }
    if (m.s >= m.at[m.at.length - 1] - 0.01) {
      letGo(T, m, true);
      if (m.job) t.arrived.push(m);
      return false;
    }
    const k = Math.min(m.path.length - 1, Math.max(0, Math.round((m.s / m.at[m.at.length - 1]) * (m.path.length - 1))));
    const c = m.path[k];
    if (isPaved(g, c.x, c.y)) return true;
    letGo(T, m, true);
    return false;
  });
}

/** How near a seat a walker must pass to take it, tiles; and how many of them do. */
const SEAT_REACH = 0.1;
const SITS = 0.3;

/** The cell key a seat is filed under. */
export const seatCell = (g: Pick<Grid, "w">, x: number, y: number) => Math.round(y) * g.w + Math.round(x);

/** File seats under their cells. */
export function seatsByCell(g: Pick<Grid, "w">, seats: readonly Seat[]): Map<number, Seat[]> {
  const by = new Map<number, Seat[]>();
  for (const s of seats) { const k = seatCell(g, s.x, s.y); const l = by.get(k); if (l) l.push(s); else by.set(k, [s]); }
  return by;
}

/** A small hash of a walker and a seat, 0–1: whether they sit, and for how long. */
const roll = (id: number, key: string, salt: number) => {
  let h = Math.imul(id ^ salt, 0x9e3779b1);
  for (let k = 0; k < key.length; k++) h = Math.imul(h ^ key.charCodeAt(k), 0x85ebca6b);
  return ((h >>> 8) & 0xffff) / 0x10000;
};

/**
 * A WALKER PASSING A FREE SEAT may sit on it: about one in three, for ten to
 * thirty seconds, then on their way. Not the one they've just got up from.
 */
export function sitDown(m: Mover, seats: Map<number, Seat[]>, taken: Set<string>, g: Grid): void {
  for (const s of seats.get(seatCell(g, m.x, m.y)) ?? []) {
    if (taken.has(s.key) || m.sat === s.bench || Math.hypot(s.x - m.x, s.y - m.y) > SEAT_REACH) continue;
    if (roll(m.id, s.key, 0x51) >= SITS) continue;
    m.sit = { x: s.x, y: s.y, heading: s.heading, seat: s.key, left: 10 + 20 * roll(m.id, s.key, 0x7e) };
    m.x = s.x; m.y = s.y; m.heading = s.heading; m.speed = 0;
    taken.add(s.key);
    return;
  }
}

/** Standing at work, a builder on a site or a vibe coder mopping up sludge: not going anywhere. */
export const atWork = (m: Mover) => m.job?.role === "working" || m.job?.role === "cleaning";

/** Swings of a hammer a second, in phase, for a builder at work. */
const WORK_RATE = 9;

/**
 * SOMEBODY WALKING IN: off a bus or out of a car at a door, and the few steps
 * from the road into the house, after `wait` seconds standing. Not a trip on
 * the roads: a line of its own, from the stop to the middle of the house.
 * @see stepArrivals
 */
export function walkInto(t: Town, g: Grid, from: Cell, to: Cell, structure: number, wait = 0): Mover {
  const side = (rand(t) - 0.5) * 0.3;
  const start = { x: from.x + side * (to.y - from.y), y: from.y + side * (to.x - from.x) };
  const line = [start, { x: to.x, y: to.y }];
  const at = new Float32Array([0, Math.hypot(to.x - start.x, to.y - start.y)]);
  const m: Mover = {
    id: t.next++, kind: "person",
    // Its PATH is the stop alone, which is paved: the walk itself crosses the
    // verge, and a mover whose path leaves the road is taken off it.
    path: [from, from], line, at, s: 0, speed: 0,
    cruise: PERSON_CRUISE * (1 + (rand(t) - 0.5) * 2 * SPREAD),
    x: start.x, y: start.y, z: roadHeightAt(g, start.x, start.y),
    heading: Math.atan2(to.y - start.y, to.x - start.x),
    stuck: 0, colour: pick(t, SHIRTS), phase: rand(t) * Math.PI * 2,
    job: { site: structure, role: "moving-in" },
    wait,
  };
  t.movers.push(m);
  return m;
}

/**
 * Send somebody, or a truck, on a job from one place to another. Null if there
 * is no way there. @see stepWorks
 */
export function sendOnJob(
  t: Town, g: Grid, kind: Mover["kind"], from: Place, to: Place, job: NonNullable<Mover["job"]>, after?: Mover,
): Mover | null {
  const m = setOff(t, g, kind, from, to, undefined, after);
  if (!m) return null;
  m.job = job;
  t.movers.push(m);
  return m;
}
