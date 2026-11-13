/**
 * World v2 — river traffic: boats that come in where a river does, call at a
 * seaport on it, and go on down and out where it leaves.
 *
 * ONLY WHERE THERE IS A PORT. A river with a seaport on its bank sends boats
 * in over its inflow; a river without one stays empty, and so does every
 * lake. @see RiverMap, SEAPORTS
 *
 * EACH BOAT CALLS AT ONE PORT: the one on its river it would be turned round
 * soonest at, counting the boats already bound for each against how many
 * berths it has and how long a call there takes. It steers to that port, waits
 * off it in the order it arrived until a berth is free, ties up for the port's
 * time, and goes on to the exit, where it is taken off the map.
 *
 * THROUGHPUT IS THE PORTS'. A river sends boats in about as fast as its ports
 * can turn them round — a berth a call's length — so a bigger port, with more
 * berths and quicker calls, means more boats on the river, not longer queues.
 *
 * The rivers are re-mapped about once a second rather than every frame: the
 * water moves, and a bank that is wet one second and dry the next does not
 * need to be noticed the same frame.
 */
import type { ColumnField } from "../../fluid/columns";
import type { Grid } from "../grid";
import { structureDef } from "../structures/def";
import { addBoat, sampleWater, type Boat, type Fleet, type Steer } from "./fleet";
import { notable } from "../../game/machine";
import { inAiDistrictNow } from "../ai/district";
import {
  basinAt, berthsBeside, downhill, downstream, isExit, mapRiver, midstream, stepsFrom, tileDepthOf,
  type BerthSpot, type RiverMap,
} from "./river";
import { berthsAlong, channelTo } from "./quay";
import { SHIP_CLASSES, classOf } from "./classes";
import { fitOf, fitting, type Fitting } from "./fittings";
import { cargoOf, lookOf } from "./cargo";
import { ALONGSIDE } from "./classes";
import { createYards, landCargo, lands, yardSlows, type Yards } from "./yard";

/** Seconds between looks at the rivers. */
const REMAP_EVERY = 1;
/** Seconds a river must stay too low for a port's bigger ships before it is said. */
export const LOW_HOLD = 20;
/** The quickest and slowest a river sends boats, seconds apart, and before the first. */
const SPAWN_FASTEST = 3;
const SPAWN_SLOWEST = 20;
const FIRST_SPAWN = 1;
/** How much faster a port in the AI's district turns ships round, with Market Maker. */
export const MARKET_TURNROUND = 1.5;
/** Berths' worth of ships that may be waiting off a port, beyond what it has berths for. */
const WAITING = 1;
/** How far apart boats are sent ahead to a port, in the time its berths take to turn one round: under one, to leave no berth waiting. */
const AHEAD_APART = 0.7;
/** How fast a boat under way gets up a river, tiles a second: what her engine makes against the water's drag. */
const CRUISE = 0.85;
/** How hard a ship under way is held off the banks, against her course; and within how many steps of her berth she is let come in. */
const MIDSTREAM = 1.6;
const COME_IN = 2;
/** The sizes sent, in turn, where the river's ports take them: mostly boats. @see SHIP_CLASSES */
const MIX = [0, 1, 0, 2, 0, 1] as const;
/** Boats under way on a river: this many, and this many more for every berth on it. */
const MAX_BASE = 2;
const MAX_PER_BERTH = 2;
/** How hard a boat under way pushes itself, tiles a second squared. */
export const RIVER_MOTOR = 1;
/** A boat closer than this to where the next would appear holds it back, tiles. */
const SPAWN_CLEAR = 1.1;
/** How far in from the rim a boat is put down, tiles. */
const SPAWN_IN = 1.25;
/** Nearer the rim than this, tiles, on an exit, and a boat has left. */
const LEAVE_AT = 0.3;
/** Nearer its berth than this, tiles, and a boat ties up. */
const TIE_UP_AT = 0.45;
/** Nearer a port's berths than this, tiles, and a boat joins its queue. */
const WAIT_AT = 1.6;

/** How long a ship waits off a port for a berth before it gives up and goes, seconds. */
export const PATIENCE = 45;
/** How far off its berth the first ship waiting lies, in tiles up the way in, and how far apart the rest. */
const ANCHOR_FROM = 2;
const ANCHORAGE = 6;

/**
 * One berth at a port: how many of the ship classes can lie at it — deep
 * water to it and room to turn — and how far every tile of a class's channel
 * is from it, worked out when first asked. @see SHIP_CLASSES
 */
type Berth = BerthSpot & { reach: number; fit: Fitting; stepsOf: (cls: number) => Float32Array };

/** A seaport as the traffic sees it. */
export type Port = {
  id: number;
  river: number;
  /** Seconds a boat lies alongside. */
  dock: number;
  berths: Berth[];
  /** The biggest class it takes, by number: its size allows it and a berth of its can be reached. */
  takes: number;
  /** Whether it takes each class, by number: a berth fitted for it, that it can reach. */
  accepts: boolean[];
  /** Steps to the nearest of its berths a class can lie at, for a boat that has not been given one. */
  stepsOf: (cls: number) => Float32Array;
  /** Where ships wait for a berth, the first nearest: a line up the way in. */
  anchorage: { x: number; y: number }[];
};

/** Seconds a crane takes over one lift, by what it is. */
const LIFT_SECONDS = { gantry: 3.6, other: 4.6 };
/** How far through a lift the box leaves where it was picked up, and reaches where it is set down. @see seaport-renderer */
export const PICKED = 0.15;
export const SET_DOWN = 0.7;

/**
 * THE WORK OF A CALL, settled as a ship ties up: how many boxes she has room
 * for, how many cranes work her — one a berth she lies across — how many
 * lifts each has time for, how many of those unload her, and whether she is
 * then loaded again. At a cargo crane or a hardware berth every lift lands a
 * box, as far as she has them; at a trading quay or a gantry the first lifts
 * take boxes off and the last put as many back, so she sails as full as she
 * came. @see cargoOf
 */
export type Work = { cap: number; cranes: number; lifts: number; unload: number; reload: boolean };

export function workOf(look: string, fit: string, span: number, dockFor: number): Work | null {
  const cargo = cargoOf(look);
  if (!cargo || fit === "ferry" || fit === "pontoon" || fit === "slop") return null;
  const cap = cargo.slots.length, cranes = span;
  const lifts = Math.max(2, Math.round(dockFor / (fit === "gantry" ? LIFT_SECONDS.gantry : LIFT_SECONDS.other)));
  const reload = fit !== "crane" && fit !== "hardware";
  const unload = Math.max(1, Math.min(reload ? Math.floor(lifts / 2) : lifts, Math.floor(cap / cranes)));
  return { cap, cranes, lifts, unload, reload };
}

/** The lift each of a ship's cranes is on, `at` of the way through her call: which, how far through it, and what it is doing. */
export function liftAt(w: Work, at: number): { n: number; phase: number; mode: "unload" | "load" | "idle" } {
  const q = Math.min(w.lifts - 1e-6, Math.max(0, at) * w.lifts);
  const n = Math.floor(q);
  return { n, phase: q - n, mode: n < w.unload ? "unload" : w.reload && n >= w.lifts - w.unload ? "load" : "idle" };
}

/** How many boxes have been picked off her, and how many set back aboard, that far through. */
function moved(w: Work, at: number): { off: number; on: number; landed: number } {
  if (at >= 1) return { off: w.cranes * w.unload, on: w.reload ? w.cranes * w.unload : 0, landed: w.cranes * w.unload };
  const { n, phase, mode } = liftAt(w, at);
  const off = w.cranes * (Math.min(n, w.unload) + (mode === "unload" && phase >= PICKED ? 1 : 0));
  const landed = w.cranes * (Math.min(n, w.unload) + (mode === "unload" && phase >= SET_DOWN ? 1 : 0));
  const on = w.reload ? w.cranes * (Math.max(0, n - (w.lifts - w.unload)) + (mode === "load" && phase >= SET_DOWN ? 1 : 0)) : 0;
  return { off, on, landed };
}

/** How many boxes are aboard her that far through her call: one fewer as each lift picks one up, one more as each sets one down. */
export function aboard(w: Work, at: number): number {
  const m = moved(w, at);
  return w.cap - m.off + m.on;
}

/** How many of her boxes have been set down ashore by then. */
export const landedBy = (w: Work, at: number): number => moved(w, at).landed;

/**
 * The slot the first of her cranes is working on this lift — the box it
 * takes, or the place it fills; the next crane's is the one before it,
 * unloading, and after it, loading. −1 on a lift with nothing to do.
 */
export function slotAt(w: Work, n: number, mode: "unload" | "load" | "idle"): number {
  if (mode === "unload") return w.cap - 1 - n * w.cranes;
  if (mode === "load") return w.cap - w.cranes * w.unload + (n - (w.lifts - w.unload)) * w.cranes;
  return -1;
}

/** A call completed: at which port and berth, by what size of ship, come for what fitting. */
export type Call = { port: number; berth: number; cls: number; fit: string; vip?: boolean };

/**
 * The berths a class may be given at a port: the first of each run it would
 * lie across — water for it at every one, and one of them fitted for it;
 * come for a fitting, one of them fitted with that.
 */
export function berthsFor(p: Port, cls: number, fit?: string): number[] {
  const span = classOf(cls).span;
  const out: number[] = [], whole: number[] = [];
  for (let k = 0; k + span <= p.berths.length; k++) {
    let ok = true, fitted = 0;
    for (let j = 0; j < span; j++) {
      const b = p.berths[k + j];
      if (b.reach <= cls) ok = false;
      if (b.fit.classes.includes(cls) && (fit === undefined || b.fit.id === fit)) fitted++;
    }
    if (ok && fitted) out.push(k);
    if (ok && fitted === span) whole.push(k);
  }
  // COME FOR A FITTING, a ship lies where her whole length is of it. Across
  // one of another only where there is nowhere else and the fitting is for
  // nothing smaller — a lone gantry, which is no use otherwise. A ship come
  // "for the quay" beside two gantries lay across one of them, and kept the
  // boats off the quay while she waited for it.
  if (fit === undefined || span === 1) return out;
  if (whole.length) return whole;
  return Math.min(...fitting(fit).classes) >= cls ? out : [];
}

/** The fittings a class could come to a port for, in berth order, each once. */
export function fitsFor(p: Port, cls: number): string[] {
  const out: string[] = [];
  for (const b of p.berths) if (!out.includes(b.fit.id) && berthsFor(p, cls, b.fit.id).length) out.push(b.fit.id);
  return out;
}

export type Traffic = {
  rivers: RiverMap | null;
  /** Every seaport with a berth on a river, by structure id. */
  ports: Map<number, Port>;
  /**
   * The boats come for each port, in the order they got near it: a free berth
   * goes to the first of them without one. Nearest-first let a boat arriving
   * late slip in ahead of one that had been waiting off the port a whole call.
   */
  queues: Map<number, number[]>;
  sinceMap: number;
  /** Seconds to the next boat, per river. */
  untilSpawn: Map<number, number>;
  /** Boats sent so far, to vary where along the inflow the next one comes in. */
  sent: number;
  /**
   * Calls COMPLETED since the last look — a ship that lay its full time
   * alongside and cast off. What the port is paid for. @see world/boats/exports
   */
  calls: Call[];
  /** Ports a ship gave up waiting for since the last look, by structure id. */
  turned: number[];
  /**
   * A CONVOY IS IN: what the rivers send is the convoy — the biggest ships
   * the ports take, one after another, in one livery. The scene's to say.
   */
  convoy: boolean;
  /** The first call at a port by a bigger class of ship than it has had: for a horn and a notice. */
  firsts: { port: number; cls: number }[];
  /** Ports the river has fallen too low for the biggest ships they were taking, since the last look. */
  lows: number[];
  /** Investors on their way: the next boats in are their yachts, for a pontoon. @see callInvestor */
  investors: number;
  /** What each port was taking when last mapped. */
  took: Map<number, number>;
  /** How long each port's river has been too low for what it took, seconds. @see LOW_HOLD */
  falling: Map<number, number>;
  /** When each port was last sent a boat, by the count of boats sent: ports as good as each other take turns. @see pickPort */
  turn: Map<number, number>;
  /** Seconds the traffic has run; and when each port's berths of a fitting may next be sent a boat ahead of their being clear. @see pickPort */
  clock: number;
  ahead: Map<string, number>;
  /** What each port's cranes have landed and not yet sent out by road. @see yard */
  yards: Yards;
  /**
   * How much quicker than usual the rivers run: calls take this many times
   * less long, and boats are sent this many times as often. One, but for a
   * convoy with extra hands at the quays. @see world/events
   */
  rush: number;
};

/**
 * AN INVESTOR COMES BY WATER: the next boat a river with a pontoon sends is
 * their yacht, and its call says so. Whether there is a pontoon for them to
 * come to: with none, nobody is sent.
 */
export function callInvestor(t: Traffic): boolean {
  const any = [...t.ports.values()].some((p) => berthsFor(p, 0, "pontoon").length > 0);
  if (any) t.investors++;
  return any;
}

export const createTraffic = (): Traffic => ({
  rivers: null, ports: new Map(), queues: new Map(), sinceMap: Infinity, untilSpawn: new Map(), sent: 0, calls: [], turned: [], yards: createYards(), clock: 0, ahead: new Map(), rush: 1, convoy: false, firsts: [], lows: [], investors: 0, took: new Map(), falling: new Map(), turn: new Map(),
});

/** Every seaport's berths, on the rivers as they stand. */
export function portsOf(g: Grid, r: RiverMap): Map<number, Port> {
  const out = new Map<number, Port>();
  for (const s of g.structures.values()) {
    const port = structureDef(s.def)?.port;
    if (!port) continue;
    // Along its quay; one with no facing, built by hand in a test, along its best side.
    const spots = s.facing ? berthsAlong(r, s, s.facing, port.berths) : berthsBeside(r, s.x, s.y, s.w, s.h, port.berths);
    if (!spots.length) continue;
    const memo = <K, V>(make: (k: K) => V) => { const m = new Map<K, V>(); return (k: K) => { let v = m.get(k); if (v === undefined) { v = make(k); m.set(k, v); } return v; }; };
    const berths: Berth[] = spots.map((b, at) => {
      // What can lie here: the classes whose channel reaches it, with room to turn.
      let reach = 0;
      for (let k = 0; k < SHIP_CLASSES.length; k++) {
        if (r.reach[b.ty * r.w + b.tx] > k && basinAt(r, b.tx, b.ty, k) >= SHIP_CLASSES[k].basin) reach = k + 1; else break;
      }
      return { ...b, reach, fit: fitOf(s, at), stepsOf: memo((cls: number) => stepsFrom(r, [{ x: b.tx, y: b.ty }], cls)) };
    });
    const self: Port = {
      id: s.id,
      river: spots[0].river,
      // MARKET MAKER: a port in the AI's district turns ships round half as fast again. @see game/machine "market"
      dock: port.dockSeconds / (notable("market") && inAiDistrictNow(g, s.x, s.y) ? MARKET_TURNROUND : 1),
      berths,
      takes: 0,
      accepts: [],
      stepsOf: memo((cls: number) => stepsFrom(r, berthsFor(self, cls).flatMap((k) => berths.slice(k, k + classOf(cls).span)).map((b) => ({ x: b.tx, y: b.ty })), cls)),
      anchorage: [],
    };
    // THE BIGGEST IT TAKES: no bigger than its size, and a berth for it.
    for (let k = 0; k < SHIP_CLASSES.length; k++) {
      self.accepts[k] = SHIP_CLASSES[k].tier <= port.berths && berthsFor(self, k).length > 0;
      if (self.accepts[k]) self.takes = k;
    }
    // WHERE SHIPS WAIT: back up the way in from the middle of the quay.
    const mid = spots[(spots.length - 1) >> 1];
    const way = channelTo(r, { x: mid.tx, y: mid.ty }).reverse();
    // Two tiles apart: a ship at anchor is longer than a tile.
    // OUT IN THE STREAM, not along the bank the way in runs by: each place
    // moved up the river's own breadth to where the water is widest about it.
    const midOf = (at: { x: number; y: number }) => {
      let { x, y } = at;
      for (let n = 0; n < 3; n++) {
        let best = r.shore[y * r.w + x], bx = x, by = y;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= r.w || ny >= r.h || r.river[ny * r.w + nx] !== self.river) continue;
          if (r.shore[ny * r.w + nx] > best) { best = r.shore[ny * r.w + nx]; bx = nx; by = ny; }
        }
        if (bx === x && by === y) break;
        x = bx; y = by;
      }
      return { x, y };
    };
    const waits: { x: number; y: number }[] = [];
    for (const at of way.slice(ANCHOR_FROM).filter((_, k) => k % 2 === 0).map(midOf)) {
      if (!waits.some((q) => Math.hypot(q.x - at.x, q.y - at.y) < 1.5)) waits.push(at);
    }
    self.anchorage = waits.slice(0, ANCHORAGE);
    out.set(s.id, self);
  }
  return out;
}

/** How far a point is inside the map's rim, in tiles; nought on it. */
const insideBy = (r: RiverMap, x: number, y: number) =>
  Math.min(x + 0.5, y + 0.5, r.w - 0.5 - x, r.h - 0.5 - y);

/** Down a step count, and straight at the point once in its own tile. */
function toward(r: RiverMap, steps: Float32Array, b: Boat, at: { x: number; y: number }) {
  // ON THE TILE ITSELF, straight at the spot: down the count from there is
  // into the quay, and a ship — who lies a tile along from her berth's own
  // tile — pressed her bow to the wall just out of reach of tying up, for good.
  const tx = Math.round(b.x), ty = Math.round(b.y);
  const here = tx >= 0 && ty >= 0 && tx < r.w && ty < r.h ? steps[ty * r.w + tx] : Infinity;
  const way = here === 0 ? null : downhill(steps, r.w, r.h, b.x, b.y);
  if (way) return way;
  const dx = at.x - b.x, dy = at.y - b.y, d = Math.hypot(dx, dy);
  return d > 1e-6 ? { x: dx / d, y: dy / d } : null;
}

/** Where a ship lies at a berth: its middle, across the berths it spans, clear of the quay by its beam. */
function lieAt(p: Port, k: number, cls: number): { x: number; y: number; lie: number } {
  const c = classOf(cls), a = p.berths[k], z = p.berths[k + c.span - 1] ?? a;
  // Toward the quay from the berth's tile, a unit vector.
  const qx = a.x - a.tx, qy = a.y - a.ty, m = Math.hypot(qx, qy) || 1;
  const off = Math.max(0, c.beam / 2 - 0.2);
  return { x: (a.x + z.x) / 2 - (qx / m) * off, y: (a.y + z.y) / 2 - (qy / m) * off, lie: Math.atan2(qx / m, -qy / m) };
}

const nearestBerth = (p: Port, b: Boat) => {
  let best = p.berths[0], bestD = Infinity;
  for (const k of p.berths) {
    const d = Math.hypot(k.x - b.x, k.y - b.y);
    if (d < bestD) { best = k; bestD = d; }
  }
  return best;
};

/**
 * For a boat pushed out of its channel — against a bank, or into the
 * shallows — the way back into it: toward the nearest tile round it that has
 * a way out. Without it such a boat has no downstream, and sits there.
 */
function backToChannel(r: RiverMap, b: Boat, cls: number): { x: number; y: number } | null {
  const field = r.toExitOf[cls] ?? r.toExit;
  const tx = Math.round(b.x), ty = Math.round(b.y);
  let best: { x: number; y: number } | null = null, bestD = Infinity;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const nx = tx + dx, ny = ty + dy;
    if (nx < 0 || ny < 0 || nx >= r.w || ny >= r.h || !Number.isFinite(field[ny * r.w + nx])) continue;
    const d = Math.hypot(nx - b.x, ny - b.y);
    if (d < bestD) { best = { x: (nx - b.x) / (d || 1), y: (ny - b.y) / (d || 1) }; bestD = d; }
  }
  return best;
}

/**
 * The way a boat under way should go: to its berth, or to its port's nearest
 * berth before it has one, and once it has called, downstream to the exit.
 */
export const trafficSteer = (t: Traffic): Steer | undefined => {
  const r = t.rivers;
  if (!r) return undefined;
  return (b: Boat) => {
    const port = b.route?.length ? t.ports.get(b.route[0]) : undefined;
    const cls = b.cls ?? 0;
    // MIDSTREAM, not along the bank: a ship keeps water on both sides of her
    // all the way, and only comes in to the quay when she is nearly at her
    // berth. Followed alone, the steps to a berth — which is at the bank —
    // had every ship sliding along the wall of the river to get there.
    const off = (way: { x: number; y: number } | null, steps = Infinity) => {
      if (!way) return way;
      const mid = midstream(r, b.x, b.y), k = MIDSTREAM * Math.min(1, Math.max(0, (steps - COME_IN) / 2));
      const x = way.x + mid.x * k, y = way.y + mid.y * k, m = Math.hypot(x, y);
      return m > 1e-6 ? { x: x / m, y: y / m } : way;
    };
    const here = (f: Float32Array) => { const tx = Math.round(b.x), ty = Math.round(b.y); return tx >= 0 && ty >= 0 && tx < r.w && ty < r.h ? f[ty * r.w + tx] : Infinity; };
    if (!port) return off(downstream(r, b.x, b.y, cls) ?? backToChannel(r, b, cls));
    const berth = b.berth !== undefined ? port.berths[b.berth] : undefined;
    if (berth) return off(toward(r, berth.stepsOf(cls), b, lieAt(port, b.berth!, cls)), here(berth.stepsOf(cls)));
    return off(toward(r, port.stepsOf(cls), b, nearestBerth(port, b)), here(port.stepsOf(cls)));
  };
};

/** Seconds a tug takes to swing a ship end for end; how far off her berth she is held at the middle of it, in her own lengths; the class that is turned. */
export const SWING_SECONDS = 9;
const SWING_OUT = 0.5;
export const TURNED_CLASS = 2;

/**
 * WHERE A SHIP IS IN HER CALL, with the swings at either end of it taken out:
 * how far through the work of it, nought to one; and how far round she has
 * been turned, nought as she came, one head to the stream, two as she came
 * again and ready to go. A boat nobody turns is at one throughout.
 */
export function swingOf(b: Pick<Boat, "dockLeft" | "dockFor" | "swing">): { work: number; turn: number } {
  const left = b.dockLeft ?? 0, dock = b.dockFor ?? 0, secs = b.swing?.secs ?? 0;
  if (!(dock > 0)) return { work: 0, turn: 1 };
  const gone = dock + 2 * secs - left;
  const ease = (u: number) => { const k = Math.max(0, Math.min(1, u)); return k * k * (3 - 2 * k); };
  const turn = secs > 0 ? ease(gone / secs) + ease((gone - secs - dock) / secs) : 1;
  return { work: Math.max(0, Math.min(1, (gone - secs) / dock)), turn };
}

/** Let a boat go from the port it is at, or was bound for. */
function castOff(t: Traffic, b: Boat): void {
  const port = b.route?.shift();
  b.moor = null;
  b.dockLeft = 0;
  b.berth = undefined;
  b.lie = undefined;
  b.swing = undefined;
  b.waited = 0;
  if (port !== undefined) t.queues.set(port, (t.queues.get(port) ?? []).filter((id) => id !== b.id));
}

/**
 * The calls being made: join a port's queue on getting near it, take a free
 * berth in turn, tie up there, and cast off when the call is over.
 */
function stepCalls(t: Traffic, f: Fleet, dt: number, sailed: { port: number; cls: number }[] = []): void {
  // Boats that have gone, or are bound somewhere else now, leave a queue.
  const live = new Map(f.boats.map((b) => [b.id, b]));
  for (const [port, q] of t.queues) {
    t.queues.set(port, q.filter((id) => live.get(id)?.route?.[0] === port));
  }
  for (const b of f.boats) {
    if (!b.route?.length) continue;
    const port = t.ports.get(b.route[0]);
    // A port that has gone, or lost its river, is not called at.
    if (!port || (b.berth !== undefined && !port.berths[b.berth])) { castOff(t, b); continue; }
    const cls = b.cls ?? 0;
    if ((b.dockLeft ?? 0) > 0) {
      b.dockLeft! -= dt;
      if (b.dockLeft! <= 0) {
        t.calls.push({ port: port.id, berth: b.berth ?? 0, cls, fit: b.fit ?? "trade", ...(b.vip ? { vip: true } : {}) });
        sailed.push({ port: port.id, cls });
        // LANDED, into the yard. @see yard
        castOff(t, b);
      } else if (b.dockFor) {
        // WORKED BY THE CRANES as the call goes, a box a lift: off her, and
        // for some back on. What a landing berth takes off goes into the yard
        // as each box is set down there. @see workOf, yard
        const turned = swingOf(b), at = turned.work, fit = b.fit ?? "trade";
        // TURNED BY THE TUG: round about her middle, held off her berth while she swings so her ends clear the quay.
        if (b.swing) {
          b.lie = b.swing.lie + Math.PI * turned.turn;
          const off = Math.sin(Math.PI * (turned.turn % 1)) * SWING_OUT * classOf(cls).length;
          b.moor = { x: b.swing.at.x + b.swing.out.x * off, y: b.swing.at.y + b.swing.out.y * off };
        }
        const w = b.work;
        if (w) {
          b.boxes = aboard(w, at);
          const landed = landedBy(w, at);
          if (lands(fit) && landed > (b.landed ?? 0)) {
            landCargo(t.yards, port.id, ((landed - (b.landed ?? 0)) * classOf(cls).dock * classOf(cls).span) / (w.cranes * w.unload), port.berths.length);
            b.landed = landed;
          }
        }
      }
      continue;
    }
    if (b.berth === undefined) {
      const near = nearestBerth(port, b);
      const q = t.queues.get(port.id) ?? [];
      // Not near it yet, and not already waiting off it at anchor.
      // Nor come to where ships wait for it, which is on its way in.
      const hold = port.anchorage[0];
      if (!q.includes(b.id) && Math.hypot(near.x - b.x, near.y - b.y) >= WAIT_AT * Math.max(1, classOf(cls).length)
        && !(hold && Math.hypot(hold.x - b.x, hold.y - b.y) < WAIT_AT)) { b.moor = null; continue; }
      // NEAR IT: in the queue, and a berth when one is free and it is next.
      if (!q.includes(b.id)) q.push(b.id);
      t.queues.set(port.id, q);
      const held = new Set<number>();
      for (const o of f.boats) {
        if (o.route?.[0] !== port.id || o.berth === undefined) continue;
        for (let j = 0; j < classOf(o.cls).span; j++) held.add(o.berth + j);
      }
      // IN THE ORDER THEY CAME: a ship waiting for two berths side by side is
      // not passed by every boat behind it, or it would never get them.
      // And only those AHEAD OF HER FOR THE SAME BERTHS: a boat waiting for the
      // one quay held every ship for the gantries beside it out in the stream.
      const waiting = q.filter((id) => live.get(id)?.berth === undefined);
      const wanted = new Set<number>();
      for (const id of waiting) {
        if (id === b.id) break;
        const o = live.get(id)!;
        for (const k of berthsOf(port, o.cls ?? 0, o.fit)) wanted.add(k);
      }
      const free = berthsFor(port, cls, b.fit).filter((k) => {
        for (let j = 0; j < classOf(cls).span; j++) if (held.has(k + j) || wanted.has(k + j)) return false;
        return true;
      });
      if (!free.length) {
        // AT ANCHOR, in the line, and not for ever. @see PATIENCE
        b.waited = (b.waited ?? 0) + dt;
        // As long as the longest call ahead of her might take, and the usual patience over.
        if (b.waited > PATIENCE + callSeconds(port, port.takes)) { t.turned.push(port.id); castOff(t, b); continue; }
        // IN THE LINE, in its turn, lying along the channel with its bow to the port.
        const place = waiting.indexOf(b.id), spot = port.anchorage[place];
        b.moor = spot ?? b.moor ?? { x: b.x, y: b.y };
        const ahead = place > 0 ? port.anchorage[place - 1] : port.berths[(port.berths.length - 1) >> 1];
        if (spot && ahead) b.lie = Math.atan2(ahead.y - spot.y, ahead.x - spot.x);
        continue;
      }
      // The berths all of her own fitting first: a ship for the gantries does not lie across the quay beside them.
      const others = (k: number) => { let n = 0; for (let j = 0; j < classOf(cls).span; j++) if (b.fit && port.berths[k + j].fit.id !== b.fit) n++; return n; };
      free.sort((m, n) => others(m) - others(n) ||
        Math.hypot(port.berths[m].x - b.x, port.berths[m].y - b.y)
        - Math.hypot(port.berths[n].x - b.x, port.berths[n].y - b.y));
      b.berth = free[0];
      b.moor = null;
      b.lie = undefined;
    }
    const at = lieAt(port, b.berth, cls);
    if (Math.hypot(at.x - b.x, at.y - b.y) < TIE_UP_AT * Math.max(1, classOf(cls).length)) {
      b.moor = { x: at.x, y: at.y };
      // Along the quay, whichever way round is nearer how it came.
      b.lie = Math.cos(at.lie - b.heading) >= 0 ? at.lie : at.lie + Math.PI;
      // A FULL YARD slows the cranes that fill it. @see yardSlows
      const slow = lands(b.fit ?? "trade") ? yardSlows(t.yards, port.id, port.berths.length) : 1;
      b.dockFor = (port.dock * classOf(cls).dock * slow) / t.rush;
      // A SHIP IS TURNED where the port has a tug: head to the stream to be worked, and back to go. @see stepTugs
      const berthAt = port.berths[b.berth];
      const qx = berthAt.tx - berthAt.x, qy = berthAt.ty - berthAt.y, qm = Math.hypot(qx, qy) || 1;
      b.swing = cls >= TURNED_CLASS && f.boats.some((o) => o.tug === port.id)
        ? { lie: b.lie, secs: SWING_SECONDS, at: { x: at.x, y: at.y }, out: { x: qx / qm, y: qy / qm } } : undefined;
      b.dockLeft = b.dockFor + 2 * (b.swing?.secs ?? 0);
      b.work = workOf(lookOf(cls, b.fit, !!b.ai, b.id % 2 === 1), b.fit ?? "trade", classOf(cls).span, b.dockFor) ?? undefined;
      b.landed = 0;
    }
  }
  // CROSSED ON THE WAY IN: two given berths in the same moment, each now
  // nearer the other's, change berths — where each may lie at the other's.
  // Left to it they met at the quay, each in the other's way, and stayed
  // there: neither tied up, and the port took nothing more at those berths.
  const coming = f.boats.filter((b) => b.berth !== undefined && !((b.dockLeft ?? 0) > 0) && b.route?.length && classOf(b.cls).span === 1);
  for (let i = 0; i < coming.length; i++) {
    for (let j = i + 1; j < coming.length; j++) {
      const a = coming[i], o = coming[j], port = t.ports.get(a.route![0]);
      if (!port || o.route![0] !== port.id || a.berth === o.berth) continue;
      if (!berthsFor(port, a.cls ?? 0, a.fit).includes(o.berth!) || !berthsFor(port, o.cls ?? 0, o.fit).includes(a.berth!)) continue;
      const pa = port.berths[a.berth!], po = port.berths[o.berth!];
      const now = Math.hypot(pa.x - a.x, pa.y - a.y) + Math.hypot(po.x - o.x, po.y - o.y);
      const swapped = Math.hypot(po.x - a.x, po.y - a.y) + Math.hypot(pa.x - o.x, pa.y - o.y);
      if (swapped + 0.5 < now) { const k = a.berth; a.berth = o.berth; o.berth = k; }
    }
  }
}

/** How near her berth a ship is met by the port's tug, tiles. */
const TUG_MEETS = 4;

/**
 * THE PORTS' TUGS. A port that takes ships keeps a tug, lying off the end of
 * its quay. It goes out to meet a ship that has been given a berth, lays
 * itself against her bow, and pushes it round as she swings — head to the
 * stream when her call begins, and back the way she came when it ends — and
 * goes home between. It is held where it should be as a moored boat is, by a
 * line that moves: so it rides the water, bobs and leaves a wake like any
 * other, and steers nowhere of its own. A port that takes no ships, or has
 * gone, has none. @see Boat.tug, swingOf
 */
function stepTugs(t: Traffic, f: Fleet, c: ColumnField): void {
  for (let k = f.boats.length - 1; k >= 0; k--) {
    const b = f.boats[k];
    if (b.tug !== undefined && !t.ports.get(b.tug)?.accepts[TURNED_CLASS]) f.boats.splice(k, 1);
  }
  for (const p of t.ports.values()) {
    if (!p.accepts[TURNED_CLASS] || !p.berths.length) continue;
    // HOME: off the end of the quay, a boat's length past its last berth — or its first, where that end has no water.
    const a = p.berths[0], z = p.berths[p.berths.length - 1];
    const along = p.berths.length > 1 ? { x: z.x - a.x, y: z.y - a.y } : { x: -(a.ty - a.y), y: a.tx - a.x };
    const am = Math.hypot(along.x, along.y) || 1, ux = along.x / am, uy = along.y / am;
    const homes = [{ x: z.x + ux * 1.1, y: z.y + uy * 1.1 }, { x: a.x - ux * 1.1, y: a.y - uy * 1.1 }];
    let tug = f.boats.find((b) => b.tug === p.id);
    if (!tug) {
      const home = homes.find((h) => sampleWater(c, h.x, h.y).depth > classOf(0).draft);
      const made = home ? addBoat(f, c, home.x, home.y, 0) : null;
      if (!made) continue;
      made.tug = p.id; made.fit = "tug"; made.heading = Math.atan2(uy, ux);
      made.moor = { x: made.x, y: made.y };
      tug = made;
    }
    const home = homes.find((h) => sampleWater(c, h.x, h.y).depth > classOf(0).draft) ?? { x: tug.x, y: tug.y };
    // THE SHIP IT IS WORKING: one being swung; else one given a berth here and near it.
    const mine = f.boats.filter((b) => b.route?.[0] === p.id && (b.cls ?? 0) >= TURNED_CLASS && b.berth !== undefined);
    const swinging = mine.find((b) => b.swing && (b.dockLeft ?? 0) > 0 && swingOf(b).turn % 1 !== 0);
    const coming = mine.find((b) => !(b.dockLeft! > 0) && Math.hypot(b.x - p.berths[b.berth!].x, b.y - p.berths[b.berth!].y) < TUG_MEETS);
    const ship = swinging ?? coming;
    if (!ship) { tug.moor = home; tug.lie = Math.atan2(uy, ux); continue; }
    // AGAINST HER BOW, on the side she is being pushed from: she turns the way her bow is shoved.
    const cls = classOf(ship.cls), ch = Math.cos(ship.heading), sh = Math.sin(ship.heading);
    const side = cls.beam / 2 + classOf(0).beam * 0.62;
    tug.moor = { x: ship.x + ch * cls.length * 0.36 + sh * side, y: ship.y + sh * cls.length * 0.36 - ch * side };
    tug.lie = ship.heading + Math.PI / 2;
  }
}

/** Seconds of a berth a call of this class takes at a port: alongside, turned at either end if she is, and in and out. */
export const callSeconds = (p: Pick<Port, "dock">, cls: number) =>
  p.dock * classOf(cls).dock + ALONGSIDE + (cls >= TURNED_CLASS ? 2 * SWING_SECONDS : 0);

/**
 * BERTHS' WORTH OF SHIPS STILL COMING UP THE RIVER that a port's berths will
 * be clear for by the time they are there: so many calls as fit in the time
 * it takes to come up from the inflow. Without it a port far up its river
 * was sent a boat only when the last had got all the way to it, and one
 * sixty tiles up turned a third of the boats of one by the inflow.
 */
function onTheWay(p: Port, fit: string | undefined, room: number, from: number | undefined): number {
  // By the calls the berths really get: the sizes the fitting takes and the port can, as often as each is sent. @see MIX
  const takes = fit === undefined ? [0] : fitting(fit).classes.filter((k) => p.accepts[k]);
  let secs = 0, n = 0;
  for (const k of MIX) if (takes.includes(k)) { secs += callSeconds(p, k) * classOf(k).span; n++; }
  if (!n) return 0;
  const steps = from === undefined ? 0 : p.stepsOf(takes[0])[from];
  return Number.isFinite(steps) ? Math.floor((room * (steps / CRUISE)) / (secs / n)) : 0;
}

/**
 * The port on a river a new boat would be turned round soonest at, and the
 * fitting there it should come for: the boats already bound for each, plus
 * this one, a berth's worth at a time. `from` is the tile it would set out from.
 */
function pickPort(t: Traffic, f: Fleet, river: number, cls = 0, from?: number): { port: Port; fit: string } | null {
  let best: { port: Port; fit: string } | null = null, bestWait = Infinity;
  const span = classOf(cls).span;
  for (const p of t.ports.values()) {
    if (p.river !== river || !p.accepts[cls]) continue;
    // BY THE BERTHS OF ONE FITTING, not all the port has: a boat counted a big
    // port's gantry berths as room for it, and queued for its one crane
    // while a small port up the river stood empty — and a boat come for a
    // crane waited for it with a trading quay standing free. @see berthsFor
    const fits = fitsFor(p, cls);
    for (let n = 0; n < fits.length; n++) {
      const fit = fits[(n + t.sent) % fits.length];
      const room = berthsOf(p, cls, fit);
      if (!room.size) continue;
      // NO MORE THAN THOSE BERTHS HOLD, ONE OF HER SIZE TO WAIT, AND WHAT IS ON
      // ITS WAY: counted in berths, so a ship bound for it is two. A river sent ships
      // by the clock alone had them stacked up off every quay. @see WAITING
      let bound = 0;
      for (const b of f.boats) {
        if (b.route?.[0] !== p.id) continue;
        for (const k of berthsOf(p, b.cls ?? 0, b.fit)) if (room.has(k)) { bound += classOf(b.cls).span; break; }
      }
      // What is on its way is the same whoever asks: counted by her own long
      // call a ship was refused where a boat was let in, and never got her turn.
      if (bound + span > room.size + WAITING * span + onTheWay(p, fit, room.size, from)) continue;
      // SENT AHEAD, A CALL APART: beyond what the berths hold and one to wait,
      // the next is not sent till the last has had its time — or the first
      // few up a long river all came to the port together, and lay off it in a row.
      if (bound + span > room.size + WAITING * span && t.clock < (t.ahead.get(`${p.id}:${fit}`) ?? 0)) continue;
      const wait = (Math.ceil((bound + span) / room.size) * callSeconds(p, cls)) / room.size;
      // AS GOOD AS ANOTHER, the one longer without a boat: the first built of two alike took every ship.
      const turn = t.turn.get(p.id) ?? -1;
      if (wait < bestWait || (wait === bestWait && best && turn < (t.turn.get(best.port.id) ?? -1))) { best = { port: p, fit }; bestWait = wait; }
    }
  }
  return best;
}

/** The berths of a port a class can lie on, each once. @see berthsFor */
function berthsOf(p: Port, cls: number, fit?: string): Set<number> {
  const out = new Set<number>(), span = classOf(cls).span;
  for (const k of berthsFor(p, cls, fit)) for (let j = 0; j < span; j++) out.add(k + j);
  return out;
}

/** One frame of the rivers' traffic: re-map, make the calls, take off the boats that left, send new ones. */
export function stepTraffic(t: Traffic, f: Fleet, g: Grid, c: ColumnField, dt: number): void {
  t.clock += dt * t.rush;
  t.sinceMap += dt;
  if (!t.rivers || t.sinceMap >= REMAP_EVERY || t.rivers.w !== g.w || t.rivers.h !== g.h) {
    t.rivers = mapRiver(g, tileDepthOf(c));
    t.ports = portsOf(g, t.rivers);
    const since = Number.isFinite(t.sinceMap) ? t.sinceMap : 0;
    t.sinceMap = 0;
    // THE RIVER FALLEN: a port that took bigger ships a moment ago, and cannot now.
    // Said once it has STAYED fallen: a river a hair over a ship's depth dips
    // under it with every wake, and said so every few seconds. @see LOW_HOLD
    for (const p of t.ports.values()) {
      const was = t.took.get(p.id);
      if (was === undefined || p.takes >= was) { t.took.set(p.id, p.takes); t.falling.delete(p.id); continue; }
      const held = (t.falling.get(p.id) ?? 0) + since;
      if (held < LOW_HOLD) { t.falling.set(p.id, held); continue; }
      t.lows.push(p.id);
      t.took.set(p.id, p.takes);
      t.falling.delete(p.id);
    }
  }
  const r = t.rivers;
  const sailed: { port: number; cls: number }[] = [];
  stepCalls(t, f, dt, sailed);
  // THE FIRST of a bigger class to call at a port, remembered on the port. @see Structure.biggest
  for (const c of sailed) {
    const ps = g.structures.get(c.port);
    if (!ps || c.cls <= (ps.biggest ?? 0)) continue;
    ps.biggest = c.cls;
    t.firsts.push(c);
  }

  stepTugs(t, f, c);
  // LEAVING: a boat at its river's way out, against the rim, is gone.
  for (let k = f.boats.length - 1; k >= 0; k--) {
    const b = f.boats[k];
    if (isExit(r, b.x, b.y) && insideBy(r, b.x, b.y) < LEAVE_AT) f.boats.splice(k, 1);
  }

  // ARRIVING: on each river with a port, as fast as its ports turn boats round.
  const rivers = new Map<number, { berths: number; perSecond: number }>();
  for (const p of t.ports.values()) {
    const v = rivers.get(p.river) ?? { berths: 0, perSecond: 0 };
    v.berths += p.berths.length;
    v.perSecond += p.berths.length / p.dock;
    rivers.set(p.river, v);
  }
  for (const [river, cap] of rivers) {
    const left = (t.untilSpawn.get(river) ?? FIRST_SPAWN) - dt;
    t.untilSpawn.set(river, left);
    if (left > 0) continue;
    // By the berth-time of what is sent: a ship takes six boats' worth, her
    // swings besides, and getting alongside and away takes berth-time too. @see MIX, callSeconds
    let most = 0;
    for (const p of t.ports.values()) if (p.river === river) most = Math.max(most, p.takes);
    const dock = cap.berths / cap.perSecond;
    let each = 0;
    for (const k of MIX) { const cls = Math.min(most, k); each += (callSeconds({ dock }, cls) * classOf(cls).span) / MIX.length; }
    t.untilSpawn.set(river, Math.min(SPAWN_SLOWEST, Math.max(SPAWN_FASTEST, each / cap.berths)) / t.rush);
    const sources = r.sources.filter((s) => s.river === river);
    if (!sources.length) continue;
    // Near the middle of the inflow, a little to either side boat by boat.
    const mid = (sources.length - 1) / 2;
    const off = ((t.sent % 3) - 1) * Math.min(1, mid / 2);
    const at = sources[Math.round(mid + off)];
    // NO MORE COMING than the river's berths are for: boats on their way in or alongside, not those going home.
    let coming = MAX_BASE + MAX_PER_BERTH * cap.berths;
    for (const p of t.ports.values()) if (p.river === river) coming += onTheWay(p, undefined, p.berths.length, at.y * r.w + at.x);
    if (f.boats.filter((b) => b.route?.length && t.ports.get(b.route[0])?.river === river).length >= coming) continue;
    // IN FROM THE RIM, not on it: the surface over the rim's own columns leans
    // out of the map, and a boat put down there was pushed back over the edge
    // harder than its engine could take it forward.
    const s = {
      x: at.x + (at.x === 0 ? SPAWN_IN : at.x === g.w - 1 ? -SPAWN_IN : 0),
      y: at.y + (at.y === 0 ? SPAWN_IN : at.y === g.h - 1 ? -SPAWN_IN : 0),
    };
    if (f.boats.some((b) => Math.hypot(b.x - s.x, b.y - s.y) < SPAWN_CLEAR)) continue;
    // WHAT COMES: boats, and as the river's ports can take them, coasters
    // and ships among them — as big as there is a port and a channel for.
    // The size wanted; with no berth for one just now, another, the bigger
    // first: a gantry stood idle five turns in six while boats queued for
    // the one quay beside it, and the quay stood idle while a ship was
    // wanted and the gantries were full. A smaller never takes a ship's
    // turn at the same berths: she is let wait off them when they could
    // not. @see pickPort
    const want = t.convoy ? most : Math.min(most, MIX[t.sent % MIX.length]);
    const from = at.y * r.w + at.x;
    let port: Port | null = null, cls = 0, fit = "trade";
    const sizes = [want, ...Array.from({ length: SHIP_CLASSES.length - want - 1 }, (_, k) => want + 1 + k), ...Array.from({ length: want }, (_, k) => want - 1 - k)];
    for (const k of sizes) {
      if (r.reach[from] <= k) continue;
      const pick = pickPort(t, f, river, k, from);
      if (pick) { port = pick.port; fit = pick.fit; cls = k; break; }
    }
    // AN INVESTOR IS DUE: the next boat on a river with a pontoon is their yacht, bound for it. @see callInvestor
    let vip = false;
    if (t.investors > 0) {
      const pontoon = [...t.ports.values()].find((p) => p.river === river && berthsFor(p, 0, "pontoon").length > 0);
      if (pontoon) { port = pontoon; cls = 0; vip = true; }
    }
    // Nowhere for one to go just now: ask again in a moment, not a whole interval on.
    if (!port) { t.untilSpawn.set(river, 1); continue; }
    const boat = addBoat(f, c, s.x, s.y, cls);
    if (!boat) continue;
    // COME FOR ONE OF ITS BERTHS, each kind in turn. @see fittings, pickPort
    boat.fit = fit;
    if (!vip) t.ahead.set(`${port.id}:${fit}`, t.clock + (AHEAD_APART * callSeconds(port, cls) * classOf(cls).span) / Math.max(1, berthsOf(port, cls, fit).size));
    if (vip) { boat.fit = "pontoon"; boat.vip = true; t.investors--; }
    boat.boxes = cargoOf(lookOf(cls, boat.fit, !!boat.ai, boat.id % 2 === 1))?.slots.length;
    if (t.convoy) boat.convoy = true;
    t.sent++;
    boat.motor = RIVER_MOTOR;
    boat.route = [port.id];
    t.turn.set(port.id, t.sent);
    // Every other one bound for a Market Maker's port its own freighter.
    const ps = g.structures.get(port.id);
    if (ps && notable("market") && inAiDistrictNow(g, ps.x, ps.y)) boat.ai = t.sent % 2 === 0;
    const way = downstream(r, s.x, s.y, boat.cls ?? 0);
    if (way) boat.heading = Math.atan2(way.y, way.x);
  }
}

/**
 * A ship being worked at a berth: which she is and where she lies and heads;
 * her look and how many boxes are aboard; and, of the crane at this berth,
 * which lift it is on, how far through it, whether it is loading, whether it
 * has anything to do, and which of her slots it is working. @see slotAt
 */
export type Worked = {
  id: number; x: number; y: number; z: number; heading: number; cls: number; look: string; boxes: number;
  lift: number; phase: number; loading: boolean; cargo: boolean; slot: number;
};

/**
 * How each berth of a port stands, in order along its quay: WORKING with a
 * ship alongside, and which ship; BLOCKED with no water for a berth there, or
 * — a berth that lands things — its yard full; else FREE. @see port-life
 */
export function portWork(t: Traffic, f: Fleet, port: number, berths: number, fits: readonly string[]): { state: "free" | "working" | "blocked"; ship?: Worked }[] {
  const p = t.ports.get(port);
  const out: { state: "free" | "working" | "blocked"; ship?: Worked }[] = Array.from({ length: berths }, (_, k) => ({
    state: !p || k >= p.berths.length ? "blocked" : lands(fits[k] ?? "trade") && (t.yards.held.get(port) ?? 0) >= p.berths.length * 4 - 1e-6 ? "blocked" : "free",
  }));
  for (const b of f.boats) {
    if (b.route?.[0] !== port || b.berth === undefined || (b.dockLeft ?? 0) <= 0 || !b.dockFor) continue;
    const at = swingOf(b).work, fit = b.fit ?? "trade";
    const look = lookOf(b.cls ?? 0, fit, !!b.ai, b.id % 2 === 1);
    const lift = b.work ? liftAt(b.work, at) : null;
    const first = lift && b.work ? slotAt(b.work, lift.n, lift.mode) : -1;
    for (let j = 0; j < classOf(b.cls).span; j++) {
      if (!out[b.berth + j]) continue;
      // Each crane its own box: the one before the first's, unloading; the one after, loading.
      const slot = first < 0 ? -1 : lift!.mode === "load" ? first + j : first - j;
      out[b.berth + j] = {
        state: "working",
        ship: {
          id: b.id, x: b.x, y: b.y, z: b.z, heading: b.heading, cls: b.cls ?? 0, look, boxes: b.boxes ?? 0,
          lift: lift?.n ?? 0, phase: lift?.phase ?? 0, loading: lift?.mode === "load", cargo: slot >= 0, slot,
        },
      };
    }
  }
  return out;
}
