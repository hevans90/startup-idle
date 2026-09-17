/**
 * World v2 — water moving ALONG a pipe, with momentum.
 *
 * Stage one levelled the water in a network by relaxation: each pair of
 * neighbouring cells shared out what they had until they matched. That gets
 * the water to the right place and it cannot slosh, for the same reason a
 * thing with no inertia cannot overshoot. What is missing is momentum, and
 * momentum is the whole of the difference between a level that settles and a
 * level that swings past and comes back.
 *
 * So this is the Saint-Venant equations in one dimension, which is the same
 * scheme `fluid/columns` runs in two — VIRTUAL PIPES, and here the pipes are
 * real ones. A cell holds a volume; the edge between two cells holds a
 * DISCHARGE; the discharge is accelerated by the difference in water level
 * across it times the area able to carry it, slowed by friction against the
 * wall, and the volumes follow from what crossed. Every trick the two
 * dimensional solver needed is needed here and for the same reasons:
 *
 *   - both sides of an edge measured from the SILL between them, so a run over
 *     a ridge cannot siphon;
 *   - outflows scaled to the water a cell actually has, so nothing goes
 *     negative;
 *   - friction quadratic in the flow and applied IMPLICITLY, so it can slow a
 *     surge without ever pushing it backwards;
 *   - and a step short enough for the wave speed, worked out per step, because
 *     a pipe's wave speed changes by an order of magnitude between half full
 *     and pressed full.
 *
 * THE PIPE IS ROUND, which is not decoration. A circular bore is wide in the
 * middle and narrow at the top, and the narrowness at the top is exactly why
 * pipes behave the way they do: the surface width `T` is what turns a change
 * in volume into a change in LEVEL, so as a pipe fills the last of the way,
 * the same trickle lifts the level further and further, and the wave speed
 * `sqrt(g A / T)` runs away. Model it as a rectangle and a pipe fills placidly
 * and surcharges with no warning.
 *
 * AND ABOVE THE CROWN THERE IS A SLOT. A full pipe has no free surface at all,
 * so the equations above stop meaning anything — it is a pressure problem, and
 * a pressure problem is a different regime with a different (enormous) wave
 * speed. The standard trick, and the one used here, is Preissmann's: pretend
 * the pipe has a hairline slot along the top, so that water rising past the
 * crown is still a free surface, just an extremely narrow one. The level in
 * the slot IS the pressure head, the equations never change form, and part
 * full and surcharged are one code path rather than two and a switch between
 * them. See {@link SLOT}.
 */
import { addWater } from "../../fluid/columns";
import type { Grid } from "../grid";
import type { WaterField } from "./field";

/**
 * The bore, in half steps from invert to crown.
 *
 * How TALL the pipe is. How much it holds is {@link PIPE_FULL}, which is a
 * separate number on purpose: one is the shape of the cross-section and the
 * other is its size, and a game wants to tune them apart.
 */
export const PIPE_D = 2;

/** What one cell of pipe holds full, in half steps over a column. */
export const PIPE_FULL = 1.6;

/**
 * The Preissmann slot, as a fraction of the pipe's width.
 *
 * Narrow, because it is meant to be a fiction: water in the slot is water the
 * pipe is holding under pressure, and a wide slot would store real volume that
 * a full pipe does not have. Too narrow and the wave speed in it goes through
 * the roof and the step with it — the celerity in the slot is the free-surface
 * one divided by the square root of this, so a fiftieth gives about seven
 * times, which is a step this can afford. A thousandth would be truer to a
 * real pipe's water hammer and would cost thirty times the substeps to say so.
 */
const SLOT = 0.02;

/**
 * The largest head a surcharged network will take before the mains gives up,
 * in half steps above the crown.
 *
 * Without it a sealed pipe with a tap on it is a bottomless pressure vessel:
 * the slot is narrow, so it accepts water for ever and the level climbs for
 * ever. A real main has a pressure and a real pipe has a relief; this is
 * both, and it is what stops the number running away while nobody is looking.
 */
export const PIPE_HEAD = 24;

/**
 * Gravity for the water in a pipe, in the solver's own units.
 *
 * The SOLVER's gravity and not the falling one: this is a pressure gradient
 * driving a flow along a channel, which is exactly what `fluid/columns` means
 * by gravity, and a wave in a pipe has to travel at the same `sqrt(g h)` a
 * wave outside it does or the two would disagree at every port.
 */
const GRAVITY = 2.25;

/** How much of its motion the water keeps per second, against nothing. */
const DRAG = 0.96;

/**
 * Friction against the pipe wall, quadratic and implicit.
 *
 * The same shape as the bed drag in `fluid/columns`, and applied the same way
 * — dividing rather than subtracting — because a quadratic term taken off
 * explicitly can take more than there was and push the flow backwards, which
 * is a scheme that rings at the frame rate rather than one that damps. A pipe
 * is smoother than a river bed, so this is gentler than the ground's.
 */
const WALL = 0.18;

/** How far a wave may cross in one step, as a fraction of a cell. */
const COURANT = 0.4;

/** Most substeps one frame will spend on the pipes, however fast the waves. */
const MAX_SUBSTEPS = 8;

/** Below this head an edge is left alone, so a level at rest stays at rest. */
const MIN_HEAD = 1e-5;

/**
 * A circular bore, as a table.
 *
 * The relation between how full a round pipe is and how deep the water in it
 * stands has no closed form either way round: the area of a circular segment
 * is `(theta - sin theta) / 2 pi` of the circle and the depth is
 * `(1 - cos(theta / 2)) / 2` of the diameter, and eliminating theta between
 * them is not something that can be done in elementary functions. It can be
 * TABULATED, once, at a resolution far finer than anything here can see — and
 * a table read is a handful of operations against a Newton solve per cell per
 * substep.
 *
 * `FILL[k]` is how full the pipe is when the water stands at `k / STEPS` of
 * the way up it. Rising, so a depth can be found from a fill by searching it.
 */
const STEPS = 256;
const FILL = (() => {
  const t = new Float32Array(STEPS + 1);
  for (let k = 0; k <= STEPS; k++) {
    const yd = k / STEPS;                         // depth, as a fraction of D
    const theta = 2 * Math.acos(1 - 2 * yd);      // the segment's angle
    t[k] = (theta - Math.sin(theta)) / (2 * Math.PI);
  }
  t[STEPS] = 1;
  return t;
})();

/** How wide the surface is, as a fraction of the pipe's width, at this depth. */
function topFraction(yd: number): number {
  if (yd <= 0 || yd >= 1) return SLOT;            // a slot at the invert, too
  const theta = 2 * Math.acos(1 - 2 * yd);
  const t = Math.sin(theta / 2);
  return t > SLOT ? t : SLOT;
}

/**
 * How deep the water in a cell of pipe stands, in half steps above its invert.
 *
 * Past full it is in the slot, and the depth it reports there is a PRESSURE
 * head — the height water would stand at if the pipe had a standpipe on it,
 * which is precisely what the level in a Preissmann slot means.
 */
export function pipeDepth(volume: number): number {
  if (volume <= 0) return 0;
  if (volume >= PIPE_FULL) {
    // In the slot. Its width is a fraction of the pipe's, so the same volume
    // lifts the level by that much more.
    const perStep = (PIPE_FULL * SLOT * 4) / (Math.PI * PIPE_D);
    return PIPE_D + (volume - PIPE_FULL) / perStep;
  }
  const phi = volume / PIPE_FULL;
  // Binary search the table, which rises, then read between its entries.
  let lo = 0, hi = STEPS;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (FILL[mid] < phi) lo = mid; else hi = mid;
  }
  const span = FILL[hi] - FILL[lo];
  const f = span > 0 ? (phi - FILL[lo]) / span : 0;
  return ((lo + f) / STEPS) * PIPE_D;
}

/** How much a cell holds with the water standing `y` half steps up it. */
export function pipeVolume(depth: number): number {
  if (depth <= 0) return 0;
  if (depth >= PIPE_D) {
    const perStep = (PIPE_FULL * SLOT * 4) / (Math.PI * PIPE_D);
    return PIPE_FULL + (depth - PIPE_D) * perStep;
  }
  const yd = depth / PIPE_D;
  const k = yd * STEPS;
  const lo = Math.min(STEPS - 1, Math.floor(k));
  const f = k - lo;
  return (FILL[lo] + (FILL[lo + 1] - FILL[lo]) * f) * PIPE_FULL;
}

/**
 * How much more volume one half step of level costs, here.
 *
 * The surface width, in the units volume is counted in — which is what turns a
 * head difference into a volume at a port, and what the wave speed is divided
 * by. It collapses towards the slot as the pipe fills, which is the whole
 * character of a round pipe: the last of it goes in hard.
 */
export function pipeTop(volume: number): number {
  const yd = Math.min(1, Math.max(0, pipeDepth(volume) / PIPE_D));
  return (topFraction(yd) * PIPE_FULL * 4) / (Math.PI * PIPE_D);
}

/**
 * How fast news travels in a cell of pipe, in tiles a second.
 *
 * `sqrt(g A / T)` — the hydraulic depth, not the depth. Half full it is close
 * to the depth itself; pressed full it is the whole area over a hairline, and
 * the wave runs an order of magnitude faster. That is not an artefact of the
 * slot, it is what a pressurised pipe actually does, and it is why the step
 * below has to be worked out fresh rather than assumed.
 */
export function pipeCelerity(volume: number): number {
  if (volume <= 0) return 0;
  const top = pipeTop(volume);
  return Math.sqrt((GRAVITY * volume) / (top > 1e-9 ? top : 1e-9));
}

/**
 * The invert of a pipe cell: where its floor is.
 *
 * The pipe's OWN level, which is not the ground's. A run keeps the grade it
 * was laid at while the ground rises and falls over it — that is what makes a
 * pipe able to cross under a ridge, and it is the only difference between a
 * buried main and a gutter.
 */
export const invertOf = (grid: Grid, i: number) => grid.pipeZ[i];

/** Where the water in a cell stands, in half steps above the map's floor. */
export const pipeLevel = (grid: Grid, field: WaterField, i: number) =>
  invertOf(grid, i) + pipeDepth(field.pipe[i]);

/** How much of a cell's water is above a height measured from its own invert. */
function aboveSill(volume: number, sill: number): number {
  if (sill <= 0) return volume;
  const under = pipeVolume(sill);
  return volume > under ? volume - under : 0;
}

/**
 * Step one network's flow for `dt`, in as many substeps as its waves need.
 *
 * The step comes from the fastest cell in the network, because a scheme that
 * lets a wave cross more than a fraction of a cell in one step does not slow
 * down, it rings. A part full pipe runs at about a tile a second and takes one
 * substep a frame; the same pipe pressed full runs seven times that and takes
 * a few. `MAX_SUBSTEPS` is the backstop — past it the step is simply short of
 * what it should be, which damps rather than explodes.
 */
export function stepPipeFlow(
  field: WaterField, grid: Grid, cells: Int32Array, from: number, to: number, dt: number,
) {
  let left = dt;
  let guard = 0;
  while (left > 1e-6 && guard++ < MAX_SUBSTEPS) {
    let fastest = 0;
    for (let k = from; k < to; k++) {
      const c = pipeCelerity(field.pipe[cells[k]]);
      if (c > fastest) fastest = c;
    }
    const stable = fastest > 0 ? COURANT / fastest : left;
    const h = left < stable ? left : stable;
    substep(field, grid, cells, from, to, h);
    left -= h;
  }
}

function substep(
  field: WaterField, grid: Grid, cells: Int32Array, from: number, to: number, dt: number,
) {
  const { w, h } = grid;
  const pipe = field.pipe;
  const flux = field.pipeFlux;
  const keep = Math.pow(DRAG, dt);
  const wall = WALL * dt;

  // 1. ACCELERATE every edge by the level difference across it and the water
  //    able to carry it. Both sides from the sill between them: what drives
  //    flow from one cell into the next is the water standing above the lip it
  //    has to cross, and a cell whose water lies below its neighbour's floor is
  //    not pressing on it at all.
  for (let k = from; k < to; k++) {
    const i = cells[k];
    const x = i % w, y = (i / w) | 0;
    for (let axis = 0; axis < 2; axis++) {
      const nx = x + (axis === 0 ? 1 : 0), ny = y + (axis === 0 ? 0 : 1);
      const e = i * 2 + axis;
      if (nx >= w || ny >= h) { flux[e] = 0; continue; }
      const j = ny * w + nx;
      if (!grid.pipe[j]) { flux[e] = 0; continue; }

      const zi = invertOf(grid, i), zj = invertOf(grid, j);
      const sill = zi > zj ? zi : zj;
      const li = zi + pipeDepth(pipe[i]), lj = zj + pipeDepth(pipe[j]);
      const hi = li > sill ? li - sill : 0;
      const hj = lj > sill ? lj - sill : 0;
      const head = hi - hj;
      // The area doing the carrying is the UPSTREAM side's, above the sill.
      // Downhill of a dry lip there is nothing to accelerate, which is what
      // stops a dry cell developing a flow out of water it has not got.
      const carry = head > 0 ? aboveSill(pipe[i], sill - zi) : aboveSill(pipe[j], sill - zj);

      let q = flux[e];
      if (carry > 0 && (head > MIN_HEAD || head < -MIN_HEAD)) {
        q = (q + GRAVITY * carry * head * dt) * keep;
      } else {
        q *= keep;
      }
      // Friction against the wall: quadratic, and implicit so that it can only
      // ever slow the flow down. Taken off explicitly a quadratic can take
      // more than there was and reverse the flow, which rings.
      flux[e] = carry > 0 ? q / (1 + (wall * (q < 0 ? -q : q)) / (carry * carry)) : 0;
    }
  }

  // 2. SCALE each cell's outflows down to the water it actually has. One pass
  //    is enough: reducing an outflow can only reduce a neighbour's inflow, so
  //    no cell's own limit can be broken by another cell being limited.
  for (let k = from; k < to; k++) {
    const i = cells[k];
    const x = i % w, y = (i / w) | 0;
    let out = 0;
    const east = i * 2, south = i * 2 + 1;
    if (flux[east] > 0) out += flux[east];
    if (flux[south] > 0) out += flux[south];
    const west = x > 0 ? (i - 1) * 2 : -1;
    const north = y > 0 ? (i - w) * 2 + 1 : -1;
    if (west >= 0 && flux[west] < 0) out -= flux[west];
    if (north >= 0 && flux[north] < 0) out -= flux[north];
    const has = pipe[i] / dt;
    if (out <= has || out <= 0) continue;
    const scale = has / out;
    if (flux[east] > 0) flux[east] *= scale;
    if (flux[south] > 0) flux[south] *= scale;
    if (west >= 0 && flux[west] < 0) flux[west] *= scale;
    if (north >= 0 && flux[north] < 0) flux[north] *= scale;
  }

  // 3. And the volumes are whatever crossed.
  for (let k = from; k < to; k++) {
    const i = cells[k];
    const x = i % w, y = (i / w) | 0;
    let delta = 0;
    delta -= flux[i * 2];
    delta -= flux[i * 2 + 1];
    if (x > 0) delta += flux[(i - 1) * 2];
    if (y > 0) delta += flux[(i - w) * 2 + 1];
    pipe[i] += delta * dt;
    if (pipe[i] < 0) pipe[i] = 0;
  }
}

/**
 * Empty a cell that is no longer pipe back onto the map.
 *
 * Water in a pipe that has just been deleted has to go somewhere, and the
 * honest somewhere is the ground it was lying on. Left in the array it would
 * be counted by `totalVolume` for ever while belonging to nothing, which is a
 * leak with the sign the other way round.
 */
export function spillOrphaned(field: WaterField, grid: Grid) {
  const { pipe } = field;
  for (let i = 0; i < pipe.length; i++) {
    if (pipe[i] <= 0 || grid.pipe[i]) continue;
    const x = i % grid.w, y = (i / grid.w) | 0;
    const cx = x * 4, cy = y * 4;                 // its own first column
    addWater(field.columns, cx, cy, pipe[i], grid.fluid[i] || 1);
    pipe[i] = 0;
    field.pipeFlux[i * 2] = 0;
    field.pipeFlux[i * 2 + 1] = 0;
  }
}
