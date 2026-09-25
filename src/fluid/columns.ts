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
  createFalls, dropAt, intoAir, markCliffs, stepFalls, waterInAir, type FallState,
} from "./falls";
import {
  ACROSS, SPLASH, createDrips, crown, fadeSplashes, markSplash, stepDrips,
  waterInDrips, type DripState,
} from "./drips";
import { OPEN_SKY, PRESSURE_SLOT, wetTop } from "./slots";

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
  /**
   * How many SLOTS each column is divided into. @see fluid/slots
   *
   * One is a heightfield and is what almost every field is: a column with
   * ground under it and sky over it, which is the world the solver was
   * written for and the world most of it still is. Two is a world with decks
   * in it — a bridge has a channel under it and a road over it, and those are
   * two places water can be in the same column.
   *
   * IT IS A DIMENSION AND NOT A MODE. Every per-column array is `cells *
   * layers` long and slot `a` of column `i` lives at `a * cells + i`, so slot
   * zero is the array the field has always had, in the same order, at the same
   * indices. A field with one layer is bit-for-bit the field from before this
   * existed, which is not a hope — it is what `columns.test` and the compare
   * suite go on measuring.
   */
  readonly layers: number;
  /** `nx * ny`: the stride between one slot's plane and the next. */
  readonly cells: number;
  /**
   * WHERE EACH SLOT EXISTS AT ALL, as a box per slot. @see rebuildSlots
   *
   * A second storey is a BRIDGE, and a bridge is a few tiles on a map of
   * four thousand. Walked everywhere, a field with one deck on it pays four
   * planes of every pass over the whole map to carry three planes of
   * nothing: measured on a generated map, a minute of river took 21 seconds
   * to simulate before slots and 65 after, and all of the difference was
   * empty air being stepped.
   *
   * So every pass clips its plane to this. Slot zero is the ground and its
   * box is the map, which is why nothing about a map with no decks moves.
   * An empty slot has `x1 < x0`, the same empty box `ColumnField.box` uses.
   *
   * FLAT, four numbers a slot, rather than an array of little objects. Read
   * per column per slot inside `applyDepths` the objects were a property
   * load and a field load in the innermost loop on the map, and that measured
   * as a third of the pass on its own.
   */
  readonly slotBox: Int32Array;
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
   * The water LEVEL the open rim is held at, per border column, or dry.
   *
   * Indexed by {@link rimAt}'s walk round the perimeter rather than by column,
   * because the rim is the perimeter and a whole map of numbers to describe it
   * would be the map's area to say something about its edge.
   *
   * {@link NO_INFLOW} — anything below the world's floor — is an ordinary
   * absorbing edge, so a field that never sets this behaves exactly as it did.
   * @see spill, Grid.inflow
   */
  rim: Float32Array | null;
  /** Which fluid arrives over the rim. @see setRim */
  rimMaterial: number;
  /** Bumped whenever {@link rim} changes, so a device copy knows to re-read. */
  rimRev: number;
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
  /**
   * The FLOOR of every slot: the top of the solid underneath it.
   *
   * Still called `ground` because for slot zero that is exactly what it is,
   * and because every caller that treats this as a heightfield is right to.
   * Callers keep it in step with the terrain.
   */
  readonly ground: Float32Array;
  /**
   * The ROOF of every slot: the underside of the solid over it, or the sky.
   *
   * {@link OPEN_SKY} where there is nothing above, which is every slot on
   * every field with one layer — so this array exists, costs its memory, and
   * changes no answer at all until something builds a deck. @see fluid/slots
   */
  readonly roof: Float32Array;
  /**
   * BUMPED WHENEVER THE TERRAIN UNDER THE WATER CHANGES.
   *
   * The device keeps its own copy of the ground and the host's used to be sent
   * up every frame — a quarter of a megabyte to say what it said last frame,
   * because the editor changes terrain and nothing was telling the solver when.
   * This is that telling. @see syncGround
   *
   * A COUNTER AND NOT A FLAG, so that nobody has to remember to clear it, and
   * a reader that missed a frame still sees a difference.
   *
   * `ground` is a public array and things do write to it directly — fixtures,
   * tests — which is reasonable and is why this is worth naming: a writer that
   * does not bump it leaves the device holding terrain that has moved. The
   * editor's path goes through `syncGround` and is covered; a fixture replaces
   * the grid, which rebuilds the scene and the solver with it.
   */
  groundRev: number;
  /** Water depth per column, never negative. */
  readonly depth: Float32Array;
  /**
   * Flux on the +x edge of each column, and on the +y edge — per slot PAIR.
   *
   * An edge between two columns is not one channel once the columns have
   * slots in them. A road running alongside a bridge meets BOTH of that
   * bridge's slots: its water is level with the deck, and the channel beneath
   * is a separate thing it does not touch. Each of those is its own edge with
   * its own momentum on it, and merging them is how a deck comes to leak.
   *
   * So there are `layers * layers` planes of edges, and the flux from slot `a`
   * on this side to slot `b` on the far one is at `(a * layers + b) * cells +
   * i`. Plane zero is the `fx` that has always been here.
   *
   * Most planes are empty on most maps and cost only the test that skips
   * them — see {@link connected}, which answers no for a pair that does not
   * overlap and no for a slot that is not there.
   */
  readonly fx: Float32Array;
  readonly fy: Float32Array;
  /** Scratch for one step's depth change, so a step allocates nothing. */
  readonly delta: Float32Array;
  /**
   * WHAT A STEP'S LANDINGS ADD UP TO, before any of it is applied.
   *
   * A fall used to land straight into the depth, and the next fall in the same
   * step then read that depth — for whether the cell was dry, which decides
   * its material, and for how deep it is, which sets both the plunge's cap and
   * whether it kicks at all. So the answer depended on which lip the loop
   * reached first. Measured, over ONE step with the cliff set walked
   * backwards: 3104 of 9600 values differed, the worst by 18.4 against a scale
   * of 29.4. Disabling only the landing took that to 1.16 — sixteen times
   * smaller — which is what named it.
   *
   * That is a latent fault on its own, since nothing guarantees the order
   * `markCliffs` emits edges in. It is fatal on a device, where there is no
   * order at all.
   *
   * So a landing accumulates: the WATER into `landing`, its momentum into
   * `impulse`, and the material of the biggest arrival into `landMat` by the
   * same argmax rule the divergence uses. Nothing reads a depth another
   * landing has changed, because nothing has changed one yet.
   */
  /**
   * How much room the drip list has, sampled ONCE at the top of a step.
   *
   * `dripRoom` read as each fall is reached gives whoever is reached first the
   * drops — and a drop is water, taken out of the sheet by `shedSpray` and
   * held back from the pool by the plunge's crown. So the budget, which is a
   * drawing allowance, decided the water, and the answer depended on the order
   * `markCliffs` happened to emit edges in.
   *
   * Sampled once, every fall in a step sees the same allowance and the water
   * comes out the same whichever way the set is walked. What is left over is
   * only WHICH drops get their own slot when the list is full — and a drop
   * that does not fit merges into another rather than being lost, so no water
   * turns on it.
   */
  room: number;
  /**
   * WHY THESE ARE DOUBLES, and it is not precision for its own sake.
   *
   * Banking a landing rather than applying it is what makes the falls
   * commute — but only if the BANK itself commutes, and in an f32 array it
   * does not. Every term arriving here is computed in f64 (`amount * speed`,
   * say) and `+=` on a Float32Array rounds after each one, so two lips
   * landing in one cell give `fl32(fl32(A) + B)` one way round and
   * `fl32(fl32(B) + A)` the other, and those are different numbers. Two terms
   * is enough; associativity never comes into it.
   *
   * It cost a real measurement to see. `falls-order.test.ts` went red on a
   * scene where exactly two lips met, the two contributions traced out
   * IDENTICAL and merely swapped, and the sum still differed by a float step.
   * In doubles the terms arrive unrounded and `A + B == B + A` exactly, which
   * is all this needs. Three lips into one cell would still be associativity
   * and would still not commute — the device has no such limit, because it
   * banks in fixed point, and integers associate.
   *
   * The same trap is in the argmax below: `kept > landBest[i]` against an f32
   * store can pick a different winner each way round, when `A > B` but the
   * rounded `A` is not.
   */
  readonly landing: Float64Array;
  /** `amount * speed`, summed — see `landing`. A sum, so order cannot matter. */
  readonly impulse: Float64Array;
  readonly landMat: Float32Array;
  readonly landBest: Float64Array;
  /**
   * The plunge's push, per edge, and the largest cap any contributor to it
   * wanted.
   *
   * Accumulated for the same reason and applied once — `fx[i] += room(q, cap -
   * fx[i])` clamps against the flux as it stands, so two plunges into one edge
   * gave a different answer each way round. Summed and clamped once they
   * cannot.
   */
  readonly kickX: Float64Array;
  readonly kickY: Float64Array;
  readonly capX: Float64Array;
  readonly capY: Float64Array;
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
  /**
   * Water falling in DROPS, which is not the same thing as a fall.
   *
   * A fall is a sheet going over a lip and belongs to the edge it crosses; a
   * drip is a parcel in free flight from a mouth that may be nowhere near a
   * cliff at all. See `drips.ts`.
   */
  readonly drips: DripState;
  /**
   * Set while a DEVICE solver owns this water, null otherwise.
   *
   * When it is set the host is no longer the owner: it keeps a copy for the
   * renderer and everything else to read, and what it WRITES is collected here
   * and sent up as a short list. The alternative — sending the copy back every
   * frame — is what made the two sides disagree, because then both of them own
   * the state and every frame has to reconcile them. @see Arrivals
   */
  arrivals: Arrivals | null;
  /**
   * CELLS WHOSE DEPTH THE HOST WILL READ, written down so the device can
   * answer just those.
   *
   * Null on the CPU path, where the host owns the depth and reading it is a
   * lookup. While the device owns it, every read is of a copy that came back
   * some frames ago — and bringing the whole band back to serve two hundred
   * and ninety questions was 97% of the readback. So the readers say what they
   * want: the drops before they are stepped, the pipe mouths, the cursor.
   *
   * Filled through {@link wantDepth} and emptied when it is uploaded, so
   * anything registering during a frame is answered by that frame's readback.
   * @see gatherWanted
   */
  wanted: { at: Int32Array; n: number } | null;
};

/** Slot zero is the whole map; every other slot starts out empty. */
function slotBoxes(nx: number, ny: number, layers: number): Int32Array {
  const b = new Int32Array(layers * 4);
  b[2] = nx - 1; b[3] = ny - 1;
  for (let a = 1; a < layers; a++) b[a * 4 + 3] = -1;
  return b;
}

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
/**
 * The flux below which nothing moves at all, in the flux's own units.
 *
 * A PRECURSOR FILM IS NOT WATER. An advancing front pushes a trickle ahead of
 * itself that thins without ever reaching nothing — the arithmetic has no
 * reason to stop — and at the tip that trickle is a millionth of a half step
 * over a sill. Neither solver is wrong about it and neither can be right: the
 * host carries 1.2e-6 in f64 where the device underflows the same quantity to
 * 3.4e-36 in f32, thirty orders of magnitude apart on an amount that is not
 * there.
 *
 * It matters because it feeds a THRESHOLD. The film decides which frame the
 * front tops the sill, and the pool that fills behind it is then a per cent
 * out on water that is unambiguously there — which is the whole of the
 * no-drop disagreement between the two solvers, traced cell by cell.
 *
 * THE FLUX AND NOT THE DEPTH, which is the part that has to be right. Clamping
 * a depth DESTROYS the water in it, every frame, for ever — a leak, and this
 * file's central invariant is that there is none. Clamping a flux moves
 * nothing: the head goes on building until it can push past the floor, and
 * then it pushes. What that looks like is a front that advances in steps
 * rather than creeping, which is closer to what water on a dry slope does than
 * an infinitely thin precursor is.
 *
 * A HUNDRED MILLIONTH, and the size was measured rather than picked. Real flow
 * on these maps runs between one and twenty; the trickle this exists to stop
 * was 4e-9. A millionth was tried first and it is too big — it changed the
 * outflow under a plunge by seven per cent and `falls.test` said so, which is
 * the test earning its keep. At this floor a cell fed by nothing else gains
 * about a millionth of a half step a MINUTE, against a dry depth of 0.02.
 */
export const FLUX_FLOOR = 1e-8;

/** A flux, with anything under the floor treated as the nothing it is. */
const floored = (q: number) => (q > FLUX_FLOOR || q < -FLUX_FLOOR ? q : 0);

const WIND_DEPTH = 2.5;
const INV_WIND_DEPTH = 1 / WIND_DEPTH;

export function createColumnField(
  nx: number,
  ny: number,
  params: FlowParams = FLOW_DEFAULTS,
  cell = 1,
  layers = 1,
): ColumnField {
  const cells = nx * ny;
  // Per SLOT, and per slot PAIR. At one layer both are `nx * ny` and every
  // index below is the index it always was. @see ColumnField.layers
  const n = cells * layers;
  const e = cells * layers * layers;
  const stride = Math.max(1, Math.round(WIND_TILES / cell));
  const wnx = Math.ceil(nx / stride), wny = Math.ceil(ny / stride);
  return {
    nx, ny, cell, params, layers, cells,
    slotBox: slotBoxes(nx, ny, layers),
    t: 0,
    openEdge: false,
    rim: null,
    rimMaterial: 1,
    rimRev: 0,
    windX: new Float32Array(wnx * wny),
    windY: new Float32Array(wnx * wny),
    wnx, wny, wstride: stride,
    ground: new Float32Array(n),
    // NOTHING OVERHEAD until something says otherwise, which is the whole of
    // what makes a one-layer field the field it was. @see OPEN_SKY
    roof: new Float32Array(n).fill(OPEN_SKY),
    groundRev: 0,
    depth: new Float32Array(n),
    fx: new Float32Array(e),
    fy: new Float32Array(e),
    delta: new Float32Array(n),
    room: 1,
    landing: new Float64Array(n),
    impulse: new Float64Array(n),
    landMat: new Float32Array(n),
    landBest: new Float64Array(n),
    kickX: new Float64Array(e),
    kickY: new Float64Array(e),
    capX: new Float64Array(e),
    capY: new Float64Array(e),
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
    falls: createFalls(nx, ny, layers),
    drips: createDrips(nx, ny, layers),
    arrivals: null,
    wanted: null,
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
  const { nx, ny, cells, layers, depth, material, ground, roof, rim, rimMaterial } = f;
  const n = rimLength(nx, ny);
  for (let k = 0; k < n; k++) {
    const i = rimAt(nx, ny, k);
    const level = rim ? rim[k] : NO_INFLOW;
    for (let a = 0; a < layers; a++) {
      const ia = a * cells + i;
      // HELD, OR EMPTIED, and the two are one expression rather than two
      // cases: an absorbing edge is an inflow whose level is below the
      // ground, so there is no branch here that a map without an inflow
      // takes and a map with one does not. @see NO_INFLOW
      //
      // THE SLOT THE LEVEL IS IN, and only that one. A river arriving at the
      // edge of the map arrives in the channel; if there happens to be a
      // deck over that channel the deck is not also full of river. Every
      // other slot on the rim is emptied, which is what an open edge does.
      const held = level - ground[ia];
      if (held > 0 && ground[ia] + held <= roof[ia]) {
        depth[ia] = held;
        material[ia] = rimMaterial;
        // WATER THE FIELD DOES NOT OTHERWISE KNOW ABOUT. Everything else that
        // puts water down goes through `addWater`, which widens the active box
        // and raises the deepest column; this writes the depth itself, so it
        // owes both. Without the box the solver looks at an empty region and
        // does nothing at all — a rim held at its level, and a map still dry
        // half a minute later. @see include, ColumnField.deepest
        include(f, i % nx, (i / nx) | 0);
        if (held > f.deepest) f.deepest = held;
      } else { depth[ia] = 0; material[ia] = 0; }
    }
  }
}

/**
 * A level below anything the world can hold: an ordinary absorbing edge.
 *
 * Heights are clamped to a hundred and twenty six half steps, so this is not
 * merely large, it is unreachable — which is what lets "no inflow" and "an
 * inflow this low" be the same thing and spares the boundary a second array
 * saying which cells are which.
 */
export const NO_INFLOW = -1e9;

/** How many entries a field's rim has. @see rimAt */
export const rimLength = (nx: number, ny: number) => nx * 2 + ny * 2;

/**
 * The column the `n`th step round the rim lands on.
 *
 * WRITTEN ONCE AND READ BY BOTH SOLVERS. The device walks the border in a
 * compute pass, one thread per step, and the host walks it here; if the two
 * disagree about which column is the ninth step the maps differ along one
 * edge, which is exactly the kind of seam that gets blamed on the solver.
 *
 * THE FOUR CORNERS ARE VISITED TWICE, once by a row and once by a column, and
 * nothing here stops that — clearing a cleared column is still a cleared
 * column. It matters only for a held level, where two entries name one column
 * and the later write wins, so whoever fills the array owes it the same answer
 * for both. @see buildRim, which gets it by reading the column rather than the
 * step.
 */
export function rimAt(nx: number, ny: number, n: number): number {
  if (n < nx) return n;                                    // the top row
  if (n < nx * 2) return (ny - 1) * nx + (n - nx);         // the bottom row
  if (n < nx * 2 + ny) return (n - nx * 2) * nx;           // the left column
  return (n - nx * 2 - ny) * nx + nx - 1;                  // the right column
}

/**
 * Hold the rim at these levels, or pass null to make it absorbing again.
 *
 * The array is kept, not copied: it is rebuilt from the map whenever the
 * ground under it moves, and a copy here would be a second thing to keep in
 * step. @see ColumnField.rim
 */
export function setRim(f: ColumnField, rim: Float32Array | null, material = 1) {
  f.rim = rim;
  f.rimMaterial = material;
  f.rimRev++;
}

/** Material indices the per-material drag table covers. */
export const MATERIAL_SLOTS = 16;

/** Give a material its own flux retention. 0 leaves it on the field default. */
export function setMaterialDrag(f: ColumnField, material: number, drag: number) {
  if (material >= 0 && material < MATERIAL_SLOTS) f.dragOf[material] = drag;
}

export const at = (f: ColumnField, x: number, y: number) => y * f.nx + x;

/**
 * Surface height of a SLOT: its floor plus whatever stands on it.
 *
 * `i` is a slot index — `a * cells + column` — and at one layer that is a
 * column index, which is what every caller written before slots existed
 * passes and is right to.
 *
 * The WATER's top rather than its hydraulic surface: this is what the thing
 * is seen at, landed on and picked with, and a slot running full under a deck
 * is all of those at the soffit. The pressure head is the solver's business
 * and stays inside it. @see wetTop, head
 */
export const surfaceAt = (f: ColumnField, i: number) =>
  wetTop(f.ground[i], f.roof[i], f.depth[i]);

/**
 * The plane a RAW push should be written to, or -1 if there is nowhere to go.
 *
 * A head-driven flux works itself out: `accelerate` visits every plane and
 * the ones that are not connected come out zero. A plunge and a crater do
 * not — they are momentum written straight onto an edge, and an edge has to
 * be chosen. So: the connected plane with the most gap in it, which on a map
 * with no decks is the only plane there is.
 *
 * THE LARGEST AND NOT THE FIRST, so the answer does not depend on the order
 * the slots happen to be numbered in. A splash at the mouth of a bridge can
 * reach the deck and the channel both; it goes through the bigger opening.
 */
export function pushPlane(
  f: ColumnField, i: number, axis: number, a: number, back: boolean, surface: number,
): number {
  const { nx, ny, cells, layers, ground, roof } = f;
  const x = i % nx, y = (i / nx) | 0;
  const step = axis === 0 ? 1 : nx;
  const jx = axis === 0 ? (back ? x - 1 : x + 1) : x;
  const jy = axis === 1 ? (back ? y - 1 : y + 1) : y;
  if (jx < 0 || jy < 0 || jx >= nx || jy >= ny) return -1;
  const j = back ? i - step : i + step;
  const ia = a * cells + i;
  const fa = ground[ia], ra = roof[ia];
  let best = -1, most = 0;
  for (let b = 0; b < layers; b++) {
    const jb = b * cells + j;
    // AND ONLY ONTO GROUND THE WATER COULD GET TO, which is the test this
    // has always made and is why it takes a surface. A crater is a raw flux
    // rather than something a head drove, so it is the one thing on the map
    // not subject to the sill — and at the foot of a cliff that means a drop
    // landing in the plunge pool shoves water UP the rock face. Measured on a
    // twenty half step shelf over a flooded plain, drops landing at the
    // bottom put four hundredths of a unit on top of the shelf.
    if (ground[jb] >= surface) continue;
    const lo = fa > ground[jb] ? fa : ground[jb];
    const hi = ra < roof[jb] ? ra : roof[jb];
    const gap = hi - lo;
    if (gap > most) { most = gap; best = b; }
  }
  if (best < 0) return -1;
  // On the way BACK the edge belongs to the neighbour, so the near side of it
  // is the neighbour's slot and this one is the far side.
  return back ? (best * layers + a) * cells + j : (a * layers + best) * cells + i;
}

/**
 * The slot a thing at height `z` would come down on, as a slot index.
 *
 * THE HIGHEST SURFACE AT OR BELOW IT, which is what falling means. A drop
 * over a bridge lands on the bridge; the same drop a storey lower, having
 * come out of a pipe under the span, lands in the river — and a column that
 * cannot tell those apart puts both of them on the deck.
 *
 * Nothing below it at all — a drop under the lowest floor there is, which is
 * a drop inside the world — falls back to slot zero, the ground, because
 * landing it somewhere is better than losing it.
 */
export function slotUnder(f: ColumnField, i: number, z: number): number {
  let best = i, top = -Infinity;
  for (let a = 0; a < f.layers; a++) {
    const ia = a * f.cells + i;
    if (f.roof[ia] <= f.ground[ia]) continue;   // not a slot at all
    const s = surfaceAt(f, ia);
    if (s <= z && s > top) { top = s; best = ia; }
  }
  return best;
}

/**
 * Work out where each slot exists, and clear anything left over.
 *
 * Once a frame, off the geometry, exactly as `markCliffs` is and for the same
 * reason: `ground` and `roof` are public arrays that fixtures and tests write
 * to directly, so a derived index with an invalidation protocol is a rule
 * somebody has to remember. Rebuilt from scratch, there is no protocol to get
 * wrong. It costs one pass of two comparisons per slot.
 *
 * CLEARING IS THE PART THAT IS NOT OBVIOUS. A plane the passes have stopped
 * visiting keeps whatever flux it last had, for ever — so a bridge taken down
 * would leave momentum standing in the air where its deck used to be, and a
 * bridge put back would start with it. Whenever a box moves, every plane
 * above the ground's is emptied; the ground's is the whole map and never
 * moves.
 */
export function rebuildSlots(f: ColumnField): void {
  const { nx, ny, cells, layers, ground, roof, slotBox } = f;
  if (layers < 2) return;                       // slot zero is the map
  let moved = false;
  for (let a = 1; a < layers; a++) {
    const A = a * cells;
    let x0 = nx, y0 = ny, x1 = -1, y1 = -1;
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const ia = A + y * nx + x;
        if (roof[ia] <= ground[ia]) continue;   // absent
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < x0) { x0 = 0; y0 = 0; y1 = -1; }   // the empty box
    const k = a * 4;
    if (slotBox[k] !== x0 || slotBox[k + 1] !== y0
      || slotBox[k + 2] !== x1 || slotBox[k + 3] !== y1) {
      moved = true;
      slotBox[k] = x0; slotBox[k + 1] = y0; slotBox[k + 2] = x1; slotBox[k + 3] = y1;
    }
  }
  if (!moved) return;
  f.fx.fill(0, cells);
  f.fy.fill(0, cells);
}

/**
 * A slot pair's region: where the near slot is and the far one is beside it.
 *
 * The far box is grown by one because the edge reaches into the next column,
 * and the whole thing is clipped to the water's own active box. Written into
 * a caller's scratch rather than returned, so a pass that asks for it once
 * per plane allocates nothing.
 */
export function planeRegion(
  f: ColumnField, a: number, b: number,
  X0: number, Y0: number, X1: number, Y1: number,
  out: { x0: number; y0: number; x1: number; y1: number },
): boolean {
  const s = f.slotBox, p = a * 4, q = b * 4;
  out.x0 = Math.max(X0, s[p], s[q] - 1);
  out.y0 = Math.max(Y0, s[p + 1], s[q + 1] - 1);
  out.x1 = Math.min(X1, s[p + 2], s[q + 2] + 1);
  out.y1 = Math.min(Y1, s[p + 3], s[q + 3] + 1);
  return out.x1 >= out.x0 && out.y1 >= out.y0;
}

/** The slot index of slot `a` in the column at `i`. */
export const slotAt = (f: ColumnField, i: number, a: number) => a * f.cells + i;

/**
 * The plane a slot PAIR's edges live on. @see ColumnField.fx
 *
 * `a` is the slot on the near side of the edge and `b` the one on the far
 * side, so the same physical connection is `pair(a, b)` looked at from one
 * column and `pair(b, a)` from the other.
 */
export const pairOf = (f: ColumnField, a: number, b: number) => a * f.layers + b;

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
  // Water in the air counts. A drop on its way down is still a drop, whether
  // it is a sheet coming off a lip or a parcel out of a pipe.
  return sum + waterInAir(f) + waterInDrips(f.drips);
}

/**
 * Add (or remove) water at a column, never taking it below empty.
 *
 * A `material` of 0 leaves whatever is there alone, so draining never rewrites
 * what it is draining.
 */
export function addWater(
  f: ColumnField, x: number, y: number, amount: number, material = 0, a = 0,
) {
  if (x < 0 || y < 0 || x >= f.nx || y >= f.ny) return;
  if (a < 0 || a >= f.layers) return;
  const i = a * f.cells + at(f, x, y);
  const next = Math.max(0, f.depth[i] + amount);
  if (material && amount > 0) f.material[i] = material;
  // WHAT ACTUALLY WENT IN, which is not always what was asked for: a drain
  // that asks for more than is there takes what is there.
  if (f.arrivals) note(f.arrivals, i, next - f.depth[i], material);
  f.depth[i] = next;
  if (next <= 0) f.material[i] = 0;
  if (next > 0) include(f, x, y);
  if (next > f.deepest) f.deepest = next;
}

/**
 * WHAT THE HOST HAS PUT IN SINCE THE DEVICE LAST LOOKED.
 *
 * The device owns the water when it is running, and the host does not send it
 * back — it sends what it has ADDED. This is where that is collected: a
 * per-cell accumulator with a list of which cells have been touched, so what
 * goes up is a few dozen numbers rather than a megabyte of arrays, and so that
 * two writes to one cell in a frame arrive as one number rather than as two
 * threads racing to add to the same place.
 *
 * It exists only while a device solver is attached. On the CPU path `arrivals`
 * is null, `note` is never called, and none of this costs anything.
 */
export type Arrivals = {
  /** Cells touched this frame, in order, each one once. */
  readonly cell: Int32Array;
  /** Per cell, what has been added to it. Only `cell[0..n]` is meaningful. */
  readonly depth: Float32Array;
  readonly fx: Float32Array;
  readonly fy: Float32Array;
  readonly mat: Uint8Array;
  /** Whether a cell is already in `cell`, so it is listed once. */
  readonly listed: Uint8Array;
  n: number;
};

/**
 * Ask for a cell's depth in the next readback.
 *
 * A no-op on the CPU path and past the cap, and BOTH are silent on purpose: a
 * reader that is not answered reads whatever the last full refresh left, which
 * is the same thing it would have read before any of this existed. The cap is
 * sized for every reader at once. @see ColumnField.wanted, WANT_MAX
 */
export function wantDepth(f: ColumnField, i: number): void {
  const w = f.wanted;
  if (!w || i < 0 || i >= f.depth.length || w.n >= w.at.length) return;
  w.at[w.n++] = i;
}

export function createArrivals(cells: number): Arrivals {
  return {
    cell: new Int32Array(cells), depth: new Float32Array(cells),
    fx: new Float32Array(cells), fy: new Float32Array(cells),
    mat: new Uint8Array(cells), listed: new Uint8Array(cells), n: 0,
  };
}

/** Add to a cell's pending arrival, listing it the first time. @see Arrivals */
function reach(a: Arrivals, i: number): void {
  if (a.listed[i]) return;
  a.listed[i] = 1;
  a.cell[a.n++] = i;
}

export function note(a: Arrivals, i: number, amount: number, material: number) {
  if (amount === 0 && !material) return;
  reach(a, i);
  a.depth[i] += amount;
  if (material && amount > 0) a.mat[i] = material;
}

/** The same, for a flux an arrival pushed — see the crater in `splashInto`. */
export function noteFlux(a: Arrivals, i: number, dx: number, dy: number) {
  if (dx === 0 && dy === 0) return;
  reach(a, i);
  a.fx[i] += dx;
  a.fy[i] += dy;
}

/** Everything is on the device; start collecting again. @see Arrivals */
export function clearArrivals(a: Arrivals) {
  for (let k = 0; k < a.n; k++) {
    const i = a.cell[k];
    a.listed[i] = 0; a.depth[i] = 0; a.fx[i] = 0; a.fy[i] = 0; a.mat[i] = 0;
  }
  a.n = 0;
}

/**
 * Reference impact speed, in half steps a second: a landing this fast digs as
 * big a crater as a drop of {@link DROP}'s size ever digs.
 *
 * A drop off a five step lip arrives at about forty — `sqrt(2 g h)` on the
 * fall gravity — so this is "a decent drop", and a pipe hanging a hand's
 * breadth over a pool makes a ripple rather than a bomb crater.
 */
export const IMPACT_REF = 40;

/** Radial flow a full impact drives, in tiles a second. */
const CRATER = 1.1;

/**
 * Never more than this much of the local wave speed.
 *
 * A crater is an initial condition for the solver, not an effect painted on
 * it, so it has to be one the solver can carry: `sqrt(gravity * depth)` is how
 * fast news travels in water that deep, and shoving faster than that is asking
 * a scheme with a Courant limit to represent something supersonic. It rings
 * instead. Half of it leaves room for the wave the crater itself becomes.
 */
const CRATER_CAP = 0.5;

/** Water at least this many times the drop's own depth has room for a crater. */
const CRATER_ROOM = 3;

/**
 * How fast a drop has to arrive to throw a crown, in half steps a second, and
 * how much of itself it throws.
 *
 * The real criterion is a Weber number, `We = rho v^2 d / sigma`, of about
 * forty: below it the drop merges with a ripple and nothing leaves the
 * surface, above it the crater's rim goes unstable and flings droplets off.
 * With the drop size fixed by {@link DROP} the Weber number is a speed, so
 * that is what this is. Thirty is a fall of about three full steps.
 */
export const CROWN_SPEED = 30;
const CROWN_SHARE = 0.22;

/**
 * How hard a plunge drives the water away from it, against the momentum the
 * sheet actually arrives with.
 *
 * One would be the honest number: all of the jet's downward momentum turned
 * sideways at the bed, which is nearly what a plunging jet does. It is set at
 * three, and it is worth being exact about why rather than calling it a
 * fraction and quietly using four.
 *
 * At one, the depression this digs is 0.25 of a half step in a pool two and a
 * half deep — and that is not a bug, it is the answer. The forcing settles
 * where it balances the pressure gradient it has made, `q = gain * carry *
 * head`, which for this fall predicts 0.30 against 0.25 measured. Real
 * waterfalls do not dig visible holes in the water surface either. But a
 * tenth of a half step is a dimple nobody can see at any zoom this game is
 * played at, and a waterfall whose pool is indistinguishable from a pool under
 * a tap is the thing this is here to fix.
 *
 * So it is exaggerated, in the same spirit and for the same reason as
 * {@link CRATER} — a single drop does not really drive a tile a second of
 * radial flow either. Three is where the pool reads as driven: measured on a
 * river over a twenty-four half step cliff, 2.39 half steps deep and flowing
 * at 0.61 becomes 1.08 deep and flowing at 1.48. Past three the cap takes over
 * and it stops changing, which is the right place for a knob to stop.
 */
export const PLUNGE_PUSH = 3;

/**
 * How fast a plunge may drive the water away from it, against the wave speed.
 *
 * The same rule a crater obeys and for the same reason — `sqrt(gravity *
 * depth)` is how fast news travels in water that deep and a scheme with a
 * Courant limit cannot carry anything faster — but it applies DIFFERENTLY,
 * because a fall is not an impulse. A drop arrives once and the cap is on what
 * that one arrival may do; a sheet arrives every step for as long as the river
 * runs, so the cap is on the flow it BUILDS, and the forcing stops adding once
 * the outflow is there. Left uncapped it is an accelerating push with only
 * drag against it and the pool below a tall fall empties itself.
 *
 * Higher than a crater's half, because a plunge pool really does run out at
 * the critical speed — that is what the white tongue spreading away from the
 * foot of a waterfall IS. And it is a cap on the EDGE's flux and not on a
 * quarter of it: the quartering belongs to the momentum being split four ways,
 * not to how fast any one of the four may end up going. Quartered as well, the
 * cap came out below the outflow the pool's own head was already driving, so
 * the plunge could never add anything to it and the foot of a waterfall ran
 * SLOWER than the same water arriving from a tap.
 */
export const PLUNGE_CAP = 1;

/**
 * How much of what arrives fast comes back up as a plume, at most.
 *
 * A garnish and not the mechanism, which took some getting right. The plume
 * moves real water out of the impact and lands it a column or two away, so it
 * digs a depression all by itself — and in the first version of this it was
 * digging MOST of it, with the momentum contributing a fifth. That is a bad
 * way round for it to be, because whether the plume becomes drops at all is a
 * question about the length of a list: a wide fall would have hit the budget,
 * stopped making drops, and lost its plunge along with them. Now the momentum
 * carries it — with the plume switched off entirely the pool is 1.08 deep and
 * flowing at 1.48 against 1.06 and 1.63 with it.
 */
export const PLUNGE_SPRAY = 0.05;

/** How much of the drip list a plunge leaves for everything else. */
export const PLUNGE_ROOM = 0.3;

/** How white a plunge makes the water it lands in, per unit arriving. */
export const PLUNGE_WHITE = 9;

/**
 * A SHEET arriving at the bottom of a fall: the water goes in, and the
 * momentum it arrived with goes OUT across the pool.
 *
 * The thing that makes a waterfall do something to the water under it rather
 * than be a picture hung in front of it. A fall used to arrive as
 * `depth[to] += amount` — the whole of it, at rest, as though poured from a
 * jug a hand's breadth above the surface — so the pool under a thirty half
 * step drop was as still as a pond, and everything that looked like a plunge
 * was foam painted on and the odd drop shed off the sheet. Measured on a
 * twenty-four half step fall, the water in the receiving column moved at 0.02
 * columns a second, which is nothing.
 *
 * A jet hitting a pool turns at the bed and runs away radially, and the
 * DIVERGENCE of that is the standing depression you see under a waterfall —
 * so it is not painted either, it comes out of the same continuity the rest of
 * the solver runs on, along with the ring that travels away from it and the
 * hydraulic jump where that ring meets still water.
 *
 * This is {@link splashInto} for something that keeps arriving: a drop's
 * crater is an impulse capped at what one arrival may do, a plunge is a
 * FORCING capped at the flow it may build. Same cap, different thing capped.
 */
export function plungeInto(
  f: ColumnField, x: number, y: number, amount: number, material: number, speed: number,
  a = 0,
): void {
  if (x < 0 || y < 0 || x >= f.nx || y >= f.ny) return;
  const i = a * f.cells + at(f, x, y);
  // Some of it never joins the pool: a sheet coming in hard throws a plume
  // straight back up, which is the loudest thing about a waterfall — if there
  // are drops to spare for one. A crown is at least one drop however little is
  // thrown, so a fall ninety columns wide fills the whole list in two frames
  // if it is asked for a plume per column, and past the end of that list a
  // drop is merged into another one and arrives somewhere it never was. Where
  // there is no room the water simply stays in the pool: it is the same water
  // either way, and whether it is drawn as drops is a budget rather than a
  // fact about the water. See `PLUNGE_SPRAY` for why it is only a garnish.
  const spray = speed > CROWN_SPEED && f.room > PLUNGE_ROOM
    ? amount * PLUNGE_SPRAY * Math.min(1, (speed - CROWN_SPEED) / CROWN_SPEED)
    : 0;

  // BANKED, NOT APPLIED — see `ColumnField.landing`. Nothing here reads a
  // depth, so nothing here can depend on which lip landed first.
  const kept = amount - spray;
  f.landing[i] += kept;
  f.impulse[i] += kept * speed;
  if (material && kept > f.landBest[i]) {
    f.landBest[i] = kept;
    f.landMat[i] = material;
  }

  if (spray > 0) crown(f.drips, x, y, surfaceAt(f, i), spray, material, speed);
  // And it is WHITE, which the solver's own breaking test cannot tell: that
  // reads the rate the surface is changing, and a sheet delivered straight
  // into the depth never touches it. A max, so it does not care about order.
  // IN THE SLOT IT LANDED IN, which is what `i` already is: the device banks
  // this same white at the landing slot, so reducing it to a column here put
  // a plunge into a deck's channel on storey nought and the two paths' foam
  // parted by a third of the scale. @see bankLanding, markSplash
  markSplash(f.drips, i, (amount * PLUNGE_WHITE * speed) / IMPACT_REF);
  include(f, x, y);
}

/**
 * Put the step's landings into the water, and turn their momentum outward.
 *
 * FOUR PHASES, EACH ORDER-FREE, and the order between them is the whole point:
 *
 *  1. the landings are banked as they happen — see `ColumnField.landing`;
 *  2. here, the water goes in and every cell's depth is final;
 *  3. the plunge's push is worked out from THAT depth and banked per edge;
 *  4. and each edge's push is clamped against its cap, once.
 *
 * Phase 3 reading a depth phase 2 has finished with is what keeps the cap and
 * the wet test the same for every contributor. Phase 4 clamping a sum rather
 * than each arrival is what makes two plunges into one edge commute.
 *
 * A cell hit by ONE fall — which is every fixture the plunge is looked at on —
 * comes out exactly where it did before.
 */
export function applyLandings(f: ColumnField) {
  const {
    depth, ground, fx, fy, material, params,
    landing, impulse, landMat, landBest, kickX, kickY, capX, capY,
  } = f;
  const b = f.box;
  // 2. THE WATER, and the material it brought, decided against the depth as
  //    it stood before any of this step's landings — which is what the old
  //    code did too, for the first landing into a cell.
  for (let i = 0; i < landing.length; i++) {
    if (landing[i] <= 0) continue;
    if (landMat[i] && depth[i] <= params.dryDepth) material[i] = landMat[i];
    depth[i] += landing[i];
  }
  // 3. THE PUSH, from the depth as it now stands.
  for (let ia = 0; ia < impulse.length; ia++) {
    if (impulse[ia] <= 0) continue;
    const h = depth[ia];
    if (h <= params.dryDepth) continue;
    const i = ia % f.cells, a = (ia / f.cells) | 0;
    // Turned at the bed and sent out four ways. Only onto ground the water
    // could reach — the cliff it just came off is RIGHT THERE, and a plunge
    // that pushes back up its own wall is a waterfall feeding itself.
    //
    // Beware the units, which is what got this wrong the first time. The sheet
    // arrives in HALF STEPS a second and the solver moves water in TILES a
    // second; a half step draws at an eighth of a tile, which is half a
    // COLUMN, so `ACROSS` converts to columns and `cell` from columns to
    // tiles.
    const cap = h * PLUNGE_CAP * Math.sqrt(params.gravity * h);
    const q = impulse[ia] * (ACROSS * f.cell) * PLUNGE_PUSH * 0.25;
    const surface = ground[ia] + h;
    // ONTO THE EDGE THE WATER CAN ACTUALLY USE — see `pushPlane`. The old
    // test was "is the ground over there lower than my surface", which is
    // the same question a heightfield can ask; with slots the answer has to
    // say WHICH opening, and a plane of -1 is no opening at all.
    const e = pushPlane(f, i, 0, a, false, surface);
    if (e >= 0) { kickX[e] += q; if (cap > capX[e]) capX[e] = cap; }
    const w = pushPlane(f, i, 0, a, true, surface);
    if (w >= 0) { kickX[w] -= q; if (cap > capX[w]) capX[w] = cap; }
    const so = pushPlane(f, i, 1, a, false, surface);
    if (so >= 0) { kickY[so] += q; if (cap > capY[so]) capY[so] = cap; }
    const no = pushPlane(f, i, 1, a, true, surface);
    if (no >= 0) { kickY[no] -= q; if (cap > capY[no]) capY[no] = cap; }
  }
  // 4. AND THE CLAMP, once per edge. A push can only ever move a flux AWAY
  //    from nought and never past the cap, which is what `room` said one
  //    arrival at a time.
  for (let i = 0; i < kickX.length; i++) {
    const kx = kickX[i];
    if (kx > 0) fx[i] = Math.max(fx[i], Math.min(fx[i] + kx, capX[i]));
    else if (kx < 0) fx[i] = Math.min(fx[i], Math.max(fx[i] + kx, -capX[i]));
    const ky = kickY[i];
    if (ky > 0) fy[i] = Math.max(fy[i], Math.min(fy[i] + ky, capY[i]));
    else if (ky < 0) fy[i] = Math.min(fy[i], Math.max(fy[i] + ky, -capY[i]));
  }
  landing.fill(0);
  impulse.fill(0);
  landMat.fill(0);
  landBest.fill(0);
  kickX.fill(0);
  kickY.fill(0);
  capX.fill(0);
  capY.fill(0);
  void b;
}

/** As much of `want` as `left` has room for, and never backwards. */

/**
 * A drop landing: its water goes in, its MOMENTUM goes out.
 *
 * The part that makes a drop interact with the water rather than being pasted
 * on top of it. A drop arrives with `m v` of downward momentum and the surface
 * has to do something with it; what it does is get out of the way. The fluid
 * is pushed aside into a crater, the crater's walls stand above the rest of
 * the surface, and gravity pulls them back down and past — which is a ring
 * wave, spreading. Nobody has to draw the ring. It is what this scheme does
 * with a hole in a surface, and the hole is the only thing put in.
 *
 * Vertical velocity is not a variable a shallow water scheme HAS — that is the
 * shallow water assumption — so the momentum cannot be handed over as itself.
 * Its consequence can: an outward flux on the four edges of the column that
 * was hit, which is the crater, capped at {@link CRATER_CAP} of the wave speed
 * so the solver is never asked for something faster than it can carry.
 *
 * Returns the volume thrown back up as SPRAY — the crown — which the caller
 * puts back in the air as drops. Only water deep enough to have a crater can
 * throw one; a drop landing on dry ground or on a film just wets it.
 */
export function splashInto(
  f: ColumnField, x: number, y: number, volume: number, material: number, speed: number,
  a = 0,
): number {
  if (x < 0 || y < 0 || x >= f.nx || y >= f.ny) return 0;
  const col = at(f, x, y);
  const i = a * f.cells + col;
  const h = f.depth[i];
  // How much room the water under it has: a crater needs somewhere to go.
  const room = Math.min(1, h / Math.max(1e-6, volume * CRATER_ROOM));
  const hit = Math.min(1, speed / IMPACT_REF);

  if (room > 0 && hit > 0) {
    const wave = Math.sqrt(f.params.gravity * h);
    const out = Math.min(CRATER_CAP * wave, CRATER * hit * room);
    // Split four ways, and only onto edges that exist — the rim of the map is
    // a wall, and a flux written onto it is a flux the solver zeroes anyway.
    //
    // And only onto ground the water could actually get to. A crater is a raw
    // flux, written straight onto the edges rather than driven by a head, so
    // it is the one thing on the map that is not subject to the sill the rest
    // of the solver measures everything from — and at the foot of a cliff that
    // means a drop landing in the plunge pool shoves water UP the rock face.
    // Nothing noticed while the only drops were pipe drips landing in the
    // open; a fall sheds its spray exactly where a cliff is. Measured on a
    // twenty half step shelf over a flooded plain, drops landing at the bottom
    // put four hundredths of a unit of water on top of the shelf, which is
    // water climbing twelve half steps with nothing pushing it.
    const surface = f.ground[i] + h;
    const q = h * out * 0.25;
    const arr = f.arrivals;
    // Split four ways, and only onto edges that exist and that the water
    // could get through — see `pushPlane`, which is the same rule the plunge
    // uses and the reason it is one function.
    const e = pushPlane(f, col, 0, a, false, surface);
    if (e >= 0) { f.fx[e] += q; if (arr) noteFlux(arr, e, q, 0); }
    const w = pushPlane(f, col, 0, a, true, surface);
    if (w >= 0) { f.fx[w] -= q; if (arr) noteFlux(arr, w, -q, 0); }
    const so = pushPlane(f, col, 1, a, false, surface);
    if (so >= 0) { f.fy[so] += q; if (arr) noteFlux(arr, so, 0, q); }
    const no = pushPlane(f, col, 1, a, true, surface);
    if (no >= 0) { f.fy[no] -= q; if (arr) noteFlux(arr, no, 0, -q); }
  }

  const spray = speed > CROWN_SPEED && room >= 1
    ? volume * CROWN_SHARE * Math.min(1, (speed - CROWN_SPEED) / CROWN_SPEED)
    : 0;
  addWater(f, x, y, volume - spray, material, a);
  return spray;
}

/** Widen the active box to cover a column. */
export function include(f: ColumnField, x: number, y: number) {
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

export function stirWind(f: ColumnField) {
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
 * And GIVES WAY is the whole of it: past this, `substepsFor` stops and the
 * rest of the frame's time is not integrated at all. The simulation runs
 * SLOWER THAN REAL TIME rather than taking a step too long for the water in
 * it. Running slow is a thing you can look at; ringing is not.
 *
 * This used to claim `hMax` caught what was left by holding the wave speed
 * down. It does not and never did — nothing stretches the step, the time is
 * simply dropped — and the difference matters to everything else that is
 * given the frame's dt. @see maxStep
 */
const MAX_SUBSTEPS = 12;

export function stepFlow(f: ColumnField, dt: number) {
  // WHERE THE GROUND MAKES A CLIFF, once a frame — see `FallState.cliff`.
  //
  // Here rather than wherever the ground is written, and rebuilt rather than
  // invalidated, because a derived index with an invalidation protocol is a
  // rule somebody has to remember: `ground` is a public array and the tests
  // write to it directly, quite reasonably. Ground cannot change during a
  // frame — the editor writes it between them — so once at the top is always
  // current, and there is no protocol to get wrong.
  //
  // It costs one pass of two comparisons per column. What it saves is
  // `stepFalls` walking the whole box every SUBSTEP doing much more than that.
  // WHERE THE SLOTS ARE, on the same terms and for the same reasons.
  rebuildSlots(f);
  markCliffs(f);
  for (const h of substepsFor(f, dt)) substep(f, h);
}

/**
 * How a frame is cut into substeps.
 *
 * Lifted out because the device solver has to cut the frame the same way and
 * a stepping rule written twice is a pair of solvers that diverge for a
 * reason that is nobody's physics. The device plans its frame from the
 * `deepest` its last reduction reported, which is a frame stale — the `hMax`
 * backstop in `substep` is what makes that safe, exactly as it is here.
 *
 * The list is short by construction: the guard is the same {@link
 * MAX_SUBSTEPS} the loop used to carry, and a frame that runs out of substeps
 * simply does not finish its dt, which is the old behaviour written down.
 */
/**
 * The most simulated time one call can advance, from the water as it stands.
 *
 * `stepFlow` cuts `dt` into substeps no longer than `stableStep` and stops at
 * {@link MAX_SUBSTEPS} of them, so anything past this product is dropped. Ask
 * for it BEFORE handing a frame's dt to anything, and hand everything the same
 * answer: a frame that only integrates a fifth of its time must only pour a
 * fifth of its springs, or the map gains water it has had no time to move.
 *
 * Measured on a spring at 48 squared, five seconds of wall clock in one-second
 * frames — which is what a backgrounded tab's throttled rAF hands over. The
 * flow advances one second either way. Unclamped the map held 80 of water;
 * clamped it holds 16, which is what five seconds of one-sixtieth frames hold
 * after the same one second of flow.
 */
export const maxStep = (f: ColumnField) => MAX_SUBSTEPS * stableStep(f);

export function substepsFor(f: ColumnField, dt: number): number[] {
  const out: number[] = [];
  let left = dt;
  while (left > 1e-6 && out.length < MAX_SUBSTEPS) {
    const h = Math.min(left, stableStep(f));
    out.push(h);
    left -= h;
  }
  return out;
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
export const VERTICAL = 1 / 8;
export const MIXING = 1.44 * VERTICAL * VERTICAL;

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
export const BREAK_START = 0.65 / VERTICAL;
export const BREAK_STOP = 0.15 / VERTICAL;
export const PERSIST = 5;

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
export const SWEEPS = 2;

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
 * Constants a substep works out once and every pass then reads.
 *
 * Passed rather than recomputed because the GPU gets them as a uniform block
 * and the two have to be the same numbers — a pass that derives its own is a
 * pass that can disagree with its twin about `dt`.
 */
export type PassConsts = {
  x0: number; y0: number; x1: number; y1: number;
  /** `gravity * dt / cell` — a head becomes a gradient. */
  gain: number;
  /** `bedDrag * dt`. */
  bedGain: number;
  /** Deepest water the flux term credits, from the CFL condition. */
  hMax: number;
  /** `minSlope * cell` — the slope below which nothing accelerates. */
  minHead: number;
  /** `dt / cell` — a flux crosses one edge, the depth it moves is one cell. */
  spread: number;
  /** `dt / cell^2` — a viscosity is a length squared over a time. */
  diffScale: number;
  dt: number;
};

/**
 * PASS 1 — every edge accelerated by the head across it and the water able to
 * carry it, then dragged.
 *
 * Lifted out of `substep` whole and unchanged. It is a pure GATHER: an edge
 * reads only the two cells it lies between and writes only itself, which is
 * what makes it the first pass worth moving to the device and the easiest to
 * prove right there — see `fluid/gpu/accelerate`, its twin, and
 * `fluid/compare`, which is how the two are held together.
 */
export function accelerate(f: ColumnField, c: PassConsts) {
  const { x0: X0, y0: Y0, x1: X1, y1: Y1, gain, bedGain, hMax, minHead, dt } = c;
  const { nx, ny, cells, layers, ground, roof, depth, fx, fy } = f;
  const { windX, windY, wnx, wstride } = f;
  const keepOf = f.keepOf;
  const material = f.material;
  // Accelerate every edge by the head across it and the water able to CARRY
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
  // AND FROM THE LID DOWNWARDS, which is the same argument stood on its head
  // and is what a slot adds. An edge is a GAP, and a gap has a top as well as
  // a bottom: water four steps deep against a hole one step tall pushes
  // through one step of hole. Without the lid a flooded channel under a
  // bridge drives its whole depth against an opening it cannot get through.
  // On an uncovered slot the lid is the sky and the term never binds, which
  // is every edge on a map with no decks on it.
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
  //
  // THE SLOT PAIR IS THE OUTER LOOP AND NOT THE INNER ONE, which is a
  // performance decision and was measured. Walked innermost, the plane's base
  // index is a multiply per edge, `layers` is a value the engine cannot see
  // is one, and a map with no decks on it pays for the machinery of decks
  // everywhere: 0.855ms a frame became 1.19, a THIRD more, on a field that
  // has exactly one plane. Walked outermost, the base is hoisted, the inner
  // loop is the loop it always was — and a one-layer field makes exactly one
  // pass, which is the pass it used to make.
  //
  // What it costs is locality: two planes is two sweeps of the same depths.
  // That is the right way round. The common case pays nothing and the case
  // with bridges in it pays for its bridges.
  const R = { x0: 0, y0: 0, x1: 0, y1: 0 };
  for (let a = 0; a < layers; a++) {
    const A = a * cells;
    for (let b = 0; b < layers; b++) {
      // ONLY WHERE THE PAIR EXISTS. A bridge is a few tiles; the three
      // planes that mention its deck have no business anywhere else.
      if (!planeRegion(f, a, b, X0, Y0, X1, Y1, R)) continue;
      const B = b * cells;
      const P = (a * layers + b) * cells;
      for (let y = R.y0; y <= R.y1; y++) {
        // The wind is held in two plain numbers across a whole run of columns,
        // and refreshed when the run ends. Read per column out of its own
        // array it cost more than three times what the rest of this loop does:
        // a wind cell is sixteen columns wide, so that was the same two floats
        // fetched sixteen times over, in a loop the engine cannot prove is not
        // writing to them.
        const wrow = ((y / wstride) | 0) * wnx;
        let wc = (R.x0 / wstride) | 0;
        let nextRun = (wc + 1) * wstride;
        let wxv = windX[wrow + wc] * dt, wyv = windY[wrow + wc] * dt;
        for (let x = R.x0; x <= R.x1; x++) {
          if (x === nextRun) {
            wc++;
            nextRun += wstride;
            wxv = windX[wrow + wc] * dt;
            wyv = windY[wrow + wc] * dt;
          }
          const i = y * nx + x;
          const ia = A + i, p = P + i;
          const fa = ground[ia], ra = roof[ia];
          // A SLOT THAT IS NOT THERE, out before anything is worked out for
          // it. The overlap test below would answer the same — an absent
          // slot overlaps nothing — but it answers it after four loads and a
          // dozen operations, and a bridge's own plane is absent over almost
          // the whole of any map that has one. A box round the decks is not
          // enough on its own: two bridges at opposite corners make a box
          // the size of the world. @see slotBox
          if (ra <= fa) { fx[p] = 0; fy[p] = 0; continue; }
          const da = depth[ia];
          // The HYDRAULIC surface, written out rather than called: past the
          // roof the extra depth is in a narrow slot and buys little height,
          // which is what lets a full conduit go on flowing. @see head
          const rma = ra - fa;
          const sa = da <= rma ? fa + da : ra + (da - rma) * PRESSURE_SLOT;
          // SHELTERED SLOTS GET NO WEATHER. A gust is a thing that happens to
          // a surface open to the sky; the water under a bridge is not open
          // to the sky. On a map with no decks every slot is, so both of
          // these are the wind the field always had.
          const wxs = ra >= OPEN_SKY ? wxv : 0;
          const wys = ra >= OPEN_SKY ? wyv : 0;
          if (x + 1 < nx) {
            const jb = B + i + 1;
            const fb = ground[jb], rb = roof[jb];
            const sill = fa > fb ? fa : fb;
            const lid = ra < rb ? ra : rb;
            // THE ONE RULE. Two slots that do not overlap are not joined, and
            // an absent slot overlaps nothing — so a deck and the channel
            // under it, and a road and the channel under the deck beside it,
            // are both simply edges that are not there. @see fluid/slots
            if (lid <= sill) {
              fx[p] = 0;
            } else {
              const gap = lid - sill;
              const db = depth[jb], rmb = rb - fb;
              const sb = db <= rmb ? fb + db : rb + (db - rmb) * PRESSURE_SLOT;
              let hi = sa - sill; if (hi < 0) hi = 0; else if (hi > gap) hi = gap;
              let hj = sb - sill; if (hj < 0) hj = 0; else if (hj > gap) hj = gap;
              const head = hi - hj;
              const carry = Math.min(hMax, head > 0 ? hi : hj);
              const k = keepOf[material[head > 0 ? ia : jb]];
              const push = carry > 0 && Math.abs(head) > minHead;
              const q = push ? (fx[p] + gain * carry * head) * k : fx[p] * k;
              // The wind is added AFTER the drag, so it is this step's push
              // rather than something the drag has already taken a bite out
              // of, and only where there is water to push: on a dry edge the
              // limiter would stop anything moving anyway, but the flux
              // itself would wind up.
              fx[p] = floored(carry > 0
                ? q / (1 + bedGain * Math.abs(q) / (carry * carry))
                  + wxs * (carry < WIND_DEPTH ? carry * INV_WIND_DEPTH : 1)
                : q);
            }
          } else {
            fx[p] = 0;                          // the map edge is a wall
          }
          if (y + 1 < ny) {
            const jb = B + i + nx;
            const fb = ground[jb], rb = roof[jb];
            const sill = fa > fb ? fa : fb;
            const lid = ra < rb ? ra : rb;
            if (lid <= sill) {
              fy[p] = 0;
            } else {
              const gap = lid - sill;
              const db = depth[jb], rmb = rb - fb;
              const sb = db <= rmb ? fb + db : rb + (db - rmb) * PRESSURE_SLOT;
              let hi = sa - sill; if (hi < 0) hi = 0; else if (hi > gap) hi = gap;
              let hj = sb - sill; if (hj < 0) hj = 0; else if (hj > gap) hj = gap;
              const head = hi - hj;
              const carry = Math.min(hMax, head > 0 ? hi : hj);
              const k = keepOf[material[head > 0 ? ia : jb]];
              const push = carry > 0 && Math.abs(head) > minHead;
              const q = push ? (fy[p] + gain * carry * head) * k : fy[p] * k;
              fy[p] = floored(carry > 0
                ? q / (1 + bedGain * Math.abs(q) / (carry * carry))
                  + wys * (carry < WIND_DEPTH ? carry * INV_WIND_DEPTH : 1)
                : q);
            }
          } else {
            fy[p] = 0;
          }
        }
      }
    }
  }
}

/**
 * PASS 2 — every cell's outflows scaled down to the water it actually has.
 *
 * This is what makes the scheme positivity-preserving, and one pass is enough:
 * reducing an outflow can only reduce a neighbour's INflow, so no cell's own
 * limit can be violated by another cell being limited.
 *
 * IT LOOKS LIKE A SCATTER AND IS NOT. A cell writes its west and north
 * neighbours' edges as well as its own, which reads like a race waiting to
 * happen — but an edge is only ever scaled by the cell it flows OUT of, and
 * the two conditions (`fx[i] > 0` for cell `i`, `fx[i] < 0` for cell `i + 1`)
 * cannot both hold. So each edge has exactly one writer and the pass is
 * order-independent: run over the cells forwards and backwards it gives the
 * same answer to the bit, which is measured and not argued. That is what lets
 * the device do it with no atomics — see `fluid/gpu/limit`.
 */
export function limit(f: ColumnField, c: PassConsts) {
  const { x0: X0, y0: Y0, x1: X1, y1: Y1, spread } = c;
  const { nx, cells, layers, depth, fx, fy } = f;
  // THIS ONE CANNOT PUT THE PLANE OUTSIDE, and it is worth saying why the
  // other passes can. A limit is a statement about one slot's WHOLE outflow:
  // water leaving a deck may be going onto the road at the end of the span
  // and over the parapet at the side of it, and it is one body of water
  // paying for both. Scaled a plane at a time, each of them could take all of
  // it. So the planes are walked inside — with their bases worked out once
  // per slot rather than once per edge, which is what the outer loop buys
  // everywhere else.
  const out0 = new Int32Array(layers);      // this slot's own edges, per far slot
  const in0 = new Int32Array(layers);       // the far slot's edges into this one
  for (let a = 0; a < layers; a++) {
    const A = a * cells;
    const k = a * 4, sb = f.slotBox;
    // Grown by one: a slot limits the edges ARRIVING at it too, and those
    // belong to the column before.
    const lx0 = Math.max(X0, sb[k] - 1), lx1 = Math.min(X1, sb[k + 2] + 1);
    const ly0 = Math.max(Y0, sb[k + 1] - 1), ly1 = Math.min(Y1, sb[k + 3] + 1);
    if (lx1 < lx0 || ly1 < ly0) continue;
    for (let b = 0; b < layers; b++) {
      out0[b] = (a * layers + b) * cells;
      in0[b] = (b * layers + a) * cells;
    }
    for (let y = ly0; y <= ly1; y++) {
      for (let x = lx0; x <= lx1; x++) {
        const i = y * nx + x;
        const d = depth[A + i];
        let outflow = 0;
        for (let b = 0; b < layers; b++) {
          const e = out0[b] + i;
          if (fx[e] > 0) outflow += fx[e];
          if (fy[e] > 0) outflow += fy[e];
          const w = in0[b] + i - 1;
          if (x > 0 && fx[w] < 0) outflow -= fx[w];
          const n = in0[b] + i - nx;
          if (y > 0 && fy[n] < 0) outflow -= fy[n];
        }
        const want = outflow * spread;
        if (want <= d || want <= 0) continue;
        const scale = d / want;
        for (let b = 0; b < layers; b++) {
          const e = out0[b] + i;
          if (fx[e] > 0) fx[e] *= scale;
          if (fy[e] > 0) fy[e] *= scale;
          const w = in0[b] + i - 1;
          if (x > 0 && fx[w] < 0) fx[w] *= scale;
          const n = in0[b] + i - nx;
          if (y > 0 && fy[n] < 0) fy[n] *= scale;
        }
      }
    }
  }
}

/**
 * PASS 3 — every unit that leaves a cell arrives in exactly one other, so the
 * total is conserved to the last bit the floats carry.
 *
 * A SCATTER HERE AND A GATHER ON THE DEVICE, and the two are bit-identical,
 * which is measured rather than hoped for — see `divergence.test.ts`. Each
 * cell's `delta` is touched by three others: the row above adds its southward
 * move, the cell before adds its eastward one, and the cell itself subtracts
 * its own two. A cell that sums its own four incident edges IN THAT ORDER gets
 * the same answer to the bit.
 *
 * The order is not a detail. `delta` is a `Float32Array`, so the scatter rounds
 * on every one of its accumulations; a gather that sums in double and stores
 * once is a different number, and was, in 1371 cells out of 2976. The device
 * rounds every operation anyway, so it gets that for free — which is the whole
 * reason the gather is worth having there and not here: written out in
 * JavaScript, with `Math.fround` at each step and `dropAt` asked twice per
 * edge, it costs 1.79 times what the scatter does.
 *
 * `air` is not a scatter at all. An edge belongs to exactly one cell, so the
 * water going over a lip has one writer either way and needs no atomic.
 */
export function divergence(f: ColumnField, c: PassConsts) {
  const { x0: X0, y0: Y0, x1: X1, y1: Y1, spread } = c;
  const { nx, ny, cells, layers, fx, fy, delta, material } = f;
  const { bestIn, bestMat } = f;
  for (let a = 0; a < layers; a++) {
    const base = a * cells;
    const k = a * 4, sb = f.slotBox;
    const cx0 = Math.max(X0, sb[k]), cx1 = Math.min(X1, sb[k + 2]);
    const cy0 = Math.max(Y0, sb[k + 1]), cy1 = Math.min(Y1, sb[k + 3]);
    if (cx1 < cx0) continue;
    for (let y = cy0; y <= cy1; y++) {
      const row = base + y * nx;
      delta.fill(0, row + cx0, row + cx1 + 1);
      bestIn.fill(0, row + cx0, row + cx1 + 1);
    }
  }
  // Note the biggest contributor to each cell as we go, so a cell that fills
  // this step knows what filled it.
  //
  // WRITTEN OUT AND NOT A CLOSURE. It was a two-line arrow called once per
  // moving edge, and neither engine inlines it: the divergence went from
  // 0.25ms on still water to 1.0ms the moment anything moved, on arithmetic
  // that is four array accesses. Four copies of two lines is the price, and
  // the shape of each is identical so they read as one thing.
  //
  // THE PLANE IS THE OUTER LOOP, for the reason `accelerate` gives at length:
  // walked innermost it is a multiply per edge and a loop the engine cannot
  // see the bound of, and a field with one plane made it 0.090ms into 0.156.
  // Accumulating into `delta` across planes is a `+=` either way round, so
  // nothing about the answer turns on the order.
  const R = { x0: 0, y0: 0, x1: 0, y1: 0 };
  for (let a = 0; a < layers; a++) {
    const A = a * cells;
    for (let b = 0; b < layers; b++) {
      if (!planeRegion(f, a, b, X0, Y0, X1, Y1, R)) continue;
      const B = b * cells;
      const pl = a * layers + b;
      const P = pl * cells;
      for (let y = R.y0; y <= R.y1; y++) {
        for (let x = R.x0; x <= R.x1; x++) {
          const i = y * nx + x;
          const ia = A + i, p = P + i;
          if (x + 1 < nx) {
            const move = fx[p] * spread;
            if (move !== 0) {
              delta[ia] -= move;
              // OVER A LIP it goes into the air instead, and stays there
              // until it has fallen the distance — see `falls`. Only
              // downhill: water climbing the other way is not going over
              // anything. A drop is measured from the slot it LEAVES to the
              // slot it is aimed at, so coming off the side of a deck is a
              // fall and running onto the road at the end of one is not.
              if (move > 0 && dropAt(f, i, 0, a, b) > 0) {
                intoAir(f, i, 0, move, pl);
              } else {
                const jb = B + i + 1;
                delta[jb] += move;
                if (move > 0) {
                  if (move > bestIn[jb]) { bestIn[jb] = move; bestMat[jb] = material[ia]; }
                } else {
                  const up = -move;
                  if (up > bestIn[ia]) { bestIn[ia] = up; bestMat[ia] = material[jb]; }
                }
              }
            }
          }
          if (y + 1 < ny) {
            const move = fy[p] * spread;
            if (move !== 0) {
              delta[ia] -= move;
              if (move > 0 && dropAt(f, i, 1, a, b) > 0) {
                intoAir(f, i, 1, move, pl);
              } else {
                const jb = B + i + nx;
                delta[jb] += move;
                if (move > 0) {
                  if (move > bestIn[jb]) { bestIn[jb] = move; bestMat[jb] = material[ia]; }
                } else {
                  const up = -move;
                  if (up > bestIn[ia]) { bestIn[ia] = up; bestMat[ia] = material[jb]; }
                }
              }
            }
          }
        }
      }
    }
  }
}

/**
 * PASS 4 — the depths move by the divergence, and the box is rebuilt from what
 * is left wet.
 *
 * THE FIRST PASS WITH A REDUCTION IN IT. Three things here are not per cell:
 * the deepest column, which sizes the next substep; the active box, which
 * every other pass is bounded by; and whether anything is breaking, which
 * decides if the diffusion runs at all. On the device those are atomics — see
 * `fluid/gpu/apply`, where the whole of the difficulty is that three numbers
 * have to be agreed by 65,536 threads and the rest is a gather.
 */
export function applyDepths(f: ColumnField, c: PassConsts) {
  const { x0: X0, y0: Y0, x1: X1, y1: Y1, dt } = c;
  const { nx, ny, cells, layers, depth, delta, params, material } = f;
  const bestMat = f.bestMat;
  const b = f.box;
  b.x0 = f.nx; b.y0 = f.ny; b.x1 = -1; b.y1 = -1;
  let deepest = 0;
  f.breaking = false;
  const sbox = f.slotBox;
  for (let y = Y0; y <= Y1; y++) {
    for (let x = X0; x <= X1; x++) {
      const i = y * nx + x;
      // THE BOX IS A COLUMN'S, NOT A SLOT'S. It bounds a walk over x and y
      // and every pass walks every slot of what it reaches, so a column with
      // water in either storey has to be in it. `keep` is that: any slot
      // still worth stepping puts the whole column back in the box.
      let keep = false;
      for (let a = 0; a < layers; a++) {
        const k = a * 4;
        if (x < sbox[k] || x > sbox[k + 2] || y < sbox[k + 1] || y > sbox[k + 3]) continue;
        const ia = a * cells + i;
        const wasDry = depth[ia] <= params.dryDepth;
        // The limiter guarantees this is already non-negative; the max only
        // guards against a rounding residue leaving a tiny negative behind.
        depth[ia] = Math.max(0, depth[ia] + delta[ia]);
        if (depth[ia] > deepest) deepest = depth[ia];
        // How fast the surface moved, which is what says whether it is
        // breaking. Free here: the divergence has just worked it out.
        f.rate[ia] = Math.abs(delta[ia]) / dt;
        // THE RIM IS NOT BREAKING, IT IS LEAVING. With an open edge `spill`
        // empties the outermost ring every substep and the flow refills it
        // from inside, so the rate there is a whole column arriving and going
        // again — the largest there is, and nothing to do with a wave coming
        // apart.
        //
        // Read as breaking it painted the rim with SATURATED foam: measured
        // on a flooded map, `broke` pinned at 1 on ninety-two of the ring's
        // columns and the foam with it, against 0.02 and no breaking anywhere
        // with the edge closed. And it pulsed, because the refill does —
        // which is the flicker somebody reported at the edge of the map, half
        // a cell wide.
        const rim = f.openEdge
          && (x === 0 || y === 0 || x === nx - 1 || y === ny - 1);
        if (!rim && depth[ia] > params.dryDepth && params.breaking > 0) {
          stepBreaking(f, dt, ia, depth[ia]);
        } else {
          f.breakAge[ia] = -1;
          f.broke[ia] = 0;
        }
        if (depth[ia] <= 0) {
          material[ia] = 0;
          // A column with water in the AIR off one of its edges stays in the
          // box even when nothing is standing on it. Dropped out, the fall
          // stops being stepped and whatever is falling hangs there for ever
          // — which is what happened to a waterfall the moment its shelf ran
          // dry. Every plane of every edge it owns, because a deck's fall and
          // the channel's are different planes of the same two columns.
          for (let q = 0; q < layers; q++) {
            const k = ((a * layers + q) * cells + i) * 2;
            if (f.falls.air[k] > 0 || f.falls.air[k + 1] > 0) { keep = true; break; }
          }
        } else {
          keep = true;
          if (wasDry && bestMat[ia]) material[ia] = bestMat[ia];
        }
      }
      if (!keep) continue;
      if (x < b.x0) b.x0 = x;
      if (x > b.x1) b.x1 = x;
      if (y < b.y0) b.y0 = y;
      if (y > b.y1) b.y1 = y;
    }
  }
  f.deepest = deepest;
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
export function diffuseBreaking(f: ColumnField, c: PassConsts) {
  const { nx, cells, layers, fx, fy, depth, broke, rate, velo, iterA, iterB, params } = f;
  const { x0, y0, x1, y1, diffScale: scale } = c;
  const floor = params.dryDepth * 8;
  const dry = params.dryDepth;

  // ONE PLANE AT A TIME. The scratch is a column's worth and the planes are
  // walked in turn, so `velo` and the two iterates are reused rather than
  // multiplied — a diffusion of the deck's momentum has nothing to say to the
  // channel's, and they never overlap in time.
  const R = { x0: 0, y0: 0, x1: 0, y1: 0 };
  for (let a = 0; a < layers; a++) {
    for (let b = 0; b < layers; b++) {
      if (!planeRegion(f, a, b, x0, y0, x1, y1, R)) continue;
      const plane = (a * layers + b) * cells;
      const near = a * cells;
      for (let axis = 0; axis < 2; axis++) {
        const q = axis === 0 ? fx : fy;
        const step = axis === 0 ? 1 : nx;
        for (let y = R.y0; y <= R.y1; y++) {
          for (let x = R.x0; x <= R.x1; x++) {
            const i = y * nx + x;
            const far = i + step;
            const dn = depth[near + i];
            const df = far < cells ? depth[b * cells + far] : dn;
            const h = Math.max((dn + df) * 0.5, floor);
            velo[i] = q[plane + i] / h;
            iterA[i] = velo[i];
          }
        }
        // (I - dt nu grad^2) u_new = u_old, by Jacobi: each cell is its own
        // old value plus its neighbours' new ones, in the ratio the viscosity
        // sets.
        let from = iterA, into = iterB;
        for (let sweep = 0; sweep < SWEEPS; sweep++) {
          for (let y = R.y0; y <= R.y1; y++) {
            for (let x = R.x0; x <= R.x1; x++) {
              const i = y * nx + x;
              // The viscosity, from the intensity: a mixing length squared
              // over a time, the length being the depth.
              const d = scale * broke[near + i] * MIXING
                * depth[near + i] * rate[near + i] * params.breaking;
              if (d <= 0) { into[i] = velo[i]; continue; }
              const here = from[i];
              const w = x > R.x0 && depth[near + i - 1] > dry ? from[i - 1] : here;
              const e = x < R.x1 && depth[near + i + 1] > dry ? from[i + 1] : here;
              const n = y > R.y0 && depth[near + i - nx] > dry ? from[i - nx] : here;
              const so = y < R.y1 && depth[near + i + nx] > dry ? from[i + nx] : here;
              into[i] = (velo[i] + d * (w + e + n + so)) / (1 + 4 * d);
            }
          }
          const swap = from; from = into; into = swap;
        }
        for (let y = R.y0; y <= R.y1; y++) {
          for (let x = R.x0; x <= R.x1; x++) {
            const i = y * nx + x;
            if (broke[near + i] <= 0) continue;
            const far = i + step;
            const dn = depth[near + i];
            const df = far < cells ? depth[b * cells + far] : dn;
            const h = Math.max((dn + df) * 0.5, floor);
            q[plane + i] = from[i] * h;
          }
        }
      }
    }
  }
}

function substep(f: ColumnField, dt: number) {
  f.t += dt;
  if (f.openEdge) spill(f);
  const region = activeBox(f);
  if (!region) { stepAir(f, dt); return; }      // nothing wet, but drops still fall
  stirWind(f);
  const { X0, Y0, X1, Y1 } = { X0: region.x0, Y0: region.y0, X1: region.x1, Y1: region.y1 };
  const { ny, params, cell } = f;
  // A head is the surface difference across one cell; what accelerates water is
  // the GRADIENT, so the head is divided by how far apart the two columns are.
  const gain = params.gravity * dt / cell;
  const keep = Math.pow(params.drag, dt);
  const bedGain = params.bedDrag * dt;
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
  void ny;

  // 1. ACCELERATE — see `accelerate`, which is a separate function because
  //    the compute port replaces it one pass at a time and a pass that cannot
  //    be called on its own cannot be compared on its own.
  const consts: PassConsts = {
    x0: X0, y0: Y0, x1: X1, y1: Y1, gain, bedGain, hMax, minHead, spread, dt,
    diffScale: dt / (cell * cell),
  };
  // 0. What was breaking at the end of the last step dissipates at the start
  //    of this one, on the viscosity that step worked out. A step behind,
  //    which is what an explicit indicator always is.
  if (f.breaking && params.breaking > 0) diffuseBreaking(f, consts);
  accelerate(f, consts);

  // 2. LIMIT — see `limit`, lifted out for the same reason as `accelerate`.
  limit(f, consts);

  // 3. DIVERGENCE — see `divergence`, lifted out like the two before it.
  divergence(f, consts);

  // 4. APPLY — see `applyDepths`, lifted out like the three before it.
  applyDepths(f, consts);


  // And what has finished falling lands. After the depths, so what arrives
  // this step is water that left a lip on an earlier one.
  stepFalls(f, dt, region);
  // 6. AND WHAT LANDED GOES IN, all of it at once — see `applyLandings`. After
  //    the falls rather than inside them, which is the whole of the change:
  //    nothing a fall does can be seen by the next fall in the same step.
  applyLandings(f);
  // The same for drops, which land wherever the surface has got to — so a pipe
  // over a filling pool has a shorter fall as the pool comes up to meet it.
  stepAir(f, dt);
}

/**
 * The water that is in the AIR, which falls whether or not any is on the map.
 *
 * Everything else a step does is about columns that are wet, so a step over a
 * dry map has nothing to do and says so — except for this. A pipe over dry
 * ground is the first water that map ever gets, and a drop that only moved once
 * something else was already wet would hang there forever: measured, a pipe on
 * a dry map put twenty drops in the air in five seconds and landed none of
 * them, while the same pipe with an unrelated puddle five tiles away landed all
 * of it. So this runs on both sides of the nothing-wet return.
 */
export function stepAir(f: ColumnField, dt: number) {
  fadeSplashes(f.drips, dt);
  stepDrips(
    f.drips, dt,
    (cx, cy, z) => {
      const x = Math.round(cx), y = Math.round(cy);
      if (x < 0 || y < 0 || x >= f.nx || y >= f.ny) return -1e9;
      return surfaceAt(f, slotUnder(f, y * f.nx + x, z));
    },
    (cx, cy, volume, material, speed, z) => {
      const x = Math.round(cx), y = Math.round(cy);
      if (x < 0 || y < 0 || x >= f.nx || y >= f.ny) return 0;
      const s = slotUnder(f, y * f.nx + x, z);
      // AND THE WHITE IT MAKES, in the slot it landed in. Water arriving out
      // of the air has air in it, and the surface rate the breaking test reads
      // never sees a drop — it is put in by hand — so it has to leave word.
      // Here rather than in `stepDrips` because this is where the storey is
      // known. @see markSplash, stepFoam
      markSplash(f.drips, s, volume * SPLASH);
      return splashInto(f, x, y, volume, material, speed, (s / f.cells) | 0);
    },
  );
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
/**
 * The discharge out of a slot across one of its two forward edges, summed
 * over everywhere it can go.
 *
 * A slot's water leaves eastward through as many planes as there are slots to
 * receive it — off the end of a bridge onto the road AND over the parapet
 * into the ditch beside it, at the same time, from the same water. What moves
 * whatever is drawn on that water is all of it together, which is this sum.
 *
 * At one layer it is one plane and one array read. @see ColumnField.fx
 */
function outX(f: ColumnField, i: number, a: number): number {
  const { cells, layers, fx } = f;
  let q = 0;
  for (let b = 0; b < layers; b++) q += fx[(a * layers + b) * cells + i];
  return q;
}

/** The same across the +y edge. @see outX */
function outY(f: ColumnField, i: number, a: number): number {
  const { cells, layers, fy } = f;
  let q = 0;
  for (let b = 0; b < layers; b++) q += fy[(a * layers + b) * cells + i];
  return q;
}

/** What arrives from the west, which is the planes the other way round. */
function inX(f: ColumnField, i: number, a: number): number {
  const { cells, layers, fx } = f;
  let q = 0;
  for (let b = 0; b < layers; b++) q += fx[(b * layers + a) * cells + i];
  return q;
}

/** The same from the north. @see inX */
function inY(f: ColumnField, i: number, a: number): number {
  const { cells, layers, fy } = f;
  let q = 0;
  for (let b = 0; b < layers; b++) q += fy[(b * layers + a) * cells + i];
  return q;
}

export function flowX(f: ColumnField, x: number, y: number, a = 0): number {
  const i = y * f.nx + x;
  const ia = a * f.cells + i;
  const d = f.depth[ia];
  if (d <= 0) return 0;
  const by = Math.max(d, f.params.dryDepth * 8);
  const west = x > 0 ? inX(f, i - 1, a) : 0;
  const v = (west + outX(f, i, a)) * 0.5 / by;
  return v > MAX_FLOW_SPEED ? MAX_FLOW_SPEED : v < -MAX_FLOW_SPEED ? -MAX_FLOW_SPEED : v;
}

export function flowY(f: ColumnField, x: number, y: number, a = 0): number {
  const i = y * f.nx + x;
  const ia = a * f.cells + i;
  const d = f.depth[ia];
  if (d <= 0) return 0;
  const by = Math.max(d, f.params.dryDepth * 8);
  const north = y > 0 ? inY(f, i - f.nx, a) : 0;
  const v = (north + outY(f, i, a)) * 0.5 / by;
  return v > MAX_FLOW_SPEED ? MAX_FLOW_SPEED : v < -MAX_FLOW_SPEED ? -MAX_FLOW_SPEED : v;
}

export function velocityAt(
  f: ColumnField, x: number, y: number, a = 0,
): { vx: number; vy: number } {
  if (x < 0 || y < 0 || x >= f.nx || y >= f.ny) return { vx: 0, vy: 0 };
  const i = at(f, x, y);
  const d = f.depth[a * f.cells + i];
  if (d <= 0) return { vx: 0, vy: 0 };
  const by = Math.max(d, f.params.dryDepth * 8);
  const west = x > 0 ? inX(f, i - 1, a) : 0;
  const north = y > 0 ? inY(f, i - f.nx, a) : 0;
  const clamp = (v: number) => Math.max(-MAX_FLOW_SPEED, Math.min(MAX_FLOW_SPEED, v));
  return {
    vx: clamp((west + outX(f, i, a)) * 0.5 / by),
    vy: clamp((north + outY(f, i, a)) * 0.5 / by),
  };
}

/** How much water is moving, as a single number — for settling checks. */
export function flowEnergy(f: ColumnField): number {
  let sum = 0;
  for (let i = 0; i < f.fx.length; i++) sum += Math.abs(f.fx[i]) + Math.abs(f.fy[i]);
  return sum;
}
