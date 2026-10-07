/**
 * World v2 — river traffic: boats that come in where a river does, go down it
 * under their own power, and leave where it does.
 *
 * ONLY WHERE THERE IS A PORT. A river with a seaport on its bank sends a boat
 * in over its inflow every so often, up to a few at once; a river without one
 * stays empty, and so does every lake. The boat steers for its river's exit
 * and is taken off the map when it gets there. @see RiverMap, SEAPORT
 *
 * The rivers are re-mapped about once a second rather than every frame: the
 * water moves, and a bank that is wet one second and dry the next does not
 * need to be noticed the same frame.
 */
import type { ColumnField } from "../../fluid/columns";
import type { Grid } from "../grid";
import { SEAPORT } from "../structures/def";
import { addBoat, type Fleet, type Steer } from "./fleet";
import {
  downstream, isExit, mapRiver, riverAt, riversBeside, tileDepthOf, type RiverMap,
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

export type Traffic = {
  rivers: RiverMap | null;
  /** Rivers, from 1, with a seaport on their bank. */
  ported: Set<number>;
  sinceMap: number;
  untilSpawn: number;
  /** Boats sent so far, to vary where along the inflow the next one comes in. */
  sent: number;
};

export const createTraffic = (): Traffic => ({
  rivers: null, ported: new Set(), sinceMap: Infinity, untilSpawn: FIRST_SPAWN, sent: 0,
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

/** The way a boat under way should go: downstream, toward its river's exit. */
export const trafficSteer = (t: Traffic): Steer | undefined =>
  t.rivers ? (x, y) => downstream(t.rivers!, x, y) : undefined;

/** One frame of the rivers' traffic: re-map, take off the boats that left, send new ones. */
export function stepTraffic(t: Traffic, f: Fleet, g: Grid, c: ColumnField, dt: number): void {
  t.sinceMap += dt;
  if (!t.rivers || t.sinceMap >= REMAP_EVERY || t.rivers.w !== g.w || t.rivers.h !== g.h) {
    t.rivers = mapRiver(g, tileDepthOf(c));
    t.ported = portedRivers(g, t.rivers);
    t.sinceMap = 0;
  }
  const r = t.rivers;

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
    const way = downstream(r, s.x, s.y);
    if (way) boat.heading = Math.atan2(way.y, way.x);
  }
}
