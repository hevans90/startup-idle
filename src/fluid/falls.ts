/**
 * Water in the air.
 *
 * The solver moves water across an edge in one step. Over a lip that is wrong
 * in a way you can see: the wave at the top stops, the wave at the bottom
 * starts, and nothing crosses the distance between them. Water that goes over
 * a cliff spends time falling, and while it is falling it is somewhere and it
 * is not anywhere else.
 *
 * So it leaves the column at the top and does not arrive at the one below
 * until it has fallen the distance. In between it is held HERE, on the edge it
 * went over, and `totalWater` counts it — a drop in the air is still a drop.
 *
 * A fall has a FRONT, the leading edge of the water, and a HEAD, the trailing
 * one. Both accelerate under a gravity of their own: the solver's is a pressure
 * gradient measured in tiles and has nothing to say about anything falling.
 * While water is still going over, the head stays at the lip and the front runs
 * away from it; when the supply stops the head lets go and the whole thing
 * drops away. Nothing lands until the front reaches the bottom, and after that
 * water leaves the air at the rate it is arriving.
 */
import type { ColumnField } from "./columns";

/**
 * Gravity for a falling sheet, in half steps per second squared.
 *
 * Chosen from how long a drop should take to look right: at 90, a ten half
 * step cliff — five full steps, a serious drop — takes just under half a
 * second from lip to floor, which is about what the eye expects of something
 * that size.
 */
export const FALL_GRAVITY = 90;

/**
 * Below this a drop is a ledge, not a fall, in half steps.
 *
 * Two terrain steps. One is a lip water tumbles over and keeps flowing, and
 * treating it as a fall is worse than useless: at a tenth of this, a steady
 * hillside became a staircase of little cliffs and the water spent its whole
 * journey in the air, arriving nowhere. A fall is a drop you would hesitate to
 * step off.
 */
export const FALL_MIN = 4;

/**
 * How long a fall stays attached to its lip after the last water crosses.
 *
 * The flux over an edge is a real quantity in a real simulation and it crosses
 * zero from one frame to the next. Without this the head lets go and grabs on
 * again several times a second, which is a stutter rather than a waterfall.
 */
const CLING = 1 / 6;

export type FallState = {
  /** Water in the air on each edge, `+x` then `+y` per column. */
  readonly air: Float32Array;
  /** Leading and trailing edges, in half steps below the lip. */
  readonly front: Float32Array;
  readonly head: Float32Array;
  readonly frontSpeed: Float32Array;
  readonly headSpeed: Float32Array;
  /** Seconds since water last went over. */
  readonly since: Float32Array;
};

export function createFalls(nx: number, ny: number): FallState {
  const n = nx * ny * 2;
  return {
    air: new Float32Array(n),
    front: new Float32Array(n),
    head: new Float32Array(n),
    frontSpeed: new Float32Array(n),
    headSpeed: new Float32Array(n),
    // Long ago: an edge nobody has poured over has no fall on it, and starting
    // at zero put one on every cliff in the world on the first frame.
    since: new Float32Array(n).fill(CLING),
  };
}

/** Where a neighbour's water, or failing that its ground, stands. */
const besideAt = (f: ColumnField, j: number) =>
  f.depth[j] > f.params.dryDepth ? f.ground[j] + f.depth[j] : f.ground[j];

/**
 * How far water leaving column `i` over one of its edges would fall, or 0
 * where that is a step in a river rather than a cliff.
 *
 * Read off the GROUND on the far side, not its surface: a pool at the foot of
 * a cliff shortens the fall, and once it is deep enough there is no fall left.
 */
export function dropAt(f: ColumnField, i: number, axis: number): number {
  const x = i % f.nx, y = (i / f.nx) | 0;
  const jx = axis === 0 ? x + 1 : x, jy = axis === 0 ? y : y + 1;
  if (jx >= f.nx || jy >= f.ny) return 0;
  const drop = f.ground[i] - besideAt(f, jy * f.nx + jx);
  return drop >= FALL_MIN ? drop : 0;
}

/** Hold `amount` in the air on an edge rather than landing it. */
export function intoAir(f: ColumnField, i: number, axis: number, amount: number) {
  f.falls.air[i * 2 + axis] += amount;
}

/**
 * Advance every fall, and land what has finished falling.
 *
 * Called after the depths are applied, so what lands this step is water that
 * left a lip on some earlier one.
 */
export function stepFalls(
  f: ColumnField, dt: number,
  region: { x0: number; y0: number; x1: number; y1: number },
) {
  const { nx, ny, depth, material, params } = f;
  const s = f.falls;
  for (let y = region.y0; y <= region.y1; y++) {
    for (let x = region.x0; x <= region.x1; x++) {
      const i = y * nx + x;
      for (let axis = 0; axis < 2; axis++) {
        const k = i * 2 + axis;
        const jx = axis === 0 ? x + 1 : x, jy = axis === 0 ? y : y + 1;
        if (jx >= nx || jy >= ny) { land(f, k, i, i, 1); continue; }
        const j = jy * nx + jx;
        const drop = f.ground[i] - besideAt(f, j);
        if (drop < FALL_MIN) {
          // The cliff has gone — filled in from below, or the ground moved.
          // Whatever was in the air belongs to the cell below it.
          land(f, k, j, i, 1);
          reset(s, k);
          continue;
        }

        const flux = axis === 0 ? f.fx[i] : f.fy[i];
        s.since[k] = flux > 0 && depth[i] > params.dryDepth ? 0 : s.since[k] + dt;

        if (s.since[k] < CLING) {
          s.head[k] = 0;                        // more is coming over behind it
          s.headSpeed[k] = 0;
        } else {
          s.headSpeed[k] += FALL_GRAVITY * dt;
          s.head[k] += s.headSpeed[k] * dt;
        }
        if (s.front[k] < drop) {
          s.frontSpeed[k] += FALL_GRAVITY * dt;
          s.front[k] = Math.min(drop, s.front[k] + s.frontSpeed[k] * dt);
        }

        // NOTHING lands until the front gets there. After that it leaves the
        // air at the rate it is arriving, which in a steady fall is the rate
        // it went over — the time constant is the time the fall takes.
        if (s.front[k] >= drop && s.air[k] > 0) {
          const fall = Math.sqrt((2 * drop) / FALL_GRAVITY);
          land(f, k, j, i, Math.min(1, dt / fall));
        }
        // Caught its own front, or fallen past the bottom: nothing is left of
        // it, and anything still in the air has landed by now.
        if (s.head[k] >= s.front[k] || s.head[k] >= drop) {
          land(f, k, j, i, 1);
          reset(s, k);
        }
      }
    }
  }
  void material;
}

/** Put a share of what is in the air into the cell below it. */
function land(f: ColumnField, k: number, to: number, from: number, share: number) {
  const air = f.falls.air[k];
  if (air <= 0) return;
  const amount = air * share;
  f.falls.air[k] = air - amount;
  if (f.depth[to] <= f.params.dryDepth && f.material[from]) f.material[to] = f.material[from];
  f.depth[to] += amount;
  include(f, to % f.nx, (to / f.nx) | 0);
}

function reset(s: FallState, k: number) {
  s.front[k] = 0;
  s.head[k] = 0;
  s.frontSpeed[k] = 0;
  s.headSpeed[k] = 0;
  s.since[k] = CLING;
}

/** Widen the active box to cover a column that has just been landed on. */
function include(f: ColumnField, x: number, y: number) {
  const b = f.box;
  if (b.x1 < b.x0) { b.x0 = x; b.x1 = x; b.y0 = y; b.y1 = y; return; }
  if (x < b.x0) b.x0 = x;
  if (x > b.x1) b.x1 = x;
  if (y < b.y0) b.y0 = y;
  if (y > b.y1) b.y1 = y;
}

/** Every drop in the air, anywhere. */
export function waterInAir(f: ColumnField): number {
  let sum = 0;
  for (let k = 0; k < f.falls.air.length; k++) sum += f.falls.air[k];
  return sum;
}

/** How far down its wall a fall has got, or null where there is no fall. */
export function fallExtent(f: ColumnField, i: number, axis: number) {
  const k = i * 2 + axis;
  const head = f.falls.head[k], front = f.falls.front[k];
  return front > head ? { head, front } : null;
}
