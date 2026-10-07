/**
 * World v2 — river traffic: boats that come in where a river does, go down it
 * under their own power, and leave where it does.
 *
 * ONLY WHERE THERE IS A PORT. A river with a seaport on its bank sends a boat
 * in over its inflow every so often, up to a few at once; a river without one
 * stays empty, and so does every lake. The boat steers for its river's exit
 * and is taken off the map when it gets there. @see RiverMap, SEAPORT
 *
 * CALLING AT EVERY PORT ON THE WAY. A boat sent in is given the seaports on
 * its river as a route, the furthest upstream first. It steers to each one's
 * berth — the river tile beside the quay — ties up there for a while, and
 * then goes on to the next, and after the last to the exit. A berth with a
 * boat already in it is waited for, a little way off. @see berthOf
 *
 * The rivers are re-mapped about once a second rather than every frame: the
 * water moves, and a bank that is wet one second and dry the next does not
 * need to be noticed the same frame.
 */
import type { ColumnField } from "../../fluid/columns";
import type { Grid } from "../grid";
import { SEAPORT } from "../structures/def";
import { addBoat, type Boat, type Fleet, type Steer } from "./fleet";
import {
  berthOf, downhill, downstream, isExit, mapRiver, riverAt, riversBeside, stepsFrom, tileDepthOf,
  type RiverMap,
} from "./river";

/** Seconds between looks at the rivers. */
const REMAP_EVERY = 1;
/** Seconds between boats on a river with a port, and before the first. */
const SPAWN_EVERY = 6;
const FIRST_SPAWN = 1;
/** The most boats under way on one river at once. */
const MAX_PER_RIVER = 6;
/** How hard a boat under way pushes itself, tiles a second squared. */
export const RIVER_MOTOR = 1;
/** A boat closer than this to where the next would appear holds it back, tiles. */
const SPAWN_CLEAR = 1.1;
/** How far in from the rim a boat is put down, tiles. */
const SPAWN_IN = 1.25;
/** Nearer the rim than this, tiles, on an exit, and a boat has left. */
const LEAVE_AT = 0.3;
/** Seconds a boat lies alongside at a port. */
export const DOCK_TIME = 5;
/** Nearer its berth than this, tiles, and a boat ties up. */
const TIE_UP_AT = 0.45;
/** Nearer a taken berth than this, tiles, and a boat waits where it is. */
const WAIT_AT = 1.6;

/** A seaport's berth, and how far every tile of its river is from it. */
type Berth = { x: number; y: number; tx: number; ty: number; river: number; steps: Float32Array };

export type Traffic = {
  rivers: RiverMap | null;
  /** Rivers, from 1, with a seaport on their bank. */
  ported: Set<number>;
  /** Each seaport's berth, by its structure id. */
  berths: Map<number, Berth>;
  /**
   * The boats come for each berth, in the order they got near it: only the
   * first may tie up. Nearest-first let a boat arriving late slip in ahead of
   * one that had been waiting off the berth for a whole call.
   */
  queues: Map<number, number[]>;
  sinceMap: number;
  untilSpawn: number;
  /** Boats sent so far, to vary where along the inflow the next one comes in. */
  sent: number;
};

export const createTraffic = (): Traffic => ({
  rivers: null, ported: new Set(), berths: new Map(), queues: new Map(), sinceMap: Infinity, untilSpawn: FIRST_SPAWN, sent: 0,
});

/** Which rivers have a seaport on their bank. */
export function portedRivers(g: Grid, r: RiverMap): Set<number> {
  const out = new Set<number>();
  for (const s of g.structures.values()) {
    if (s.def !== SEAPORT.id) continue;
    for (const k of riversBeside(r, s.x, s.y, s.w, s.h)) out.add(k);
  }
  return out;
}

/** How far a point is inside the map's rim, in tiles; nought on it. */
const insideBy = (r: RiverMap, x: number, y: number) =>
  Math.min(x + 0.5, y + 0.5, r.w - 0.5 - x, r.h - 0.5 - y);

/** Every seaport's berth, on the rivers as they stand. */
export function berthsOf(g: Grid, r: RiverMap): Map<number, Berth> {
  const out = new Map<number, Berth>();
  for (const s of g.structures.values()) {
    if (s.def !== SEAPORT.id) continue;
    const b = berthOf(r, s.x, s.y, s.w, s.h);
    if (b) out.set(s.id, { ...b, steps: stepsFrom(r, b.tx, b.ty) });
  }
  return out;
}

/**
 * The way a boat under way should go: to the berth of the next port on its
 * route, and with none left, downstream to its river's exit. Straight at the
 * berth once it is in the berth's own tile, where the steps run out.
 */
export const trafficSteer = (t: Traffic): Steer | undefined => {
  const r = t.rivers;
  if (!r) return undefined;
  return (b: Boat) => {
    const next = b.route?.length ? t.berths.get(b.route[0]) : undefined;
    if (!next) return downstream(r, b.x, b.y);
    const way = downhill(next.steps, r.w, r.h, b.x, b.y);
    if (way) return way;
    const dx = next.x - b.x, dy = next.y - b.y, d = Math.hypot(dx, dy);
    return d > 1e-6 ? { x: dx / d, y: dy / d } : null;
  };
};

/**
 * The calls a boat is making: tie up at the next berth when it gets there,
 * cast off when its time is up, and wait off a berth another boat is in.
 */
function stepCalls(t: Traffic, f: Fleet, dt: number): void {
  // Boats that have gone, or no longer want a berth, leave its queue.
  const live = new Map(f.boats.map((b) => [b.id, b]));
  for (const [port, q] of t.queues) {
    t.queues.set(port, q.filter((id) => live.get(id)?.route?.[0] === port));
  }
  for (const b of f.boats) {
    if (!b.route) continue;
    // A port that has gone, or lost its river, is not called at.
    while (b.route.length && !t.berths.has(b.route[0])) { b.route.shift(); b.moor = null; b.dockLeft = 0; }
    if (!b.route.length) { b.moor = null; continue; }
    const port = b.route[0];
    const berth = t.berths.get(port)!;
    if ((b.dockLeft ?? 0) > 0) {
      b.dockLeft! -= dt;
      if (b.dockLeft! <= 0) {
        b.route.shift();
        b.moor = null;
        t.queues.set(port, (t.queues.get(port) ?? []).filter((id) => id !== b.id));
      }
      continue;
    }
    const d = Math.hypot(berth.x - b.x, berth.y - b.y);
    if (d >= WAIT_AT) { b.moor = null; continue; }
    // NEAR IT: in the queue, and tied up only when it is this boat's turn.
    const q = t.queues.get(port) ?? [];
    if (!q.includes(b.id)) q.push(b.id);
    t.queues.set(port, q);
    if (q[0] !== b.id) { b.moor ??= { x: b.x, y: b.y }; continue; }
    if (d < TIE_UP_AT) {
      b.moor = { x: berth.x, y: berth.y };
      b.dockLeft = DOCK_TIME;
    } else {
      b.moor = null;
    }
  }
}

/** One frame of the rivers' traffic: re-map, take off the boats that left, send new ones. */
export function stepTraffic(t: Traffic, f: Fleet, g: Grid, c: ColumnField, dt: number): void {
  t.sinceMap += dt;
  if (!t.rivers || t.sinceMap >= REMAP_EVERY || t.rivers.w !== g.w || t.rivers.h !== g.h) {
    t.rivers = mapRiver(g, tileDepthOf(c));
    t.ported = portedRivers(g, t.rivers);
    t.berths = berthsOf(g, t.rivers);
    t.sinceMap = 0;
  }
  const r = t.rivers;
  stepCalls(t, f, dt);

  // LEAVING: a boat at its river's way out, against the rim, is gone.
  for (let k = f.boats.length - 1; k >= 0; k--) {
    const b = f.boats[k];
    if (isExit(r, b.x, b.y) && insideBy(r, b.x, b.y) < LEAVE_AT) f.boats.splice(k, 1);
  }

  // ARRIVING: every so often, a boat in over each ported river's inflow.
  t.untilSpawn -= dt;
  if (t.untilSpawn > 0) return;
  t.untilSpawn = SPAWN_EVERY;
  for (const river of t.ported) {
    const under = f.boats.filter((b) => b.motor > 0 && riverAt(r, Math.round(b.x), Math.round(b.y)) === river);
    if (under.length >= MAX_PER_RIVER) continue;
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
    const boat = addBoat(f, c, s.x, s.y);
    if (!boat) continue;
    t.sent++;
    boat.motor = RIVER_MOTOR;
    // ITS ROUTE: the ports on its river, the furthest from the exit first,
    // which is the order it passes them in going down.
    boat.route = [...t.berths.entries()]
      .filter(([, b]) => b.river === river)
      .sort(([, a], [, b]) => r.toExit[b.ty * r.w + b.tx] - r.toExit[a.ty * r.w + a.tx])
      .map(([id]) => id);
    const way = downstream(r, s.x, s.y);
    if (way) boat.heading = Math.atan2(way.y, way.x);
  }
}
