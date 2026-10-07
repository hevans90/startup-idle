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
import {
  berthsBeside, downhill, downstream, isExit, mapRiver, riverAt, stepsFrom, tileDepthOf,
  type BerthSpot, type RiverMap,
} from "./river";

/** Seconds between looks at the rivers. */
const REMAP_EVERY = 1;
/** The quickest and slowest a river sends boats, seconds apart, and before the first. */
const SPAWN_FASTEST = 3;
const SPAWN_SLOWEST = 20;
const FIRST_SPAWN = 1;
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

/** One berth at a port, and how far every tile of its river is from it. */
type Berth = BerthSpot & { steps: Float32Array };

/** A seaport as the traffic sees it. */
export type Port = {
  id: number;
  river: number;
  /** Seconds a boat lies alongside. */
  dock: number;
  berths: Berth[];
  /** Steps to the nearest of its berths, for a boat that has not been given one. */
  steps: Float32Array;
};

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
};

export const createTraffic = (): Traffic => ({
  rivers: null, ports: new Map(), queues: new Map(), sinceMap: Infinity, untilSpawn: new Map(), sent: 0,
});

/** Every seaport's berths, on the rivers as they stand. */
export function portsOf(g: Grid, r: RiverMap): Map<number, Port> {
  const out = new Map<number, Port>();
  for (const s of g.structures.values()) {
    const port = structureDef(s.def)?.port;
    if (!port) continue;
    const spots = berthsBeside(r, s.x, s.y, s.w, s.h, port.berths);
    if (!spots.length) continue;
    out.set(s.id, {
      id: s.id,
      river: spots[0].river,
      dock: port.dockSeconds,
      berths: spots.map((b) => ({ ...b, steps: stepsFrom(r, [{ x: b.tx, y: b.ty }]) })),
      steps: stepsFrom(r, spots.map((b) => ({ x: b.tx, y: b.ty }))),
    });
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

const nearestBerth = (p: Port, b: Boat) => {
  let best = p.berths[0], bestD = Infinity;
  for (const k of p.berths) {
    const d = Math.hypot(k.x - b.x, k.y - b.y);
    if (d < bestD) { best = k; bestD = d; }
  }
  return best;
};

/**
 * The way a boat under way should go: to its berth, or to its port's nearest
 * berth before it has one, and once it has called, downstream to the exit.
 */
export const trafficSteer = (t: Traffic): Steer | undefined => {
  const r = t.rivers;
  if (!r) return undefined;
  return (b: Boat) => {
    const port = b.route?.length ? t.ports.get(b.route[0]) : undefined;
    if (!port) return downstream(r, b.x, b.y);
    const berth = b.berth !== undefined ? port.berths[b.berth] : undefined;
    if (berth) return toward(r, berth.steps, b, berth);
    return toward(r, port.steps, b, nearestBerth(port, b));
  };
};

/** Let a boat go from the port it is at, or was bound for. */
function castOff(t: Traffic, b: Boat): void {
  const port = b.route?.shift();
  b.moor = null;
  b.dockLeft = 0;
  b.berth = undefined;
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
    if ((b.dockLeft ?? 0) > 0) {
      b.dockLeft! -= dt;
      if (b.dockLeft! <= 0) castOff(t, b);
      continue;
    }
    if (b.berth === undefined) {
      const near = nearestBerth(port, b);
      if (Math.hypot(near.x - b.x, near.y - b.y) >= WAIT_AT) { b.moor = null; continue; }
      // NEAR IT: in the queue, and a berth when one is free and it is next.
      const q = t.queues.get(port.id) ?? [];
      if (!q.includes(b.id)) q.push(b.id);
      t.queues.set(port.id, q);
      const held = new Set(
        f.boats.filter((o) => o.route?.[0] === port.id && o.berth !== undefined).map((o) => o.berth!),
      );
      const next = q.find((id) => live.get(id)?.berth === undefined);
      const free = port.berths.map((_, k) => k).filter((k) => !held.has(k));
      if (next !== b.id || !free.length) { b.moor ??= { x: b.x, y: b.y }; continue; }
      free.sort((m, n) =>
        Math.hypot(port.berths[m].x - b.x, port.berths[m].y - b.y)
        - Math.hypot(port.berths[n].x - b.x, port.berths[n].y - b.y));
      b.berth = free[0];
      b.moor = null;
    }
    const berth = port.berths[b.berth];
    if (Math.hypot(berth.x - b.x, berth.y - b.y) < TIE_UP_AT) {
      b.moor = { x: berth.x, y: berth.y };
      b.dockLeft = port.dock;
    }
  }
}

/**
 * The port on a river a new boat would be turned round soonest at: the boats
 * already bound for each, plus this one, a berth's worth at a time.
 */
function pickPort(t: Traffic, f: Fleet, river: number): Port | null {
  let best: Port | null = null, bestWait = Infinity;
  for (const p of t.ports.values()) {
    if (p.river !== river) continue;
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
    t.untilSpawn.set(river, Math.min(SPAWN_SLOWEST, Math.max(SPAWN_FASTEST, 1 / cap.perSecond)));
    const under = f.boats.filter((b) => b.motor > 0 && riverAt(r, Math.round(b.x), Math.round(b.y)) === river);
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
    const port = pickPort(t, f, river);
    const boat = addBoat(f, c, s.x, s.y);
    if (!boat) continue;
    t.sent++;
    boat.motor = RIVER_MOTOR;
    boat.route = port ? [port.id] : [];
    const way = downstream(r, s.x, s.y);
    if (way) boat.heading = Math.atan2(way.y, way.x);
  }
}
