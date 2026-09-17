/**
 * The solver's state, on the device.
 *
 * Storage buffers rather than textures, and raw WebGPU rather than anything of
 * Pixi's, because `src/fluid` is the physics and knows nothing about drawing.
 * The spike in `render/compute-spike` proved a Pixi `Buffer` with
 * `BufferUsage.STORAGE` is a real `GPUBuffer` a vertex shader can read, so the
 * renderer can wrap this when it comes to read it; nothing here has to change.
 *
 * ONE BUFFER, NOT ONE PER ARRAY, and that is not tidiness. A compute stage is
 * guaranteed only EIGHT storage bindings — this adapter allows ten, others
 * allow eight and no more — and the solver has around twenty arrays. Bound
 * separately it does not fit, and the way it does not fit is worth writing
 * down, because it cost a pass to find:
 *
 *   The number of storage buffers (9) in the Compute stage exceeds the
 *   maximum per-stage limit (8).
 *
 * Nine was ground, depth, material, fx, fy, scale, windX, windY and keepOf.
 * Raising the limit to the adapter's ten would have bought one more pass. So
 * every array lives in one `array<f32>` at a known offset, which binds once,
 * uploads in one call, and has no limit worth the name.
 *
 * MATERIAL IS STORED AS A FLOAT. It is an integer 0 to 15 and every one of
 * those is exact in f32, so the shader reads it back with `u32()` and loses
 * nothing. A separate u32 buffer would be a second binding for sixteen
 * distinct values.
 *
 * WHAT SYNCHRONISES, and every pass after this one depends on it. Within one
 * compute pass, each dispatch is its own synchronization scope and they behave
 * AS IF RUN SERIALLY: the API inserts the barriers, and a dispatch reads
 * whatever the dispatch before it wrote. A WebGPU spec editor, on gpuweb
 * discussion 4434:
 *
 *   dispatches are each their own synchronization scope so in terms of memory
 *   it is as-if they were run serially. However implementation should optimize
 *   this so that two dispatches that only read from the same resource (but
 *   don't write to any shared resource) run in parallel.
 *
 * So a pass that has to see all of another pass's output splits into two
 * DISPATCHES, not two passes, and nothing has to be encoded between them. What
 * is NOT synchronised is anything inside a single dispatch: two threads of one
 * dispatch writing the same word still need an atomic, or to be proved unable
 * to collide, which is what `gpu/limit` proves about its edges.
 *
 * This was settled by reading rather than by testing, and deliberately. The
 * obvious experiment — put two dependent dispatches in one pass and look for a
 * race — came back clean five times out of five, which says nothing at all,
 * because a guarantee cannot be distinguished from a coincidence by observing
 * it hold.
 *
 * INDEXING IS THE CPU'S, EXACTLY. A cell is `y * nx + x`; the flux arrays are
 * cell-indexed too, `fx[i]` being the edge from `i` to `i + 1` and `fy[i]` the
 * edge from `i` to `i + nx`. Anything else would need a translation on every
 * upload and every readback, and a translation is a place to be wrong that
 * nothing in the physics is asking for.
 */
import {
  MATERIAL_SLOTS, MAX_FLOW_SPEED, type Arrivals, type ColumnField,
} from "../columns";
import { FALL_THROW } from "../falls";
import type { Stamps } from "./stamps";

/** A number WGSL will read as an f32 — an integer needs its point. */
const num = (v: number) => (Number.isInteger(v) ? `${v}.0` : String(v));

/** Bytes in the uniform block. Twenty `vec4`s — see `writeConsts`. */
const CONSTS_BYTES = 320;

/**
 * How far apart one substep's constants sit from the next.
 *
 * A DYNAMIC OFFSET has to be a multiple of 256, and that is the whole reason
 * this is not just `CONSTS_BYTES`. Twelve of these is six kilobytes, which
 * buys the frame down from one command buffer PER SUBSTEP to one for the
 * lot: the uniform used to be a single block rewritten between substeps, so
 * every substep had to be submitted before the next could overwrite it, and a
 * frame with four substeps cost seven submits and the driver overhead of each.
 */
export const CONSTS_STRIDE = 512;

/** Substeps' worth of constants the buffer holds. @see MAX_SUBSTEPS */
export const CONSTS_SLOTS = 16;

/**
 * x0, y0, x1, y1, deepest, breaking, drops shed, cliff edges, the clamp's
 * and the delta's tallies, the wet count, the columns' water and the air's.
 * @see GpuState.reduce
 */
export const REDUCE_SLOTS = 13;

/** The slot the spray's spawn counter claims from. @see REDUCE_SLOTS */
export const SPAWNED_SLOT = 6;

/** The slot the cliff index is counted in. @see REDUCE_SLOTS */
export const CLIFFN_SLOT = 7;

/**
 * One lip's row in the falls outbox: the edge, then what is on it.
 *
 * Ten floats — which edge, the water in the air off it, how far the front and
 * the head have got, the lip's two smoothed throw components, the wash and the
 * foam standing on it, how hard it is POURING over that edge, and what the
 * water is made of. Six of those are per EDGE and four per COLUMN; the
 * column's ride along on the edge's row rather than needing a list of their
 * own, because a column with two falling edges is two rows saying the same
 * thing, which is cheaper than a second list.
 *
 * The POUR is the flux on this row's own edge and nothing else — `pourOf` asks
 * for `fx` on an east lip and `fy` on a south one, never both — so one float
 * carries what two whole maps of flux used to.
 *
 * That is everything `drawFalls` reads that is not `depth`, `ground` or
 * `material` — and those three come back whole for other reasons.
 *
 * The lip NEXT DOOR is always in the list too, which is what makes this
 * complete rather than nearly complete: `alongLip` only returns a neighbour it
 * has already asked `falling` about, so every column the renderer reads a
 * throw, a reach, a wash or a foam from is itself a lip.
 */
export const FALL_OUT_STRIDE = 10;

/**
 * How many lips the outbox holds.
 *
 * Sixteen thousand, against a waterfall fixture that has seven hundred and
 * thirty two — a map would have to be nearly all cliff to reach it. Overflow
 * costs the lips past the cap their sheet for a frame and nothing else: no
 * water is in the outbox, only a picture of it.
 */
export const FALL_OUT_MAX = 16384;

/**
 * The slot the CLAMP's losses are counted in, and it should always read nought.
 *
 * `applyDepths` takes `max(0, depth + delta)` on both solvers, and the comment
 * either side of it says the same thing: the limiter guarantees the sum is
 * already non-negative and the max is only there to swallow a rounding
 * residue. If that guarantee ever fails the water goes SILENTLY — no error, no
 * discontinuity, just a total that sags — and a solver losing eight per cent of
 * a pour looks exactly like one that is merely spreading it thin.
 *
 * So the clamp counts what it eats. In fixed point, because it is an atomic
 * sum across every thread and WGSL has no float `atomicAdd` — the same reason
 * the landings are fixed point. @see CLAMP_SCALE
 */
export const CLAMP_SLOT = 8;

/**
 * Fixed point for {@link CLAMP_SLOT}: a thousandth of a half step.
 *
 * Small, deliberately. What this counts should be zero or a rounding residue,
 * and if it is ever large enough to overflow an `i32` at this scale the
 * number itself has stopped being the point.
 */
export const CLAMP_SCALE = 1024;

/**
 * The slot every cell's `delta` is summed into, which should also read nought.
 *
 * The divergence is a GATHER and its whole claim to conserving water is that
 * it telescopes: every edge is debited by the cell it leaves and credited by
 * the cell it arrives at, so the sum over the map cancels to nothing. That is
 * a claim about indices and guards, and the cheapest way to hold it to account
 * is to add the answers up. A frame whose deltas do not sum to nought is
 * creating or destroying water in the arithmetic, wherever it looks like it is
 * happening on screen.
 *
 * At {@link DELTA_SCALE}, and signed: an `i32` at that scale holds half a
 * million half-steps, which is far more than a map can hold.
 */
export const DELTA_SLOT = 9;
export const DELTA_SCALE = 4096;

/**
 * THE READOUT'S TWO NUMBERS, counted where the water already is.
 *
 * How many tiles are wet and how much water the columns hold: the editor puts
 * both in the corner of the screen and the store worked them out by walking
 * every column of the map, every tick, for ever — sixty five thousand reads a
 * frame for two integers, and the walk is also the last thing that needed the
 * whole depth map on the host. The device has the depths in registers while it
 * is applying them; counting there is free and the answer rides back in the
 * reduction that already comes down.
 *
 * WET is counted per TILE, not per column, because that is what the readout
 * says: a tile is wet when the MEAN of its sixteen columns is over the dry
 * depth. `depthAt` is the rule being mirrored and it is mirrored rather than
 * shared, like every other rule that has to exist in two languages.
 */
export const WET_SLOT = 10;

/**
 * Every drop the COLUMNS hold, summed on the device, a tile at a time.
 *
 * Counted in `createMeta`, which is walking the depths anyway to decide which
 * tiles are wet. The host's own version of this walked sixty five thousand
 * depths every tick to find the few hundred that hold anything.
 *
 * SEPARATE FROM THE AIR, which these two used to share. The readout wants the
 * sum and gets it — that is one addition — but the leak alarm wants the
 * columns ALONE: it asks whether the device's own passes are losing water,
 * and the air is a different question answered by a different pass. Sharing
 * the slot meant the alarm could not be given the device's answer at all, so
 * it summed the whole depth map on the host instead, 43us a frame, and even
 * that stopped being the device's answer the day depth started coming back by
 * the band. @see GpuFrame.deviceWater
 */
export const DEPTH_SLOT = 11;

/**
 * And every drop still in the AIR off a lip, summed per lip in `createFallout`.
 *
 * Its own pass because air lives on lips and nowhere else — a hundred and
 * thirty thousand edges to find the few hundred that hold any, which is the
 * shape the lip list already has.
 */
export const AIR_SLOT = 12;

/**
 * Fixed point for {@link DEPTH_SLOT} and {@link AIR_SLOT}: a two hundred and fifty sixth.
 *
 * The sum is added a TILE at a time, so the rounding happens four thousand
 * times rather than sixty five thousand, and at this scale that is at most
 * sixteen half steps of error on a number the readout rounds to an integer
 * and displays next to five figures. The headroom is what picks the scale:
 * a map flooded to thirty half steps everywhere holds about two million, and
 * an `i32` at this scale carries eight.
 */
export const WATER_SCALE = 256;

/** Floats per arrival: cell, depth, fx, fy, material. @see Arrivals */
export const ARRIVE_STRIDE = 5;

/**
 * How many drops the spray may ask for in ONE step, and what each one costs.
 *
 * A cliff edge sheds at most one drop a step, so the true bound is the cliff
 * set — but that is two per cell and a map's worth of it would be megabytes to
 * hold a few dozen drops. This is the practical ceiling instead: the drip list
 * is a thousand long and `dripRoom` has already throttled the rate to nothing
 * by the time it is full, so four thousand requests in a single step cannot
 * arise from water. It is a guard against a bug, not a budget.
 *
 * EIGHT FLOATS EACH, and TWO KINDS of drop in them, because a fall makes
 * spray twice over and only one of the two was obvious. A breaking sheet
 * sheds drops out of its own mass on the way down; a sheet hitting water
 * throws a CROWN back up off the impact, and that one comes out of the
 * landing rather than the air. The device missed the second entirely at
 * first — the sheet's water matched to the last bit while the landings were
 * out by 0.66 across 41 cells, which is what a plume looks like when nobody
 * throws it.
 *
 *   0  the edge, which is what the drops are put back in ORDER by
 *   1  which kind: nought a shed drop, one a crown
 *   2  the column it belongs to — where a crown comes off; unused by a shed,
 *      whose column is the edge's own
 *   3  how much water
 *   4  how far down the sheet it left from, or the height of the impact
 *   5  the scatter, or the speed of the impact
 *   6  the lip's speed, for a shed drop's arc
 *   7  the material
 *
 * Everything else about where a drop goes is arithmetic the host can do, and
 * does, in the same `dropFrom` and `crown` the CPU path calls.
 */
export const SPAWN_MAX = 4096;

/**
 * Cells one frame may ask the depth of, by name.
 *
 * MAX_DRIPS is 1024 and each drop asks about the five cells it might round
 * into, with MAX_MOUTHS at 256 and the cursor's tile sixteen — so the worst
 * case before deduplication is about 5,400. This is that with room over, and
 * the list is deduplicated, so a waterfall's clustered spray comes in well
 * under it. A list that overran would be a reader
 * silently getting no answer, so it is capped where it is filled and the count
 * is what the pass dispatches over. @see gatherWanted
 */
export const WANT_MAX = 8192;
export const SPAWN_STRIDE = 8;

/** Which sort of drop a record holds. @see SPAWN_MAX */
export const SPAWN_SHED = 0;
export const SPAWN_CROWN = 1;

/** The arrays the packed buffer holds, in order. Offsets follow from this. */
export const FIELDS = [
  "ground", "depth", "material", "fx", "fy", "scale", "windX", "windY", "keepOf",
  "delta", "air", "bestMat", "rate", "breakAge", "broke",
  "velo", "iterA", "iterB",
  // The falls. Per EDGE except the smoothed throw and the cliff index.
  "front", "head", "frontSpeed", "headSpeed", "since", "shed",
  "throwX", "throwY", "cliff", "cliffCol",
  // WHAT THE HOST ADDED THIS FRAME, as a LIST rather than as arrays.
  //
  // Five floats a cell — which cell, how much depth, how much on each flux,
  // and what material — for only the cells the host actually touched. A pour
  // is a few dozen of them. The version this replaced sent four whole arrays
  // every frame, a megabyte and a half, and its real cost was not the
  // bandwidth: sending the host's copy of the water back at all means both
  // sides own it, and then every frame has to reconcile two versions across an
  // asynchronous boundary. Every water bug in this port came out of that
  // reconciliation. @see Arrivals
  "arrive",
  // THE FLOW WASH, which is a rendering field rather than a physical one: the
  // pattern the current carries. It lives here because advecting it is a
  // gather over the same fluxes the solver already holds, and doing it on the
  // host cost more than the whole of the rest of a frame's water.
  "washNow", "washNext", "washSeed",
  // THE FOAM, carried the same way, and the splash it is partly born from.
  // `splashNow` is the device's own copy of what `drips.splash` holds on the
  // host: a plunge marks it from the device and a landing drop marks it from
  // here, so it has to live somewhere both can reach.
  "foamNow", "foamNext", "splashNow", "splashIn",
  // What the landings banked, once it is a push. Per EDGE, like the fluxes.
  "kickX", "kickY", "capX", "capY",
  // Not state: an OUTBOX. The falls pass appends a drop's worth of request per
  // shed and the host drains it. @see SPAWN_MAX
  "spawn",
  // THE MATERIALS, PACKED FOUR TO A WORD, for the texture to be copied from.
  //
  // The surface samples material as an `r8unorm` texture and the device holds
  // it as a float, and a buffer-to-texture copy does not convert — so the one
  // texture the device could not fill went on being uploaded from the host
  // every frame, which meant the host's copy had to be kept current, which
  // meant a quarter of a megabyte coming back to keep it so. Four materials
  // bit-packed into a word is the same bytes the texture wants, laid out the
  // way it wants them. @see createMatpack
  "matByte",
  // NOR IS THIS ONE, and it is what stopped two megabytes a frame.
  //
  // `air`, `front`, `head` and the two throws are per EDGE over the whole map
  // — two megabytes of it — and the only thing on the host that reads any of
  // them is the falls renderer, which draws about five hundred quads. A busy
  // map has a few hundred lips on it. So the device writes those few hundred
  // out as a LIST and the host scatters it back into the arrays the renderer
  // already indexes, which leaves the renderer untouched and the transfer
  // three orders of magnitude smaller. @see FALL_OUT_STRIDE
  "fallOut",
  // AND THE DEPTH THE HOST STILL WANTS, as a list of cells and their answers.
  //
  // The depth band was 254KB of a 263KB readback — 97% of it — for the two
  // hundred and ninety cells anything on the host actually reads: the drops
  // deciding whether they have landed, the pipe mouths deciding whether they
  // are drowned, and the cursor. It received sixty five thousand. The band
  // bought nothing on a flooded map either, because the active box is then the
  // whole map.
  //
  // So the host writes down which cells it wants, the device answers exactly
  // those, and the whole band comes back on the slow refresh instead — which
  // keeps every other reader (the save, the handover to the CPU solver) seeing
  // a field that is stale rather than one that is frozen. @see WANT_MAX
  "wantAt", "wantOut",
] as const;
export type FieldName = (typeof FIELDS)[number];

export type GpuState = {
  device: GPUDevice;
  nx: number;
  ny: number;
  /** Cells, which is also the length of each per-cell array. */
  cells: number;
  /**
   * Which slice of the constants the next pass encoded should read.
   *
   * Mutable, and set by whoever is encoding a substep before it encodes one.
   * It lives here rather than in every pass's signature because a substep's
   * passes all read the same slice and none of them has an opinion about
   * which. @see CONSTS_STRIDE
   */
  constsAt: number;
  /**
   * The whole state, bound once. Every pass uses it and nothing in it changes.
   * @see bindState
   */
  bound: GPUBindGroup | null;
  /**
   * WHEN THE GPU STARTED AND STOPPED, pass by pass, or null where the device
   * cannot say. Every pass is begun through {@link beginPass}, so switching
   * this on times all of them and forgetting one is not possible. @see Stamps
   */
  stamps: Stamps | null;
  /** Every array, back to back. @see FIELDS */
  field: GPUBuffer;
  /**
   * The numbers that are not per cell: the box, the deepest column, whether
   * anything is breaking, and the tallies the passes keep between them.
   *
   * ITS OWN BUFFER because these are ATOMICS and the rest are not. WGSL types
   * a whole binding, so `array<atomic<i32>>` and `array<f32>` cannot be the
   * same one, and reinterpreting is not worth the reading it would cost.
   *
   * THIRTEEN `i32`, and this said six and then seven — the tallies were added
   * one at a time and the count was not. See {@link REDUCE_SLOTS}, which is
   * the number, and the `*_SLOT` constants beside it, which are what they are
   * for: x0, y0, x1, y1, deepest, breaking, then SPAWNED, CLIFFN, CLAMP,
   * DELTA, WET, DEPTH and AIR.
   *
   * `deepest` holds the BIT PATTERN of a float and is combined with
   * `atomicMax`, which works because every depth is non-negative and IEEE bit
   * order matches value order there — see `readReduce`.
   */
  reduce: GPUBuffer;
  /**
   * The landings, in FIXED POINT, because they are the only true scatter left.
   *
   * Two lips can land in one cell, so the water and the momentum arriving
   * there are sums across threads — and WGSL has no float `atomicAdd`, which
   * is just as well: float addition does not associate, so a float scatter
   * would answer differently depending on how the device scheduled it. In
   * integers it associates exactly and the answer is the answer.
   *
   * Four regions of `cells` each: landing, impulse, the packed material argmax
   * — see `LAND_SCALE` and `packMat` — and the splash whiteness, which is a
   * max rather than a sum and needs no scale.
   */
  acc: GPUBuffer;
  consts: GPUBuffer;
  /** Where each array starts, in floats. */
  offset: Record<FieldName, number>;
  /** How long each is, in floats. */
  length: Record<FieldName, number>;
  /** Floats in the whole buffer. */
  floats: number;
  destroy: () => void;
};

export type PassUniforms = {
  x0: number; y0: number; x1: number; y1: number;
  gain: number; bedGain: number; hMax: number; minHead: number;
  dt: number; windDepth: number; spread: number;
  /** Whether the outermost ring is emptied every substep. @see spill */
  openEdge: boolean;
  dryDepth: number; fallMin: number; gravity: number; breaking: number;
  diffScale: number; room: number; cell: number; cliffN: number;
  /** The frame's own dt, for the fields carried once a frame. @see washNow */
  frameDt: number;
  /** How many arrivals the host has for this frame. @see Arrivals */
  arriveN: number;
  /** How many cells the host wants the depth of. @see WANT_MAX */
  wantN: number;
};

export function createGpuState(device: GPUDevice, f: ColumnField): GpuState {
  const cells = f.nx * f.ny;
  // A SUBSTEP'S WORTH EACH, for the three that change BETWEEN substeps.
  //
  // The wind gusts on the clock and the drag is raised to the substep's own
  // dt, so both are rewritten every substep — which was safe while every
  // substep was its own command buffer and is not safe now that the frame is
  // one. `queue.writeBuffer` takes effect where it is CALLED in the queue, and
  // every one of these calls happens before the single submit, so the last
  // substep's wind landed before the first substep's dispatches ran and every
  // substep read the same, wrong, weather. A ring, like the constants, and the
  // slot goes into the OFFSET the constants already carry — so no shader
  // changes at all. @see CONSTS_SLOTS
  const wind = f.windX.length;
  const sizes: Record<FieldName, number> = {
    ground: cells, depth: cells, material: cells, fx: cells, fy: cells,
    scale: cells,
    windX: wind * CONSTS_SLOTS, windY: wind * CONSTS_SLOTS,
    keepOf: MATERIAL_SLOTS * CONSTS_SLOTS,
    // `air` is per EDGE — two to a cell, `i * 2 + axis`, the CPU's own index.
    delta: cells, air: cells * 2, bestMat: cells,
    rate: cells, breakAge: cells, broke: cells,
    velo: cells, iterA: cells, iterB: cells,
    front: cells * 2, head: cells * 2, frontSpeed: cells * 2,
    headSpeed: cells * 2, since: cells * 2, shed: cells * 2,
    throwX: cells, throwY: cells, cliff: cells * 2, cliffCol: cells,
    fallOut: FALL_OUT_MAX * FALL_OUT_STRIDE,
    // A word to four columns, and the map's width is a multiple of four.
    matByte: Math.ceil(cells / 4),
    kickX: cells, kickY: cells, capX: cells, capY: cells,
    arrive: cells * ARRIVE_STRIDE,
    washNow: cells, washNext: cells, washSeed: cells,
    foamNow: cells, foamNext: cells, splashNow: cells, splashIn: cells,
    spawn: SPAWN_MAX * SPAWN_STRIDE,
    wantAt: WANT_MAX, wantOut: WANT_MAX,
  };
  const offset = {} as Record<FieldName, number>;
  let at = 0;
  for (const name of FIELDS) {
    offset[name] = at;
    at += sizes[name];
  }

  const field = device.createBuffer({
    size: at * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    label: "solver state",
  });
  const acc = device.createBuffer({
    size: cells * 4 * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    label: "landings",
  });
  const reduce = device.createBuffer({
    size: REDUCE_SLOTS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    label: "reduce",
  });
  const consts = device.createBuffer({
    size: CONSTS_STRIDE * CONSTS_SLOTS,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    label: "consts",
  });

  return {
    device, nx: f.nx, ny: f.ny, cells, field, reduce, acc, consts, constsAt: 0,
    bound: null,
    // Off unless the solver turns it on, so a harness that only wants an
    // answer does not pay for a query set it never reads. @see createStamps
    stamps: null,
    offset, length: sizes, floats: at,
    destroy: () => {
      field.destroy(); reduce.destroy(); acc.destroy(); consts.destroy();
    },
  };
}

/** Widened once, so `material` can ride in the float buffer with the rest. */
const wideScratch = new WeakMap<ColumnField, Float32Array>();
const cliffScratch = new WeakMap<ColumnField, Float32Array>();

/**
 * The arrays the HOST can still write, and therefore the only ones that have
 * to go up once the device owns the state.
 *
 * Everything else — the fall state, the breaking state, the scratch the
 * passes use between themselves — is the device's from the first frame, and
 * sending the host's stale copy of it back every frame is not just wasted
 * bandwidth, it would overwrite the device's own work with a readback that is
 * a frame old. What the host does write is water: a spring pours, a pipe
 * pours, a brush paints, a drop lands, the editor raises the ground.
 *
 * @see uploadArrivals
 */
export const HOST_WRITES = ["ground", "depth", "material", "fx", "fy"] as const;

/**
 * The runs of the packed buffer the host still reads, as [first, last] pairs.
 *
 * The whole field is nearly ten megabytes on a 256 square map and it was all
 * coming back every frame, which cost about fifty milliseconds and paced the
 * simulation to itself. Most of it is the device talking to itself: the
 * limiter's scale, the diffusion's three iterates, the divergence's delta, the
 * landings' kicks and caps, the material argmax, the cliff index. Nothing on
 * this side has ever read one of them outside the comparison harness.
 *
 * WHAT IS LEFT, and why:
 *   depth, material, fx, fy   the surface mesh, the foam, the flow wash, a
 *                             drop looking for what is under it, the volume
 *                             and wet-tile counts in the store
 * `broke` is not here either: the foam that read it is a device pass now.
 *   air                       a sheet in the air, drawn and painted
 *   front, head               how far down its wall a fall has got, which is
 *                             the whole of what the sheet renderer needs of it
 *   throwX, throwY            the launch the sheet is drawn on
 *   washNow, foamNow          the two fields the current carries, advected on
 *                             the device now and drawn from textures here
 *   spawn                     the spray's outbox
 *
 * `ground` is not here: the host owns it, the device never writes it. Neither
 * are `rate` and `breakAge` — grep says nothing outside the solver has ever
 * read either.
 *
 * NOR ARE `frontSpeed`, `headSpeed`, `since` AND `shed`, and that one is a
 * trade rather than a fact. They are a fall's own workings, nothing draws
 * them, and together they are two thirds of what was coming back. The cost is
 * that switching BACK to the CPU mid-fall hands it speeds and timers a frame
 * or two old: a sheet re-accelerates from slightly the wrong speed and a
 * spray bank restarts. Both settle inside a frame and neither is visible; a
 * readback four times the size, every frame, for ever, is visible.
 *
 * The runs are named in pairs because the fields are laid out in `FIELDS`
 * order and a run of them is one copy rather than one per array.
 *
 * DEPTH IS NOT HERE EITHER, and it is the one field that is neither a list nor
 * a slow refresh: it comes back by the BAND, the rows the device's own
 * dispatch region covered, because those are the only rows it can have
 * changed. See `setDepthBand`, which is where the argument is.
 *
 * NOR IS THE SPRAY'S OUTBOX, which is a head and not a run: the drops are
 * claimed in order from the front, so what is worth copying is however many
 * were claimed and not the whole ceiling of four thousand. That leaves this
 * list empty, and it is kept because the SHAPE is the point — a run that has
 * to come back whole, every frame, would go here, and nothing does any more.
 */
export const READ_BACK: readonly (readonly [FieldName, FieldName])[] = [];

/**
 * THE CARRIED FIELDS, and they come back SLOWLY.
 *
 * The flow wash and the foam are half a megabyte a frame, and the surface is
 * no longer drawn from the host's copy of either — the device fills those
 * textures itself. What is left reading them is the falls renderer, which
 * samples them at the lips and nowhere else, and that is what the lip list
 * carries.
 *
 * The MATERIAL and the two FLUXES are here for the same reason and by the same
 * argument. Nothing reads a flux on the host but `pourOf`, which asks about
 * one edge of one lip; nothing reads a material but the falls' colour and the
 * surface's texture, and the texture is filled from `matByte` now. Both ride
 * the lip row per frame, and come back whole only for the handover.
 *
 * So why come back at all? THE HANDOVER. Switch the solver off and
 * `drawGpuWater` starts advecting these arrays again from wherever they are,
 * and the textures go back to being views over them — so a host copy that is
 * minutes stale shows a visibly wrong pattern for the second it takes to
 * re-settle. Once every {@link CARRY_EVERY} readbacks keeps it under half a
 * second stale, which is invisible on a pattern that drifts this slowly, for
 * a thirtieth of the bandwidth.
 */
export const CARRIED_BACK: readonly (readonly [FieldName, FieldName])[] = [
  ["material", "fy"],
  ["washNow", "washNow"],
  ["foamNow", "foamNow"],
];

/** How many readbacks apart the carried fields come back whole. */
export const CARRY_EVERY = 30;

/**
 * The FALLS, which do not come back as arrays at all. @see FALL_OUT_STRIDE
 *
 * `air`, `front`, `head`, `throwX` and `throwY` used to be three runs of this
 * list and two megabytes of the three and a half that came down every frame.
 * They are now a list of the lips that actually have anything on them, and the
 * length of the copy is decided per frame from how many there were last time —
 * which is why this is not one of the runs above, where the length is fixed
 * when the solver is built.
 */
export const FALL_OUT_BACK: readonly (readonly [FieldName, FieldName])[] = [
  ["air", "air"], ["front", "head"], ["throwX", "throwY"],
];

/**
 * A texture the DEVICE fills, and the field of the packed buffer it is filled
 * from.
 *
 * The water surface is drawn from six single-channel textures, and until now
 * every one of them was a view over a host array that Pixi re-uploaded every
 * frame — a megabyte and three quarters going up to say what the device had
 * just sent down. The arrays are still the host's copy, because the falls
 * renderer, the pipes and the wet count all read them, but the TEXTURE no
 * longer comes from them: a buffer-to-texture copy on the end of the solver's
 * own command buffer fills it straight from the state the passes just wrote.
 *
 * @see copyOut, which is where the alignment rule is stated.
 */
export type Sink = {
  name: FieldName;
  texture: GPUTexture;
  /**
   * Bytes a texel, which is four for the `r32float` fields and ONE for the
   * material — whose texture is `r8unorm` and whose source is therefore a
   * field of packed bytes rather than a field of floats. @see createMatpack
   */
  texel?: 1 | 4;
};

/**
 * Fill the render textures from the packed buffer, in the frame's own encoder.
 *
 * ON THE END OF THE SOLVER'S COMMAND BUFFER and not on its own, because the
 * queue runs command buffers in submission order: the copy is after every
 * pass that writes what it copies, and before the render that samples it,
 * without a single barrier or fence of our own.
 *
 * THE 256-BYTE ROW RULE. `bytesPerRow` must be a multiple of 256 whenever more
 * than one row is copied, and a row here is `nx` floats. A 256-column map —
 * which is what a 64-tile map is — gives 1024 and is fine; a map whose width
 * is not a multiple of 64 is not, and there is no padding to be done about it
 * from this side. The caller checks and simply does not wire the sinks up, so
 * such a map keeps the upload it has always had rather than failing.
 */
export function copyOut(enc: GPUCommandEncoder, s: GpuState, sinks: readonly Sink[]) {
  for (const sink of sinks) {
    const texel = sink.texel ?? 4;
    enc.copyBufferToTexture(
      {
        buffer: s.field,
        offset: s.offset[sink.name] * 4,
        bytesPerRow: s.nx * texel,
        rowsPerImage: s.ny,
      },
      { texture: sink.texture },
      { width: s.nx, height: s.ny, depthOrArrayLayers: 1 },
    );
  }
}

/**
 * Whether a map is the right shape for {@link copyOut}, PER TEXEL SIZE.
 *
 * The 256-byte row rule is about BYTES, so it is a different question for a
 * four-byte float than for the material's single byte: 256 columns gives 1024
 * and 256, both fine, while 128 columns gives 512 and 128 — the floats can
 * still be copied and the material cannot. Asked once for the whole layer this
 * came out as the stricter answer for everything, which quietly took the five
 * float textures off the device on any map narrower than 256.
 */
export const canCopyOut = (nx: number, texel: 1 | 4) =>
  (nx * texel) % 256 === 0;

/** Where a run starts and how long it is, in floats. @see READ_BACK */
export function runsOf(s: GpuState): { at: number; len: number }[] {
  return READ_BACK.map(([first, last]) => ({
    at: s.offset[first],
    len: s.offset[last] + s.length[last] - s.offset[first],
  }));
}

/**
 * WHAT THE HOST ADDED, as a list, and nothing else.
 *
 * This is the piece that lets the device own the water. Sending the host's
 * copy up — whole arrays, or a difference of them — means both sides hold the
 * state and every frame has to reconcile two versions of it across a boundary
 * three to five frames wide. That reconciliation is where every water fault in
 * this port came from: pours wiped by a readback older than the upload that
 * carried them, water lost at the edge of a region, totals that drifted down
 * as a puddle spread. A list of what was ADDED has nothing to reconcile. It is
 * also about four orders of magnitude smaller.
 *
 * Returns how many arrivals went up, which is what the pass is sized from.
 */
export function uploadArrivals(
  s: GpuState, f: ColumnField, a: Arrivals, scratch: Float32Array,
): number {
  if (a.n === 0) return 0;
  const n = Math.min(a.n, (scratch.length / ARRIVE_STRIDE) | 0);
  for (let k = 0; k < n; k++) {
    const i = a.cell[k], at2 = k * ARRIVE_STRIDE;
    scratch[at2] = i;
    scratch[at2 + 1] = a.depth[i];
    scratch[at2 + 2] = a.fx[i];
    scratch[at2 + 3] = a.fy[i];
    scratch[at2 + 4] = a.mat[i];
  }
  s.device.queue.writeBuffer(
    s.field, s.offset.arrive * 4, scratch, 0, n * ARRIVE_STRIDE,
  );
  void f;
  return n;
}

/**
 * Put the whole of a CPU field onto the device.
 *
 * All of it, every time, because this is the COMPARISON path: a partial upload
 * that happens to be right for one scene is a fault waiting for another. What
 * the real solver uploads per frame is a much shorter list — see the plan's
 * "host side per frame" — and that is an optimisation to make once the passes
 * are right, not before.
 */
export function upload(s: GpuState, f: ColumnField) {
  const q = s.device.queue;
  const put = (name: FieldName, data: Float32Array) =>
    q.writeBuffer(s.field, s.offset[name] * 4, data);
  put("ground", f.ground);
  put("depth", f.depth);
  put("fx", f.fx);
  put("fy", f.fy);
  put("windX", f.windX);
  put("windY", f.windY);
  put("keepOf", f.keepOf);
  put("delta", f.delta);
  put("rate", f.rate);
  put("breakAge", f.breakAge);
  put("broke", f.broke);
  put("velo", f.velo);
  put("iterA", f.iterA);
  put("iterB", f.iterB);
  const s2 = f.falls;
  put("front", s2.front);
  put("head", s2.head);
  put("frontSpeed", s2.frontSpeed);
  put("headSpeed", s2.headSpeed);
  put("since", s2.since);
  put("shed", s2.shed);
  put("throwX", s2.throwX);
  put("throwY", s2.throwY);

  // The cliff index is integers, and rides here as floats like `material`:
  // an index up to a few hundred thousand is exact in f32 to 2^24.
  let idx = cliffScratch.get(f);
  if (!idx || idx.length !== s2.cliff.length) {
    idx = new Float32Array(s2.cliff.length);
    cliffScratch.set(f, idx);
  }
  idx.fill(-1);
  for (let k = 0; k < s2.cliffN; k++) idx[k] = s2.cliff[k];
  put("cliff", idx);
  put("air", f.falls.air);
  // `bestMat` is a Uint8Array on the CPU and rides here as floats, the same
  // way `material` does and for the same reason.

  let wide = wideScratch.get(f);
  if (!wide || wide.length !== f.material.length) {
    wide = new Float32Array(f.material.length);
    wideScratch.set(f, wide);
  }
  for (let i = 0; i < f.material.length; i++) wide[i] = f.material[i];
  put("material", wide);
  for (let i = 0; i < f.bestMat.length; i++) wide[i] = f.bestMat[i];
  put("bestMat", wide);
  // READ BEFORE IT IS WRITTEN by the cliff pass — it is how a column knows
  // whether it was already a lip — so it has to go up with the rest, and it is
  // a byte array, so it rides widened like the material does.
  for (let i = 0; i < s2.cliffCol.length; i++) wide[i] = s2.cliffCol[i];
  put("cliffCol", wide);
}

/**
 * The uniform block, as six `vec4`s.
 *
 * Vectors rather than a flat struct of scalars because a uniform buffer aligns
 * members to sixteen bytes: a hand-packed run of loose floats is a silent
 * mismatch where the shader reads the right bytes for the first two fields and
 * rubbish for the rest, which looks exactly like a physics bug.
 */
/**
 * Scratch for {@link writeConsts}, so a substep allocates nothing.
 *
 * MODULE-WIDE rather than per state, because it is written and handed to
 * `writeBuffer` on the same line and never read again — `writeBuffer` copies
 * out of it before it returns, so nothing holds a reference past the call and
 * two states cannot collide over it. Three hundred and twenty bytes and two
 * views, several times a frame, for a block that is overwritten every time.
 *
 * SAFE BECAUSE EVERY CALL WRITES THE SAME SLOTS. A fresh buffer came zeroed,
 * so a slot nobody wrote read as nought; reused, it would read as whatever the
 * last call left there. Nothing below is conditional — the same fixed set goes
 * in every time — so the handful of slots nobody writes are still the zeroes
 * this was allocated with. Add a conditional write here and that stops being
 * true, and the symptom is a pass reading another pass's uniform.
 */
const CONSTS_SCRATCH = new ArrayBuffer(CONSTS_BYTES);
const CONSTS_I32 = new Int32Array(CONSTS_SCRATCH);
const CONSTS_F32 = new Float32Array(CONSTS_SCRATCH);

export function writeConsts(
  s: GpuState, u: PassUniforms, wnx: number, wstride: number, slot = 0,
) {
  const buf = CONSTS_SCRATCH;
  const i32 = CONSTS_I32;
  const f32 = CONSTS_F32;
  i32[0] = u.x0; i32[1] = u.y0; i32[2] = u.x1; i32[3] = u.y1;
  i32[4] = s.nx; i32[5] = s.ny; i32[6] = wnx; i32[7] = wstride;
  f32[8] = u.gain; f32[9] = u.bedGain; f32[10] = u.hMax; f32[11] = u.minHead;
  f32[12] = u.dt; f32[13] = u.windDepth; f32[14] = 1 / u.windDepth;
  f32[15] = u.spread;
  // Nine offsets need three vectors, not two. Squeezing the ninth into a spare
  // slot of the second is how the first draft of this read `keepOf` out of the
  // middle of the wind.
  const o = s.offset;
  i32[16] = o.ground; i32[17] = o.depth; i32[18] = o.material; i32[19] = o.fx;
  // THE RING'S SLOT, folded into the offset rather than sent as an index: the
  // shader reads these three through the offsets it is given, so a substep
  // pointing at its own slice needs nothing on the device to know about it.
  const wcells = s.length.windX / CONSTS_SLOTS;
  const at = slot % CONSTS_SLOTS;
  i32[20] = o.fy; i32[21] = o.scale;
  i32[22] = o.windX + at * wcells; i32[23] = o.windY + at * wcells;
  i32[24] = o.keepOf + at * MATERIAL_SLOTS;
  i32[25] = o.delta; i32[26] = o.air; i32[27] = o.bestMat;
  f32[28] = u.dryDepth; f32[29] = u.fallMin;
  f32[30] = u.gravity; f32[31] = u.breaking;
  i32[32] = o.rate; i32[33] = o.breakAge; i32[34] = o.broke; i32[35] = o.velo;
  i32[36] = o.iterA; i32[37] = o.iterB; i32[38] = o.front; i32[39] = o.head;
  i32[40] = o.frontSpeed; i32[41] = o.headSpeed; i32[42] = o.since;
  i32[43] = o.shed;
  i32[44] = o.throwX; i32[45] = o.throwY; i32[46] = o.cliff; i32[47] = u.cliffN;
  f32[48] = u.diffScale; f32[49] = u.room; f32[50] = u.cell;
  i32[52] = o.spawn; i32[53] = SPAWN_MAX; i32[54] = SPAWN_STRIDE;
  i32[56] = o.kickX; i32[57] = o.kickY; i32[58] = o.capX; i32[59] = o.capY;
  i32[60] = o.cliffCol;
  i32[61] = o.arrive; i32[62] = u.arriveN; i32[63] = ARRIVE_STRIDE;
  i32[64] = o.washNow; i32[65] = o.washNext; i32[66] = o.washSeed;
  i32[67] = o.fallOut;
  i32[72] = o.matByte;
  i32[73] = u.openEdge ? 1 : 0;
  i32[74] = o.wantAt; i32[75] = o.wantOut;
  i32[76] = u.wantN;
  i32[68] = o.foamNow; i32[69] = o.foamNext;
  i32[70] = o.splashNow; i32[71] = o.splashIn;
  f32[51] = u.frameDt;
  s.device.queue.writeBuffer(s.consts, (slot % CONSTS_SLOTS) * CONSTS_STRIDE, buf);
}

/** Copy any buffer back off the device, as raw bytes. */
export async function readRaw(
  device: GPUDevice, src: GPUBuffer, bytes: number,
): Promise<ArrayBuffer> {
  const staging = device.createBuffer({
    size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const enc = device.createCommandEncoder();
  enc.copyBufferToBuffer(src, 0, staging, 0, bytes);
  device.queue.submit([enc.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const out = staging.getMappedRange().slice(0);
  staging.unmap();
  staging.destroy();
  return out;
}

/** Copy one array back off the device. */
export async function readField(
  s: GpuState, name: FieldName,
): Promise<Float32Array> {
  const bytes = s.length[name] * 4;
  const staging = s.device.createBuffer({
    size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const enc = s.device.createCommandEncoder();
  enc.copyBufferToBuffer(s.field, s.offset[name] * 4, staging, 0, bytes);
  s.device.queue.submit([enc.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const out = new Float32Array(staging.getMappedRange().slice(0));
  staging.unmap();
  staging.destroy();
  return out;
}

/**
 * The shared head of every solver shader: the state, the constants, and the
 * accessors that turn an array name and an index into an offset.
 *
 * ONE TEXT, so the layout cannot drift between passes — the same argument
 * `render/corner-rule` makes, and it was right there. The accessors are
 * functions rather than pointers because WGSL has no pointers into storage
 * that survive a function boundary, and reading
 * `groundAt(i)` rather than `ground[i]` is the whole of the price.
 */
export const STATE_WGSL = `
// NO BACKTICKS BELOW THIS LINE. Everything here is inside a template literal,
// so one in a WGSL comment ends the shader and leaves TypeScript parsing the
// rest of the file as code. It has cost three separate debugging sessions.
struct Consts {
  box: vec4<i32>,        // x0, y0, x1, y1 — the active box, inclusive
  dims: vec4<i32>,       // nx, ny, wind columns, columns per wind cell
  a: vec4<f32>,          // gain, bedGain, hMax, minHead
  b: vec4<f32>,          // dt, windDepth, 1 / windDepth, spread
  o0: vec4<i32>,         // offsets: ground, depth, material, fx
  o1: vec4<i32>,         // offsets: fy, scale, windX, windY
  o2: vec4<i32>,         // offsets: keepOf, delta, air, bestMat
  c: vec4<f32>,          // dryDepth, fallMin, gravity, breaking on
  o3: vec4<i32>,         // offsets: rate, breakAge, broke, velo
  o4: vec4<i32>,         // offsets: iterA, iterB, front, head
  o5: vec4<i32>,         // offsets: frontSpeed, headSpeed, since, shed
  o6: vec4<i32>,         // offsets: throwX, throwY, cliff, and cliffN
  d: vec4<f32>,          // diffScale, room, cell, spare
  o7: vec4<i32>,         // offset: spawn, then its ceiling and its stride
  o8: vec4<i32>,         // offsets: kickX, kickY, capX, capY
  o9: vec4<i32>,         // cliffCol, then arrive: offset, count, stride
  o10: vec4<i32>,        // offsets: washNow, washNext, washSeed, fallOut
  o11: vec4<i32>,        // offsets: foamNow, foamNext, splashNow, splashIn
  o12: vec4<i32>,        // offset: matByte, open edge, wantAt, wantOut
  o13: vec4<i32>,        // how many cells the host asked the depth of, 3 spare
};

@group(0) @binding(0) var<uniform> consts : Consts;
@group(0) @binding(1) var<storage, read_write> field : array<f32>;
@group(0) @binding(2) var<storage, read_write> reduce : array<atomic<i32>>;
@group(0) @binding(3) var<storage, read_write> acc : array<atomic<i32>>;

fn nx() -> i32 { return consts.dims.x; }
fn ny() -> i32 { return consts.dims.y; }
fn wnx() -> i32 { return consts.dims.z; }
fn wstride() -> i32 { return consts.dims.w; }
fn gain() -> f32 { return consts.a.x; }
fn bedGain() -> f32 { return consts.a.y; }
fn hMax() -> f32 { return consts.a.z; }
fn minHead() -> f32 { return consts.a.w; }
fn dt() -> f32 { return consts.b.x; }
fn windDepth() -> f32 { return consts.b.y; }
fn invWindDepth() -> f32 { return consts.b.z; }
fn spread() -> f32 { return consts.b.w; }

fn groundAt(i: i32) -> f32 { return field[consts.o0.x + i]; }
fn depthAt(i: i32) -> f32 { return field[consts.o0.y + i]; }
// Stored as a float because every material index is exact in f32 — see the
// note at the top of state.ts.
fn materialAt(i: i32) -> u32 { return u32(field[consts.o0.z + i]); }
fn fxAt(i: i32) -> f32 { return field[consts.o0.w + i]; }
fn fyAt(i: i32) -> f32 { return field[consts.o1.x + i]; }
fn scaleAt(i: i32) -> f32 { return field[consts.o1.y + i]; }
fn windXAt(i: i32) -> f32 { return field[consts.o1.z + i]; }
fn windYAt(i: i32) -> f32 { return field[consts.o1.w + i]; }
fn keepOfAt(i: u32) -> f32 { return field[consts.o2.x + i32(i)]; }
fn deltaAt(i: i32) -> f32 { return field[consts.o2.y + i]; }
fn airAt(k: i32) -> f32 { return field[consts.o2.z + k]; }
fn bestMatAt(i: i32) -> f32 { return field[consts.o2.w + i]; }
fn dryDepth() -> f32 { return consts.c.x; }
fn fallMin() -> f32 { return consts.c.y; }
fn gravity() -> f32 { return consts.c.z; }
fn breakingOn() -> f32 { return consts.c.w; }
/** Whether the map's rim is emptied every substep. @see openEdgeRim */
fn openEdgeOn() -> bool { return consts.o12.y != 0; }

/** Which cell the host's k-th question is about. @see WANT_MAX */
fn wantAt(k: i32) -> i32 { return i32(field[consts.o12.z + k]); }
/** And where its answer goes. */
fn setWantOut(k: i32, v: f32) { field[consts.o12.w + k] = v; }
/** How many it asked. */
fn wantN() -> i32 { return consts.o13.x; }
/**
 * Whether this column is the rim water LEAVES by, rather than water.
 *
 * With an open edge the outermost ring is emptied every substep and refilled
 * from inside, so the rate there is a whole column arriving and going again —
 * the largest there is, and nothing to do with a wave coming apart.
 */
fn openEdgeRim(i: i32) -> bool {
  if (!openEdgeOn()) { return false; }
  let x = i % nx();
  let y = i / nx();
  return x == 0 || y == 0 || x == nx() - 1 || y == ny() - 1;
}
fn rateAt(i: i32) -> f32 { return field[consts.o3.x + i]; }
fn breakAgeAt(i: i32) -> f32 { return field[consts.o3.y + i]; }
fn brokeAt(i: i32) -> f32 { return field[consts.o3.z + i]; }
fn setRate(i: i32, v: f32) { field[consts.o3.x + i] = v; }
fn setBreakAge(i: i32, v: f32) { field[consts.o3.y + i] = v; }
fn setBroke(i: i32, v: f32) { field[consts.o3.z + i] = v; }
fn setDepth(i: i32, v: f32) { field[consts.o0.y + i] = v; }
fn setMaterial(i: i32, v: f32) { field[consts.o0.z + i] = v; }
fn veloAt(i: i32) -> f32 { return field[consts.o3.w + i]; }
fn iterAAt(i: i32) -> f32 { return field[consts.o4.x + i]; }
fn iterBAt(i: i32) -> f32 { return field[consts.o4.y + i]; }
fn setVelo(i: i32, v: f32) { field[consts.o3.w + i] = v; }
fn setIterA(i: i32, v: f32) { field[consts.o4.x + i] = v; }
fn setIterB(i: i32, v: f32) { field[consts.o4.y + i] = v; }
fn diffScale() -> f32 { return consts.d.x; }
fn roomNow() -> f32 { return consts.d.y; }
fn cellSize() -> f32 { return consts.d.z; }
/**
 * How fast the water over a lip is going, per axis, capped.
 *
 * The twin of columns.ts's flowX and flowY: the mean of the two fluxes either
 * side of a column over a FLOORED depth, so a film does not divide its way to
 * an enormous speed.
 */
fn flowXAt(i: i32) -> f32 {
  let d = depthAt(i);
  if (d <= 0.0) { return 0.0; }
  let by = max(d, dryDepth() * 8.0);
  let west = select(0.0, fxAt(i - 1), (i % nx()) > 0);
  let v = (west + fxAt(i)) * 0.5 / by;
  return clamp(v, -${num(MAX_FLOW_SPEED)}, ${num(MAX_FLOW_SPEED)});
}

fn flowYAt(i: i32) -> f32 {
  let d = depthAt(i);
  if (d <= 0.0) { return 0.0; }
  let by = max(d, dryDepth() * 8.0);
  let north = select(0.0, fyAt(i - nx()), (i / nx()) > 0);
  let v = (north + fyAt(i)) * 0.5 / by;
  return clamp(v, -${num(MAX_FLOW_SPEED)}, ${num(MAX_FLOW_SPEED)});
}

/** What a lip throws at that speed. @see throwOf */
fn throwOf(speed: f32) -> f32 { return min(${num(FALL_THROW)}, max(0.0, speed)); }

fn kickXAt(i: i32) -> f32 { return field[consts.o8.x + i]; }
fn kickYAt(i: i32) -> f32 { return field[consts.o8.y + i]; }
fn capXAt(i: i32) -> f32 { return field[consts.o8.z + i]; }
fn capYAt(i: i32) -> f32 { return field[consts.o8.w + i]; }
fn setKickX(i: i32, v: f32) { field[consts.o8.x + i] = v; }
fn setKickY(i: i32, v: f32) { field[consts.o8.y + i] = v; }
fn setCapX(i: i32, v: f32) { field[consts.o8.z + i] = v; }
fn setCapY(i: i32, v: f32) { field[consts.o8.w + i] = v; }
fn cliffColAt(i: i32) -> f32 { return field[consts.o9.x + i]; }
/** The arrivals list: how many, and the nth one's five numbers. */
fn arriveCount() -> i32 { return consts.o9.z; }
fn arriveAt(n: i32, part: i32) -> f32 {
  return field[consts.o9.y + n * consts.o9.w + part];
}
fn washNowAt(i: i32) -> f32 { return field[consts.o10.x + i]; }
fn setWashNow(i: i32, v: f32) { field[consts.o10.x + i] = v; }
fn washNextAt(i: i32) -> f32 { return field[consts.o10.y + i]; }
fn setWashNext(i: i32, v: f32) { field[consts.o10.y + i] = v; }
fn washSeedAt(i: i32) -> f32 { return field[consts.o10.z + i]; }
/**
 * THE ACTIVE BOX AS activeBox GIVES IT — the wet region padded by one, read
 * from the reduction rather than from the uniform.
 *
 * For the fields carried once a frame, and it has to be this and not the
 * region the physics passes were dispatched over. That one is padded by a
 * whole frame's reach, so it is bigger; a carried field recomputed in the
 * extra ring is recomputed in cells the CPU leaves alone, and a cell the CPU
 * leaves alone keeps whatever white it last had. Measured, that showed up as
 * a foam disagreement of exactly 0.9 — the landing constant, to the bit.
 */
fn carriedBox() -> vec4<i32> {
  return vec4<i32>(
    max(0, atomicLoad(&reduce[0]) - 1),
    max(0, atomicLoad(&reduce[1]) - 1),
    min(nx() - 1, atomicLoad(&reduce[2]) + 1),
    min(ny() - 1, atomicLoad(&reduce[3]) + 1),
  );
}

fn foamNowAt(i: i32) -> f32 { return field[consts.o11.x + i]; }
fn setFoamNow(i: i32, v: f32) { field[consts.o11.x + i] = v; }
fn foamNextAt(i: i32) -> f32 { return field[consts.o11.y + i]; }
fn setFoamNext(i: i32, v: f32) { field[consts.o11.y + i] = v; }
fn splashNowAt(i: i32) -> f32 { return field[consts.o11.z + i]; }
fn setSplashNow(i: i32, v: f32) { field[consts.o11.z + i] = v; }
fn splashInAt(i: i32) -> f32 { return field[consts.o11.w + i]; }
/** The WHOLE frame's dt, which the carried fields step on — not a substep's. */
fn frameDt() -> f32 { return consts.d.w; }
/** How many edges the cliff index holds, as the cliff pass left it. */
fn cliffCount() -> i32 { return atomicLoad(&reduce[${CLIFFN_SLOT}]); }
fn setCliffCol(i: i32, v: f32) { field[consts.o9.x + i] = v; }
fn spawnBase() -> i32 { return consts.o7.x; }
fn spawnMax() -> i32 { return consts.o7.y; }
fn spawnStride() -> i32 { return consts.o7.z; }

/**
 * THE SPRAY'S OUTBOX, appended to by whoever makes a drop.
 *
 * Claim first, write second, and take the water out only if the claim landed
 * inside the buffer: a request that cannot be recorded must not happen at
 * all, or the water goes somewhere no drop ever carries it. Returns whether
 * the slot was real.
 */
fn postSpawn(
  k: i32, kind: i32, cell: i32, volume: f32, a: f32, b: f32, lip: f32, mat: f32,
) -> bool {
  let slot = atomicAdd(&reduce[${SPAWNED_SLOT}], 1);
  if (slot >= spawnMax()) { return false; }
  let at = spawnBase() + slot * spawnStride();
  field[at + 0] = f32(k);
  field[at + 1] = f32(kind);
  field[at + 2] = f32(cell);
  field[at + 3] = volume;
  field[at + 4] = a;
  field[at + 5] = b;
  field[at + 6] = lip;
  field[at + 7] = mat;
  return true;
}

/**
 * The spray's scatter — the exact twin of scatterOf in falls.ts, and it has
 * to be exact: the sin-based hash it replaced gave 0.147 in f64 and 0.941 in
 * f32 for the same edge. A u32 multiply wraps in both languages and a float's
 * BIT PATTERN is the same number on both sides, so every step here is equality
 * rather than approximation.
 */
fn scatterOf(k: i32, speed: f32, salt: i32) -> f32 {
  var h: u32 = bitcast<u32>(speed)
    ^ (bitcast<u32>(k) * 0x9e3779b9u)
    ^ (bitcast<u32>(salt) * 0x632be5abu);
  h = (h ^ (h >> 16u)) * 0x85ebca6bu;
  h = (h ^ (h >> 13u)) * 0xc2b2ae35u;
  h = h ^ (h >> 16u);
  return f32(h >> 8u) / 16777216.0;
}
fn cliffN() -> i32 { return consts.o6.w; }

fn frontAt(k: i32) -> f32 { return field[consts.o4.z + k]; }
fn headAt(k: i32) -> f32 { return field[consts.o4.w + k]; }
fn frontSpeedAt(k: i32) -> f32 { return field[consts.o5.x + k]; }
fn headSpeedAt(k: i32) -> f32 { return field[consts.o5.y + k]; }
fn sinceAt(k: i32) -> f32 { return field[consts.o5.z + k]; }
fn shedAt(k: i32) -> f32 { return field[consts.o5.w + k]; }
fn throwXAt(i: i32) -> f32 { return field[consts.o6.x + i]; }
fn throwYAt(i: i32) -> f32 { return field[consts.o6.y + i]; }
fn cliffAt(n: i32) -> i32 { return i32(field[consts.o6.z + n]); }
/** One word of four packed materials. @see createMatpack */
fn setMatByte(n: i32, v: u32) { field[consts.o12.x + n] = bitcast<f32>(v); }
/** One float of one lip's row in the falls outbox. @see FALL_OUT_STRIDE */
fn setFallOut(n: i32, part: i32, v: f32) {
  field[consts.o10.w + n * ${FALL_OUT_STRIDE} + part] = v;
}
fn setCliff(n: i32, v: f32) { field[consts.o6.z + n] = v; }

fn setFront(k: i32, v: f32) { field[consts.o4.z + k] = v; }
fn setHead(k: i32, v: f32) { field[consts.o4.w + k] = v; }
fn setFrontSpeed(k: i32, v: f32) { field[consts.o5.x + k] = v; }
fn setHeadSpeed(k: i32, v: f32) { field[consts.o5.y + k] = v; }
fn setSince(k: i32, v: f32) { field[consts.o5.z + k] = v; }
fn setShed(k: i32, v: f32) { field[consts.o5.w + k] = v; }
fn setThrowX(i: i32, v: f32) { field[consts.o6.x + i] = v; }
fn setThrowY(i: i32, v: f32) { field[consts.o6.y + i] = v; }
fn setAir(k: i32, v: f32) { field[consts.o2.z + k] = v; }

fn setFx(i: i32, v: f32) { field[consts.o0.w + i] = v; }
fn setFy(i: i32, v: f32) { field[consts.o1.x + i] = v; }
fn setScale(i: i32, v: f32) { field[consts.o1.y + i] = v; }
fn setDelta(i: i32, v: f32) { field[consts.o2.y + i] = v; }
fn addAir(k: i32, v: f32) { field[consts.o2.z + k] = field[consts.o2.z + k] + v; }
fn setBestMat(i: i32, v: f32) { field[consts.o2.w + i] = v; }

/**
 * Where a neighbour's water, or failing that its ground, stands, and how far
 * water leaving a cell over one edge would fall.
 *
 * The twin of besideAt and dropAt in fluid/falls. Here rather than in a
 * pass because the DIVERGENCE asks it of its own edges and of its two
 * upstream neighbours' — a cell has to be able to work out whether the water
 * coming towards it was diverted into the air before it arrived, which is what
 * makes that pass a gather instead of a scatter.
 */
fn besideAt(j: i32) -> f32 {
  let dj = depthAt(j);
  return select(groundAt(j), groundAt(j) + dj, dj > dryDepth());
}

fn dropAt(i: i32, axis: i32) -> f32 {
  let x = i % nx();
  let y = i / nx();
  let jx = select(x, x + 1, axis == 0);
  let jy = select(y + 1, y, axis == 0);
  if (jx >= nx() || jy >= ny()) { return 0.0; }
  let drop = groundAt(i) - besideAt(jy * nx() + jx);
  return select(0.0, drop, drop >= fallMin());
}
`;

/** The bind group layout the head above describes: one uniform, one buffer. */
/**
 * ONE LAYOUT PER DEVICE, and the memo is not tidiness.
 *
 * Every pass asks for this when it is built, so fourteen identical layout
 * objects were being made — harmless in itself, but it is what stopped the
 * BIND GROUP from being shared: a bind group belongs to the layout it was
 * made with, and with a layout each, every pass had to have its own. One
 * layout makes one bind group legal everywhere. @see bindState
 */
const layouts = new WeakMap<GPUDevice, GPUBindGroupLayout>();

export function stateLayout(device: GPUDevice): GPUBindGroupLayout {
  const had = layouts.get(device);
  if (had) return had;
  const made = device.createBindGroupLayout({
    entries: [
      {
        binding: 0, visibility: GPUShaderStage.COMPUTE,
        // @see CONSTS_STRIDE — one slice per substep, chosen at bind time.
        buffer: { type: "uniform", hasDynamicOffset: true },
      },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
    ],
  });
  layouts.set(device, made);
  return made;
}

/**
 * Bind the whole solver state, at the substep's own slice of the constants.
 *
 * Every pass goes through this rather than calling `setBindGroup` itself, so
 * that the dynamic offset cannot be forgotten in one of them — which is a
 * silent wrong answer rather than an error, since the pass would simply read
 * whichever substep's numbers happened to be in slot nought.
 */
/**
 * Begin a compute pass, TIMED where the device can be asked.
 *
 * Every pass in the solver goes through this rather than calling
 * `beginComputePass` itself, for the same reason they all go through
 * `bindState`: a timing that has to be remembered in sixteen places is a
 * timing that is missing from one of them, and a readout that is quietly short
 * of a pass is worse than one that has none. @see Stamps
 */
export function beginPass(
  enc: GPUCommandEncoder, s: GpuState, label: string,
): GPUComputePassEncoder {
  const timestampWrites = s.stamps?.take(label);
  return enc.beginComputePass(
    timestampWrites ? { label, timestampWrites } : { label },
  );
}

export function bindState(
  pass: GPUComputePassEncoder, s: GpuState, layout: GPUBindGroupLayout,
): void {
  // MADE ONCE. This called `stateBindGroup` per pass, so a frame with two
  // substeps built about forty six identical bind groups over buffers that
  // never change — the only thing that varies between passes is the dynamic
  // offset, and that is an argument to `setBindGroup` rather than part of the
  // group. @see stateLayout
  s.bound = s.bound ?? stateBindGroup(s, layout);
  pass.setBindGroup(0, s.bound, [s.constsAt]);
}

export function stateBindGroup(s: GpuState, layout: GPUBindGroupLayout): GPUBindGroup {
  return s.device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: { buffer: s.consts, size: CONSTS_BYTES } },
      { binding: 1, resource: { buffer: s.field } },
      { binding: 2, resource: { buffer: s.reduce } },
      { binding: 3, resource: { buffer: s.acc } },
    ],
  });
}
