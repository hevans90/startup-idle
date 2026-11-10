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
import { PEDAL_TURN_M, STEP_TILES } from "./people/people-format";
import { TILES_PER_M } from "./cars/models";
import { isPaved } from "../roads/mask";
import type { Network } from "../roads/network";
import {
  outward, placesOf, roadHeightAt, routeBetween, walkLine, type Cell, type Place,
} from "./roads";
import {
  buildTraffic, CHANGE_LEN, inside, isChange, lightOf, lineOf, LANE_CLEAR, PATIENT, roadKey, roundTo, routeLanes, spotsAt, walkLeft, yieldsTo, zoneOn,
  type Spot, type Traffic,
} from "./lanes/drive";
import { walkBetween, type Kerbside, type Walk } from "./lanes/walk";
import { aboard, bayNear, carNear, heldBays, kerbOf, PARK_CAP, refile, RESIDENT_SHARE, STAY } from "./parking";
import type { LaneGraph } from "./lanes/graph";
import { NEIGHBOUR } from "../../iso/dir";
import { structureAt } from "../grid";
import type { Emergency } from "./emergency";

export type Mover = {
  id: number;
  kind: "car" | "person" | "truck" | "bus" | "limo" | "bike";
  /**
   * WORK, if it is on some: a builder walking to a site or home from it, a
   * builder at work on one, or a load of materials on its way. Movers on a
   * job are not the town's trips: they are counted apart, reported when they
   * arrive, and a builder at work stands where it is. @see world/projects
   */
  job?: { site: number; role: "builder" | "home" | "working" | "truck" | "arrive" | "leave" | "moving-in" | "haul" | "haul-back" | "clean-go" | "clean" | "cleaning" | "clean-back" | "leader" | "emergency" | "emergency-back" };
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
  /** The fastest it may take each point of its line for the bend there, tiles a second. @see bendsOf */
  bends?: Float32Array;
  /** AN EMERGENCY VEHICLE, which; and whether it is on a call, its blue lights on. @see agents/emergency */
  siren?: "police" | "ambulance" | "fire";
  blues?: boolean;
  /**
   * SIDEWAYS off its line, tiles to the right (to the kerb), now and where it
   * is going: pulled in for an emergency vehicle, or one out past them.
   */
  side?: number;
  sideTo?: number;
  /** Pulled in: where along its line it stops. */
  pullAt?: number;
  /**
   * ON FOOT over the pavements: the graph its way was planned on, the
   * crossings on it, the next of them, whether it has stepped out onto that
   * one, and how long it has stood at its kerb. @see walkBetween, mayCross
   */
  walk?: { graph: LaneGraph; crossings: Walk["crossings"]; k: number; on: boolean; waited: number };
  /**
   * PARKED in a bay: which, on which lanes, seconds till it goes (Infinity, a
   * resident's), the door it came to; and, going, where to and how many are
   * still to get in. @see agents/parking
   */
  park?: { bay: number; graph: LaneGraph; stay: number; door?: Place; trip?: Place; boarding: number };
  /** On its way to park: the bay held for it, and the door it is visiting. */
  bayTo?: { bay: number; door: Place };
  /** Walking out to a parked car to go in it: the car. */
  toCar?: number;
  /** GETTING BY parked cars on a street one cell wide: from where along its line it goes out into the other lane, and till where. */
  pass?: { lane: number; a: number; b: number };
  /** Arrived short of the end of its way: a car parked on it. */
  there?: boolean;
};

/**
 * A vehicle's way along the lanes: the graph it was planned on, its lanes,
 * where along its line each begins and where it comes onto each, which it is on, the last junction lane
 * it has been let onto, the conflict zones it holds, how long it has waited
 * at a line, and where it is going — to plan again when the roads change.
 */
export type Drive = {
  graph: LaneGraph;
  lanes: number[];
  start: number[];
  /** Where along its line it comes onto each lane: for a change of lane, where it starts across. */
  enter: number[];
  /** Waiting to change onto this lane, for a gap in it. @see mayChange */
  wants?: number;
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
  /** What each road cell wears, a zebra in bit 4: where walkers have the right of way. Set by the scene. @see roadDressOf */
  dress?: Uint8Array;
  /** The benches' seats, by the cell they are on. Set by the scene. @see seatsByCell */
  seats?: Map<number, Seat[]>;
  /** The lanes, and who holds which junction's zones. Built as the roads change. @see trafficOf */
  traffic?: Traffic;
  /** The emergency services: who has been called out to what. @see stepEmergency */
  emergency?: Emergency;
  movers: Mover[];
  /** The cars parked in the bays, each with `park`: off the roads, and drawn with the rest. @see agents/parking */
  parked: Mover[];
  /** The lanes the residents' cars were last parked for. */
  residentsFor?: LaneGraph;
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
  movers: [], parked: [], arrived: [], next: 1, t: 0, places: [], placesAt: -1, untilCar: 0, untilPerson: 0, seed: 0x2f6e2b1,
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
export const MAX_CARS = 80;
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
/**
 * CYCLISTS: the share of the town's car trips taken on a bike, how fast they
 * ride against a car's cruise, and how far toward the kerb from the lane's
 * middle. Cars queue behind them; nobody overtakes.
 */
const BIKE_SHARE = 0.1;
const BIKE_CRUISE = CAR_CRUISE * 0.65;
const BIKE_SIDE = 0.07;
const SPREAD = 0.2;
/** Tiles a second squared: a walker's, and a driver's sums of whether it can stop. */
const ACCEL = 2.5;
const BRAKE = 4;
/**
 * HOW A DRIVER FOLLOWS (the Intelligent Driver Model): the time it keeps
 * behind the car in front, s; how hard it pulls away and how hard it likes to
 * brake, tiles a second squared; and the hardest it ever brakes — the cap
 * that makes sure nobody runs into anybody. @see follow
 */
const HEADWAY = 0.7;
const IDM_A = 2.2;
const IDM_B = 3;
const HARD = 6;
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
/**
 * GETTING OUT OF THE WAY: how far ahead of an emergency vehicle the cars in
 * its lane pull in, how far to the kerb, and how far out it goes to pass,
 * tiles; how fast anyone moves sideways, tiles a second. Only on a road two
 * cells wide or more, one lane each way: a narrow one has no room to pass.
 */
const PULL_AHEAD = 4;
const PULL_IN = 0.26;
const PASS_OUT = -0.2;
const SIDE_RATE = 0.5;
/** Pulled in this far, a car is out of an emergency vehicle's way. */
const PULLED = 0.12;
const pulled = (m: Mover) => (m.side ?? 0) > PULLED;
/** Standing where it stopped a while: an emergency vehicle at the scene, a bus at a stop. */
const standing = (m: Mover) => (m.wait ?? 0) > 0;
/**
 * Whether a vehicle goes by another pulled in at the kerb rather than stop
 * behind it: one on a call by anybody pulled in for it, anybody by one
 * standing there — from out in the lane, not at the kerb itself; and not one
 * on a call by another of its own call at the scene.
 */
const passes = (m: Mover, o: Mover) =>
  ((pulled(o) && !pulled(m) && (m.blues || standing(o))) || (!!m.blues && o.pullAt !== undefined && o.speed < 0.05 && (m.side ?? 0) < PASS_OUT / 2))
  && !(m.blues && o.siren && standing(o) && o.job?.site === m.job?.site);
/** How near a junction an emergency vehicle has every other car there wait for it, tiles. */
const BLUES_NEAR = 4;

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

function setOff(t: Town, g: Grid, kind: Mover["kind"], from: Place | Kerbside, to: Place | Kerbside, colour?: number, after?: Mover, spots?: { start?: Spot; goal?: Spot }): Mover | null {
  let path: Cell[], line: Cell[], drive: Drive | undefined, walk: Mover["walk"];
  if (kind !== "person") {
    if (from.kind === "kerb" || to.kind === "kerb") return null;
    const way = driveWay(t, g, from, to, after, undefined, spots);
    if (!way) return null;
    ({ path, line, drive } = way);
  } else {
    // OVER THE PAVEMENTS, crossing where they are crossed — or, where they
    // do not join, along the kerb lines as before.
    const T = trafficOf(t, g);
    const w = walkBetween(T.G, g, from, to);
    let shift = 0;
    if (w) {
      line = w.pts.slice();
      path = cellsOf(g, line);
      walk = { graph: T.G, crossings: w.crossings, k: 0, on: false, waited: 0 };
    } else {
      if (from.kind === "kerb" || to.kind === "kerb") return null;
      const p = routeBetween(g, from, to, false);
      if (!p || p.length < 2) return null;
      path = p;
      line = walkLine(g, path, (rand(t) - 0.5) * 0.08);
    }
    // OFF THE MAP AND ON AGAIN: a trip from a gateway comes in from beyond the
    // rim, and one to a gateway walks on past it.
    if (from.kind === "gateway") {
      const o = outward(g, from);
      line.unshift({ x: line[0].x + o.x * OFF_MAP, y: line[0].y + o.y * OFF_MAP });
      shift = OFF_MAP;
    }
    if (to.kind === "gateway") {
      const o = outward(g, to), end = line[line.length - 1];
      line.push({ x: end.x + o.x * OFF_MAP, y: end.y + o.y * OFF_MAP });
    }
    if (walk && shift) walk.crossings = walk.crossings.map((x) => ({ ...x, s0: x.s0 + shift, s1: x.s1 + shift }));
  }
  // (No step of no length: a way has a heading at every point.)
  line = line.filter((p, k) => k === 0 || Math.hypot(p.x - line[k - 1].x, p.y - line[k - 1].y) > 1e-6);
  if (line.length < 2) return null;
  const at = new Float32Array(line.length);
  for (let k = 1; k < line.length; k++) at[k] = at[k - 1] + Math.hypot(line[k].x - line[k - 1].x, line[k].y - line[k - 1].y);
  const base = kind === "car" ? CAR_CRUISE : kind === "truck" ? TRUCK_CRUISE : kind === "bus" ? BUS_CRUISE
    : kind === "limo" ? LIMO_CRUISE : kind === "bike" ? BIKE_CRUISE : PERSON_CRUISE;
  const m: Mover = {
    id: t.next++, kind, path, line, at, s: 0, speed: 0,
    cruise: base * (1 + (rand(t) - 0.5) * 2 * SPREAD),
    x: line[0].x, y: line[0].y, z: roadHeightAt(g, line[0].x, line[0].y), heading: 0,
    stuck: 0,
    colour: colour ?? (kind === "truck" ? TRUCK_COLOUR : kind === "bus" ? BUS_COLOUR : kind === "limo" ? LIMO_COLOUR
      : pick(t, kind === "car" ? CAR_COLOURS : SHIRTS)),
    ...(kind === "bike" ? { side: BIKE_SIDE, sideTo: BIKE_SIDE } : {}),
    phase: rand(t) * Math.PI * 2,
    ...(drive ? { drive } : {}),
  };
  if (walk) {
    m.walk = walk;
    // Not single file: each a little in or out of the pavement's middle.
    m.side = m.sideTo = (rand(t) - 0.5) * 0.06;
  }
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
function driveWay(t: Town, g: Grid, from: Place, to: Place, after?: Mover, at?: { x: number; y: number; heading: number }, spots?: { start?: Spot; goal?: Spot }) {
  const T = trafficOf(t, g);
  const prior = spots?.start ? [spots.start] : after?.drive && after.drive.graph === T.G ? [after.drive.end] : null;
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
  // Not from the very end of a lane: already at a junction's line, with no room to stop at it.
  const roomy = starts.filter((sp) => T.G.lanes[sp.lane].len - sp.s > 0.6);
  if (roomy.length) starts = roomy;
  const goals = spots?.goal ? [spots.goal] : spotsAt(T, g, to, to.kind === "gateway" ? "end" : null);
  const r = routeLanes(T.G, starts, goals);
  if (!r) return null;
  const { pts, start, enter } = lineOf(T.G, r);
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
  const path = cellsOf(g, line);
  const drive: Drive = {
    graph: T.G, lanes: r.lanes, start: start.map((s) => s + shift), enter: enter.map((s) => s + shift), k: 0, let: 0, claims: [], waited: 0, to,
    end: { lane: r.lanes[r.lanes.length - 1], s: r.s1 },
  };
  return { path, line, drive };
}

/** The cells a line crosses, for the road going from under it. */
function cellsOf(g: Grid, line: readonly Cell[]): Cell[] {
  const path: Cell[] = [];
  for (const p of line) {
    const c = { x: Math.min(g.w - 1, Math.max(0, Math.round(p.x))), y: Math.min(g.h - 1, Math.max(0, Math.round(p.y))) };
    const last = path[path.length - 1];
    if (!last || last.x !== c.x || last.y !== c.y) path.push(c);
  }
  if (path.length < 2) path.push(path[0]);
  return path;
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
/**
 * A RUN of bays in a lane, on a street one cell wide, now: its bays' stretch
 * (`s0`–`s1`), where along it a car getting by them is out in the oncoming
 * lane (`z0`–`z1`), and the stretch of it parked in (`p0`–`p1`, if any). Like
 * a bridge one car wide, one way at a time: `out`, somebody is getting by;
 * `facing`, somebody coming the other way is on it, or too near to stop
 * short; `waiting`, somebody coming the other way has waited long for
 * it; `asked`, somebody behind the parked cars has. @see passParked
 */
type Run = { lane: number; opp: number; s0: number; s1: number; z0: number; z1: number; p0: number; p1: number; out: boolean; facing: boolean; waiting: boolean; asked: boolean };
/** A parked car's half length, for its bay's room, tiles. */
const PARKED_HALF = 0.2;
/** How far either side of a run of parked cars a car getting by them is out, tiles. */
const RUN_IN = 1, RUN_OUT = 0.9;
function trafficNow(T: Traffic, cars: readonly Mover[], walkers: readonly Mover[] = [], parkedCars: readonly Mover[] = []) {
  // PARKED, in the bays: each lane's, in order along it.
  const parked = new Map<number, { m: Mover; s: number; blocks: boolean }[]>(), taken = new Set<number>();
  for (const c of parkedCars) {
    const b = c.park && c.park.graph === T.G ? T.G.bays[c.park.bay] : undefined;
    if (!b) continue;
    taken.add(b.id);
    const list = parked.get(b.lane), e = { m: c, s: b.s, blocks: b.blocks };
    if (list) list.push(e); else parked.set(b.lane, [e]);
  }
  for (const list of parked.values()) list.sort((a, b) => a.s - b.s);
  // ON FOOT AT THE CROSSINGS: who is out on one, who waits at its kerb.
  const foot = { on: new Set<number>(), waiting: new Set<number>() };
  for (const m of walkers) {
    const w = m.walk;
    if (!w || w.graph !== T.G || m.sit) continue;
    const x = w.crossings[w.k];
    if (!x) continue;
    // (Out on it from when they make up their mind to go: the last steps to the kerb too.)
    if (w.on) foot.on.add(x.c);
    else if (x.s0 - m.s < KERB_LOOK) foot.waiting.add(x.c);
  }
  const on = new Map<number, Onto[]>();
  const coming = new Map<number, { m: Mover; d: number }[]>();
  const blues: Mover[] = [];
  for (const m of cars) {
    const d = m.drive;
    if (!d || d.graph !== T.G) continue;
    if (m.blues) blues.push(m);
    // On to the next lane past where it begins — into a junction only once let in.
    while (d.k + 1 < d.lanes.length && m.s >= d.enter[d.k + 1] && (d.let > d.k || !inside(T.G.lanes[d.lanes[d.k + 1]]) || inside(T.G.lanes[d.lanes[d.k]]))) d.k++;
    // LET IN AND STILL WAITING at its line — held up by something on the far
    // side the rules did not see coming: it gives its place back.
    if (d.let > d.k && m.stuck > 3) { letGo(T, m, true); d.let = d.k; }
    const lane = d.lanes[d.k];
    const list = on.get(lane);
    const o = { m, s: m.s - d.start[d.k] };
    if (list) list.push(o); else on.set(lane, [o]);
    // GOING ACROSS: on both lanes, till it is clear of the one it left.
    if (d.k > 0 && m.s < d.enter[d.k] + CHANGE_LEN + halfLength(m) && isChange(T.G, d.lanes[d.k - 1], lane)) {
      const was = d.lanes[d.k - 1], o2 = { m, s: m.s - d.start[d.k - 1] }, l2 = on.get(was);
      if (l2) l2.push(o2); else on.set(was, [o2]);
    }
    const q = d.k + 1;
    if (q < d.lanes.length && d.let < q && inside(T.G.lanes[d.lanes[q]])) {
      const c = coming.get(d.lanes[q]);
      const e = { m, d: d.start[q] - m.s };
      if (c) c.push(e); else coming.set(d.lanes[q], [e]);
    }
    letGo(T, m, false);
  }
  return { on, coming, blues, foot, parked, taken, runs: runsOf(T, on, parked) };
}

/** The runs of bays in the lanes of streets one cell wide, with cars parked in them, and who is by each now. @see Run */
function runsOf(T: Traffic, on: ReadonlyMap<number, Onto[]>, parked: ReadonlyMap<number, { m: Mover; s: number; blocks: boolean }[]>): Map<number, Run[]> {
  const G = T.G, out = new Map<number, Run[]>(), byId = new Map<number, Run>();
  for (const [lane, list] of parked) {
    for (const p of list) {
      const id = p.m.park && G.bays[p.m.park.bay]?.run;
      if (id === undefined) continue;
      let r = byId.get(id);
      if (!r) {
        const R = G.runs[id], opp = G.lanes[R.lane].opposite!;
        const s0 = R.s0 - PARKED_HALF, s1 = R.s1 + PARKED_HALF;
        r = { lane, opp, s0, s1, z0: s0 - RUN_IN, z1: s1 + RUN_OUT, p0: Infinity, p1: -Infinity, out: false, facing: false, waiting: false, asked: false };
        byId.set(id, r);
        const rs = out.get(lane);
        if (rs) rs.push(r); else out.set(lane, [r]);
      }
      r.p0 = Math.min(r.p0, p.s - halfLength(p.m)); r.p1 = Math.max(r.p1, p.s + halfLength(p.m));
    }
  }
  for (const [lane, runs] of out) {
    const len = G.lanes[runs[0].opp].len;
    for (const r of runs) {
      // Getting by them: anybody whose way out covers any of it. Waited long behind them: the first in the queue.
      let first: Onto | undefined;
      for (const o of on.get(lane) ?? []) {
        const P = o.m.pass, d = o.m.drive!;
        if (P && P.lane === lane && P.b - d.start[d.k] > r.z0 && P.a - d.start[d.k] < r.z1) r.out = true;
        else if (o.s < r.p0 && (!first || o.s > first.s)) first = o;
      }
      if (first && r.p0 - first.s < 1.5 && first.m.stuck > PATIENT) r.asked = true;
      // Coming the other way: on it, too near to stop short, or at its end; or long stood there.
      const facing = (o: Mover, sL: number) => {
        const ho = halfLength(o);
        if (sL - ho < r.z1 && sL + ho > r.z0) return true;
        const to = sL - ho - r.z1;
        if (to > -0.05 && to < 0.6 && o.stuck > PATIENT) r.waiting = true;
        return to > 0 && o.speed > 0.1 && to < (o.speed * o.speed) / (2 * IDM_B) + 0.2;
      };
      for (const o of on.get(r.opp) ?? []) if (facing(o.m, len - o.s)) r.facing = true;
      for (const P of T.into.get(r.opp) ?? []) for (const o of on.get(P) ?? []) if (facing(o.m, len + G.lanes[P].len - o.s)) r.facing = true;
    }
  }
  return out;
}

/**
 * OUT OF THE WAY of an emergency vehicle: the cars ahead of it in its lane,
 * on a road with room, pull in to the kerb and stop till it is by; it goes
 * out toward the middle to pass them.
 */
function giveWayToBlues(T: Traffic, cars: readonly Mover[], now: ReturnType<typeof trafficNow>) {
  const G = T.G;
  const wide = (lane: number) => {
    const l = G.lanes[lane];
    return l.kind === "street" && l.lanes === 1 && G.streets[l.street!].width >= 2;
  };
  const pull = new Set<Mover>();
  for (const B of now.blues) {
    const d = B.drive!, lane = d.lanes[d.k];
    B.sideTo = wide(lane) ? PASS_OUT : restSide(T, now, B);
    if (!wide(lane)) continue;
    // Stood short of the scene, where it is going: nobody need wait in at the kerb for it.
    if (B.speed < 0.05 && B.at[B.at.length - 1] - B.s < 2) continue;
    const at = B.s - d.start[d.k];
    for (const o of now.on.get(lane) ?? []) if (!o.m.blues && o.s > at - 0.2 && o.s < at + PULL_AHEAD) pull.add(o.m);
  }
  // (In at the kerb only where nobody is parked: otherwise stopped out in the lane.)
  const kerbFree = (m: Mover) => {
    const d = m.drive;
    if (!d || d.graph !== G || !wide(d.lanes[d.k])) return false;
    const at = m.s - d.start[d.k];
    return !(now.parked.get(d.lanes[d.k]) ?? []).some((p) => Math.abs(p.s - at) < halfLength(p.m) + halfLength(m) + 0.1);
  };
  for (const m of cars) {
    if (m.blues) continue;
    // AT THE SCENE: in at the kerb, where there is one to be in at.
    if (m.siren && standing(m)) { m.sideTo = kerbFree(m) ? PULL_IN : 0; continue; }
    if (pull.has(m)) { m.sideTo = m.pullAt === undefined || pulled(m) ? (kerbFree(m) ? PULL_IN : 0) : m.sideTo; m.pullAt ??= m.s + 0.5 + m.speed * m.speed / (2 * IDM_B); }
    else {
      // Through a junction, on the curve, as the zones have it.
      m.sideTo = restSide(T, now, m);
      m.pullAt = undefined;
    }
  }
}

/** Let go the zones a vehicle is past — or all of them. */
function letGo(T: Traffic, m: Mover, all: boolean) {
  const d = m.drive;
  if (!d || !d.claims.length) return;
  const half = halfLength(m);
  d.claims = d.claims.filter(({ zone, lane }) => {
    if (!all) {
      const j = d.lanes.indexOf(lane, Math.max(0, d.k - 1));
      const past = j < 0 || d.k > j || (d.k === j && m.s - d.start[j] > zoneOn(T, zone, lane).e + LANE_CLEAR + 2 * half);
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
type Ahead = { cap: number; idm: number };
/**
 * SOMETHING AHEAD, `free` tiles of clear road from its nose, going at `lead`:
 * the most a driver may go to stop short of it braking its hardest, and how
 * much it wants to brake for it (IDM's interaction term, the largest kept).
 * `s0` is the room it keeps when stopped behind it.
 */
function follow(A: Ahead, v: number, free: number, lead: number, s0: number) {
  const room = Math.max(0, free - s0);
  A.cap = Math.min(A.cap, Math.sqrt(lead * lead + 2 * HARD * room));
  const want = Math.max(0, s0 + v * HEADWAY + (v * (v - lead)) / (2 * Math.sqrt(IDM_A * IDM_B)));
  A.idm = Math.max(A.idm, (want / Math.max(free, 0.01)) ** 2);
}

function driveLimit(t: Town, T: Traffic, m: Mover, now: ReturnType<typeof trafficNow>, h: number, A: Ahead): void {
  const d = m.drive!;
  const G = T.G;
  const v = m.speed, half = halfLength(m);
  // PULLED IN for an emergency vehicle: to a stop at the kerb.
  if (m.pullAt !== undefined) follow(A, v, m.pullAt - m.s, 0, 0);
  passParked(T, m, now, A);
  // FOLLOWING: the nearest thing ahead on its own lanes, or one just gone
  // off the same lane onto another curve, still in the way.
  for (let j = d.k; j < d.lanes.length && d.start[j] - m.s < FOLLOW; j++) {
    for (const o of now.on.get(d.lanes[j]) ?? []) {
      if (o.m === m || passes(m, o.m)) continue;
      const gap = d.start[j] + o.s - m.s;
      // (Two set off from the same spot: the later waits for the earlier.)
      const ahead = Math.abs(gap) < 1e-3 ? o.m.id < m.id : gap > 0;
      if (ahead && gap < FOLLOW + 1) follow(A, v, Math.max(0, gap) - spacing(m, o.m) + GAP, o.m.speed, GAP);
    }
    if (j > 0) {
      for (const sib of G.lanes[d.lanes[j - 1]].next) {
        if (sib === d.lanes[j]) continue;
        for (const o of now.on.get(sib) ?? []) {
          if (o.m === m || o.s > (T.split.get(`${sib},${d.lanes[j]}`) ?? 0.8) + halfLength(o.m) + halfLength(m)) continue;
          const gap = d.start[j] + o.s - m.s;
          if (gap > 0) follow(A, v, gap - spacing(m, o.m) + GAP, o.m.speed, GAP);
        }
      }
    }
    // A CROSSING ahead with somebody out on it — or, a zebra, at its kerb:
    // stopped short of it. (Not one it is already over.)
    for (const x of T.over.get(d.lanes[j]) ?? []) {
      const front = d.start[j] + x.s - m.s - half;
      if (front < CROSS_STOP || front > FOLLOW) continue;
      if (now.foot.on.has(x.c) || (now.foot.waiting.has(x.c) && zebraAt(t, T, x.c))) follow(A, v, front - CROSS_STOP, 0, 0.02);
    }
    // LETTING IN one waiting beside to change onto this lane, a little ahead.
    for (const b of G.lanes[d.lanes[j]].beside ?? []) {
      for (const o of now.on.get(b) ?? []) {
        if (o.m === m || o.m.drive?.wants !== d.lanes[j]) continue;
        const gap = d.start[j] + o.s - m.s;
        if (gap > 0.3) follow(A, v, gap - spacing(m, o.m) + GAP, 0, GAP + 0.25);
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
          follow(A, v, mine - left - spacing(m, o.m) + GAP, 0, GAP);
        }
      }
    }
  }
  // CHANGING LANE: across when there is a gap, and waiting short of the move for one.
  const c = d.k + 1;
  if (c < d.lanes.length && d.let < c && isChange(G, d.lanes[d.k], d.lanes[c])) {
    const toMove = d.enter[c] - m.s;
    if (toMove < (v * v) / (2 * IDM_B) + 1.5) {
      if (mayChange(m, c, now)) {
        if (toMove < 0.5) { d.let = c; d.wants = undefined; }
      } else {
        d.wants = d.lanes[c];
        follow(A, v, toMove, 0, 0.02);
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
    if (toLine <= stopping + half + (G.lanes[d.lanes[d.k]].hold ?? STOP_BACK) + 1.2) {
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
        follow(A, v, toLine - half - back, 0, 0.02);
        if (m.speed < 0.1) d.waited += h;
      }
    }
  }
}

/** How far out from its lane a vehicle goes to get by a car parked in it, tiles. */
const PASS_SIDE = { car: 0.17, truck: 0.2, bus: 0.2, bike: 0.17 } as Record<string, number>;
const passSide = (m: Mover) => PASS_SIDE[m.kind] ?? 0.17;
/** The fastest it goes by, tiles a second. */
const PASS_SPEED = 0.9;

/**
 * BY A PARKED CAR in its lane, on a street one cell wide: out into the
 * oncoming lane to get by all those parked in its run of bays, when it is its
 * way's turn, it is first in the queue for them and there is room to be back
 * in after; and back in. Till then, stopped behind them. Coming the other way,
 * short of a run while somebody is getting by it, or has long waited to.
 * (Bays on wider roads are out of the lane.) @see Run
 */
function passParked(T: Traffic, m: Mover, now: ReturnType<typeof trafficNow>, A: Ahead) {
  const d = m.drive!, G = T.G, v = m.speed, half = halfLength(m), end = m.at[m.at.length - 1];
  const L = d.lanes[d.k];
  // (Done with it once back in its own lane.)
  if (m.pass && (m.pass.lane !== L || (m.s > m.pass.b && (m.side ?? 0) > -0.03))) m.pass = undefined;
  const out = (m.side ?? 0) <= -(passSide(m) - 0.03);
  for (let j = d.k; j < d.lanes.length && d.start[j] - m.s < FOLLOW + 1; j++) {
    const X = d.lanes[j], lenX = G.lanes[X].len;
    // COMING THE OTHER WAY: short of a run somebody is getting by, or asks to.
    const other = G.lanes[X].opposite;
    if (other !== undefined) {
      for (const r of now.runs.get(other) ?? []) {
        if (!r.out && !(r.asked && !r.waiting)) continue;
        const e = d.start[j] + lenX - r.z1, nose = m.s + half;
        if (nose < e + 0.02 && e - nose < FOLLOW) follow(A, v, e - nose - 0.05, 0, 0.02);
      }
      // HEAD ON: short of anybody out getting by, coming this way.
      for (const o of now.on.get(other) ?? []) {
        if (!o.m.pass || (o.m.side ?? 0) > -0.05) continue;
        const at = d.start[j] + lenX - o.s, ho = halfLength(o.m);
        if (at > m.s && at - ho - m.s - half < FOLLOW) follow(A, v, at - ho - m.s - half - 0.05, 0, 0.05);
      }
    }
    const list = now.parked.get(X);
    if (!list) continue;
    for (const p of list) {
      // (Not itself, just out of its bay.)
      if (!p.blocks || p.m === m) continue;
      const at = d.start[j] + p.s, ph = halfLength(p.m), gap = at - m.s;
      // Behind it already, or beyond where it is going.
      // (Into a bay: up to the next one's car, bumper to bumper.)
      if (gap + ph + half < 0 || gap > FOLLOW + 1 || at - ph > end + (m.bayTo ? 0 : half + GAP)) continue;
      // Parked where it is going: it stops short, there.
      if (!m.bayTo && at - ph < end + half + GAP && at > end - 1) {
        follow(A, v, gap - spacing(m, p.m) + GAP, 0, GAP);
        if (gap - spacing(m, p.m) < 0.15 && v < 0.1) m.there = true;
        continue;
      }
      if (m.pass && at - ph < m.pass.b + half) { if (out) continue; }
      else if (j === d.k && gap < Math.max(1.2, v * 1.5 + 0.8)) {
        const r = runAt(G, now, p.m);
        if (r && mayPass(now, m, r, m.s - d.start[j])) {
          m.pass = { lane: L, a: d.start[j] + r.p0 - half - 0.4, b: passEnd(G, m, r, d.start[j]) };
          continue;
        }
      }
      follow(A, v, gap - spacing(m, p.m) + GAP, 0, GAP);
    }
  }
  const P = m.pass;
  if (!P) return;
  // (One just parked further along the run, by one of those getting by ahead of it: by that one too.)
  for (const r of now.runs.get(L) ?? []) if (r.z0 < P.b - d.start[d.k] && r.z1 > P.a - d.start[d.k] && m.s < P.b - 0.3) P.b = Math.max(P.b, passEnd(G, m, r, d.start[d.k]));
  if (m.s > P.a - 0.5) A.cap = Math.min(A.cap, PASS_SPEED);
  // HEAD ON: short of one already coming the other way, into where it is getting by.
  const opp = G.lanes[L].opposite!, len = G.lanes[opp].len, mine = m.s - d.start[d.k];
  for (const o of now.on.get(opp) ?? []) {
    const sL = len - o.s, ho = halfLength(o.m);
    if (sL + ho < mine - half || sL - ho > P.b - d.start[d.k] + half + 0.1) continue;
    follow(A, v, sL - ho - mine - half - 0.05, 0, 0.05);
  }
}

/** The run a parked car's bay is one of, as it is now. */
function runAt(G: Traffic["G"], now: ReturnType<typeof trafficNow>, c: Mover): Run | undefined {
  const b = c.park && G.bays[c.park.bay];
  if (!b || b.run === undefined) return undefined;
  const R = G.runs[b.run];
  return (now.runs.get(R.lane) ?? []).find((r) => r.s0 <= b.s && b.s <= r.s1);
}

/** Where along its line a vehicle getting by a run of parked cars is back in: past the last of them, or at its bay among them. */
function passEnd(G: Traffic["G"], m: Mover, r: Run, start: number): number {
  return Math.min(start + r.p1 + halfLength(m) + 0.1, start + G.lanes[r.lane].len - 0.05, m.bayTo ? m.at[m.at.length - 1] : Infinity);
}

/**
 * Whether a vehicle may go out to get by a run of parked cars, from `from`
 * along its lane: nobody coming the other way on it, too near to stop short
 * or waiting at its end; nobody ahead of it in its own lane still to get by;
 * and room to be back in after them.
 */
function mayPass(now: ReturnType<typeof trafficNow>, m: Mover, r: Run, from: number): boolean {
  if (r.facing || r.waiting) return false;
  const half = halfLength(m);
  for (const o of now.on.get(r.lane) ?? []) {
    if (o.m === m || o.s <= from || o.m.pass) continue;
    if (o.s < r.p1 + half) return false;
    if (o.s - halfLength(o.m) < r.p1 + 2 * half + 0.8 && o.m.speed < 0.5) return false;
  }
  return true;
}

/**
 * Where across its lane a vehicle would be: in at its bay's kerb at the end of
 * the way to it, out in the oncoming lane getting by a parked car, a cyclist
 * toward the kerb along a street; otherwise on the lane's line.
 */
function restSide(T: Traffic, now: ReturnType<typeof trafficNow>, m: Mover): number {
  const d = m.drive, l = d && d.graph === T.G ? T.G.lanes[d.lanes[d.k]] : undefined;
  if (m.bayTo) {
    // In along the kerb from behind, or — the bay behind taken — from alongside it.
    const b = T.G.bays[m.bayTo.bay], left = m.at[m.at.length - 1] - m.s;
    if (b && left < 0.9) {
      const behind = T.G.bays.some((o) => o.lane === b.lane && o.s < b.s && b.s - o.s < 0.8 && now.taken.has(o.id));
      if (!behind || left < 0.05) return b.side;
    }
  }
  if (m.pass && m.s >= m.pass.a && m.s <= m.pass.b) return -passSide(m);
  return m.kind === "bike" && l?.kind === "street" ? BIKE_SIDE : 0;
}

/** Whether there is a gap for a vehicle to change onto lane `c` of its way: room ahead, and behind for whoever is coming. */
function mayChange(m: Mover, c: number, now: ReturnType<typeof trafficNow>): boolean {
  const d = m.drive!, me = Math.max(m.s, d.enter[c]);
  for (const o of now.on.get(d.lanes[c]) ?? []) {
    // (Not one at the kerb: it is out of the lane.)
    if (o.m === m || pulled(o.m)) continue;
    const at = d.start[c] + o.s, room = spacing(m, o.m) + 0.1;
    if (at >= me ? at - me < room + Math.max(0, m.speed - o.m.speed) * 0.5 : me - at < room + o.m.speed * 0.8) return false;
  }
  return true;
}

/** Whether a vehicle at the line may take the junction lane `q` of its way. @see Traffic */
function mayEnter(t: Town, T: Traffic, m: Mover, q: number, toLine: number, stopping: number, now: ReturnType<typeof trafficNow>): boolean {
  const d = m.drive!, G = T.G;
  const y = G.lanes[d.lanes[q]];
  // Only the car at the front of the queue.
  const mine = m.s - d.start[d.k];
  for (const o of now.on.get(d.lanes[d.k]) ?? []) if (o.m !== m && o.s > mine && !passes(m, o.m)) return false;
  // Its zones free, or held by cars on the same curve — and none long waited
  // for by someone else: a stream never shuts out a side road for good.
  // (Not one too near the line to stop for it.)
  const hungry = (z: number) => { const w = T.hungry.get(z); return !!w && w.lane !== y.id && t.t - w.at < 0.5 && toLine > stopping + 0.1; };
  let held = false;
  for (const z of y.zones) {
    if (hungry(z)) return false;
    const c = T.claims.get(z);
    if (c && c.cars.size && c.lane !== y.id) held = true;
  }
  if (held) {
    // Waited long enough, it asks for all of them: no more go in across it till it has.
    // (At the lights, only on its green.)
    const J = G.junctions[y.junction!];
    const green = J.kind !== "signals" || y.arm === undefined || lightOf(T, J.id, y.arm, t.t) === "green";
    if (d.waited >= PATIENT && green) for (const z of y.zones) T.hungry.set(z, { lane: y.id, at: t.t });
    return false;
  }
  // AN EMERGENCY VEHICLE coming: everyone else waits — unless it is behind them, and they are in its way.
  if (!m.blues) {
    for (const B of now.blues) {
      const e = B.drive!;
      if (e.graph !== G || e.lanes.indexOf(d.lanes[d.k], e.k) >= 0) continue;
      for (let j = e.k; j < e.lanes.length && e.start[j] - B.s < BLUES_NEAR; j++) if (G.lanes[e.lanes[j]].junction === y.junction) return false;
    }
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
  // ON A CALL: through the lights, and giving way to nobody.
  if (m.blues) return true;
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

/** How far short of a crossing's kerb a walker looks to cross, tiles. */
const KERB_LOOK = 0.35;
/** How far a car's nose stops short of a crossing's middle, tiles: half its width and a little. */
const CROSS_STOP = 0.2;
/** A gap a walker crosses a plain road in, seconds; and how long they wait before trusting the cars to stop for them. */
const CROSS_GAP = 2.5;
const WALK_PATIENT = 10;

/** Whether a crossing is a zebra, as the road is painted. */
const zebraAt = (t: Town, T: Traffic, c: number) => !!t.dress && (t.dress[T.G.crossings[c].cells[0]] & 4) !== 0;

/** The vehicles coming to a crossing, or on it: each with the gap from its nose to the crossing's middle. */
function comingTo(T: Traffic, now: ReturnType<typeof trafficNow>, c: number): { m: Mover; f: number }[] {
  const out: { m: Mover; f: number }[] = [];
  for (const L of T.lanesOver.get(c) ?? []) {
    const s = T.over.get(L)!.find((x) => x.c === c)!.s;
    for (const o of now.on.get(L) ?? []) out.push({ m: o.m, f: s - o.s - halfLength(o.m) });
    for (const P of T.into.get(L) ?? []) {
      const len = T.G.lanes[P].len;
      for (const o of now.on.get(P) ?? []) if (len - o.s + s < 4) out.push({ m: o.m, f: len - o.s + s - halfLength(o.m) });
    }
  }
  return out;
}

/**
 * WHETHER A WALKER MAY STEP OUT over a crossing now. At lights, on the walk,
 * with time to get over. On a zebra, unless a car is too near to stop for
 * them; elsewhere, in a gap in the traffic — or, waited long enough, as on a
 * zebra. Never with a car over it.
 */
function mayCross(t: Town, T: Traffic, now: ReturnType<typeof trafficNow>, m: Mover, x: Walk["crossings"][number]): boolean {
  const C = T.G.crossings[x.c];
  const lit = C.junction >= 0 && T.G.junctions[C.junction].kind === "signals";
  if (lit && walkLeft(T, C.junction, t.t) < (x.s1 - x.s0) / m.cruise + 0.5) return false;
  const yielded = lit || zebraAt(t, T, x.c) || m.walk!.waited > WALK_PATIENT;
  for (const { m: o, f } of comingTo(T, now, x.c)) {
    if (f < -2 * halfLength(o) - CROSS_STOP) continue;
    if (f < CROSS_STOP) return false;
    if (o.speed < 0.1) continue;
    const room = f - CROSS_STOP;
    if (yielded ? room < (o.speed * o.speed) / (2 * IDM_B) + 0.15 : room / o.speed < CROSS_GAP) return false;
  }
  return true;
}

/** The fastest a walker may take its line where it is: to a stop at the end. */
function lineLimit(m: Mover): number {
  const left = m.at[m.at.length - 1] - m.s;
  return Math.min(m.cruise, Math.sqrt(2 * BRAKE * Math.max(0, left)) + 0.05);
}

/** How far ahead a driver slows for a bend, tiles. */
const BEND_LOOK = 1.5;

/**
 * THE BENDS of a vehicle's line: at each of its points, the fastest it may go
 * for how far the way turns in the next 0.6 tiles — a right angle at four
 * tenths of its cruise. Worked out once a trip.
 */
function bendsOf(m: Mover): Float32Array {
  const n = m.line.length, total = m.at[n - 1], out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const a = along(m, m.at[k]), b = along(m, Math.min(total, m.at[k] + 0.6));
    const turn = Math.abs(Math.atan2(a.dx * b.dy - a.dy * b.dx, a.dx * b.dx + a.dy * b.dy));
    out[k] = m.cruise * (1 - 0.6 * Math.min(1, turn / (Math.PI / 2)));
  }
  return out;
}

/** The speed a driver would like where it is: its cruise, or slower for a bend coming up, braking gently into it. */
function wishOf(m: Mover): number {
  const B = (m.bends ??= bendsOf(m));
  let lo = 0, hi = m.at.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (m.at[mid] < m.s) lo = mid + 1; else hi = mid; }
  let v = m.cruise;
  for (let k = Math.max(0, lo - 1); k < m.at.length && m.at[k] < m.s + BEND_LOOK; k++) {
    v = Math.min(v, Math.sqrt(B[k] * B[k] + 2 * IDM_B * Math.max(0, m.at[k] - m.s)));
  }
  return Math.max(0.2, v);
}

/** A driver's speed after a step: IDM toward what it would like, never past what it can stop short of. */
function drive(m: Mover, A: Ahead, h: number) {
  const v = m.speed, v0 = wishOf(m);
  const free = Math.max(-IDM_B, IDM_A * (1 - (v / v0) ** 4));
  const a = Math.max(-HARD, free - IDM_A * A.idm);
  m.speed = Math.max(0, Math.min(v + a * h, A.cap));
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
        m.path = way.path; m.line = way.line; m.drive = way.drive; m.bends = undefined;
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
  const tripCars = cars.filter((m) => !m.job).length + t.parked.filter((c) => c.park!.trip).length;
  const people = t.movers.filter((m) => m.kind === "person" && !m.job).length;
  t.untilCar -= h;
  if (t.untilCar <= 0 && tripCars < want.cars) {
    t.untilCar = CAR_EVERY / townCaps.every;
    const trip = (rand(t) < busy.commute ? commuteTrip(t, g, net, "car") : null) ?? tripFor(t, "car");
    // A car's trip taken by a shuttle bus, or a moving van, as the cards say.
    // Rolled only with one of them in force: the town's sequence as it was without.
    const r = culture.shuttle || culture.vans ? rand(t) : 0.5;
    const [kind, colour] = culture.shuttle && r < SHUTTLE_SHARE ? ["bus", SHUTTLE_COLOUR] as const
      : culture.vans && r > 1 - VAN_SHARE ? ["truck", VAN_COLOUR] as const
      : rand(t) < BIKE_SHARE ? ["bike", undefined] as const : ["car", undefined] as const;
    // From a door, in a car parked near it if there is one: its people walk out to it first.
    if (trip && kind === "car" && trip[0].kind === "door" && fromBay(t, g, trip[0], trip[1])) { /* on its way */ }
    else {
      const m = trip && setOff(t, g, kind, ...trip, colour);
      if (m && !cars.some((o) => Math.hypot(o.x - m.x, o.y - m.y) < START_CLEAR) && !amongParked(t, g, m)) {
        // To a door: to park near it, if there is a bay free.
        if (kind === "car" && trip![1].kind === "door") toBay(t, g, m, trip![0], trip![1]);
        t.movers.push(m);
      }
    }
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
  if (t.parked.some((c) => c.park!.graph !== T.G)) refile(t, T.G);
  if (t.residentsFor !== T.G) residents(t, g, T);
  const now = trafficNow(T, cars, t.movers.filter((m) => m.walk), t.parked);
  stepParked(t, g, T, now, h);
  giveWayToBlues(T, cars, now);
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
    // AT A STOP: standing, then on its way — out from the kerb when the lane is clear behind.
    if (m.wait && m.wait > 0) {
      m.wait -= h;
      m.speed = 0;
      if (m.wait <= 0 && pulled(m) && m.drive && m.drive.graph === T.G && !mayChange(m, m.drive.k, now)) m.wait = 0.1;
      const to = m.sideTo ?? 0, side = m.side ?? 0;
      if (side !== to) {
        m.side = side < to ? Math.min(to, side + SIDE_RATE * h) : Math.max(to, side - SIDE_RATE * h);
        const p = along(m, m.s);
        m.x = p.x - p.dy * m.side; m.y = p.y + p.dx * m.side;
      }
      continue;
    }
    if (drives(m)) {
      // Behind whatever is ahead, and to a stop at the end of the way.
      const A: Ahead = { cap: Infinity, idm: 0 };
      // Its end a little past the line's, so it rolls on up to it rather than creeping.
      follow(A, m.speed, m.at[m.at.length - 1] - m.s, 0, -0.05);
      if (m.drive && m.drive.graph === T.G) driveLimit(t, T, m, now, h, A);
      drive(m, A, h);
    } else {
      let limit = lineLimit(m);
      // AT A CROSSING'S KERB: over when it is safe to be, and stood till then.
      const w = m.walk;
      if (w && w.graph === T.G) {
        while (w.k < w.crossings.length && m.s > w.crossings[w.k].s1) { w.k++; w.on = false; w.waited = 0; }
        const x = w.crossings[w.k];
        if (x && !w.on) {
          const to = x.s0 - m.s;
          if (to <= 0 || (to < KERB_LOOK && mayCross(t, T, now, m, x))) w.on = true;
          else if (to < KERB_LOOK) {
            w.waited += h;
            limit = Math.min(limit, Math.sqrt(2 * BRAKE * Math.max(0, to - 0.04)));
          }
        }
      }
      if (m.speed < limit) m.speed = Math.min(limit, m.speed + ACCEL * h);
      else m.speed = Math.max(limit, m.speed - BRAKE * h);
    }
    if (drives(m)) {
      if (m.speed < 0.05) m.stuck += h; else m.stuck = 0;
      if (m.stuck > STALLED) m.gone = true;
    }
    m.s += m.speed * h;
    const p = along(m, m.s);
    // Sideways, toward where it is going, off its line to its right.
    const to = m.sideTo ?? 0, side = m.side ?? 0;
    if (side !== to) m.side = side < to ? Math.min(to, side + SIDE_RATE * h) : Math.max(to, side - SIDE_RATE * h);
    const off = m.side ?? 0;
    m.x = p.x - p.dy * off;
    m.y = p.y + p.dx * off;
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
    // Pedalling: a turn of the pedals, 2π, a gear's distance.
    if (m.kind === "bike") m.phase += (h * m.speed * 2 * Math.PI) / (PEDAL_TURN_M * TILES_PER_M);
    if (m.kind === "person") {
      m.phase += (h * m.speed * Math.PI) / STRIDE;
      if (!m.job && t.seats) sitDown(m, t.seats, taken, g);
    }
  }

  // ARRIVING, and the road going from under somebody.
  t.movers = t.movers.filter((m) => {
    if (atWork(m)) return true;     // the site lets them go. @see stepWorks, stepCleanup
    if (m.gone) { letGo(T, m, true); return false; }
    // (Into a bay: once in at the kerb.)
    const inBay = !m.bayTo || Math.abs((m.side ?? 0) - (T.G.bays[m.bayTo.bay]?.side ?? 0)) < 0.02;
    if ((m.s >= m.at[m.at.length - 1] - 0.01 && inBay) || m.there) {
      letGo(T, m, true);
      if (m.job) t.arrived.push(m);
      // INTO ITS BAY, and its people out and off to the door.
      if (m.bayTo) parkIn(t, g, T, m);
      // AT THE CAR, and in.
      if (m.toCar !== undefined) boarded(t, m.toCar);
      return false;
    }
    const k = Math.min(m.path.length - 1, Math.max(0, Math.round((m.s / m.at[m.at.length - 1]) * (m.path.length - 1))));
    const c = m.path[k];
    if (isPaved(g, c.x, c.y)) return true;
    letGo(T, m, true);
    if (m.toCar !== undefined) boarded(t, m.toCar);
    return false;
  });
}

/**
 * Whether a vehicle setting off would start among parked cars: near one, or,
 * on a street one cell wide, alongside where the traffic gets by them.
 */
function amongParked(t: Town, g: Grid, m: Mover): boolean {
  if (t.parked.some((o) => Math.hypot(o.x - m.x, o.y - m.y) < START_CLEAR)) return true;
  const d = m.drive, T = trafficOf(t, g);
  if (!d || d.graph !== T.G) return false;
  const L = T.G.lanes[d.lanes[0]], at = -d.start[0], opp = L.opposite;
  if (opp === undefined) return false;
  const len = T.G.lanes[opp].len;
  // (Not on, or across from, a run of bays: where cars get by them.)
  return T.G.runs.some((R) => (R.lane === L.id && at > R.s0 - RUN_IN - 1 && at < R.s1 + 1) || (R.lane === opp && len - at > R.s0 - RUN_IN - 0.5 && len - at < R.s1 + RUN_OUT + 1.5));
}

/** A walker reached their car, or will not: one fewer to wait for. */
function boarded(t: Town, car: number) {
  const c = t.parked.find((p) => p.id === car);
  if (c?.park) c.park.boarding = Math.max(0, c.park.boarding - 1);
}

/** Its people, walking from a car in a bay to a door, or from a door out to it. */
function walkers(t: Town, g: Grid, T: Traffic, c: Mover, door: Place, out: boolean): number {
  const kerb = kerbOf(g, T.G.bays[c.park?.bay ?? c.bayTo!.bay]);
  let n = 0;
  for (let k = 0; k < aboard(c); k++) {
    const w = out ? setOff(t, g, "person", door, kerb) : setOff(t, g, "person", kerb, door);
    if (!w) continue;
    if (out) w.toCar = c.id;
    // (Not all at once: one after the other, out of the car or the door.)
    w.wait = k * 0.6;
    t.movers.push(w);
    n++;
  }
  return n;
}

/** A CAR TO A DOOR: a bay near it held for it, and its way there instead. */
function toBay(t: Town, g: Grid, m: Mover, from: Place, door: Place) {
  const T = trafficOf(t, g);
  if (t.parked.length + t.movers.filter((o) => o.bayTo).length >= PARK_CAP * townCaps.cars) return;
  const b = bayNear(T.G, heldBays(t), door);
  if (!b) return;
  const way = driveWay(t, g, from, door, undefined, undefined, { goal: { lane: b.lane, s: b.s } });
  if (!way) return;
  m.path = way.path; m.line = way.line; m.drive = way.drive; m.bends = undefined;
  m.at = new Float32Array(m.line.length);
  for (let k = 1; k < m.line.length; k++) m.at[k] = m.at[k - 1] + Math.hypot(m.line[k].x - m.line[k - 1].x, m.line[k].y - m.line[k - 1].y);
  m.bayTo = { bay: b.id, door };
}

/** A CAR FROM A DOOR, parked near it: its people walk out to it, and it goes when they are in. False if there is none. */
function fromBay(t: Town, g: Grid, door: Place, to: Place): boolean {
  const T = trafficOf(t, g);
  const c = carNear(t, T.G, door);
  if (!c) return false;
  c.park!.trip = to;
  c.park!.boarding = walkers(t, g, T, c, door, true);
  return true;
}

/** ARRIVED AT ITS BAY: parked, for a while, and its people out. */
function parkIn(t: Town, g: Grid, T: Traffic, m: Mover) {
  const b = T.G.bays[m.bayTo!.bay], door = m.bayTo!.door;
  m.bayTo = undefined;
  if (!b || m.drive?.graph !== T.G) return;
  m.park = { bay: b.id, graph: T.G, stay: STAY[0] + rand(t) * (STAY[1] - STAY[0]), door, boarding: 0 };
  m.x = b.x; m.y = b.y; m.heading = b.heading; m.speed = 0; m.side = m.sideTo = b.side; m.pass = undefined;
  t.parked.push(m);
  walkers(t, g, T, m, door, false);
}

/** THE RESIDENTS' CARS, in a share of the bays outside homes: by a hash of the bay, not the town's own sequence. */
function residents(t: Town, g: Grid, T: Traffic) {
  t.residentsFor = T.G;
  const held = heldBays(t), doors = new Map<number, Place>();
  for (const p of t.places) if (p.kind === "door" && p.structure !== undefined) doors.set(p.structure, p);
  for (const b of T.G.bays) {
    if (held.has(b.id) || t.parked.length >= PARK_CAP * townCaps.cars) continue;
    const [dx, dy] = NEIGHBOUR[b.kerb];
    const s = g.structures.get(structureAt(g, (b.cell % g.w) + dx, ((b.cell / g.w) | 0) + dy));
    if (!s || !residentsIn(s) || roll(b.id, `${b.x},${b.y}`, 0x9a) >= RESIDENT_SHARE) continue;
    const c: Mover = {
      id: t.next++, kind: "car", path: [], line: [{ x: b.x, y: b.y }, { x: b.x, y: b.y }], at: new Float32Array(2), s: 0, speed: 0,
      cruise: CAR_CRUISE * (1 + (roll(b.id, "c", 0x3c) - 0.5) * 2 * SPREAD),
      x: b.x, y: b.y, z: roadHeightAt(g, b.x, b.y), heading: b.heading, stuck: 0,
      colour: CAR_COLOURS[Math.floor(roll(b.id, "k", 0x5d) * CAR_COLOURS.length)], phase: 0,
      side: b.side, sideTo: b.side,
      park: { bay: b.id, graph: T.G, stay: Infinity, door: doors.get(s.id), boarding: 0 },
    };
    t.parked.push(c);
  }
}

/**
 * THE PARKED CARS, a step: a visitor's stay running out, its people coming
 * out to it; and one with everybody in, out of its bay when nothing is coming
 * along the lane behind — and back on the roads.
 */
function stepParked(t: Town, g: Grid, T: Traffic, now: ReturnType<typeof trafficNow>, h: number) {
  for (const c of [...t.parked]) {
    const P = c.park!;
    if (P.graph !== T.G) continue;
    if (!P.trip) {
      P.stay -= h;
      if (P.stay > 0 || !P.door) continue;
      // Time to go: somewhere else on its roads.
      const ends = t.places.filter((p) => p !== P.door && p.net === P.door!.net && !p.building);
      if (!ends.length) { P.stay = STAY[0]; continue; }
      P.trip = pick(t, ends);
      P.boarding = walkers(t, g, T, c, P.door, true);
      continue;
    }
    if (P.boarding > 0) continue;
    const b = T.G.bays[P.bay];
    if (!clearBehind(T, now, c, b)) continue;
    const way = driveWay(t, g, P.trip, P.trip, undefined, undefined, { start: { lane: b.lane, s: b.s } });
    if (!way) { t.parked.splice(t.parked.indexOf(c), 1); continue; }
    // One of a run of them: out only when it can get by the rest of them straight away.
    const r = runAt(T.G, now, c);
    const ahead = r && (now.parked.get(b.lane) ?? []).some((p) => p.m !== c && p.s > b.s && p.s < r.s1);
    let pass: Mover["pass"];
    if (r && ahead) {
      if (!mayPass(now, c, r, b.s)) continue;
      // (Already among them, out from the first.)
      const d0 = way.drive.start[0];
      pass = { lane: b.lane, a: d0 + b.s - 1, b: passEnd(T.G, c, r, d0) };
    }
    t.parked.splice(t.parked.indexOf(c), 1);
    // Off: on its way, out from the kerb.
    c.path = way.path; c.line = way.line; c.drive = way.drive; c.bends = undefined;
    c.at = new Float32Array(c.line.length);
    for (let k = 1; k < c.line.length; k++) c.at[k] = c.at[k - 1] + Math.hypot(c.line[k].x - c.line[k - 1].x, c.line[k].y - c.line[k - 1].y);
    c.s = 0; c.speed = 0; c.stuck = 0; c.park = undefined; c.pass = pass;
    t.movers.push(c);
  }
}

/** Whether a car in a bay may pull out: nothing on its lane, or coming onto it, near behind it or beside it, nor getting by it. */
function clearBehind(T: Traffic, now: ReturnType<typeof trafficNow>, c: Mover, b: { lane: number; s: number }): boolean {
  const half = halfLength(c);
  const ok = (o: Mover, back: number) => back < -2 * half - 0.1 || back > Math.max(0.9, o.speed * 1.8) + 2 * half;
  for (const o of now.on.get(b.lane) ?? []) {
    if (!ok(o.m, b.s - o.s)) return false;
    // (Nor into the way of one getting by the parked cars it is one of.)
    const P = o.m.pass, d = o.m.drive;
    if (P && d && P.lane === b.lane && o.s < b.s && P.b - d.start[d.k] > b.s - 2 * half) return false;
  }
  for (const P of T.into.get(b.lane) ?? []) for (const o of now.on.get(P) ?? []) if (!ok(o.m, b.s + T.G.lanes[P].len - o.s)) return false;
  return true;
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

/** A mover's way cut short where it is: it arrives there. */
export function stopHere(m: Mover): void {
  let k = 1;
  while (k < m.line.length - 1 && m.at[k] < m.s) k++;
  const p = along(m, m.s);
  m.line = [...m.line.slice(0, k), { x: p.x, y: p.y }];
  m.at = new Float32Array(m.line.length);
  for (let i = 1; i < m.line.length; i++) m.at[i] = m.at[i - 1] + Math.hypot(m.line[i].x - m.line[i - 1].x, m.line[i].y - m.line[i - 1].y);
  m.s = m.at[m.at.length - 1];
  m.bends = undefined;
  // Its way on, if it has one, from here.
  const d = m.drive;
  if (d) d.end = { lane: d.lanes[d.k], s: m.s - d.start[d.k] };
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
