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
import { addBoat, type Boat, type Fleet, type Steer } from "./fleet";
import { notable } from "../../game/machine";
import { inAiDistrictNow } from "../ai/district";
import {
  basinAt, berthsBeside, downhill, downstream, isExit, mapRiver, riverAt, stepsFrom, tileDepthOf,
  type BerthSpot, type RiverMap,
} from "./river";
import { berthsAlong, channelTo } from "./quay";
import { SHIP_CLASSES, classOf } from "./classes";
import { fitOf, type Fitting } from "./fittings";

/** Seconds between looks at the rivers. */
const REMAP_EVERY = 1;
/** The quickest and slowest a river sends boats, seconds apart, and before the first. */
const SPAWN_FASTEST = 3;
const SPAWN_SLOWEST = 20;
const FIRST_SPAWN = 1;
/** How much faster a port in the AI's district turns ships round, with Market Maker. */
export const MARKET_TURNROUND = 1.5;
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

/** A call completed: at which port and berth, by what size of ship, come for what fitting. */
export type Call = { port: number; berth: number; cls: number; fit: string };

/**
 * The berths a class may be given at a port: the first of each run it would
 * lie across — water for it at every one, and one of them fitted for it;
 * come for a fitting, one of them fitted with that.
 */
export function berthsFor(p: Port, cls: number, fit?: string): number[] {
  const span = classOf(cls).span;
  const out: number[] = [];
  for (let k = 0; k + span <= p.berths.length; k++) {
    let ok = true, fitted = false;
    for (let j = 0; j < span; j++) {
      const b = p.berths[k + j];
      if (b.reach <= cls) ok = false;
      if (b.fit.classes.includes(cls) && (fit === undefined || b.fit.id === fit)) fitted = true;
    }
    if (ok && fitted) out.push(k);
  }
  return out;
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
   * How much quicker than usual the rivers run: calls take this many times
   * less long, and boats are sent this many times as often. One, but for a
   * convoy with extra hands at the quays. @see world/events
   */
  rush: number;
};

export const createTraffic = (): Traffic => ({
  rivers: null, ports: new Map(), queues: new Map(), sinceMap: Infinity, untilSpawn: new Map(), sent: 0, calls: [], turned: [], rush: 1,
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
    self.anchorage = way.slice(ANCHOR_FROM, ANCHOR_FROM + ANCHORAGE);
    out.set(s.id, self);
  }
  return out;
}

/** How far a point is inside the map's rim, in tiles; nought on it. */
const insideBy = (r: RiverMap, x: number, y: number) =>
  Math.min(x + 0.5, y + 0.5, r.w - 0.5 - x, r.h - 0.5 - y);

/** Down a step count, and straight at the point once in its own tile. */
function toward(r: RiverMap, steps: Float32Array, b: Boat, at: { x: number; y: number }) {
  const way = downhill(steps, r.w, r.h, b.x, b.y);
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

/** The river a point is on, or beside: a boat hard against a bank is still on its river. */
function riverNear(r: RiverMap, x: number, y: number): number {
  const tx = Math.round(x), ty = Math.round(y);
  return riverAt(r, tx, ty) || riverAt(r, tx + 1, ty) || riverAt(r, tx - 1, ty) || riverAt(r, tx, ty + 1) || riverAt(r, tx, ty - 1);
}

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
    if (!port) return downstream(r, b.x, b.y, cls) ?? backToChannel(r, b, cls);
    const berth = b.berth !== undefined ? port.berths[b.berth] : undefined;
    if (berth) return toward(r, berth.stepsOf(cls), b, lieAt(port, b.berth!, cls));
    return toward(r, port.stepsOf(cls), b, nearestBerth(port, b));
  };
};

/** Let a boat go from the port it is at, or was bound for. */
function castOff(t: Traffic, b: Boat): void {
  const port = b.route?.shift();
  b.moor = null;
  b.dockLeft = 0;
  b.berth = undefined;
  b.lie = undefined;
  b.waited = 0;
  if (port !== undefined) t.queues.set(port, (t.queues.get(port) ?? []).filter((id) => id !== b.id));
}

/**
 * The calls being made: join a port's queue on getting near it, take a free
 * berth in turn, tie up there, and cast off when the call is over.
 */
function stepCalls(t: Traffic, f: Fleet, dt: number): void {
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
      if (b.dockLeft! <= 0) { t.calls.push({ port: port.id, berth: b.berth ?? 0, cls, fit: b.fit ?? "trade" }); castOff(t, b); }
      continue;
    }
    if (b.berth === undefined) {
      const near = nearestBerth(port, b);
      const q = t.queues.get(port.id) ?? [];
      // Not near it yet, and not already waiting off it at anchor.
      if (!q.includes(b.id) && Math.hypot(near.x - b.x, near.y - b.y) >= WAIT_AT * Math.max(1, classOf(cls).length)) { b.moor = null; continue; }
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
      const waiting = q.filter((id) => live.get(id)?.berth === undefined);
      const next = waiting[0];
      const free = berthsFor(port, cls, b.fit).filter((k) => {
        for (let j = 0; j < classOf(cls).span; j++) if (held.has(k + j)) return false;
        return true;
      });
      if (next !== b.id || !free.length) {
        // AT ANCHOR, in the line, and not for ever. @see PATIENCE
        b.waited = (b.waited ?? 0) + dt;
        if (b.waited > PATIENCE) { t.turned.push(port.id); castOff(t, b); continue; }
        b.moor = port.anchorage[waiting.indexOf(b.id)] ?? b.moor ?? { x: b.x, y: b.y };
        continue;
      }
      free.sort((m, n) =>
        Math.hypot(port.berths[m].x - b.x, port.berths[m].y - b.y)
        - Math.hypot(port.berths[n].x - b.x, port.berths[n].y - b.y));
      b.berth = free[0];
      b.moor = null;
    }
    const at = lieAt(port, b.berth, cls);
    if (Math.hypot(at.x - b.x, at.y - b.y) < TIE_UP_AT * Math.max(1, classOf(cls).length)) {
      b.moor = { x: at.x, y: at.y };
      // Along the quay, whichever way round is nearer how it came.
      b.lie = Math.cos(at.lie - b.heading) >= 0 ? at.lie : at.lie + Math.PI;
      b.dockLeft = (port.dock * classOf(cls).dock) / t.rush;
    }
  }
}

/**
 * The port on a river a new boat would be turned round soonest at: the boats
 * already bound for each, plus this one, a berth's worth at a time.
 */
function pickPort(t: Traffic, f: Fleet, river: number, cls = 0): Port | null {
  let best: Port | null = null, bestWait = Infinity;
  for (const p of t.ports.values()) {
    if (p.river !== river || !p.accepts[cls]) continue;
    const bound = f.boats.filter((b) => b.route?.[0] === p.id).length;
    const wait = Math.ceil((bound + 1) / p.berths.length) * p.dock;
    if (wait < bestWait) { best = p; bestWait = wait; }
  }
  return best;
}

/** One frame of the rivers' traffic: re-map, make the calls, take off the boats that left, send new ones. */
export function stepTraffic(t: Traffic, f: Fleet, g: Grid, c: ColumnField, dt: number): void {
  t.sinceMap += dt;
  if (!t.rivers || t.sinceMap >= REMAP_EVERY || t.rivers.w !== g.w || t.rivers.h !== g.h) {
    t.rivers = mapRiver(g, tileDepthOf(c));
    t.ports = portsOf(g, t.rivers);
    t.sinceMap = 0;
  }
  const r = t.rivers;
  stepCalls(t, f, dt);

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
    // By the berth-time of what is sent: a ship takes six boats' worth. @see MIX
    let most = 0;
    for (const p of t.ports.values()) if (p.river === river) most = Math.max(most, p.takes);
    let each = 0;
    for (const k of MIX) { const c = classOf(Math.min(most, k)); each += (c.dock * c.span) / MIX.length; }
    // And a fifth slower again: getting alongside and away takes berth-time too.
    each *= most ? 1.2 : 1;
    t.untilSpawn.set(river, Math.min(SPAWN_SLOWEST, Math.max(SPAWN_FASTEST, each / cap.perSecond)) / t.rush);
    const under = f.boats.filter((b) => b.motor > 0 && riverNear(r, b.x, b.y) === river);
    if (under.length >= MAX_BASE + MAX_PER_BERTH * cap.berths) continue;
    const sources = r.sources.filter((s) => s.river === river);
    if (!sources.length) continue;
    // Near the middle of the inflow, a little to either side boat by boat.
    const mid = (sources.length - 1) / 2;
    const off = ((t.sent % 3) - 1) * Math.min(1, mid / 2);
    const at = sources[Math.round(mid + off)];
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
    // The size wanted, then smaller, then bigger: whatever a port here takes.
    const want = Math.min(most, MIX[t.sent % MIX.length]);
    const sizes = [...Array.from({ length: want + 1 }, (_, k) => want - k), ...Array.from({ length: SHIP_CLASSES.length - want - 1 }, (_, k) => want + 1 + k)];
    let port: Port | null = null, cls = 0;
    for (const k of sizes) {
      if (r.reach[at.y * r.w + at.x] <= k) continue;
      port = pickPort(t, f, river, k);
      if (port) { cls = k; break; }
    }
    if (!port) continue;
    const boat = addBoat(f, c, s.x, s.y, cls);
    if (!boat) continue;
    // COME FOR ONE OF ITS BERTHS, each kind in turn. @see fittings
    const fits = fitsFor(port, cls);
    boat.fit = fits[t.sent % fits.length];
    t.sent++;
    boat.motor = RIVER_MOTOR;
    boat.route = [port.id];
    // Every other one bound for a Market Maker's port its own freighter.
    const ps = g.structures.get(port.id);
    if (ps && notable("market") && inAiDistrictNow(g, ps.x, ps.y)) boat.ai = t.sent % 2 === 0;
    const way = downstream(r, s.x, s.y, boat.cls ?? 0);
    if (way) boat.heading = Math.atan2(way.y, way.x);
  }
}
