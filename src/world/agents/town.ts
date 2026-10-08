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
import type { Grid } from "../grid";
import { HEIGHT_UNIT, HH, HW } from "../iso";
import { isPaved } from "../roads/mask";
import type { Network } from "../roads/network";
import {
  carLine, outward, placesOf, roadHeightAt, routeBetween, walkLine, type Cell, type Place,
} from "./roads";

export type Mover = {
  id: number;
  kind: "car" | "person";
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
  /** Seconds it has stood still wanting to go, and seconds it will push on regardless. */
  stuck: number;
  pushing: number;
  colour: number;
  /** A phase of its own, for a walker's step. */
  phase: number;
};

export type Town = {
  movers: Mover[];
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
  movers: [], next: 1, t: 0, places: [], placesAt: -1, untilCar: 0, untilPerson: 0, seed: 0x2f6e2b1,
});

/** A person's leg, half steps long, and how far it swings either side of straight down. */
export const LEG = 0.5;
export const SWING = 0.5;
/** A tile along the ground in half steps' height, on the screen: so a swing can be put in either. */
export const HALF_STEP_IN_TILES = HEIGHT_UNIT / Math.hypot(HW, HH);
/**
 * Tiles a person covers in one step: a leg's reach forward plus its reach
 * back. Their phase goes on by π a step, so the feet keep pace with the ground
 * and do not skate. @see town-render
 */
export const STRIDE = 2 * LEG * Math.sin(SWING) * HALF_STEP_IN_TILES;

/** At most this many cars and people. */
export const MAX_CARS = 40;
export const MAX_PEOPLE = 50;
/** Cars and people a building brings, and cars a road out of the map does. */
const CARS_PER_BUILDING = 1.5;
const PEOPLE_PER_BUILDING = 2;
const CARS_FOR_GATEWAYS = 3;
/** Seconds between setting one more off, while there are fewer than there should be. */
const CAR_EVERY = 0.4;
const PERSON_EVERY = 0.3;

/** Cruising speeds, tiles a second, and how much they vary one to the next. */
const CAR_CRUISE = 1.6;
const PERSON_CRUISE = 0.45;
const SPREAD = 0.2;
/** Tiles a second squared. */
const ACCEL = 2.5;
const BRAKE = 4;
/**
 * How far ahead a driver looks, and how near its line ahead another car can be
 * and be in its way: about a car's length, which still clears the oncoming
 * lane of a one-cell road (0.44 off) — and is not a lane's width, which let a
 * car turning in pass a waiting car's middle by a hair and pull in on its nose.
 */
const LOOK = 1.2;
const CLEAR = 0.3;
/** The gap a car keeps to the one in front, nose to tail, tiles. */
const GAP = 0.5;
/** Seconds stuck before it pushes on, and for how long. */
const PATIENCE = 4;
const PUSH = 1.5;
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

const CAR_COLOURS = [0xc0392b, 0x2e6fb5, 0xf2f0ea, 0xe8b931, 0x3f8f4f, 0x7c8691, 0x2b2b2b];
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
function setOff(t: Town, g: Grid, kind: Mover["kind"], from: Place, to: Place): Mover | null {
  const path = routeBetween(g, from, to, kind === "car");
  if (!path || path.length < 2) return null;
  const lean = kind === "person" ? (rand(t) - 0.5) * 0.08 : 0;
  const line = kind === "car" ? carLine(g, path) : walkLine(g, path, lean);
  // OFF THE MAP AND ON AGAIN: a trip from a gateway comes in from beyond the
  // rim, and one to a gateway drives on past it.
  if (from.kind === "gateway") {
    const o = outward(g, from);
    line.unshift({ x: line[0].x + o.x * OFF_MAP, y: line[0].y + o.y * OFF_MAP });
  }
  if (to.kind === "gateway") {
    const o = outward(g, to), end = line[line.length - 1];
    line.push({ x: end.x + o.x * OFF_MAP, y: end.y + o.y * OFF_MAP });
  }
  const at = new Float32Array(line.length);
  for (let k = 1; k < line.length; k++) at[k] = at[k - 1] + Math.hypot(line[k].x - line[k - 1].x, line[k].y - line[k - 1].y);
  const base = kind === "car" ? CAR_CRUISE : PERSON_CRUISE;
  const m: Mover = {
    id: t.next++, kind, path, line, at, s: 0, speed: 0,
    cruise: base * (1 + (rand(t) - 0.5) * 2 * SPREAD),
    x: line[0].x, y: line[0].y, z: roadHeightAt(g, line[0].x, line[0].y), heading: 0,
    stuck: 0, pushing: 0,
    colour: pick(t, kind === "car" ? CAR_COLOURS : SHIRTS),
    phase: rand(t) * Math.PI * 2,
  };
  const p = along(m, 0);
  m.heading = Math.atan2(p.dy, p.dx);
  return m;
}

/** A trip's two ends: on one network, far enough apart, and with a door at one end at least for a person. */
function tripFor(t: Town, kind: Mover["kind"]): [Place, Place] | null {
  const places = t.places;
  if (places.length < 2) return null;
  for (let tries = 0; tries < 8; tries++) {
    const from = pick(t, kind === "person" ? places.filter((p) => p.kind === "door") : places);
    if (!from) return null;
    const ends = places.filter((p) => p !== from && p.net === from.net
      && Math.abs(p.x - from.x) + Math.abs(p.y - from.y) >= MIN_TRIP);
    if (ends.length) return [from, pick(t, ends)];
  }
  return null;
}

/** How many cars and people a town this size has. */
export function wanted(places: readonly Place[]): { cars: number; people: number } {
  const doors = places.filter((p) => p.kind === "door").length;
  const gateways = places.length - doors;
  if (places.length < 2) return { cars: 0, people: 0 };
  return {
    cars: Math.min(MAX_CARS, Math.round(doors * CARS_PER_BUILDING + (gateways >= 2 ? CARS_FOR_GATEWAYS : 0))),
    people: doors ? Math.min(MAX_PEOPLE, Math.round(doors * PEOPLE_PER_BUILDING)) : 0,
  };
}

/**
 * How far along its own way ahead `m` would run into `o`, or Infinity if it
 * would not: points along the line it is about to drive, checked for `o`
 * standing on them.
 *
 * ALONG ITS LINE, NOT ITS NOSE. Looking straight ahead was enough to follow a
 * car down a lane and blind at a junction: a car turning out of a side street
 * looks across the main road until it has turned, and pulled out across a car
 * already in the lane it was turning into. Its line goes where it will.
 */
function conflict(m: Mover, o: Mover): number {
  const rx = o.x - m.x, ry = o.y - m.y;
  if (rx * rx + ry * ry > (LOOK + CLEAR) * (LOOK + CLEAR)) return Infinity;
  const total = m.at[m.at.length - 1];
  for (let d = 0.1; d <= LOOK && m.s + d <= total; d += 0.1) {
    const p = along(m, m.s + d);
    if ((p.x - o.x) ** 2 + (p.y - o.y) ** 2 < CLEAR * CLEAR) return d;
  }
  return Infinity;
}

/**
 * Where, along its own line, `m` would meet `o` in the next little while if
 * both keep going — or Infinity. Each is run on along its line at its speed,
 * or at a crawl if it is stopped, since a stopped car is waiting to go.
 *
 * A DRIVER JUDGES WHERE THE OTHER CAR WILL BE, not where it is. Judged only by
 * where it was, a car in the main road crept up to the mouth of a junction
 * before the car turning in had reached it, and the two ended in each other's
 * way with nothing for it but one driving across the other's nose.
 */
function meeting(m: Mover, o: Mover): number {
  const rx = o.x - m.x, ry = o.y - m.y;
  if (rx * rx + ry * ry > (2 * LOOK) ** 2) return Infinity;
  const vm = Math.max(m.speed, CRAWL), vo = Math.max(o.speed, CRAWL);
  const tm = m.at[m.at.length - 1], to = o.at[o.at.length - 1];
  for (let t = STEP; t <= AHEAD; t += STEP) {
    const dm = Math.min(tm, m.s + vm * t), dn = Math.min(to, o.s + vo * t);
    const a = along(m, dm), b = along(o, dn);
    if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 < CLEAR * CLEAR) return dm - m.s;
  }
  return Infinity;
}
/** How far ahead in time a driver judges, the step it judges in, and the crawl it assumes of a stopped car. */
const AHEAD = 1.2;
const STEP = 0.12;
const CRAWL = 0.6;

/**
 * The fastest a car may go given the cars around it:
 *  - never into one that is in its way now, on the line it is about to drive;
 *  - and, the younger of two that would meet, short of where they would.
 * Two cars each in the other's way where they stand is settled by the elder
 * going, which is all a standstill like that can be settled by.
 */
function trafficLimit(m: Mover, cars: readonly Mover[]): number {
  if (m.pushing > 0) return Infinity;
  let limit = Infinity;
  for (const o of cars) {
    if (o === m) continue;
    const d = conflict(m, o);
    if (Number.isFinite(d)) {
      if (m.id < o.id && Number.isFinite(conflict(o, m))) continue;
      limit = Math.min(limit, Math.max(0, (d - GAP) * 2.5));
      continue;
    }
    if (m.id < o.id) continue;
    const meet = meeting(m, o);
    if (Number.isFinite(meet)) limit = Math.min(limit, Math.max(0, (meet - GAP) * 2.5));
  }
  return limit;
}

/** The fastest a mover may take the line where it is: slower into a bend, and to a stop at the end. */
function lineLimit(m: Mover): number {
  const total = m.at[m.at.length - 1];
  const left = total - m.s;
  let v = Math.sqrt(2 * BRAKE * Math.max(0, left)) + 0.05;
  if (m.kind === "car") {
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
  }

  // SETTING OFF, one at a time, while the town is short.
  const want = wanted(t.places);
  const cars = t.movers.filter((m) => m.kind === "car");
  const people = t.movers.length - cars.length;
  t.untilCar -= h;
  if (t.untilCar <= 0 && cars.length < want.cars) {
    t.untilCar = CAR_EVERY;
    const trip = tripFor(t, "car");
    const m = trip && setOff(t, g, "car", ...trip);
    if (m && !cars.some((o) => Math.hypot(o.x - m.x, o.y - m.y) < START_CLEAR)) t.movers.push(m);
  }
  t.untilPerson -= h;
  if (t.untilPerson <= 0 && people < want.people) {
    t.untilPerson = PERSON_EVERY;
    const trip = tripFor(t, "person");
    const m = trip && setOff(t, g, "person", ...trip);
    if (m) t.movers.push(m);
  }

  // MOVING.
  for (const m of t.movers) {
    const limit = Math.min(lineLimit(m), m.kind === "car" ? trafficLimit(m, cars) : Infinity);
    if (m.speed < limit) m.speed = Math.min(limit, m.speed + ACCEL * h);
    else m.speed = Math.max(limit, m.speed - BRAKE * h);
    // PATIENCE: stood still a while with somewhere to be, it pushes on.
    if (m.kind === "car") {
      m.pushing = Math.max(0, m.pushing - h);
      if (m.speed < 0.05 && lineLimit(m) > 0.2) m.stuck += h; else m.stuck = 0;
      if (m.stuck > PATIENCE) { m.pushing = PUSH; m.stuck = 0; }
    }
    m.s += m.speed * h;
    const p = along(m, m.s);
    m.x = p.x;
    m.y = p.y;
    m.z = roadHeightAt(g, p.x, p.y);
    // Facing the way it goes, turned in over a moment, not snapped round.
    const want2 = Math.atan2(p.dy, p.dx);
    let d = want2 - m.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    m.heading += d * Math.min(1, h * (m.kind === "car" ? 10 : 14));
    if (m.kind === "person") m.phase += (h * m.speed * Math.PI) / STRIDE;
  }

  // ARRIVING, and the road going from under somebody.
  t.movers = t.movers.filter((m) => {
    if (m.s >= m.at[m.at.length - 1] - 0.01) return false;
    const k = Math.min(m.path.length - 1, Math.max(0, Math.round((m.s / m.at[m.at.length - 1]) * (m.path.length - 1))));
    const c = m.path[k];
    return isPaved(g, c.x, c.y);
  });
}
