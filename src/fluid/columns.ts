/**
 * Column-based water: a real flow simulation over arbitrary terrain.
 *
 * Every cell holds a COLUMN of water — a depth above whatever the ground is
 * there — and the state is nothing but those depths plus the flux on the edges
 * between them. There is no pool, no level, no surface plane: a cell's surface
 * is `ground + depth` and the surface of the world is whatever the columns add
 * up to. Water at any height flows to any other height because the only thing
 * driving it is the difference between two surfaces.
 *
 * This replaces a shallow-water sim that solved waves on a FLAT plane per pool.
 * That could not flow: the plane was the pool's identity, so water could ripple
 * but never go anywhere, and every vertical thing — a fall, a chute — had to be
 * drawn as decoration over the top of it. Here a waterfall is not a special
 * case, it is a large surface difference across one edge.
 *
 * THE MODEL is virtual pipes (Mei, Decaudin & Neyret 2007): each edge carries a
 * flux accelerated by the head difference across it and slowed by drag, and the
 * depths are updated from the divergence. Momentum lives on the edges, which is
 * what makes a river run rather than ooze — a pure equalisation scheme spreads
 * water correctly and looks like nothing at all.
 *
 * WHY IT CANNOT GO NEGATIVE, which is the whole difficulty with wet/dry fronts:
 * before anything is applied, each cell's total outflow is scaled down until it
 * is at most the water the cell actually has. Scaling an outflow can only
 * reduce some other cell's inflow, never increase its outflow, so one pass is
 * enough and no cell can be over-drained. Depths stay at or above zero by
 * construction rather than by clamping after the fact, which is what keeps a
 * shoreline stable.
 */

import {
  createFalls, dropAt, intoAir, stepFalls, waterInAir, type FallState,
} from "./falls";

/**
 * Tuning. Depths and heights are in HALF STEPS, the engine's height unit.
 *
 * Distances are in TILES, never in columns, and that is the whole point of the
 * `cell` on the field: how finely a tile is divided is a detail setting, and
 * nothing here should move when it changes.
 */
export type FlowParams = {
  /**
   * Gravity, in tiles per second squared.
   *
   * A wave runs at `sqrt(gravity * depth)` tiles a second, so at 2.25 a body
   * one half step deep carries one at a tile and a half a second, and deeper
   * water carries one faster. That depth term is what makes the BED shape the
   * flow rather than only steer it — see the note on `carry` in the substep.
   */
  gravity: number;
  /**
   * Per-second flux retention; below 1 so still water settles.
   *
   * The FLUID's own loss of momentum, and the one thing that makes one fluid
   * behave unlike another — see `dragOf`. The BED's is `bedDrag`, which is a
   * property of the ground and the same for everything flowing over it.
   *
   * Deliberately weak. It was 0.55 when it was carrying the whole of the
   * dissipation, and a disturbed basin lost 99% of its motion inside twenty
   * seconds — water that behaved like jelly. Now that the bed does the
   * dissipating, this is what it should always have been: a real fluid loses
   * almost nothing to itself. At 0.9 a basin still holds a quarter of a
   * disturbance after a minute, and it spends that minute ringing in its own
   * standing waves, whose periods come from the shape of the basin for free.
   */
  drag: number;
  /** Largest step the solver will take at once, for stability. */
  maxDt: number;
  /**
   * Depth below which a cell is treated as dry by callers.
   *
   * The water is NOT removed — that would leak volume, and a sim that leaks is
   * a sim you cannot reason about. It is a rendering and reporting threshold,
   * so a millimetre of spread does not paint the whole map wet.
   */
  dryDepth: number;
  /**
   * Surface SLOPE below which nothing accelerates, in half steps per tile.
   *
   * Standing in for the friction the scheme has none of, and the reason a
   * puddle has an edge: frictionless water on a perfectly flat plane spreads
   * forever, so without this a pour grew into an ever-widening film that
   * levelled below anything you could see and never settled anywhere.
   *
   * A SLOPE rather than a depth, which is what it was first. A depth threshold
   * makes water cling to a cliff — a shallow sheet stops accelerating wherever
   * it happens to be, including halfway down a drop. A slope threshold only
   * ever stops water that is already nearly level, and a slope always has a
   * gradient, so it drains whatever its depth.
   *
   * A slope rather than a head, which is what it was second. A head is the
   * difference across ONE CELL, so halving the cell size halves it for the same
   * hillside, and the same pour on the same hill settled over 385 tiles at four
   * columns per tile against 986 at two. A gradient is a property of the
   * ground.
   */
  minSlope: number;
  /**
   * Bed roughness: how hard the ground under the water holds it back.
   *
   * Chézy-shaped, which is to say the drag on a flow goes as its discharge
   * SQUARED over the depth squared — so a river barely notices the bed and a
   * thin sheet over the same ground is stopped by it. `drag` alone could not
   * tell those apart: it took the same fraction per second off a torrent and a
   * film, which is why a sheet spreading over flat ground used to keep its
   * momentum all the way out to the friction threshold.
   *
   * Applied implicitly — the flux is DIVIDED by one plus the loss rather than
   * having it subtracted — because the term is quadratic, and subtracting a
   * quadratic can overshoot straight through zero and turn a flow round.
   *
   * Manning's `h^(7/3)` is the usual law and gives much the same shape; this is
   * `h^2` because it is one multiply instead of a fractional `Math.pow` on
   * every edge of every substep, and at sixty-five thousand columns that is the
   * difference between a tenth of a millisecond and several.
   */
  bedDrag: number;
  /**
   * How hard the wind pushes on the surface — the only term that puts energy
   * IN.
   *
   * Every other term is a sink, and a solver made only of sinks answers "what
   * does water do when you leave it alone" with "nothing, forever". It pushes
   * the FLUX, so not a drop is created or lost, and it arrives as a couple of
   * long gusts drifting across the map at periods that do not divide into one
   * another, so the balance the water is chasing keeps moving. Zero turns it
   * off, which is what a test of how much water there is should use.
   */
  wind: number;
  /**
   * How hard BREAKING waves dissipate, as a multiple of the modelled rate.
   *
   * Zero turns it off, which is what a test of how a wave propagates should
   * use. One is the model as published. See `stepBreaking`.
   */
  breaking: number;
};

export const FLOW_DEFAULTS: FlowParams = {
  gravity: 2.25,
  drag: 0.9,
  maxDt: 1 / 60,
  dryDepth: 0.02,
  // 0.3 per tile: measured as the highest value that still lets a plateau
  // drain properly (33.6 of 40 units reach the bottom) while holding a pour on
  // flat ground together as something you can see. At twice this a third of it
  // clings to the top.
  minSlope: 0.3,
  bedDrag: 0.4,
  wind: 0.5,
  breaking: 1,
};

export type ColumnField = {
  readonly nx: number;
  readonly ny: number;
  /** Seconds simulated, which is the clock the wind gusts on. */
  t: number;
  /**
   * Whether the edge of the field is the edge of the WORLD, or a wall.
   *
   * Open, the outermost ring of columns is emptied before every substep, so
   * water that reaches it has left: a depth held at zero, which is the
   * ordinary absorbing boundary. It is what makes a map a piece of somewhere
   * larger rather than a tank, and what a river needs — a hole somebody had to
   * dig for it is not somewhere to go, it is a plughole.
   *
   * Closed by default, because a solver has to be: a test of how much water
   * there is should not depend on where the water happened to be.
   */
  openEdge: boolean;
  /**
   * The wind, on a grid far coarser than the water.
   *
   * A gust is a weather-sized thing — `WIND_TILES` across — so sampling it per
   * column would be computing the same number sixteen times over. Coarse, and
   * read through `wix`/`wiy` so an edge pays one add and one array read for it.
   */
  readonly windX: Float32Array;
  readonly windY: Float32Array;
  readonly wnx: number;
  readonly wny: number;
  /** How many columns across one wind cell is. */
  readonly wstride: number;
  /**
   * How wide one column is, in TILES.
   *
   * Every length in the scheme is divided by this, which is what makes the
   * resolution a detail setting rather than a physics one: a head is a
   * difference across one cell but an acceleration wants a gradient, and a flux
   * crosses one edge but a depth wants it spread over one cell's area. Leave it
   * at 1 and a column IS a tile, which is how the solver's own tests read.
   */
  readonly cell: number;
  readonly params: FlowParams;
  /** Ground height per column. Callers keep this in step with the terrain. */
  readonly ground: Float32Array;
  /** Water depth per column, never negative. */
  readonly depth: Float32Array;
  /** Flux on the +x edge of each column, and on the +y edge. */
  readonly fx: Float32Array;
  readonly fy: Float32Array;
  /** Scratch for one step's depth change, so a step allocates nothing. */
  readonly delta: Float32Array;
  /**
   * Breaking: how fast the surface is moving, how long it has been breaking,
   * HOW HARD it is breaking, and scratch for the solve.
   *
   * `rate` is `|d(depth)/dt|` in half steps a second, which the divergence
   * works out anyway and would otherwise throw away. `breakAge` is seconds
   * since a column started breaking, or -1 for one that is not.
   */
  readonly rate: Float32Array;
  readonly breakAge: Float32Array;
  /**
   * How hard each column is breaking, nought to one.
   *
   * The intensity and not the viscosity, because this is the quantity both
   * halves want: the solver multiplies it up into an eddy viscosity to
   * dissipate with, and the renderer paints foam with it. They were two
   * different criteria computed in two places for a while, and they did not
   * quite agree — white where nothing was being dissipated, and dissipation
   * with nothing to show for it.
   */
  readonly broke: Float32Array;
  readonly velo: Float32Array;
  readonly iterA: Float32Array;
  readonly iterB: Float32Array;
  /**
   * Whether anything at all is breaking, so a calm map skips the solve.
   *
   * A bounding BOX was tried instead, on the reasoning that breaking is local.
   * It is not local enough: a hard pour breaks in scattered patches across the
   * whole wet area, so the box spans the map anyway and maintaining it costs
   * more than it saves — 3.13ms against 2.93ms on a flooded map.
   */
  breaking: boolean;
  /**
   * What KIND of fluid stands in each column, carried along as it moves.
   *
   * Without this, sludge flowing into a dry cell would arrive as whatever that
   * cell last held — which is to say it would turn into water as it spread.
   * Only a cell that was DRY takes a new material: mixing is not modelled, so
   * the first thing to arrive owns the column until it empties again.
   */
  readonly material: Uint8Array;
  /** Scratch: the largest inflow into each cell this step, and where from. */
  readonly bestIn: Float32Array;
  readonly bestMat: Uint8Array;
  /**
   * Per-material flux retention, indexed by material. Empty entries fall back
   * to `params.drag`.
   *
   * This is the one thing that makes one fluid behave unlike another: sludge
   * holds less of its momentum from moment to moment, so it creeps where water
   * runs. Looked up per EDGE from whichever side is the source, and raised to
   * the timestep once per material per substep rather than once per cell.
   */
  readonly dragOf: Float32Array;
  /** Scratch: `dragOf` raised to this substep's dt. */
  readonly keepOf: Float32Array;
  /**
   * Inclusive bounds of the water, plus a margin — the only region stepped.
   *
   * The solver used to walk the whole grid whatever was on it, which cost 1.6ms
   * a frame on an EMPTY map. Cost should be proportional to how much water
   * there is, not to how big the world is. Grown by one column a step so water
   * can always spread into the ring around itself, and recomputed from what is
   * actually wet as each step goes, so it shrinks back as water drains.
   */
  box: { x0: number; y0: number; x1: number; y1: number };
  /**
   * The deepest column anywhere, which is what sizes the substep.
   *
   * A wave runs at `sqrt(gravity * depth)`, so the deepest water present is
   * the fastest thing in the field and the thing the step has to keep up
   * with. Kept up to date by the divergence, which writes every depth anyway,
   * and by `addWater`, so that water arriving deep is stepped safely on the
   * very first substep rather than one step later.
   */
  deepest: number;
  /**
   * Water that has left a lip and not yet reached the bottom — see `falls`.
   *
   * A drop in the air is still a drop: `totalWater` counts it, and nothing
   * arrives below a cliff until it has actually fallen the distance.
   */
  readonly falls: FallState;
};

/** How many TILES across one wind cell is. Gusts are weather, not ripples. */
const WIND_TILES = 4;

/**
 * Depth at which water feels the wind in full, in half steps.
 *
 * A deliberate departure from the physics, which says a stress on the surface
 * does not care what is underneath it. Left ungated, a gust strong enough to
 * stir a lake threw a shallow puddle around in waves as deep as the puddle —
 * and a real puddle is held still by friction and by being too small to raise a
 * wave on at all, neither of which a depth-averaged model on half-tile cells
 * can represent. Gating it is the cheaper lie.
 */
const WIND_DEPTH = 2.5;
const INV_WIND_DEPTH = 1 / WIND_DEPTH;

export function createColumnField(
  nx: number,
  ny: number,
  params: FlowParams = FLOW_DEFAULTS,
  cell = 1,
): ColumnField {
  const n = nx * ny;
  const stride = Math.max(1, Math.round(WIND_TILES / cell));
  const wnx = Math.ceil(nx / stride), wny = Math.ceil(ny / stride);
  return {
    nx, ny, cell, params,
    t: 0,
    openEdge: false,
    windX: new Float32Array(wnx * wny),
    windY: new Float32Array(wnx * wny),
    wnx, wny, wstride: stride,
    ground: new Float32Array(n),
    depth: new Float32Array(n),
    fx: new Float32Array(n),
    fy: new Float32Array(n),
    delta: new Float32Array(n),
    rate: new Float32Array(n),
    breakAge: new Float32Array(n).fill(-1),
    broke: new Float32Array(n),
    velo: new Float32Array(n),
    iterA: new Float32Array(n),
    iterB: new Float32Array(n),
    breaking: false,
    material: new Uint8Array(n),
    bestIn: new Float32Array(n),
    bestMat: new Uint8Array(n),
    dragOf: new Float32Array(MATERIAL_SLOTS),
    keepOf: new Float32Array(MATERIAL_SLOTS),
    box: { x0: 0, y0: 0, x1: -1, y1: -1 },      // empty
    deepest: 0,
    falls: createFalls(nx, ny),
  };
}

/** Let water off the edge of the field, or wall it in. See `openEdge`. */
export function setOpenEdge(f: ColumnField, open: boolean) {
  f.openEdge = open;
}

/**
 * Empty the outermost ring of columns: whatever reached it has left the world.
 *
 * Before the fluxes are worked out rather than after, so the ring is dry when
 * the heads are taken and the second ring is draining into nothing — which is
 * what an open edge IS. Momentum on those edges is left alone, so a river
 * running off the map keeps running rather than stalling at the rim.
 *
 * It costs the map's perimeter, not its area, and it makes the outermost
 * quarter tile permanently dry. At sixty-four tiles across that is a rim you
 * would have to go looking for.
 */
function spill(f: ColumnField) {
  const { nx, ny, depth, material } = f;
  const clear = (i: number) => { depth[i] = 0; material[i] = 0; };
  const last = (ny - 1) * nx;
  for (let x = 0; x < nx; x++) { clear(x); clear(last + x); }
  for (let y = 0; y < ny; y++) { clear(y * nx); clear(y * nx + nx - 1); }
}

/** Material indices the per-material drag table covers. */
export const MATERIAL_SLOTS = 16;

/** Give a material its own flux retention. 0 leaves it on the field default. */
export function setMaterialDrag(f: ColumnField, material: number, drag: number) {
  if (material >= 0 && material < MATERIAL_SLOTS) f.dragOf[material] = drag;
}

export const at = (f: ColumnField, x: number, y: number) => y * f.nx + x;

/** Surface height of a column: the ground plus whatever stands on it. */
export const surfaceAt = (f: ColumnField, i: number) => f.ground[i] + f.depth[i];

/**
 * Total water in the field. Constant across any number of steps.
 *
 * Including what is in the AIR. Water going over a cliff is out of the column
 * it left and not yet in the one below, and a conservation check that only
 * counted depths would call that a leak.
 */
export function totalWater(f: ColumnField): number {
  let sum = 0;
  for (let i = 0; i < f.depth.length; i++) sum += f.depth[i];
  return sum + waterInAir(f);
}

/**
 * Add (or remove) water at a column, never taking it below empty.
 *
 * A `material` of 0 leaves whatever is there alone, so draining never rewrites
 * what it is draining.
 */
export function addWater(
  f: ColumnField, x: number, y: number, amount: number, material = 0,
) {
  if (x < 0 || y < 0 || x >= f.nx || y >= f.ny) return;
  const i = at(f, x, y);
  const next = Math.max(0, f.depth[i] + amount);
  if (material && amount > 0) f.material[i] = material;
  f.depth[i] = next;
  if (next <= 0) f.material[i] = 0;
  if (next > 0) include(f, x, y);
  if (next > f.deepest) f.deepest = next;
}

/** Widen the active box to cover a column. */
function include(f: ColumnField, x: number, y: number) {
  const b = f.box;
  if (b.x1 < b.x0) { b.x0 = x; b.x1 = x; b.y0 = y; b.y1 = y; return; }
  if (x < b.x0) b.x0 = x;
  if (x > b.x1) b.x1 = x;
  if (y < b.y0) b.y0 = y;
  if (y > b.y1) b.y1 = y;
}

/** The region worth looking at: the water plus a margin, clamped to the grid. */
export function activeBox(f: ColumnField) {
  const b = f.box;
  if (b.x1 < b.x0) return null;
  return {
    x0: Math.max(0, b.x0 - 1),
    y0: Math.max(0, b.y0 - 1),
    x1: Math.min(f.nx - 1, b.x1 + 1),
    y1: Math.min(f.ny - 1, b.y1 + 1),
  };
}

/**
 * The gusts, as a couple of long waves drifting across the map.
 *
 * Two, at angles and periods that do not divide into one another, so the field
 * wanders instead of pulsing. Each pushes along its own direction of travel, so
 * over a cycle it averages to nothing: this stirs the water, it does not blow
 * it somewhere.
 *
 * Evaluated with the angle-sum identity, which makes the whole field separable:
 * a sine per wind ROW and a sine per wind COLUMN, then a multiply per cell.
 * Done directly it is a `Math.sin` per cell per wave per substep, which on a
 * big map is more time than the water costs.
 */
const GUSTS = [
  { length: 23, period: 8.5, dx: 0.94, dy: 0.34, weight: 1 },
  { length: 13, period: 5.3, dx: -0.42, dy: 0.91, weight: 0.7 },
];

function stirWind(f: ColumnField) {
  const { windX, windY, wnx, wny, params } = f;
  if (params.wind <= 0) {
    windX.fill(0);
    windY.fill(0);
    return;
  }
  windX.fill(0);
  windY.fill(0);
  const tilesPerWindCell = f.wstride * f.cell;
  for (const g of GUSTS) {
    const k = (Math.PI * 2) / g.length;
    const w = (Math.PI * 2) / g.period;
    const ax = k * g.dx * tilesPerWindCell, ay = k * g.dy * tilesPerWindCell;
    const phase = -w * f.t;
    const amp = params.wind * g.weight;
    // sin(a + b) = sin a cos b + cos a sin b, with `a` down the columns and
    // `b` across the rows.
    for (let wy = 0; wy < wny; wy++) {
      const b = ay * (wy + 0.5) + phase;
      const sb = Math.sin(b), cb = Math.cos(b);
      const row = wy * wnx;
      for (let wx = 0; wx < wnx; wx++) {
        const a = ax * (wx + 0.5);
        const v = amp * (Math.sin(a) * cb + Math.cos(a) * sb);
        windX[row + wx] += v * g.dx;
        windY[row + wx] += v * g.dy;
      }
    }
  }
}

/**
 * Advance the flow by `dt` seconds.
 *
 * Split into sub-steps no longer than `maxDt`, so a long frame cannot outrun
 * the scheme's stability — the alternative is a dropped frame turning into a
 * detonating wave front.
 */
/**
 * The Courant number the scheme is run at, and it is not the one the theory
 * gives you.
 *
 * A wave has to take more than a step to cross a cell: `c dt / dx` below 1 in
 * one dimension, below `1/sqrt(2)` on a square grid, since a wave crossing it
 * diagonally sees both axes at once. Measured on flat ground, that second
 * number is about right — a pond at 0.69 settles and one at 0.80 never does.
 *
 * Over ROLLING ground it is nowhere near. The bed here is a staircase: height
 * belongs to a tile and there are four columns to a tile, so every tile
 * boundary is a vertical step under the water. Each one reflects a little of
 * every wave that crosses it, and what the reflections do to the stability
 * limit is take it down to somewhere between 0.46 and 0.49 — measured on the
 * same scene poured to different depths, where 0.46 settles to a millimetre
 * of chop and 0.49 stands up in spikes thirty half steps tall and stays
 * there. The same scene with the bed smoothed to column resolution instead of
 * a staircase is perfectly stable, which is what says it is the steps.
 *
 * So: 0.4, with the margin on the side of the thing that cannot be recovered
 * from.
 */
const COURANT = 0.4;

/**
 * The longest step the water can take, from the deepest of it.
 *
 * The alternative was to cap the flux instead — hold the wave speed down so
 * that whatever the depth, the fixed step is safe. That is what `hMax` did
 * alone, and it is the wrong knob to lean on: at a Courant number of 0.4 it
 * starts lying about the wave speed at sixteen half steps, which is an
 * ordinary pond, and every pond deeper than that would carry its waves too
 * slowly. Stepping finer costs time instead of truth, and only in proportion
 * to the square root of the depth — a pond four times deeper needs twice the
 * substeps.
 */
function stableStep(f: ColumnField): number {
  const h = f.deepest;
  if (h <= 0) return f.params.maxDt;
  return Math.min(f.params.maxDt, COURANT * f.cell / Math.sqrt(f.params.gravity * h));
}

/**
 * How many substeps a frame may be broken into before the clock gives way.
 *
 * Past this the step is left too long for the water in it and `hMax` catches
 * what is left, holding the wave speed down rather than letting the scheme
 * come apart. Running slow is a thing you can look at; ringing is not.
 */
const MAX_SUBSTEPS = 12;

export function stepFlow(f: ColumnField, dt: number) {
  let left = dt;
  let guard = 0;
  while (left > 1e-6 && guard++ < MAX_SUBSTEPS) {
    const h = Math.min(left, stableStep(f));
    substep(f, h);
    left -= h;
  }
}

/**
 * The mixing of a breaking wave, and the engine's vertical scale folded in.
 *
 * A breaker's eddy viscosity is modelled as `delta^2 * h * d(eta)/dt` — a
 * mixing length squared over a time, where the length is the depth and the
 * rate is how fast the surface is moving. `delta` is about 1.2 (Kennedy, Chen,
 * Kirby & Dalrymple 2000, after Zelt 1991).
 *
 * The extra factor is this engine's and cannot be dodged: depth is in HALF
 * STEPS, distance is in TILES, and a viscosity is a length squared over a
 * time, so both lengths have to be the same one. A half step is an eighth of a
 * tile, and it appears twice.
 */
const VERTICAL = 1 / 8;
const MIXING = 1.44 * VERTICAL * VERTICAL;

/**
 * How fast the surface has to move for a wave to be breaking, and how slow
 * before it stops, as multiples of the wave speed.
 *
 * The criterion is the surface's own vertical velocity against the speed the
 * wave travels at: past some fraction of it the front face cannot hold its
 * shape and spills. The literature's fractions are 0.65 to start and 0.15 to
 * stop, written for a system whose vertical and horizontal share a unit. Ours
 * does not, so they arrive divided by `VERTICAL`.
 *
 * TWO of them, and that is the point. On one threshold a wave flickers in and
 * out of breaking several times a second, because the rate it is tested on
 * crosses it constantly — and a dissipation that switches at the grid's own
 * rate is a thing a scheme can ring on, which is the opposite of the job.
 * Breaking starts hard and stops soft, and between them the bar slides from
 * one to the other over `PERSIST` depths travelled.
 */
const BREAK_START = 0.65 / VERTICAL;
const BREAK_STOP = 0.15 / VERTICAL;
const PERSIST = 5;

/**
 * How many Jacobi sweeps the implicit diffusion gets.
 *
 * Nowhere near enough to converge, and it does not need to be. What the
 * implicit form buys is not accuracy, it is that the answer is BOUNDED however
 * large the viscosity — even ONE sweep is `(u + d * sum of neighbours) over
 * (1 + 4d)`, which for a large `d` is the average of the neighbours and for a
 * small one is barely a change. It can smooth but it cannot overshoot, so the
 * coefficient never has to be held down to keep it stable. Measured, one sweep
 * and four give the same answer to two decimal places; two is the middle of
 * that for a tenth of a millisecond.
 *
 * That matters because holding it down was what made the explicit version
 * useless. The stability limit is a diffusion number of an eighth, and the
 * modelled viscosity here runs a couple of hundred times past it — so clamped,
 * every breaking column got the SAME maximum smoothing whether it was barely
 * breaking or coming apart, and the model's nought-to-one ramp meant nothing.
 * Measured: scaling the coefficient by a hundred changed the result by a third
 * (rms 0.27 to 0.39), which is the signature of a term that is saturated
 * rather than graded. What it damaged, it damaged at every setting — a drain
 * lost a third of its throughput and rivers stopped running.
 */
const SWEEPS = 2;

/**
 * Work out what is breaking, and how hard, from the last step's surface rate.
 *
 * This is the thing `render/foam` only ever DREW. Foam there is a diagnostic:
 * it reads the flow, paints it white, and tells the water nothing. Real
 * breaking is not a colour — it is where a wave's organised motion is turned
 * into turbulence and lost, and in deep water it is the dominant sink there
 * is, the thing that stops a sea growing without bound under its own wind.
 * Without it the only sinks here are a flat per-second drag on the flux and a
 * bed friction that falls off as one over the depth squared, so deep water has
 * almost nothing taking energy out of it, and what it does have is blind to
 * scale: it takes the same fraction per second off a ten tile swell as off a
 * one column spike.
 */
function stepBreaking(f: ColumnField, dt: number, i: number, d: number) {
  const { rate, breakAge, broke, params } = f;
  const wave = Math.sqrt(params.gravity * d);
  const age = breakAge[i];
  let bar = BREAK_START * wave;
  if (age >= 0) {
    const over = PERSIST * (d * VERTICAL) / wave;
    const t = over > 0 ? Math.min(1, age / over) : 1;
    bar = (BREAK_START + (BREAK_STOP - BREAK_START) * t) * wave;
  }
  if (rate[i] < bar) {
    breakAge[i] = -1;
    broke[i] = 0;
    return;
  }
  breakAge[i] = age < 0 ? 0 : age + dt;
  // In smoothly over the first half of the way past the bar, so a wave does
  // not arrive at full dissipation the instant it qualifies.
  const b = Math.min(1, (rate[i] / bar - 1) * 2);
  broke[i] = b > 0 ? b : 0;
  if (broke[i] > 0) f.breaking = true;
}

/**
 * Spread the momentum of a breaking column into the ones around it, implicitly.
 *
 * A diffusion, because that is what turbulence does to momentum. It is scale
 * SELECTIVE in the way the drags are not — a one column spike has an enormous
 * second derivative and a ten tile swell has almost none — and it cannot
 * create anything, because every sweep is an average of values already there.
 *
 * On the VELOCITY and not the discharge. The published term diffuses `h u` and
 * divides by `h`; diffusing the discharge on its own moves momentum between
 * columns of very different depth as though they were the same water, which
 * over rolling ground is most of the pairs there are.
 *
 * And only between WET neighbours. A dry cell stands in as this edge's own
 * velocity, which is a zero gradient and so no exchange at all. Read instead
 * as a velocity of zero — which is what a dry cell's flux over the depth floor
 * comes to — every waterline becomes a wall for the turbulence to drag the
 * flow down against, and a river is nearly all bank.
 */
function diffuseBreaking(
  f: ColumnField, dt: number,
  region: { x0: number; y0: number; x1: number; y1: number },
) {
  const { nx, fx, fy, depth, broke, rate, velo, iterA, iterB, cell, params } = f;
  const { x0, y0, x1, y1 } = region;
  const floor = params.dryDepth * 8;
  const dry = params.dryDepth;
  const scale = dt / (cell * cell);

  for (let axis = 0; axis < 2; axis++) {
    const q = axis === 0 ? fx : fy;
    const step = axis === 0 ? 1 : nx;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * nx + x;
        const far = i + step;
        const h = Math.max((depth[i] + (far < depth.length ? depth[far] : depth[i])) * 0.5, floor);
        velo[i] = q[i] / h;
        iterA[i] = velo[i];
      }
    }
    // (I - dt nu grad^2) u_new = u_old, by Jacobi: each cell is its own old
    // value plus its neighbours' new ones, in the ratio the viscosity sets.
    let from = iterA, into = iterB;
    for (let sweep = 0; sweep < SWEEPS; sweep++) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = y * nx + x;
          // The viscosity, from the intensity: a mixing length squared over
          // a time, the length being the depth.
          const d = scale * broke[i] * MIXING * depth[i] * rate[i] * params.breaking;
          if (d <= 0) { into[i] = velo[i]; continue; }
          const here = from[i];
          const w = x > x0 && depth[i - 1] > dry ? from[i - 1] : here;
          const e = x < x1 && depth[i + 1] > dry ? from[i + 1] : here;
          const n = y > y0 && depth[i - nx] > dry ? from[i - nx] : here;
          const s = y < y1 && depth[i + nx] > dry ? from[i + nx] : here;
          into[i] = (velo[i] + d * (w + e + n + s)) / (1 + 4 * d);
        }
      }
      const swap = from; from = into; into = swap;
    }
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * nx + x;
        if (broke[i] <= 0) continue;
        const far = i + step;
        const h = Math.max((depth[i] + (far < depth.length ? depth[far] : depth[i])) * 0.5, floor);
        q[i] = from[i] * h;
      }
    }
  }
}

function substep(f: ColumnField, dt: number) {
  f.t += dt;
  if (f.openEdge) spill(f);
  const region = activeBox(f);
  if (!region) return;                          // nothing wet: nothing to do
  stirWind(f);
  // What was breaking at the end of the last step dissipates at the start of
  // this one, on the viscosity that step worked out. A step behind, which is
  // what an explicit indicator always is.
  if (f.breaking && f.params.breaking > 0) diffuseBreaking(f, dt, region);
  const { X0, Y0, X1, Y1 } = { X0: region.x0, Y0: region.y0, X1: region.x1, Y1: region.y1 };
  const { nx, ny, ground, depth, fx, fy, delta, params, cell } = f;
  // A head is the surface difference across one cell; what accelerates water is
  // the GRADIENT, so the head is divided by how far apart the two columns are.
  const gain = params.gravity * dt / cell;
  const keep = Math.pow(params.drag, dt);
  const bedGain = params.bedDrag * dt;
  const { windX, windY, wnx, wstride } = f;
  // Likewise the friction threshold, which is a slope and becomes a head here.
  const minHead = params.minSlope * cell;
  // A flux crosses one edge; the depth it changes is spread over one cell.
  const spread = dt / cell;
  /**
   * Deepest water the flux term will credit, from the CFL condition.
   *
   * A wave runs at `sqrt(gravity * depth)`, so deep water is fast water, and
   * once it outruns a cell in a step the scheme rings instead of settling.
   *
   * The factor of two is the whole of it, and leaving it out was a real bug
   * for a long time. The condition is TWO dimensional: a wave crossing a
   * square grid diagonally has to satisfy `c dt sqrt(1/dx^2 + 1/dy^2) <= 1`,
   * which on a square cell is `c dt / dx <= 1/sqrt(2)`, not 1. Written from
   * the one dimensional form the guard sat at a Courant number of 1 and the
   * scheme came apart at about 0.7 — measured, a pond 48 half steps deep runs
   * at 0.69 and settles, and one 64 deep runs at 0.80 and never does.
   *
   * What it looked like: any pool past about fifty half steps rang for ever.
   * A shove came back at 1.12 times its own size a minute later instead of a
   * quarter of it; with the weather on, such a pond sat at a chop of 18 to 49
   * half steps where a shallower one sits at a third of one. Nothing damped
   * it, because nothing was wrong with the damping — it survived the wind
   * being turned off, the bed drag raised tenfold and the fluid drag doubled.
   * It pumped volume as well as energy: a pit lowered under a pool dug itself
   * to 112 half steps where the lowering had made 58.
   *
   * The obvious way to reach one is to LOWER THE GROUND under a pool, which
   * deepens it by however far you lowered, so this was never the pathological
   * case the old note here claimed it was.
   *
   * This is the BACKSTOP and not the working limit — `stableStep` keeps the
   * step short enough that nothing ever reaches this, and it only binds when
   * a frame has run out of substeps. It deliberately sits well above where
   * the stepper aims, because a cap that lands ON the water's own depth is
   * worse than one that lands miles above it: some edges get capped and their
   * neighbours do not, and that switching is itself a thing a scheme can ring
   * on. Measured, a 96 deep pond with the cap at 96 came apart after six
   * seconds while the same pond with the cap at 50 — every edge capped, all of
   * them consistently — sat still. Uniform is fine. Half on, half off is not.
   */
  const hMax = (cell / params.maxDt) ** 2 / (2 * params.gravity);
  for (let m = 0; m < MATERIAL_SLOTS; m++) {
    f.keepOf[m] = f.dragOf[m] > 0 ? Math.pow(f.dragOf[m], dt) : keep;
  }
  const keepOf = f.keepOf;
  const material = f.material;
  void ny;

  // 1. Accelerate every edge by the head across it and the water able to CARRY
  //    it, then apply drag.
  //
  // BOTH SIDES ARE MEASURED FROM THE SILL BETWEEN THEM, not from the sea
  // floor — hydrostatic reconstruction, after Audusse et al. 2004, and without
  // it the scheme is only honest over gentle ground. Water standing on a
  // plateau with water ten steps below it was being driven by a head of ten,
  // a pressure gradient no depth of water in the cell could produce, so it
  // evacuated the cell in a tenth of a second and left a mound where a sheet
  // should have been — worse the higher the plateau, because the head WAS the
  // cliff. Measured from the sill, the same edge is driven by the half step
  // actually standing above it.
  //
  // `carry` is that depth on whichever side is uphill: the water with a path
  // across the edge. It is the thing that makes the BED shape the flow rather
  // than only steer it. Without it every edge accelerated as hard as every
  // other, so a film crossed a rise as fast as a deep channel ran down a
  // valley. With it a wave runs at `sqrt(gravity * depth)`: it speeds up into
  // a dip, slows and heaps over a shoal, and picks out the low ground.
  //
  // It doubles as the dry gate that used to be a depth test, and is the same
  // test: on level ground it IS the upstream depth, and a dry cell has none.
  //
  // A dry cell can still be flowed INTO, but nothing accelerates out of it, or
  // a dry cell downhill of another dry cell would develop a flux out of water
  // it does not have and the limiter below would spend its whole time undoing
  // the acceleration.
  for (let y = Y0; y <= Y1; y++) {
    // The wind is held in two plain numbers across a whole run of columns, and
    // refreshed when the run ends. Read per column out of its own array it cost
    // more than three times what the rest of this loop does: a wind cell is
    // sixteen columns wide, so that was the same two floats fetched sixteen
    // times over, in a loop the engine cannot prove is not writing to them.
    const wrow = ((y / wstride) | 0) * wnx;
    let wc = (X0 / wstride) | 0;
    let nextRun = (wc + 1) * wstride;
    let wxv = windX[wrow + wc] * dt, wyv = windY[wrow + wc] * dt;
    for (let x = X0; x <= X1; x++) {
      if (x === nextRun) {
        wc++;
        nextRun += wstride;
        wxv = windX[wrow + wc] * dt;
        wyv = windY[wrow + wc] * dt;
      }
      const i = y * nx + x;
      const si = ground[i] + depth[i];
      if (x + 1 < nx) {
        const j = i + 1;
        const sill = ground[i] > ground[j] ? ground[i] : ground[j];
        const hi = si - sill, hj = ground[j] + depth[j] - sill;
        const head = (hi > 0 ? hi : 0) - (hj > 0 ? hj : 0);
        const carry = Math.min(hMax, head > 0 ? hi : hj);
        const k = keepOf[material[head > 0 ? i : j]];
        const push = carry > 0 && Math.abs(head) > minHead;
        const q = push ? (fx[i] + gain * carry * head) * k : fx[i] * k;
        // The wind is added AFTER the drag, so it is this step's push rather
        // than something the drag has already taken a bite out of, and only
        // where there is water to push: on a dry edge the limiter would stop
        // anything moving anyway, but the flux itself would wind up.
        fx[i] = carry > 0
          ? q / (1 + bedGain * Math.abs(q) / (carry * carry))
            + wxv * (carry < WIND_DEPTH ? carry * INV_WIND_DEPTH : 1)
          : q;
      } else {
        fx[i] = 0;                            // the map edge is a wall
      }
      if (y + 1 < ny) {
        const j = i + nx;
        const sill = ground[i] > ground[j] ? ground[i] : ground[j];
        const hi = si - sill, hj = ground[j] + depth[j] - sill;
        const head = (hi > 0 ? hi : 0) - (hj > 0 ? hj : 0);
        const carry = Math.min(hMax, head > 0 ? hi : hj);
        const k = keepOf[material[head > 0 ? i : j]];
        const push = carry > 0 && Math.abs(head) > minHead;
        const q = push ? (fy[i] + gain * carry * head) * k : fy[i] * k;
        fy[i] = carry > 0
          ? q / (1 + bedGain * Math.abs(q) / (carry * carry))
            + wyv * (carry < WIND_DEPTH ? carry * INV_WIND_DEPTH : 1)
          : q;
      } else {
        fy[i] = 0;
      }
    }
  }

  // 2. Scale each cell's outflows down to the water it actually has.
  //
  // This is what makes the scheme positivity-preserving, and one pass is
  // enough: reducing an outflow can only reduce a neighbour's INflow, so no
  // cell's own limit can be violated by another cell being limited.
  for (let y = Y0; y <= Y1; y++) {
    for (let x = X0; x <= X1; x++) {
      const i = y * nx + x;
      const d = depth[i];
      let out = 0;
      if (fx[i] > 0) out += fx[i];
      if (x > 0 && fx[i - 1] < 0) out -= fx[i - 1];
      if (fy[i] > 0) out += fy[i];
      if (y > 0 && fy[i - nx] < 0) out -= fy[i - nx];
      const want = out * spread;
      if (want <= d || want <= 0) continue;
      const scale = d / want;
      if (fx[i] > 0) fx[i] *= scale;
      if (x > 0 && fx[i - 1] < 0) fx[i - 1] *= scale;
      if (fy[i] > 0) fy[i] *= scale;
      if (y > 0 && fy[i - nx] < 0) fy[i - nx] *= scale;
    }
  }

  // 3. Apply the divergence. Every unit that leaves a cell arrives in exactly
  //    one other, so the total is conserved to the last bit the floats carry.
  const { bestIn, bestMat } = f;
  for (let y = Y0; y <= Y1; y++) {
    const row = y * nx;
    delta.fill(0, row + X0, row + X1 + 1);
    bestIn.fill(0, row + X0, row + X1 + 1);
  }
  // Note the biggest contributor to each cell as we go, so a cell that fills
  // this step knows what filled it.
  const credit = (to: number, from: number, move: number) => {
    if (move > bestIn[to]) { bestIn[to] = move; bestMat[to] = material[from]; }
  };
  for (let y = Y0; y <= Y1; y++) {
    for (let x = X0; x <= X1; x++) {
      const i = y * nx + x;
      if (x + 1 < nx) {
        const move = fx[i] * spread;
        delta[i] -= move;
        // OVER A LIP it goes into the air instead, and stays there until it
        // has fallen the distance — see `falls`. Only downhill: water climbing
        // the other way is not going over anything.
        if (move > 0 && dropAt(f, i, 0) > 0) {
          intoAir(f, i, 0, move);
        } else {
          delta[i + 1] += move;
          if (move > 0) credit(i + 1, i, move);
          else if (move < 0) credit(i, i + 1, -move);
        }
      }
      if (y + 1 < ny) {
        const move = fy[i] * spread;
        delta[i] -= move;
        if (move > 0 && dropAt(f, i, 1) > 0) {
          intoAir(f, i, 1, move);
        } else {
          delta[i + nx] += move;
          if (move > 0) credit(i + nx, i, move);
          else if (move < 0) credit(i, i + nx, -move);
        }
      }
    }
  }
  // Apply, and rebuild the box from what is left wet — and with it the
  // deepest column, which is what sizes the next substep.
  const b = f.box;
  b.x0 = f.nx; b.y0 = f.ny; b.x1 = -1; b.y1 = -1;
  let deepest = 0;
  f.breaking = false;
  for (let y = Y0; y <= Y1; y++) {
    for (let x = X0; x <= X1; x++) {
      const i = y * nx + x;
      const wasDry = depth[i] <= params.dryDepth;
      // The limiter guarantees this is already non-negative; the max only
      // guards against a rounding residue leaving a tiny negative behind.
      depth[i] = Math.max(0, depth[i] + delta[i]);
      if (depth[i] > deepest) deepest = depth[i];
      // How fast the surface moved, which is what says whether it is breaking.
      // Free here: the divergence has just worked it out.
      f.rate[i] = Math.abs(delta[i]) / dt;
      if (depth[i] > params.dryDepth && params.breaking > 0) {
        stepBreaking(f, dt, i, depth[i]);
      } else {
        f.breakAge[i] = -1;
        f.broke[i] = 0;
      }
      if (depth[i] <= 0) {
        material[i] = 0;
        // A column with water in the AIR off one of its edges stays in the
        // box even when nothing is standing on it. Dropped out, the fall stops
        // being stepped and whatever is falling hangs there for ever — which
        // is what happened to a waterfall the moment its shelf ran dry.
        if (f.falls.air[i * 2] <= 0 && f.falls.air[i * 2 + 1] <= 0) continue;
      } else if (wasDry && bestMat[i]) {
        material[i] = bestMat[i];
      }
      if (x < b.x0) b.x0 = x;
      if (x > b.x1) b.x1 = x;
      if (y < b.y0) b.y0 = y;
      if (y > b.y1) b.y1 = y;
    }
  }
  f.deepest = deepest;

  // And what has finished falling lands. After the depths, so what arrives
  // this step is water that left a lip on an earlier one.
  stepFalls(f, dt, region);
}

/**
 * Flow speed at a column, in TILES a second, for advecting whatever the
 * renderer draws on it.
 *
 * Divided by a depth FLOOR rather than the depth itself. Velocity is flux over
 * depth, and across a thin film that ratio runs away — a 0.07-deep sheet
 * measured 29 tiles per second, which is physically meaningless and would send
 * anything carried by it across the map in a frame. Clamped as well, because
 * the floor alone still leaves a spike where a front first arrives.
 */
export const MAX_FLOW_SPEED = 3;

/**
 * The same, one component at a time and without the object.
 *
 * `velocityAt` returns a pair, and a pair is an allocation. Called once per
 * face that is nothing; called once per wet column to shade the surface it is
 * sixty-five thousand of them a frame on a flooded map, and it measured as
 * more than doubling the cost of the draw.
 */
export function flowX(f: ColumnField, x: number, y: number): number {
  const i = y * f.nx + x;
  const d = f.depth[i];
  if (d <= 0) return 0;
  const by = Math.max(d, f.params.dryDepth * 8);
  const west = x > 0 ? f.fx[i - 1] : 0;
  const v = (west + f.fx[i]) * 0.5 / by;
  return v > MAX_FLOW_SPEED ? MAX_FLOW_SPEED : v < -MAX_FLOW_SPEED ? -MAX_FLOW_SPEED : v;
}

export function flowY(f: ColumnField, x: number, y: number): number {
  const i = y * f.nx + x;
  const d = f.depth[i];
  if (d <= 0) return 0;
  const by = Math.max(d, f.params.dryDepth * 8);
  const north = y > 0 ? f.fy[i - f.nx] : 0;
  const v = (north + f.fy[i]) * 0.5 / by;
  return v > MAX_FLOW_SPEED ? MAX_FLOW_SPEED : v < -MAX_FLOW_SPEED ? -MAX_FLOW_SPEED : v;
}

export function velocityAt(f: ColumnField, x: number, y: number): { vx: number; vy: number } {
  if (x < 0 || y < 0 || x >= f.nx || y >= f.ny) return { vx: 0, vy: 0 };
  const i = at(f, x, y);
  const d = f.depth[i];
  if (d <= 0) return { vx: 0, vy: 0 };
  const by = Math.max(d, f.params.dryDepth * 8);
  const west = x > 0 ? f.fx[i - 1] : 0;
  const north = y > 0 ? f.fy[i - f.nx] : 0;
  const clamp = (v: number) => Math.max(-MAX_FLOW_SPEED, Math.min(MAX_FLOW_SPEED, v));
  return {
    vx: clamp((west + f.fx[i]) * 0.5 / by),
    vy: clamp((north + f.fy[i]) * 0.5 / by),
  };
}

/** How much water is moving, as a single number — for settling checks. */
export function flowEnergy(f: ColumnField): number {
  let sum = 0;
  for (let i = 0; i < f.fx.length; i++) sum += Math.abs(f.fx[i]) + Math.abs(f.fy[i]);
  return sum;
}
