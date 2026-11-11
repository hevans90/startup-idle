/**
 * World v2 — a boat's wake: a trail of foam it leaves on the water, and
 * NOTHING ELSE. It is drawn and not simulated: no column is pushed, no depth
 * moved, so a boat stays the passenger it is. @see fleet
 *
 * A wake is a list of points dropped under a boat as it goes, one every
 * `SPACING` tiles TRAVELLED rather than every so often, so a boat at rest
 * leaves none and a fast one leaves them no closer together. Each point is two
 * arms of foam either side of where the boat went, spreading out and fading
 * as it ages, which is the V a boat draws behind it; consecutive points of one
 * boat are joined into those arms. @see boats-render
 *
 * The points ride the sheet: their height is the surface under them NOW, read
 * when they are drawn, not where it was when the boat went by.
 */
import type { ColumnField } from "../../fluid/columns";
import { addWater, wantDepth, type ColumnField as Columns } from "../../fluid/columns";
import { COLUMNS_PER_TILE } from "../water/field";
import { classOf } from "./classes";
import { BOAT_BEAM, sampleWater, type Fleet } from "./fleet";

/** How far a boat goes between points, in tiles. */
const SPACING = 0.12;
/** How long a point lasts, seconds. */
export const WAKE_LIFE = 3.5;
/** How fast the arms spread apart, tiles a second either side. */
const SPREAD = 0.32;
/**
 * The slowest a boat goes and still leaves a wake, the speed of a full one,
 * and how strong the wake of the slowest is: a river drifts a boat at a
 * quarter of a tile a second, and a wake scaled to nothing from there was
 * foam nobody could see.
 */
const MIN_SPEED = 0.06;
const FULL_SPEED = 0.5;
const LEAST = 0.45;
/** The most points one boat keeps. */
const MAX_POINTS = 64;

export type WakePoint = {
  boat: number;
  /** Where the boat was, in tile coordinates, and the way it was going. */
  x: number;
  y: number;
  hx: number;
  hy: number;
  /** When it was dropped, on the wake's clock. */
  born: number;
  /** How strong a wake, nought to one, from how fast the boat was going. */
  strength: number;
};

export type Wake = {
  points: WakePoint[];
  t: number;
  /** The fleet it was dropped by: a new one restarts the ids. */
  fleet: Fleet | null;
};

export const createWake = (): Wake => ({ points: [], t: 0, fleet: null });

/** How much of each new point's direction is the way the boat just went. */
const STEER = 0.3;

/** Age the wake by `dt`, drop points behind every boat under way, forget the old. */
export function stepWake(w: Wake, f: Fleet, dt: number): void {
  if (w.fleet !== f) { w.points.length = 0; w.fleet = f; }
  w.t += Math.max(0, dt);
  const keep = w.t - WAKE_LIFE;
  let n = 0;
  for (const p of w.points) if (p.born > keep) w.points[n++] = p;
  w.points.length = n;

  // The newest point of each boat, to measure how far it has gone since.
  const last = new Map<number, WakePoint>();
  const count = new Map<number, number>();
  for (const p of w.points) { last.set(p.boat, p); count.set(p.boat, (count.get(p.boat) ?? 0) + 1); }
  for (const b of f.boats) {
    const speed = Math.hypot(b.vx, b.vy);
    if (!b.afloat || speed < MIN_SPEED) continue;
    // FROM ITS MIDDLE, not its stern: the stern swings out every time the bow
    // turns, and the wake drew every swing. The hull covers the first of it.
    const s = { x: b.x, y: b.y };
    const l = last.get(b.id);
    const gone = l ? Math.hypot(s.x - l.x, s.y - l.y) : 0;
    if (l && gone < SPACING) continue;
    // THE WAY IT WENT, from the last point and eased into the way it was
    // going before, rather than the way the bow points this frame: a direction
    // that swings with every eddy put a zigzag in both arms. @see STEER
    let hx = Math.cos(b.heading), hy = Math.sin(b.heading);
    if (l) {
      hx = l.hx * (1 - STEER) + ((s.x - l.x) / gone) * STEER;
      hy = l.hy * (1 - STEER) + ((s.y - l.y) / gone) * STEER;
      const n = Math.hypot(hx, hy) || 1;
      hx /= n; hy /= n;
    }
    w.points.push({
      boat: b.id, x: s.x, y: s.y, hx, hy,
      born: w.t, strength: LEAST + (1 - LEAST) * Math.min(1, speed / FULL_SPEED),
    });
    if ((count.get(b.id) ?? 0) + 1 > MAX_POINTS) {
      const k = w.points.findIndex((p) => p.boat === b.id);
      w.points.splice(k, 1);
    }
  }
}

/** One point of a wake as drawn: its two arms and its middle, on the sheet. */
export type WakeMark = {
  boat: number;
  /** Tile coordinates and surface height, port arm, middle, starboard arm. */
  left: { x: number; y: number; z: number };
  mid: { x: number; y: number; z: number };
  right: { x: number; y: number; z: number };
  /** How opaque the arms, and the churned water in the middle, nought to one. */
  arm: number;
  churn: number;
};

/**
 * The wake's points as marks to draw, oldest first per boat, on the surface
 * as it stands. A point on water that has since drained is dropped.
 */
export function wakeMarks(w: Wake, c: ColumnField): WakeMark[] {
  const out: WakeMark[] = [];
  for (const p of w.points) {
    const age = w.t - p.born;
    const life = 1 - age / WAKE_LIFE;
    if (life <= 0) continue;
    const half = BOAT_BEAM * 0.5 + SPREAD * age;
    // Across the heading, either side.
    const ax = -p.hy * half, ay = p.hx * half;
    // ONE HEIGHT for the point, its middle's: the arms are a third of a tile
    // either side, and reading the chop under each one shook them up and down.
    const s = sampleWater(c, p.x, p.y);
    if (!s.wet) continue;
    const z = s.surface;
    out.push({
      boat: p.boat,
      left: { x: p.x + ax, y: p.y + ay, z },
      mid: { x: p.x, y: p.y, z },
      right: { x: p.x - ax, y: p.y - ay, z },
      arm: p.strength * life ** 1.5,
      churn: p.strength * Math.max(0, 1 - age / (WAKE_LIFE * 0.35)),
    });
  }
  return out;
}

/**
 * How much water a hull moves aside, in half steps over one column, for
 * every tile it travels and every tile of its beam.
 */
export const PUSH = 1.6;
/** The slowest a hull goes and still moves water; and the least water it will take a column down to, half steps. */
const PUSH_FROM = 0.08;
const PUSH_KEEPS = 1;

/**
 * HULLS MOVE THE WATER. A hull under way takes a little from the column
 * under its stern and puts it, half each, on the columns either side of its
 * bow: the bow wave, and the hollow behind that the river runs back into. So
 * a wake is the water's own, and it rocks what is moored nearby.
 *
 * NOTHING IS MADE OR LOST: what is taken is what is put down, to the last
 * drop, and no more is taken than leaves the column deep — against the host's
 * copy of it, which every column touched is asked for by name. Through
 * `addWater`, so on the device it goes up with the arrivals. @see addWater
 */
export function pushWater(f: Fleet, c: Columns, dt: number): void {
  if (dt <= 0) return;
  const col = (t: number) => Math.round((t + 0.5) * COLUMNS_PER_TILE - 0.5);
  for (const b of f.boats) {
    const speed = Math.hypot(b.vx, b.vy);
    if (!b.afloat || b.moor || speed < PUSH_FROM) continue;
    const cls = classOf(b.cls);
    const hx = b.vx / speed, hy = b.vy / speed;
    const sx = col(b.x - hx * cls.length * 0.45), sy = col(b.y - hy * cls.length * 0.45);
    if (sx < 0 || sy < 0 || sx >= c.nx || sy >= c.ny) continue;
    const from = sy * c.nx + sx;
    wantDepth(c, from);
    const take = Math.min(PUSH * speed * cls.beam * dt, Math.max(0, c.depth[from] - PUSH_KEEPS));
    if (take <= 0) continue;
    // Either side of the bow, a column clear of the hull; only onto water.
    const out = cls.beam / 2 + 1 / COLUMNS_PER_TILE;
    const sides = [1, -1].map((k) => ({ x: col(b.x + hx * cls.length * 0.4 - hy * out * k), y: col(b.y + hy * cls.length * 0.4 + hx * out * k) }))
      .filter((p) => p.x >= 0 && p.y >= 0 && p.x < c.nx && p.y < c.ny && c.depth[p.y * c.nx + p.x] > c.params.dryDepth);
    if (!sides.length) continue;
    const before = c.depth[from];
    addWater(c, sx, sy, -take);
    const took = before - c.depth[from];
    for (const p of sides) { wantDepth(c, p.y * c.nx + p.x); addWater(c, p.x, p.y, took / sides.length); }
  }
}
