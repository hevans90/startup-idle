/**
 * A whole frame of water, on the device.
 *
 * The passes each know how to do one thing to the state; this is what runs
 * them in the order a frame runs them, for as many substeps as the frame
 * needs, and it is the thing that makes the port a solver rather than a set
 * of comparisons.
 *
 * THE DEVICE OWNS THE WATER, and this header used to say the opposite — that
 * the host's `ColumnField` stayed authoritative and the device was a thing it
 * handed work to. That was the shape while the whole field went up and came
 * back every frame; it is not the shape now. `createGpuWater` installs an
 * arrivals list on the field and from that moment the host's writes are
 * COLLECTED rather than being the truth.
 *
 * What the host still holds is a copy for everything that reads water and
 * cannot ask the device — the renderer's drips, the editor, the pipes, the
 * save — brought down by a readback a few frames old, off the critical path.
 * Nothing waits on it. @see sync, scatter
 *
 * WHAT IT COSTS IS NO LONGER THE TRANSFERS. This header used to say the whole
 * field went up and came back every frame, a megabyte or so each way, and that
 * this was the dominant cost of the path. Both halves have gone:
 *
 *   UP goes only what the host can have changed — the arrivals list carries a
 *   pour or a pipe's drop as a handful of cells rather than a whole depth map,
 *   and the ground and the splash go up on a revision rather than on the
 *   clock. @see Arrivals, ColumnField.groundRev
 *
 *   DOWN comes a reduction, a LIST of the lips and a band of depth, not five
 *   whole edge maps and a map of columns: 3.63MB a frame to 0.31MB. The lips
 *   are the shape of the answer — seven hundred of them on a flooded map,
 *   against a hundred and thirty thousand edges — and depth is the one field
 *   that is neither a list nor a slow refresh, so it comes back by the band.
 *   @see FALL_OUT_STRIDE, setDepthBand
 *
 * What is left is arithmetic and a readback of a third of a megabyte. The
 * solver's own compute is about a millisecond of device time a frame.
 *
 * ONE FRAME OF LAG. A readback cannot be awaited inside a render tick, so the
 * frame submitted here is consumed at the start of the next one. The water on
 * screen is one frame behind the water the device has computed, which at sixty
 * a second is not something anybody can see, and it is stated here rather than
 * discovered.
 *
 * THE SUBSTEPS ARE PLANNED ON THE HOST, from the `deepest` the last frame's
 * reduction reported. That is a frame stale and it is safe for the reason the
 * plan gives: `hMax` inside the accelerate pass is a backstop that does not
 * care what the stepper thought. See `substepsFor`, which is shared with the
 * CPU solver so the two cut a frame the same way.
 *
 * SPILL AND WIND STAY WHERE THEY WERE — spill because it runs at the top of
 * every substep and only the first one happens when the host's copy is
 * current, so it is a pass; wind because it is a pure function of the clock
 * over a small grid, which is cheaper to work out on the host and upload than
 * to reproduce in a shader, and reproducing a sine in f32 is a difference
 * nobody needs.
 */
import {
  MATERIAL_SLOTS, clearArrivals, createArrivals, stepAir, stirWind,
  maxStep, substepsFor, wantDepth, type ColumnField,
  type PassConsts,
} from "../columns";
import { drainSpawns } from "./falls";
import { createAccelerate } from "./accelerate";
import { createApply, readReduce, reduceSeed } from "./apply";
import { createArrive } from "./arrive";
import { createCliffs } from "./cliffs";
import { createDiffuse } from "./diffuse";
import { createDivergence } from "./divergence";
import { createFallout } from "./fallout";
import { createMatpack } from "./matpack";
import { createMeta } from "./meta";
import { createSheet, type SheetPass } from "./sheet";
import { holdStamps } from "../../world/debug/gpu-stamps";
import { createFalls } from "./falls";
import { createLandings } from "./landings";
import { createLimit } from "./limit";
import { createSpill } from "./spill";
import { createWashPass } from "../../world/render/wash-gpu";
import { createFoamPass } from "../../world/render/foam-gpu";
import { createWant } from "./want";
import {
  ARRIVE_STRIDE, CLIFFN_SLOT, CONSTS_SLOTS, CONSTS_STRIDE,
  CARRIED_BACK, CARRY_EVERY, FALL_OUT_BACK, FALL_OUT_MAX, FALL_OUT_STRIDE,
  FIELDS, REDUCE_SLOTS, SPAWNED_SLOT, SPAWN_MAX, SPAWN_STRIDE, WANT_MAX,
  copyOut, createGpuState, runsOf,
  upload, uploadArrivals, writeConsts, type FieldName, type Sink,
} from "./state";
import { FALL_MIN } from "../falls";
import { dripRoom } from "../drips";

/**
 * The floor under the box's padding, in frames.
 *
 * The real figure is measured — see `stale` — because guessing it was a
 * serious bug. A readback is asked for only when the last one is done and
 * costs about three frames of latency, so the host's copy of the box can be
 * four or five frames old while the device runs a frame every tick. Padded by
 * a constant two, the dispatch region stopped short of the spreading front,
 * and water crossing the edge of it was never applied anywhere: measured on a
 * flat map with one pour and no further input, the map lost more than half its
 * water in three quarters of a second. It does not show up in the awaited
 * harness at all, because there the box is refreshed every single frame.
 */
const LATENCY = 2;

/** What one frame cost and what it did, for the readout. @see GpuWater */
export type GpuFrame = {
  substeps: number;
  /** Milliseconds of host time spent encoding and copying, not GPU time. */
  hostMs: number;
  /** How long the last readback took to come back, in milliseconds. */
  readMs: number;
  cliffN: number;
  /** The region the passes were dispatched over, for when a box is doubted. */
  region: unknown;
  drops: number;
  /** Frames submitted but not yet consumed. One is the steady state. */
  inFlight: number;
  /** Megabytes coming back each frame, which is what paces this path. */
  readMb: number;
  /**
   * Whether this frame's readback brought the CARRIED fields back whole.
   *
   * The wash and the foam come down once every {@link CARRY_EVERY} readbacks,
   * so between those the host's copies are up to half a second old — which is
   * exactly what they are for, and a trap for anything that reads them as the
   * device's current answer. `compareFrames` fell in it: it diffed a freshly
   * stepped CPU foam against a host copy up to thirty frames stale and
   * reported the full range of the field as a disagreement, every run, for
   * fields that agree to a hundredth when asked on a frame they came back on.
   *
   * What is NOT stale between carries is the wash and the foam AT THE LIPS,
   * which ride the lip row every frame. @see CARRIED_BACK
   */
  carried: boolean;
  /** Seconds the last submitted frame was asked for, arrears included. */
  owed: number;
  /** Where the host's time went, so the readout can say rather than imply. */
  scatterMs: number;
  uploadMs: number;
  encodeMs: number;
  /**
   * WHAT THE REDUCTION SAID, raw, as the last readback carried it.
   *
   * The box every pass is bounded by comes from here, and a box that is wrong
   * is not a wrong picture — it is water deleted at the edge of a dispatch. It
   * used to be invisible: the host keeps its own box too, and the two are
   * merged in `scatter`, so a reduction that came back empty looked exactly
   * like a map with no water in it.
   */
  reduce: {
    x0: number; y0: number; x1: number; y1: number;
    deepest: number; breaking: boolean; cliffN: number;
    /** Water the apply pass's clamp ate. Nought, or a bug. @see CLAMP_SLOT */
    clamped: number;
    /** Every delta summed. Nought, or the gather does not telescope. */
    deltaSum: number;
    /**
     * The readout's two numbers, counted on the device: tiles whose mean depth
     * is over the dry depth, and every column's depth summed. The store used
     * to walk the whole map for these, every tick. @see createMeta
     */
    wet: number;
    water: number;
  } | null;
  /**
   * MILLISECONDS OF GPU, per pass, averaged — or null where the device cannot
   * be asked. The one number the frame readout has never been able to give.
   *
   * A FUNCTION AND NOT A FIELD. It was read off the clocks and stored here on
   * every frame, for a readout that asks four times a second and a harness
   * that asks when a human does — sixty averages over every ring and a fresh
   * record of them, fifty-six times out of sixty for nobody. The clocks
   * outlive any solver and anyone may ask them directly; this is the same
   * question, asked when it is wanted. @see Stamps, holdStamps
   */
  gpu: () => { of: Record<string, number>; total: number; frames: number } | null;
  /**
   * EVERY DEPTH THE DEVICE SENT BACK, summed, before anything of the host's
   * is put on top of it.
   *
   * A flat closed map with nothing pouring into it cannot lose water, so this
   * is a constant and any dip in it is a bug — and it is the one number that
   * says WHOSE. The host's own total is this plus the arrivals still in
   * flight, so a total that sags could be the device's passes losing water or
   * the re-application of what is in flight losing track of it, and the two
   * want completely different fixes.
   *
   * COUNTED ON THE DEVICE, in the pass that is already walking the depths to
   * decide which tiles are wet. It was summed on the host out of the readback,
   * which was honest while the whole depth map came back every frame and
   * stopped being so the day depth started arriving BY THE BAND: rows outside
   * the band are the host's own copy, pending pours included, so the alarm was
   * quietly being shown a mixture and called it the device's answer. Forty
   * three microseconds a frame, for a number that was drifting away from what
   * it claimed to be. @see DEPTH_SLOT, setDepthBand
   *
   * Water in the AIR is not in it — that is counted per lip in its own pass,
   * and `reduce.air` has it — so on a map with a cliff on it this is not the
   * whole of the water and is not meant to be.
   */
  deviceWater: number;
};

/**
 * The rendering fields the device carries, and where their answers land.
 *
 * Handed in rather than owned, because they belong to the water LAYER — they
 * are what the surface is painted with, and the layer's textures are views
 * over these very arrays. The solver advects them because advecting them is a
 * gather over the fluxes it already holds, and doing it on the host cost three
 * times what the whole solver did.
 */
export type Carried = {
  /** The still pattern the wash settles back to. Uploaded once. */
  seed: Float32Array;
  /** The advected pattern, filled from each readback. */
  now: Float32Array;
  /** The white, likewise. */
  foam: Float32Array;
};

/**
 * What the falls' layer hands the solver so it can build the sheets.
 *
 * The PROJECTION comes from the renderer because it is the renderer's: half a
 * tile across, half a diamond down, the height unit and whatever the camera is
 * scaled by. The solver has no business knowing any of them, and a fluid
 * module that imported `iso` would be the start of it knowing all of them.
 */
export type SheetTo = {
  /**
   * One per band: a vertex attribute's offset may not exceed its stride.
   *
   * ASKED FOR EACH FRAME rather than handed over once, because the renderer
   * owns these and decides when they exist. Taken at attach time the handles
   * were of buffers Pixi had not drawn from yet and later replaced, so the
   * copy went somewhere real and nothing drew it: sheets in the pass's own
   * buffer, zeroes in every buffer a mesh reads, and a map with no falls on it.
   */
  verts: () => readonly GPUBuffer[];
  tint: GPUTextureView;
  bands: number;
  /** Quads a band may hold. @see createSheet */
  cap: number;
  /** Half width, half height, height unit, and the layer's scale. */
  proj: readonly [number, number, number, number];
  /** Columns per tile, and how many tiles high the map is. */
  cpt: number;
  tilesHigh: number;
};

export type GpuWater = {
  /**
   * Take what the device finished, BEFORE the host writes anything this frame.
   *
   * It is a separate call and the order is the whole of why. The scatter
   * overwrites the host's depths with the device's, and springs, pipes, brushes
   * and landing drops all write those depths at the top of a frame — done
   * inside `step`, as it was at first, a readback one or two frames old lands
   * on top of this frame's pour and wipes it. A spring looked like it was
   * running dry. Call this first, then let everything pour, then `step`.
   */
  sync: (f: ColumnField) => void;
  step: (f: ColumnField, dt: number) => void;
  /**
   * The same frame, but waited for.
   *
   * For a harness rather than a renderer: it costs the whole round trip in
   * line, which is the thing `step` exists to avoid, and gives back a field
   * that is this frame's rather than last frame's. A comparison against the
   * CPU solver cannot be a frame behind and still mean anything.
   */
  stepAwaited: (f: ColumnField, dt: number) => Promise<void>;
  last: () => GpuFrame;
  /**
   * A TIMESTAMP PAIR FOR A PASS THIS CODE DOES NOT ENCODE.
   *
   * The renderer's work is a render pass built inside Pixi, and the only way
   * to time it is for that pass to carry the timestamps itself — bracketing it
   * with passes of ours reads nought, because nothing orders them against it.
   * So the scene wraps `beginRenderPass` and asks for this, and the answer
   * goes into the descriptor Pixi was about to use.
   *
   * Through the solver rather than a query set of the renderer's own: two sets
   * would be two resolves and two readbacks for one question, and the readout
   * that shows the answer already comes from here. Undefined where the device
   * cannot be timed, where the solver is gone, or where the frame has used its
   * slots up — in which case Pixi gets the descriptor it always had.
   */
  stamp: (label: string) => GPUComputePassTimestampWrites | undefined;
  /**
   * BUILD THE FALLS' SHEETS HERE, into the buffer the falls' mesh draws.
   *
   * The sheets are made of the lip list, the fronts and the throws, all of
   * which are in this buffer — so the pass that builds them belongs beside the
   * passes that fill them rather than on the far side of a readback. Handed
   * the renderer's own vertex buffer, which carries a `STORAGE` usage for
   * exactly this, so the quads are written where they will be drawn from.
   *
   * Null turns it off and the host builds them again. @see createSheet
   */
  sheetTo: (to: SheetTo | null) => void;
  /** How many quads each band's sheet holds, a frame stale. @see SheetPass */
  sheetCounts: () => Uint32Array | null;
  /** What the pass wrote, for a harness to check against the host's. */
  sheetQuads: () => GPUBuffer | null;
  /**
   * The camera moved, so the sheets are drawn at a different size.
   *
   * Its own call rather than a rebuild: the projection is the only part of
   * what `sheetTo` was handed that changes while the scene stands, and
   * rebuilding the pass for a zoom would throw away a frame of sheets. Does
   * nothing where the scale has not moved. @see SheetTo
   */
  sheetScale: (scale: number) => void;
  destroy: () => void;
};

export function createGpuWater(
  device: GPUDevice, f: ColumnField, carried?: Carried,
  into: readonly Sink[] = [],
): GpuWater {
  const state = createGpuState(device, f);
  // WHEN THE GPU STARTED AND STOPPED, where the device can be asked. Every
  // claim in this file about what a pass costs was inferred from a serialised
  // bench until these existed. BORROWED and not made here: the render is timed
  // by the same set and has to be timed whether this solver exists or not, or
  // there is nothing to compare its cost against. @see holdStamps
  state.stamps = holdStamps(device);
  // FROM HERE THE DEVICE OWNS THE WATER, and the host's writes are collected
  // rather than being the truth. Put back on `destroy`, so the CPU solver goes
  // back to owning it outright and pays nothing for any of this.
  f.arrivals = createArrivals(f.depth.length);
  // AND THE LIST OF WHAT THE HOST WILL ASK THE DEPTH OF. Same lifetime as the
  // arrivals and for the mirror-image reason: those carry the host's writes
  // up, this carries its questions. @see wantDepth
  f.wanted = { at: new Int32Array(WANT_MAX), n: 0 };
  const passes = {
    arrive: createArrive(device),
    spill: createSpill(device),
    cliffs: createCliffs(device),
    diffuse: createDiffuse(device),
    accelerate: createAccelerate(device),
    limit: createLimit(device),
    divergence: createDivergence(device),
    apply: createApply(device),
    falls: createFalls(device),
    landings: createLandings(device),
    fallout: createFallout(device),
    matpack: createMatpack(device),
    meta: createMeta(device),
    want: createWant(device),
    wash: createWashPass(device),
    foam: createFoamPass(device),
  };

  // TWO staging buffers, used turn and turn about: a buffer may not be the
  // destination of a copy while it is mapped, so a single one would have to be
  // unmapped and remapped in lockstep with the frame. Only one frame is ever
  // in the air now, so the second is slack rather than necessity — and slack
  // is what lets `stepAwaited` and the live path share this code. It is cheap
  // slack now that they are sized for what is copied. @see stagingFloats
  const runs = runsOf(state);
  const runOf = ([first, last]: readonly [FieldName, FieldName]) => ({
    at: state.offset[first],
    len: state.offset[last] + state.length[last] - state.offset[first],
  });
  /**
   * WHETHER THE DEVICE IS FILLING THE MATERIAL TEXTURE.
   *
   * If it is not — a map whose rows are the wrong width for a one-byte texel,
   * or the WebGL path — then the host's copy of `material` is what that
   * texture is uploaded from, so it has to be current every frame rather than
   * at the lips and once in a while. Asked of the sinks rather than set by a
   * flag, so the two answers cannot drift apart. @see deviceSinks
   */
  const matFed = into.some((k) => k.name === "matByte");
  const everyFrame = matFed
    ? runs
    : [...runs, runOf(["material", "material"] as const)];
  /** The whole maps the list replaced, for when the list is switched off. */
  const wholeRuns = [...FALL_OUT_BACK, ...CARRIED_BACK].map(runOf);
  /** The carried fields, for the slow refresh. @see CARRIED_BACK */
  const carriedRuns = CARRIED_BACK.map(runOf);
  /** Readbacks until the carried fields come back whole. @see CARRY_EVERY */
  let carryDue = 0;
  /**
   * THE MOST FLOATS ANY ONE READBACK ASKS FOR, which is not the field.
   *
   * The runs used to be copied to their OWN offsets in the staging buffer, so
   * that the host could index the copy exactly as it indexes the field — which
   * meant every staging buffer had to be as big as the whole state, thirteen
   * megabytes apiece, to carry back a quarter of one. Two of them, and a host
   * mirror: fifty-five megabytes standing, for 0.25 moving.
   *
   * Packed contiguously instead. The copy records where each run landed and
   * the host unpacks by that, which costs one number per run and nothing else.
   *
   * Sized for the WORST FRAME rather than this one, because a buffer cannot be
   * resized: the runs read every frame, plus the two that vary with the map
   * and the spray, plus whichever of the two tails is larger — the lip rows
   * and carried fields on the list path, or the whole maps that replaced them
   * when the list is off.
   */
  const lenOf = (rs: { len: number }[]) => rs.reduce((n, r) => n + r.len, 0);
  const stagingFloats =
    lenOf(everyFrame)
    + SPAWN_MAX * SPAWN_STRIDE
    + state.nx * state.ny                       // the depth band, at its widest
    + Math.max(
      FALL_OUT_MAX * FALL_OUT_STRIDE + lenOf(carriedRuns),
      lenOf(wholeRuns),
    );
  const staging = [0, 1].map(() => ({
    field: device.createBuffer({
      size: stagingFloats * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      label: "readback field",
    }),
    reduce: device.createBuffer({
      size: REDUCE_SLOTS * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      label: "readback reduce",
    }),
    busy: false,
  }));
  /**
   * WHERE A READBACK LANDS, reused, because the alternative was copying
   * thirteen megabytes to look at four hundred kilobytes.
   *
   * `getMappedRange()` hands back the WHOLE staging buffer — it is the size of
   * the packed state, every field, whether or not this readback asked for it —
   * and `slice(0)` copied all of it, allocating a fresh thirteen megabytes
   * every time. In a profile of one pour that was the second largest thing in
   * the trace after React. Only the runs actually asked for are copied now,
   * into arrays that live as long as the solver: no allocation, and a
   * thirtieth of the bytes moved.
   *
   * Safe to share because only one readback is ever in the air — `step` asks
   * for one only when none is outstanding, and what the last one left is
   * consumed before the next is issued.
   */
  const rawSeen = new Float32Array(state.floats);
  /**
   * THE QUESTIONS THIS READBACK ASKED, kept because the answers come back
   * three to five frames later and the list has been rewritten several times
   * by then. Two buffers rather than one: `lastWant` is what the last frame
   * uploaded, `flightWant` is what the readback actually in the air asked for,
   * copied when it is issued. One readback is in flight at a time and its
   * answers are scattered before the next is issued, so one of each is enough.
   * @see wantDepth
   */
  const lastWant = new Int32Array(WANT_MAX);
  let lastWantN = 0;
  const flightWant = new Int32Array(WANT_MAX);
  let flightWantN = 0;
  /**
   * Which cells the scatter has just written a depth into.
   *
   * The unacked arrivals are re-applied ON TOP of what came back, and "what
   * came back" used to be a contiguous band of rows, so a range test answered
   * it. With the depth gathered by name it is a scattered set, and a pour the
   * device has not seen yet must still be put back over any cell this readback
   * overwrote — or the pour is lost, silently, at exactly the cells something
   * on the host was watching.
   */
  const wroteDepth = new Uint8Array(state.cells);
  const redSeen = new Int32Array(REDUCE_SLOTS);
  let turn = 0;
  let primed = false;
  /** The ground revision the device is holding. @see ColumnField.groundRev */
  let sentGround = f.groundRev;
  /** Whether the last splash sent up had anything alive in it. */
  let sentSplash = false;
  /** Seconds a tick could not submit and the next one has to make up. */
  let owed = 0;
  /** Frames since the host last had a fresh box. @see LATENCY */
  let stale = 0;
  // WHAT HAS GONE UP BUT NOT YET COME BACK.
  //
  // The device owns the water; the host sends what it ADDS and keeps a copy to
  // read. That copy is three to five frames behind, so a readback landing now
  // does not contain the arrivals sent since it was asked for — those are
  // still on their way through. They are kept here, numbered, and re-applied
  // on top of whatever comes back. That is exact, because they are a short
  // list of cells and amounts rather than a difference between two versions of
  // an array, and applying them twice is impossible: the ones a readback does
  // contain are dropped by number.
  //
  // This replaced a reconciliation between the host's copy of the water and
  // the device's, and that reconciliation is where every water fault in this
  // port came from.
  type Batch = {
    seq: number; cell: Int32Array; depth: Float32Array; fx: Float32Array;
    fy: Float32Array; mat: Uint8Array; n: number;
  };
  let unacked: Batch[] = [];
  let seq = 0;
  /** The last batch the readback in flight is known to contain. */
  let issued = -1;
  const scratch = new Float32Array(f.depth.length * ARRIVE_STRIDE);

  /**
   * HOW MANY LIP ROWS THE NEXT READBACK ASKS FOR.
   *
   * The copy's length is fixed when the command is encoded, and how many lips
   * there are is only known once the reduction comes back — so this is the
   * last count, doubled, with a floor. Doubled because a terrain edit can add
   * lips between one readback and the next and a row short is a sheet that
   * blinks; a floor so that the first frames of a map that has not reported
   * yet still carry a fall. It costs a few tens of kilobytes to be generous
   * here, against the two megabytes this replaced. @see FALL_OUT_MAX
   */
  let lipCap = 1024;
  /**
   * HOW MUCH OF THE SPRAY'S OUTBOX THE NEXT READBACK ASKS FOR.
   *
   * The outbox holds four thousand drops and a busy waterfall sheds a couple
   * of hundred, but all of it came back every frame — a hundred and
   * twenty eight kilobytes to carry eight. The drops are claimed in order from
   * the front, so a head covers them, and `drainSpawns` already bounds itself
   * by the buffer it is handed rather than by the ceiling. Same rule as the
   * lips: twice what was last seen, with a floor, so a burst has room.
   */
  let spawnCap = 256;

  type Band = { y0: number; y1: number };
  let pending: {
    raw: Float32Array; red: Int32Array; carriedFull: boolean;
    lipsFresh: boolean; band: Band; sparse: boolean; wantN: number;
  } | null = null;
  let inFlight = 0;
  let readMs = 0;
  let dead = false;
  /** The falls' sheets, where a renderer has asked for them. @see sheetTo */
  let sheet: SheetPass | null = null;
  /** What it was asked for with, so a zoom can re-say it. @see sheetScale */
  let sheetAt: SheetTo | null = null;
  /**
   * The edges the last scatter wrote, so the next one clears only those.
   *
   * @see sweepAll for why it starts out not trusted.
   */
  const wrote = new Int32Array(FALL_OUT_MAX);
  let wroteN = 0;
  /**
   * Whether {@link wrote} accounts for everything in the fall arrays.
   *
   * False wherever something other than this scatter may have written them: at
   * construction, since the CPU solver has been keeping these and leaves no
   * note of where, and after a frame of `setFallList(false)`, which writes all
   * five whole. The next scatter then blanks them outright and takes over the
   * record from there.
   */
  let swept = false;

  /**
   * Bring the readback in the air down into `field`, if there is one.
   *
   * THE ONE DOOR, because both `sync` and `step` do this and only one of them
   * is on the live path. A readback is sized for the field the solver was
   * BUILT for, so scattering it into a different one writes the old map's rows
   * into the new map — or past the end of it, when the new one is smaller.
   * Refusing here rather than trusting the caller: the shape is knowable from
   * inside, and the caller that got this wrong was the live frame loop.
   *
   * A refusal DROPS the readback rather than holding it, since the field it
   * describes is gone and nothing will ever want it again.
   */
  const bringDown = (field: ColumnField) => {
    if (!pending) return;
    const p = pending;
    pending = null;
    if (field.nx !== state.nx || field.ny !== state.ny) return;
    scatter(p.raw, p.red, field, p.carriedFull, p.lipsFresh, p.band, p.sparse, p.wantN);
  };

  const frame: GpuFrame = {
    substeps: 0, hostMs: 0, readMs: 0, cliffN: 0, drops: 0, inFlight: 0,
    region: null, owed: 0, scatterMs: 0, uploadMs: 0, encodeMs: 0,
    readMb: 0, carried: false, reduce: null, deviceWater: 0,
    gpu: () => state.stamps?.says() ?? null,
  };

  /** Put a whole readback back into the host's arrays. @see FIELDS */
  const scatter = (
    raw: Float32Array, red: Int32Array, into: ColumnField, carriedFull: boolean,
    lipsFresh: boolean, band: Band, sparse: boolean, wantN: number,
  ) => {
    // SAID PER SCATTER and not per encode, because it is a fact about what
    // just landed in the host's arrays rather than about what was asked for.
    // @see GpuFrame.carried
    frame.carried = carriedFull;
    // `set` AND NOT A LOOP. There are twenty arrays here and sixty five
    // thousand columns on a big map, so the obvious `for` is two and a half
    // million interpreted iterations per frame — it was the single largest
    // cost of this path, larger than either transfer. `set` on a typed array
    // is a memcpy where the types agree and a native convert where they do
    // not.
    const put = (name: (typeof FIELDS)[number], dst: {
      set: (a: Float32Array) => void; length: number;
    }) => {
      const at = state.offset[name];
      dst.set(raw.subarray(at, at + dst.length));
    };
    /**
     * THE DEVICE'S ANSWER, PLUS WHATEVER THE HOST HAS ADDED SINCE.
     *
     * The three arrays the host writes cannot simply be overwritten. A pour, a
     * brush stroke, a pipe — anything outside the tick — lands in the host's
     * copy at an arbitrary moment, and the arrivals delta that carries it up
     * is only taken in `step`. A readback arriving in between would wipe it,
     * and the water would never reach the device at all: the click did
     * nothing, every time the timing fell that way.
     *
     * So what is pending is measured before the overwrite and put back after,
     * and the snapshot is left at the DEVICE's value rather than the sum — so
     * the same pending amount is still owed, and `step` uploads it exactly
     * once. `settle` must not run over this afterwards.
     */
    // READ FIRST, because the lips are scattered out of a list whose LENGTH
    // this says — so it is needed before the arrays are filled rather than
    // after, which is where it used to sit.
    const r0 = readReduce(red);
    // THE BAND, AND ONLY THE BAND. Every row outside it is untouched, which is
    // both cheaper and RIGHT: the device cannot have changed them, and the
    // host's copy may hold a pour that has not been acknowledged yet, which
    // overwriting would either lose or — put back on top — count twice.
    // @see setDepthBand
    const from = sparse ? 0 : band.y0 * into.nx;
    const upto = sparse ? 0 : (band.y1 + 1) * into.nx;
    if (sparse) {
      // THE NAMED CELLS AND NOTHING ELSE. Every other column keeps whatever
      // the last whole band left it, which is what the carry frames refresh.
      const at = state.offset.wantOut;
      for (let k = 0; k < wantN; k++) {
        const i = flightWant[k];
        into.depth[i] = raw[at + k];
        wroteDepth[i] = 1;
      }
    } else {
      into.depth.set(
        raw.subarray(state.offset.depth + from, state.offset.depth + upto), from,
      );
    }
    // OFF THE DEVICE'S OWN TALLY. @see GpuFrame.deviceWater
    frame.deviceWater = r0.depth;
    // ONLY WHEN THEY ACTUALLY CAME BACK. Their offsets always hold something —
    // the last whole copy — and writing that over the host's arrays every
    // frame would undo the lips the list has just put into them, which is
    // where the material and the two fluxes come from now. @see CARRIED_BACK
    if (!matFed) put("material", into.material);
    if (carriedFull) {
      if (matFed) put("material", into.material);
      put("fx", into.fx);
      put("fy", into.fy);
      if (carried) { put("washNow", carried.now); put("foamNow", carried.foam); }
    }
    // THE LIPS, SCATTERED BACK OUT OF THE LIST.
    //
    // Cleared first: a lip that stopped falling, or a lip that stopped being a
    // lip because somebody raised the ground under it, has no row this frame
    // and would otherwise keep whatever it had for ever — a sheet hanging in
    // the air off a cliff that is not there any more.
    //
    // ONLY WHERE SOMETHING WAS PUT, which is a list this already has. It used
    // to be five `fill`s over two megabytes — eight microseconds of memset a
    // frame to unwrite seven hundred edges — and the invariant that makes the
    // short version right is inductive: after a scatter the only non-zero
    // entries are the ones it just wrote, so clearing exactly those leaves the
    // arrays blank for the next one.
    //
    // ITS OWN RECORD AND NOT `cliff`, even though the two hold the same edges
    // today. `cliff` is a rendering list with two producers — `markCliffs`
    // fills it on the CPU path, by a rule of its own that keeps an edge listed
    // while any air or front is left on it — and what has to be cleared here
    // is what THIS scatter wrote, which is a different question that happens
    // to have the same answer. @see createFallout
    const s2 = into.falls;
    /** How many lips the list actually carried. @see lipCap */
    let lips = 0;
    if (!fallList) {
      put("air", s2.air);
      put("front", s2.front);
      put("head", s2.head);
      put("throwX", s2.throwX);
      put("throwY", s2.throwY);
      // Whole arrays, from a source that keeps no record — so the first
      // scatter after this one has to blank them rather than unpick them.
      swept = false;
      wroteN = 0;
    } else if (lipsFresh) {
    if (swept) {
      for (let n = 0; n < wroteN; n++) {
        const k = wrote[n];
        s2.air[k] = 0; s2.front[k] = 0; s2.head[k] = 0;
        const i = k >> 1;
        s2.throwX[i] = 0; s2.throwY[i] = 0;
      }
    } else {
      // THE FIRST ONE SWEEPS EVERYTHING, because what is in the arrays before
      // it is the CPU solver's and this has no record of where. @see sweepAll
      s2.air.fill(0);
      s2.front.fill(0);
      s2.head.fill(0);
      s2.throwX.fill(0);
      s2.throwY.fill(0);
      swept = true;
    }
    lips = Math.min(r0.cliffN, lipCap, FALL_OUT_MAX);
    const lipAt = state.offset.fallOut;
    /**
     * Rows that landed somewhere, which is not every row read.
     *
     * Counted separately from `n` so a row naming an edge off the end of the
     * map does not leave a hole: `cliff` is read by the renderer up to its own
     * count, and a skipped entry left the PREVIOUS frame's edge sitting at
     * that index to be drawn as this frame's.
     */
    let put2 = 0;
    for (let n = 0; n < lips; n++) {
      const at = lipAt + n * FALL_OUT_STRIDE;
      const k = raw[at] | 0;
      if (k < 0 || k >= s2.air.length) continue;
      // AND THE LIP'S OWN INDEX, into the same list `markCliffs` fills on the
      // CPU path. The renderer walked the whole active box looking for falls —
      // a hundred and twenty thousand edge tests on this map to find seven
      // hundred — and the device has known which they are all along.
      s2.cliff[put2] = k;
      wrote[put2] = k;
      put2++;
      s2.air[k] = raw[at + 1];
      s2.front[k] = raw[at + 2];
      s2.head[k] = raw[at + 3];
      // The throw is the COLUMN's, and two edges of a column can both be lips,
      // so this is written twice with the same number rather than once.
      const i = (k / 2) | 0;
      s2.throwX[i] = raw[at + 4];
      s2.throwY[i] = raw[at + 5];
      // THE WASH AND THE FOAM AT THE LIP, and NOT cleared first the way the
      // five above are. A stale value in a column that is not a lip is read by
      // nothing — `drawFalls` only ever asks about lips — while clearing would
      // leave the host holding a blank pattern for the handover to advect,
      // which is the one thing these are still kept for. @see CARRIED_BACK
      if (carried) { carried.now[i] = raw[at + 6]; carried.foam[i] = raw[at + 7]; }
      // The pour on THIS edge, into whichever flux holds it, and the material.
      // Not cleared either, for the same reason the wash is not: a flux in a
      // column that is not a lip is read by nothing here, and a cleared one
      // would hand the CPU solver a dead field to take over. @see pourOf
      if (k & 1) into.fy[i] = raw[at + 8]; else into.fx[i] = raw[at + 8];
      into.material[i] = raw[at + 9];
    }
    // WHAT THE NEXT SWEEP HAS TO UNDO, and what the renderer may read.
    wroteN = put2;
    lips = put2;
    }
    // WIDE ENOUGH FOR NEXT TIME, from what the DEVICE counted.
    // A FLOOR, but never more rows than the map has edges — on a small map the
    // floor alone asked for more bytes than the five whole arrays it replaced.
    //
    // OUTSIDE THE LIP BRANCH, because `cliffN` is in every reduce and the lip
    // rows are not: with the sheets on they come back once in thirty, and this
    // sat with them. The ceiling then described the map as it was up to thirty
    // readbacks ago, and the `fallout` and `sheet` dispatches are sized from
    // it — so an edit that more than doubled the lip count had its new lips
    // fall outside the dispatch until the next refresh.
    //
    // The 2x and the 1024 floor are why that is hard to reach rather than
    // routine; it is one line to remove the class of it.
    lipCap = Math.min(
      FALL_OUT_MAX,
      Math.max(Math.min(1024, state.cells * 2), r0.cliffN * 2),
    );
    // The box is fresh again, so the padding can go back to its floor.
    stale = 0;
    const r = r0;
    frame.reduce = {
      x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1,
      deepest: r.deepest, breaking: r.breaking, cliffN: r.cliffN,
      clamped: r.clamped, deltaSum: r.deltaSum,
      wet: r.wet, water: r.water,
    };
    into.box.x0 = r.x0; into.box.y0 = r.y0;
    into.box.x1 = r.x1; into.box.y1 = r.y1;
    into.deepest = r.deepest;
    into.breaking = r.breaking;
    // AS MANY AS THE LIST ACTUALLY CARRIED, which is what was just written
    // into `cliff` above — not what the device counted, since the copy may
    // have been capped short of it. @see lipCap
    //
    // LEFT ALONE on a frame whose lip rows did not come down, because the
    // arrays still hold the last set that did and a count of nought would
    // disagree with them. @see lipsNow
    if (!fallList) s2.cliffN = Math.min(r.cliffN, s2.cliff.length);
    else if (lipsFresh) s2.cliffN = lips;

    // AND WHAT IS STILL IN THE AIR GOES BACK ON TOP. Everything numbered above
    // what this readback contains was sent after it was asked for, so the
    // device has it and this copy does not.
    unacked = unacked.filter((b) => b.seq > issued);
    for (const b of unacked) {
      for (let k = 0; k < b.n; k++) {
        const i = b.cell[k];
        // WHEREVER THE SCATTER DID NOT REACH THERE IS NOTHING TO PUT BACK.
        // The host's own write is still standing there — so adding this again
        // would count the pour twice, which on a flat map reads as water
        // appearing out of nowhere wherever somebody clicked while a readback
        // happened to be in the air.
        //
        // TWO SHAPES NOW: a contiguous band of rows, or the scattered set the
        // device was asked for by name. A range test answered the first and
        // cannot answer the second. @see wroteDepth
        if (sparse ? !wroteDepth[i] : (i < from || i >= upto)) continue;
        const next = Math.max(0, into.depth[i] + b.depth[k]);
        if (b.mat[k] && b.depth[k] > 0) into.material[i] = b.mat[k];
        into.depth[i] = next;
        if (next <= 0) into.material[i] = 0;
        // THE FLUX ONLY WHERE ITS BASE WAS REFRESHED, which is not every
        // readback. Depth is overwritten from the device just above, so adding
        // the unacked delta on top of it is right. `fx` and `fy` come down
        // once every CARRY_EVERY readbacks, and on the other twenty-nine the
        // host's own copy is still standing — INCLUDING the kick `splashInto`
        // wrote into it at the very moment it recorded this arrival. Added
        // again there, it is counted twice.
        //
        // Measured on the waterfall fixture over four hundred steps: 359 flux
        // arrivals re-applied, EVERY ONE of them onto a stale base and not one
        // onto a fresh one, 272.9 of flux added that the host already held.
        if (carriedFull) {
          into.fx[i] += b.fx[k];
          into.fy[i] += b.fy[k];
        }
        if (next <= 0) continue;
        const x = i % into.nx, y = (i / into.nx) | 0;
        if (into.box.x1 < into.box.x0) {
          into.box.x0 = x; into.box.x1 = x; into.box.y0 = y; into.box.y1 = y;
        } else {
          if (x < into.box.x0) into.box.x0 = x;
          if (x > into.box.x1) into.box.x1 = x;
          if (y < into.box.y0) into.box.y0 = y;
          if (y > into.box.y1) into.box.y1 = y;
        }
        if (next > into.deepest) into.deepest = next;
      }
    }
    // THE STAMP GOES OUT THE WAY IT CAME IN — by the list, not by a fill. It
    // is one byte a cell over sixty five thousand of them, and clearing it
    // wholesale every frame would cost more than the readback this saves.
    if (sparse) for (let k = 0; k < wantN; k++) wroteDepth[flightWant[k]] = 0;
    // THE SPRAY, drained through the same `dropFrom` and `crown` the CPU path
    // uses — see `drainSpawns`, and the ordering note in it.
    // LEVEL THE SNAPSHOT HERE, where the host's water has just been replaced
    // by the device's, rather than leaving it to the caller. Forgotten, the
    // next delta is the difference between the device's answer and the host's
    // old state — which is the whole frame's physics, sent back up and applied
    // a second time as though the host had poured it.
    const spawned = red[SPAWNED_SLOT];
    // WIDE ENOUGH FOR NEXT TIME. @see spawnCap
    spawnCap = Math.min(SPAWN_MAX, Math.max(256, spawned * 2));
    frame.drops = 0;
    if (spawned > 0) {
      const at = state.offset.spawn;
      // ONLY AS FAR AS THE COPY REACHED. `drainSpawns` bounds itself by the
      // buffer it is handed, so a head is a head and not an invitation to read
      // whatever is past it.
      const head = Math.min(spawnCap, SPAWN_MAX) * SPAWN_STRIDE;
      const made = drainSpawns(
        into, raw.subarray(at, at + head), spawned,
      );
      frame.drops = made.made;
    }
  };

  const readback = async () => {
    const slot = staging[turn];
    turn = 1 - turn;
    if (slot.busy) { inFlight--; return; }    // nothing to wait on after all
    slot.busy = true;
    const enc = device.createCommandEncoder({ label: "readback" });
    // ONLY THE RUNS THE HOST READS, at their own offsets so that everything
    // downstream can keep indexing the staging copy exactly as it indexes the
    // field. The gaps are left as whatever the buffer was last time and are
    // never looked at. @see READ_BACK
    // THE CARRIED FIELDS, ONCE IN A WHILE. Nothing reads them every frame any
    // more; what they are for is the handover back to the CPU solver, which
    // starts advecting the host's copy from wherever it happens to be.
    // @see CARRIED_BACK
    const carryNow = fallList && carryDue <= 0;
    carryDue = carryNow ? CARRY_EVERY : carryDue - 1;
    // THE ROWS THE DEVICE COULD HAVE TOUCHED, and no others. Remembered until
    // the scatter, because what it covers decides what the arrivals still in
    // flight may be applied to. @see depthBand
    const reg = frame.region as
      { x0: number; y0: number; x1: number; y1: number } | null;
    const band = depthBand && reg
      ? { y0: Math.max(0, reg.y0), y1: Math.min(state.ny - 1, reg.y1) }
      : { y0: 0, y1: state.ny - 1 };
    const spawnRun = {
      at: state.offset.spawn,
      len: Math.min(spawnCap, SPAWN_MAX) * SPAWN_STRIDE,
    };
    // THE DEPTH, WHOLE OR BY NAME.
    //
    // The band was 97% of this readback, and on a flooded map it is the whole
    // map because the active box is. What reads it is the drops, the pipe
    // mouths and the cursor — about two hundred and ninety cells — so they say
    // which, and the device answers those. @see createWant
    //
    // THE BAND STILL COMES BACK on the carry frames, which is what keeps the
    // save and the handover to the CPU solver seeing a field that is stale
    // rather than one that is frozen. Same clock as the wash and the foam, and
    // deliberately the same: they are the same kind of promise.
    flightWant.set(lastWant.subarray(0, lastWantN));
    flightWantN = lastWantN;
    const sparse = fallList && !carryNow && flightWantN > 0;
    const depthRun = sparse
      ? { at: state.offset.wantOut, len: flightWantN }
      : {
        at: state.offset.depth + band.y0 * state.nx,
        len: (band.y1 - band.y0 + 1) * state.nx,
      };
    // THE LIPS, AND WHETHER ANYONE IS STILL READING THEM.
    //
    // The row exists to feed `drawFalls`: the air, the front, the head, the
    // throw, the wash and foam at the lip, the flux and the material. With the
    // sheets built on the device nothing on this path reads any of it — the
    // CPU foam is the only other reader and it does not run while the device
    // is advecting — so the row becomes what the wash and the foam already
    // are: a SLOW REFRESH kept for the handover back to the CPU solver, which
    // starts from whatever these hold. 58.6KB a frame to 2KB.
    //
    // Asked of the pass rather than set by a flag, the way `matFed` is: if the
    // sheets are not being built here, somebody is still building them from
    // this and it comes back every frame as before.
    const lipsNow = !sheet || carryNow;
    const lipRun = {
      // As many rows as the last count says there could be, rather than as
      // seven maps. @see lipCap
      at: state.offset.fallOut,
      len: Math.min(lipCap, FALL_OUT_MAX) * FALL_OUT_STRIDE,
    };
    const asked = fallList
      ? [...everyFrame, spawnRun, depthRun,
        ...(lipsNow ? [lipRun] : []),
        ...(carryNow ? carriedRuns : [])]
      : [...everyFrame, spawnRun, depthRun, ...wholeRuns];
    // PACKED, NOT AT THEIR OWN OFFSETS. `off` is where each run lands in the
    // staging buffer; the host unpacks by it below. @see stagingFloats
    let off = 0;
    const packed: { at: number; len: number; off: number }[] = [];
    for (const r of asked) {
      enc.copyBufferToBuffer(state.field, r.at * 4, slot.field, off * 4, r.len * 4);
      packed.push({ at: r.at, len: r.len, off });
      off += r.len;
    }
    frame.readMb = (off * 4) / 1048576;
    enc.copyBufferToBuffer(state.reduce, 0, slot.reduce, 0, REDUCE_SLOTS * 4);
    // AND HOW MANY QUADS EACH BAND'S SHEET HOLDS, which is half a kilobyte and
    // has its own little mapping rather than a place in the field's runs — the
    // runs are slices of ONE buffer and this is a different one. @see SheetPass
    sheet?.copy(enc);
    device.queue.submit([enc.finish()]);
    // AND ASKED FOR ONLY NOW. @see SheetPass.fetch
    sheet?.fetch();
    const t0 = performance.now();
    try {
      // A MAPPING IN FLIGHT WHEN THE SOLVER IS TORN DOWN rejects rather than
      // resolving — the switch going off, or the map being replaced, destroys
      // the buffer underneath it. That is expected and is not an error worth
      // reaching the console, but it has to be CAUGHT: unhandled, it surfaces
      // as an AbortError from a React effect cleanup and looks like a fault in
      // whatever else happened to be going on.
      await slot.field.mapAsync(GPUMapMode.READ);
      await slot.reduce.mapAsync(GPUMapMode.READ);
      if (dead) return;
      // A VIEW PER RUN, copied into the scratch at its own offset, so that
      // everything downstream can go on indexing by the field's offset exactly
      // as it did when this was a copy of the whole buffer. @see rawSeen
      const mapped = slot.field.getMappedRange();
      // OUT OF WHERE IT LANDED and into where it belongs — the runs are packed
      // in the staging buffer and `rawSeen` is laid out like the field, so
      // everything downstream goes on indexing it by the field's own offsets.
      for (const r of packed) {
        rawSeen.set(new Float32Array(mapped, r.off * 4, r.len), r.at);
      }
      redSeen.set(new Int32Array(slot.reduce.getMappedRange()));
      pending = {
        raw: rawSeen,
        red: redSeen,
        // Whether the depth in it is the named cells or the whole band, and
        // how many were named. @see createWant
        sparse,
        wantN: flightWantN,
        // Whether the carried fields are in it, since most of the time they
        // are not and what is at their offsets is the last time they were.
        carriedFull: carryNow || !fallList,
        // Whether the lip rows in this readback are THIS frame's. @see lipsNow
        lipsFresh: lipsNow,
        band,
      };
      readMs = performance.now() - t0;
    } catch {
      // Destroyed mid-flight. Nothing to scatter and nothing to say.
    } finally {
      if (!dead) {
        try { slot.field.unmap(); slot.reduce.unmap(); } catch { /* raced a destroy */ }
      }
      slot.busy = false;
      inFlight--;
    }
  };

  /**
   * FRAMES STILL TO BE CHECKED FOR VALIDATION ERRORS.
   *
   * A compute pass whose bind group does not match its layout does not throw
   * and does not draw wrong: the encoder is poisoned, `finish` hands back an
   * invalid command buffer, and the WHOLE FRAME is dropped on the floor. The
   * water then sits exactly where the last upload left it, which looks like a
   * settled map rather than like a bug — and every measurement taken of it is
   * a measurement of nothing happening. That is not a hypothetical: the
   * single-command-buffer change missed the two carried passes, which live in
   * the renderer rather than beside the others, and the solver ran for a whole
   * session doing nothing at all.
   *
   * So the first few frames of every solver are watched. A few, and not all of
   * them, because what this catches is a pass that is wired wrong, and a pass
   * that is wired wrong is wired wrong on the first frame.
   */
  let watch = 4;

  /** Everything a frame does up to the submit. @see step */
  const encodeFrame = (field: ColumnField, dt: number): boolean => {
    const plan = substepsFor(field, dt);
    // What the frame as a whole advanced by, which is what the fields carried
    // once a frame step on — not any one substep's slice of it.
    const whole = plan.reduce((a, b) => a + b, 0);
    frame.substeps = plan.length;
    frame.readMs = readMs;
    frame.inFlight = inFlight;
    if (!plan.length) return false;

    // ONLY WHAT THE HOST CAN HAVE CHANGED — the water, and the ground under
    // it. The first frame sends everything, because the device has nothing;
    // after that the fall state, the breaking state and the passes' scratch
    // are the device's, and sending the host's copy back would overwrite its
    // own work with a readback a frame old. @see HOST_WRITES
    const up0 = performance.now();
    const first = !primed;
    if (first) {
      upload(state, field);
      if (carried) {
        // The still pattern never changes, and the advected one starts as a
        // copy of it — see `createFlowWash`. Both go up once and stay.
        device.queue.writeBuffer(
          state.field, state.offset.washSeed * 4, carried.seed,
        );
        device.queue.writeBuffer(
          state.field, state.offset.washNow * 4, carried.now,
        );
        device.queue.writeBuffer(
          state.field, state.offset.foamNow * 4, carried.foam,
        );
      }
      primed = true;
    }
    // WHAT THE HOST HAS ADDED SINCE THE LAST FRAME, as a list. Kept as a
    // numbered batch until a readback comes back that contains it — see
    // `unacked` — and then forgotten.
    const a = field.arrivals;
    let arriveN = 0;
    if (a && a.n > 0) {
      arriveN = uploadArrivals(state, field, a, scratch);
      // KEYED BY THE ENTRY AND NOT BY THE CELL. `Arrivals` is a sparse set of
      // whole-map arrays with a list of which cells were touched, and this
      // copied four of those arrays WHOLE — eight hundred and thirty
      // kilobytes every frame anybody poured, to carry a few dozen numbers,
      // while the cell list beside it was already sliced. Re-keyed to the
      // list, a batch is as big as the pour.
      const n = a.n;
      const cell = a.cell.slice(0, n);
      const depth = new Float32Array(n);
      const fx = new Float32Array(n);
      const fy = new Float32Array(n);
      const mat = new Uint8Array(n);
      for (let k = 0; k < n; k++) {
        const i = cell[k];
        depth[k] = a.depth[i];
        fx[k] = a.fx[i];
        fy[k] = a.fy[i];
        mat[k] = a.mat[i];
      }
      unacked.push({ seq: seq++, cell, n, depth, fx, fy, mat });
      clearArrivals(a);
    }
    // THE GROUND AND THE SPLASH MARKS, which the device never writes, so
    // sending them whole cannot rewind anything the way sending the water did.
    // The ground is the editor's alone; the splash is where a drop landed, and
    // the drip list is still the host's.
    //
    // AND ONLY WHEN THEY HAVE SOMETHING TO SAY. Both went up every frame — a
    // quarter of a megabyte each — to repeat what they said last frame. The
    // ground changes when somebody edits the terrain and says so; the splash
    // marks say whether any of them is still alive.
    if (!first) {
      if (field.groundRev !== sentGround) {
        sentGround = field.groundRev;
        device.queue.writeBuffer(
          state.field, state.offset.ground * 4, field.ground,
        );
      }
      // ONE FRAME PAST THE LAST MARK. `splashed` goes false on the frame the
      // last one fades out, and the device is still holding whatever was sent
      // before that — so the falling edge has to go up too, or a drop's white
      // stays on the map for ever.
      const live = field.drips.splashed;
      if (live || sentSplash) {
        device.queue.writeBuffer(
          state.field, state.offset.splashIn * 4, field.drips.splash,
        );
      }
      sentSplash = live;
    }
    // THE QUESTIONS, AND THE DROPS ADD THEIRS LAST. Everything else that reads
    // the host's depth registered during this frame — the pipe mouths, the
    // cursor — and the drops are added here because `stepAir` has just moved
    // them and where they are NOW is where they will be read. @see wantDepth
    const want = field.wanted;
    let wantN = 0;
    if (want) {
      const d = field.drips;
      // EVERY CELL A DROP MIGHT READ, which is not the cell it is in.
      //
      // `stepDrips` reads the surface at `Math.round(cx), Math.round(cy)` —
      // and a drop sitting at 10.49 reads cell 10 this frame and cell 11 the
      // next, on a drift of a hundredth. So the cell it occupies is not enough
      // and neither is predicting where its velocity takes it: measured on the
      // spray scene, asking about the drop's own cell took the worst cell from
      // 0.071 to 0.103, and adding one and four frames of travel only brought
      // it to 0.100. The FIVE-CELL cross — the drop and its four neighbours —
      // brings it to 0.07078, which is the band's own number to five digits.
      //
      // DEDUPED, because a waterfall's spray is a cluster and its drops share
      // cells. Through the same stamp the scatter uses, which is free: it is
      // already allocated and already cleared by list rather than by fill.
      const asked = wroteDepth;
      const one = (cx: number, cy: number) => {
        const x = Math.round(cx), y = Math.round(cy);
        if (x < 0 || y < 0 || x >= field.nx || y >= field.ny) return;
        const i = y * field.nx + x;
        if (asked[i]) return;
        asked[i] = 1;
        wantDepth(field, i);
      };
      // The mouths and the cursor registered earlier in the frame and are
      // already in the list; stamp them so a drop over one does not repeat it.
      for (let k = 0; k < want.n; k++) asked[want.at[k]] = 1;
      for (let k = 0; k < d.live; k++) {
        one(d.cx[k], d.cy[k]);
        one(d.cx[k] + 1, d.cy[k]);
        one(d.cx[k] - 1, d.cy[k]);
        one(d.cx[k], d.cy[k] + 1);
        one(d.cx[k], d.cy[k] - 1);
      }
      wantN = want.n;
      if (wantN > 0) {
        device.queue.writeBuffer(
          state.field, state.offset.wantAt * 4,
          // AS FLOATS, because the state buffer is one. A cell index is exact
          // in an f32 up to sixteen million, and a map is sixty five thousand.
          Float32Array.from(want.at.subarray(0, wantN)),
        );
      }
      lastWant.set(want.at.subarray(0, wantN));
      lastWantN = wantN;
      // THE STAMP OUT BY THE LIST, as everywhere else it is used.
      for (let k = 0; k < wantN; k++) asked[want.at[k]] = 0;
      // EMPTIED HERE, so the next frame's readers start from nothing and this
      // frame's readback answers exactly what this frame asked.
      want.n = 0;
    }
    device.queue.writeBuffer(state.reduce, 0, reduceSeed(field.nx, field.ny));
    frame.uploadMs = performance.now() - up0;
    const enc0 = up0;

    const p = field.params;
    // THE CLIFF INDEX ONCE A FRAME, exactly as the CPU does it: the ground
    // cannot change during a frame, so once at the top is always current.
    // ONE COMMAND BUFFER FOR THE WHOLE FRAME. It used to be one per substep,
    // because the constants were a single block that had to be rewritten
    // between them, so each substep had to be submitted before the next could
    // overwrite it — a frame with four substeps cost seven submits and the
    // driver overhead of every one. Each substep has its own slice now, so the
    // lot goes in together. @see CONSTS_STRIDE
    let slot = 0;
    const enc = device.createCommandEncoder({ label: "water frame" });
    state.constsAt = 0;
    // WHAT THE HOST POURED, first, so the cliff index and everything after it
    // sees water that arrived this frame rather than next.
    passes.arrive.encode(enc, state, arriveN);
    passes.cliffs.encode(enc, state);

    for (const h of plan) {
      field.t += h;
      stirWind(field);
      // INTO THIS SUBSTEP'S OWN SLICE. The whole frame is one command buffer
      // now, and `writeBuffer` takes effect where it is CALLED in the queue —
      // so every one of these landed before the first dispatch ran, and
      // without the ring every substep read the last one's weather and the
      // last one's drag. @see createGpuState
      const wat = (slot % CONSTS_SLOTS) * field.windX.length;
      device.queue.writeBuffer(
        state.field, (state.offset.windX + wat) * 4, field.windX,
      );
      device.queue.writeBuffer(
        state.field, (state.offset.windY + wat) * 4, field.windY,
      );
      for (let m = 0; m < MATERIAL_SLOTS; m++) {
        field.keepOf[m] = field.dragOf[m] > 0
          ? Math.pow(field.dragOf[m], h) : Math.pow(p.drag, h);
      }
      device.queue.writeBuffer(
        state.field,
        (state.offset.keepOf + (slot % CONSTS_SLOTS) * MATERIAL_SLOTS) * 4,
        field.keepOf,
      );

      // THE BOX, WIDENED BY A WHOLE FRAME'S REACH — and this is not caution,
      // it is the difference between the two solvers agreeing and not.
      //
      // `activeBox` pads the wet region by exactly one column, which is
      // exactly one substep of spreading: a flux crosses one edge, so water
      // can reach one column further and no more. That is the right pad for
      // the CPU, which recomputes the box from the water every substep. It is
      // the wrong one here, because the box the host holds came off a
      // readback and is a frame behind — and the failure is not a small
      // error, it is a RATCHET. The front is clipped one short, so no water
      // arrives in the column beyond, so the box never grows to include it,
      // so it is clipped again. Measured, the device's box came out one
      // narrower on the very first frame and stayed one narrower; by frame
      // thirty the lagging front was a whole column of water out — 7.8 of a
      // scale of 9.2 — and the map was quietly a fiftieth of a percent light.
      //
      // So: one column per substep still to run, plus the frames the readback
      // is behind. Wider costs a few more threads on a dispatch that is
      // already tiny; narrower loses water.
      // ONE COLUMN PER SUBSTEP is as fast as water can travel — a flux crosses
      // one edge — so a box `stale` frames old needs that many frames' worth
      // of substeps of padding on top of this frame's own, and one more for
      // the pad `activeBox` would have given it.
      // A FRAME OF HEADROOM ON TOP of the arithmetic, because the arithmetic
      // is a floor and the cost of being wrong is asymmetric: too wide is a
      // few thousand threads that return immediately, too narrow is water
      // deleted at the edge of the region and never seen again.
      const reach = plan.length * (stale + 2) + LATENCY * 2;
      const b = field.box;
      const region = wholeMap || b.x1 < b.x0
        ? { x0: 0, y0: 0, x1: field.nx - 1, y1: field.ny - 1 }
        : {
          x0: Math.max(0, b.x0 - reach),
          y0: Math.max(0, b.y0 - reach),
          x1: Math.min(field.nx - 1, b.x1 + reach),
          y1: Math.min(field.ny - 1, b.y1 + reach),
        };
      const consts: PassConsts = {
        x0: region.x0, y0: region.y0, x1: region.x1, y1: region.y1,
        gain: p.gravity * h / field.cell,
        bedGain: p.bedDrag * h,
        hMax: (field.cell / p.maxDt) ** 2 / (2 * p.gravity),
        minHead: p.minSlope * field.cell,
        spread: h / field.cell,
        diffScale: h / (field.cell * field.cell),
        dt: h,
      };
      writeConsts(state, {
        ...consts, windDepth: 2.5, dryDepth: p.dryDepth, fallMin: FALL_MIN,
        openEdge: field.openEdge,
        gravity: p.gravity, breaking: p.breaking,
        room: dripRoom(field.drips), cell: field.cell, frameDt: whole,
        arriveN, wantN,
        // The device counts its own cliff edges; this is only the ceiling the
        // falls dispatch is sized from — the worst case, two per cell, and
        // deliberately so. @see cliffCount, and the note on FallsPass.encode
        // for why a tighter bound was measured and rejected.
        cliffN: field.nx * field.ny * 2,
      }, field.wnx, field.wstride, slot);
      state.constsAt = (slot % CONSTS_SLOTS) * CONSTS_STRIDE;
      slot++;

      frame.region = { ...region, reach };
      const sub = enc;
      // THE BANK IS CLEARED AT THE TOP, not the bottom, and the difference
      // matters to the foam: cleared after the landings, the splash a plunge
      // banked is gone before anything can paint with it. Cleared here, the
      // last substep's marks survive to the carried passes, and every substep
      // still starts owing nothing.
      sub.clearBuffer(state.acc);
      if (field.openEdge && on("spill")) passes.spill.encode(sub, state);
      // What was breaking at the end of the last step dissipates at the start
      // of this one, on the viscosity that step worked out.
      if (field.breaking && p.breaking > 0 && on("diffuse")) {
        passes.diffuse.encode(sub, state, region);
      }
      if (on("accelerate")) passes.accelerate.encode(sub, state, region);
      if (on("limit")) passes.limit.encode(sub, state, region);
      if (on("divergence")) passes.divergence.encode(sub, state, region);
      if (on("apply")) passes.apply.encode(sub, state, region);
      if (on("falls")) passes.falls.encode(sub, state, field.nx * field.ny * 2);
      if (on("landings")) passes.landings.encode(sub, state);
    }
    // THE CARRIED FIELDS, once, after the water has finished moving — they
    // are advected on the flow this frame ended with, exactly as the host did
    // it at the top of `drawGpuWater`.
    if (carried) {
      const enc2 = enc;
      passes.wash.encode(enc2, state);
      // The foam AFTER the wash and before the bank is cleared: it reads the
      // splash the last substep's plunges banked. @see foam-gpu
      passes.foam.encode(enc2, state);
      enc2.clearBuffer(state.acc);
    }
    // AND THE LIPS, WRITTEN OUT AS A LIST — last of all, because the row
    // carries the wash and the foam and both of those are advected by the two
    // passes just above. Written before them it was a frame behind, which
    // measured as 240 lips out by a hundredth on a scale of one: small, and
    // wrong, and exactly the kind of thing that is never found later.
    // OVER THE SAME CAP THE READBACK ASKS FOR, not over the host's count of
    // lips — that count came off a readback and is a frame or more behind, so
    // a terrain edit that adds lips would leave the new ones unwritten and the
    // first frames of a map, where it is still nought, would write none at
    // all. The shader cuts the dispatch to the device's OWN count. @see lipCap
    if (on("fallout")) passes.fallout.encode(enc, state, lipCap);
    // AND THE SHEETS, off the lip list the pass above has just refreshed and
    // the fronts the falls pass moved. Before `copyOut` only because that is
    // last; nothing it writes is read here. @see createSheet
    if (sheet && on("sheet") && sheetAt) {
      sheet.encode(enc, state, lipCap);
      sheet.spill(enc, sheetAt.verts());
    }
    // AND THE DEPTHS THE HOST ASKED FOR, off the water this frame ended with.
    // After every substep for the same reason the readout below is: an answer
    // taken mid-frame is an answer to a question about a different frame.
    // @see createWant
    passes.want.encode(enc, state, wantN);
    // AND THE READOUT'S TWO NUMBERS, counted on the depths the frame ended
    // with rather than walked out of a copy of them. @see createMeta
    passes.meta.encode(enc, state);
    // AND THE MATERIALS, PACKED INTO THE BYTES ITS TEXTURE WANTS.
    // @see createMatpack
    passes.matpack.encode(enc, state);
    // AND THE SURFACE'S TEXTURES, FILLED FROM HERE rather than from the host's
    // copy of the same numbers. Last, so every pass that writes them has run.
    // @see copyOut
    copyOut(enc, state, into);
    if (watch > 0) {
      watch--;
      device.pushErrorScope("validation");
      device.queue.submit([enc.finish()]);
      void device.popErrorScope().then((e) => {
        if (e) console.error("WATER: the frame did not validate —", e.message);
      });
    } else device.queue.submit([enc.finish()]);
    stale++;
    frame.encodeMs = performance.now() - enc0 - frame.uploadMs;
    return true;
  };

  return {
    sheetTo: (to) => {
      sheet?.destroy();
      sheet = null;
      sheetAt = to;
      if (!to) return;
      sheet = createSheet(device, to.bands, to.cap);
      sheet.bind(to.tint);
      sheet.say(
        to.proj[0], to.proj[1], to.proj[2], to.proj[3],
        to.bands, to.cap, to.cpt, to.tilesHigh,
      );
    },
    sheetCounts: () => sheet?.says() ?? null,
    sheetQuads: () => sheet?.quads ?? null,
    sheetScale: (scale) => {
      if (!sheet || !sheetAt || scale === sheetAt.proj[3]) return;
      sheetAt = { ...sheetAt, proj: [sheetAt.proj[0], sheetAt.proj[1], sheetAt.proj[2], scale] };
      sheet.say(
        sheetAt.proj[0], sheetAt.proj[1], sheetAt.proj[2], scale,
        sheetAt.bands, sheetAt.cap, sheetAt.cpt, sheetAt.tilesHigh,
      );
    },
    last: () => frame,
    stamp: (label) => (dead ? undefined : state.stamps?.take(label)),
    destroy: () => {
      dead = true;
      // NOT destroyed: the set is the device's and the renderer goes on being
      // timed by it. @see holdStamps
      state.stamps = null;
      f.arrivals = null;
      f.wanted = null;
      // THE SHEETS TOO, which nothing else will ever do: `sheetTo(null)` is the
      // only other door and it has never had a caller. The pass holds four
      // buffers of its own, so every scene rebuild left a set behind — and a
      // scene rebuilds on every resize and every map load.
      //
      // BEFORE the fall layer, which the scene's cleanup destroys next: the
      // pass copies into that layer's vertex buffers, so it has to stop first.
      sheet?.destroy();
      sheet = null;
      sheetAt = null;
      for (const s of staging) { s.field.destroy(); s.reduce.destroy(); }
      state.destroy();
    },
    sync: (field) => {
      const t0 = performance.now();
      bringDown(field);
      frame.scatterMs = performance.now() - t0;
    },

    step: (field, dt) => {
      const t0 = performance.now();
      // A caller that did not `sync` still gets its readback, a frame late
      // rather than never — but it gets it AFTER its own pours, which is the
      // bug `sync` exists to prevent. The live path calls both.
      bringDown(field);
      // EVERY TICK, AND NOTHING WAITS ON THE READBACK.
      //
      // It used to wait, and had to: the host sent its own copy of the water
      // up, and a copy is only current just after a readback lands. Now the
      // device OWNS the water and the host sends only what it has added, so
      // there is nothing to be in step with — a readback is a snapshot for the
      // renderer and for the drips, and the simulation does not depend on it
      // at all.
      //
      // That is the whole of the lag. A readback costs three to five frames of
      // latency whatever its size, and on a busy pour the queue behind it was
      // pushing the wait past a tenth of a second; with the simulation gated on
      // it, that was a tenth of a second of frame. Off the critical path it
      // costs nothing but the water on screen being a few frames old.
      //
      // One is still asked for at a time, so the queue behind it cannot grow.
      // A TICK THAT CANNOT SUBMIT STILL OWES ITS TIME. Dropped instead, the
      // water simply runs slow: measured on a 256 square map it advanced at
      // 0.69 of real time, which does not read as a dropped frame — it reads
      // as syrup, and it was the most obvious thing wrong with the switch.
      // Carried over, the next frame that does submit asks for the whole
      // arrears and `substepsFor` cuts it into as many substeps as it needs,
      // with the same MAX_SUBSTEPS ceiling the CPU has.
      //
      // AND BOUNDED AT ONE FRAME'S WORTH, because arrears that can grow
      // without limit are not arrears, they are a debt nobody can pay:
      // `encodeFrame` will never integrate more than `maxStep` however much is
      // owed, so anything past that was going to be dropped by `substepsFor`
      // anyway — silently, and after being counted as paid. Bounded here, the
      // simulation runs slow under sustained load, which is what MAX_SUBSTEPS
      // is for, and a stall of a frame or two still catches up exactly.
      owed = Math.min(owed + dt, maxStep(field));
      // THE DROPS FALL ON THE HOST, and they fall HERE — before the frame is
      // encoded, so what they land goes up with this frame's arrivals.
      //
      // The CPU solver steps them at the end of every SUBSTEP and this steps
      // them once for the whole frame, which is a different trajectory and a
      // different landing time. I tried matching it and it is not a one-line
      // change: a landing made inside the substep loop is written into the
      // host's depths AFTER this frame's delta has been taken, so the next
      // readback overwrites it and that water is simply gone — measured, it
      // leaked 0.2% of the map in two seconds. Matching properly wants the
      // drip list itself on the device, which is later work. Until then the
      // two solvers agree exactly while nothing is in the air, and part
      // company once something is. @see compareFrames
      stepAir(field, dt);
      if (encodeFrame(field, owed)) {
        frame.cliffN = field.falls.cliffN;
        frame.owed = owed;
        owed = 0;
        // ISSUED HERE, and stamped with the last batch it will contain: the
        // frame's arrivals have been uploaded and submitted above, so this
        // readback shows a device that has them. Anything sent after is not in
        // it and is re-applied when it lands. @see unacked
        if (readbackOn && inFlight === 0) {
          inFlight++; issued = seq - 1; void readback();
        }
      }
      frame.hostMs = performance.now() - t0;
    },

    stepAwaited: async (field, dt) => {
      // No arrears here: it waits for every frame, so none is ever skipped.
      const t0 = performance.now();
      if (pending) {
        scatter(
          pending.raw, pending.red, field, pending.carriedFull,
          pending.lipsFresh, pending.band, pending.sparse, pending.wantN,
        );
        pending = null;
      }
      stepAir(field, dt);
      if (encodeFrame(field, dt)) {
        inFlight++;
        issued = seq - 1;
        await readback();
        // Narrowed by hand: TypeScript cannot see that `readback` assigns it.
        const got = pending as {
          raw: Float32Array; red: Int32Array; carriedFull: boolean;
          lipsFresh: boolean; band: Band; sparse: boolean; wantN: number;
        } | null;
        if (got) {
          scatter(
            got.raw, got.red, field, got.carriedFull, got.lipsFresh, got.band,
            got.sparse, got.wantN,
          );
          pending = null;
        }
        frame.cliffN = field.falls.cliffN;
      }
      frame.hostMs = performance.now() - t0;
    },
  };
}

/**
 * THE READBACK, SWITCHED OFF — for measuring what it costs, and for nothing
 * else.
 *
 * Three and a half megabytes come down every frame and the only honest way to
 * know what that is worth is to stop doing it and look. With it off the device
 * goes on solving and goes on filling the surface's textures, so the water
 * still moves on screen; what freezes is everything that reads the host's copy
 * — the falls, the drips, the wet count — which is exactly the list of what
 * would have to move to the device before this could be off for real.
 *
 * Module-level and not per solver, because a measurement wants to survive the
 * solver being rebuilt underneath it.
 */
let readbackOn = true;
export const setReadback = (on: boolean) => { readbackOn = on; };

/**
 * THE DISPATCH REGION, FORCED TO THE WHOLE MAP — for accusing it, and for
 * nothing else.
 *
 * Every pass is bounded by the active box plus a reach, and a box that is one
 * column short does not draw a smaller puddle: the water that crossed the edge
 * is applied nowhere and is simply gone. That failure is indistinguishable
 * from arithmetic losing it, which is why it wants a switch rather than an
 * argument. With this on the region is the map and nothing can be clipped, so
 * a leak that survives is a leak in a pass.
 */
let wholeMap = false;
export const setWholeMap = (on: boolean) => { wholeMap = on; };

/**
 * PASSES TO LEAVE OUT, for bisecting a fault by removing half of it.
 *
 * Every pass agrees with its CPU twin when they are compared one at a time
 * from the same state, and the solver still loses water over a run — which
 * means the fault is in something a single-pass comparison cannot see, and the
 * way to find it is to take passes away until it stops. The water is wrong
 * with any of these off, obviously; what is being asked is not whether it is
 * right but whether it is still LEAKING.
 */
let skipped = new Set<string>();
export const setSkip = (names: string[]) => { skipped = new Set(names); };
const on = (name: string) => !skipped.has(name);

/**
 * THE LIPS AS FIVE WHOLE ARRAYS AGAIN, which is what the list replaced.
 *
 * Two megabytes a frame to feed five hundred quads, and the list is a few tens
 * of kilobytes — but "the list carries everything the arrays did" is a CLAIM,
 * and the way to hold a claim like that to account is to be able to run it
 * both ways on the same deterministic bench and diff the arrays. Off, this is
 * the old transfer, exactly. @see createFallout
 */
let fallList = true;
export const setFallList = (list: boolean) => { fallList = list; };

/**
 * DEPTH BY THE BAND, which is the last thing on the wire.
 *
 * Depth is not a rendering field — it is the water, and four host systems read
 * it at cells nobody can predict: the pipes' own physics at their mouths, the
 * tile readouts under the cursor, the wet count and the volume, and the CPU
 * solver the moment somebody switches back to it. There is no list that serves
 * all four.
 *
 * But the device only CHANGES depth inside the region it dispatched over, so
 * every row outside that region is already right in the host's copy and
 * copying it again says nothing. Sending the region's rows instead is exactly
 * as correct and costs what the WATER costs rather than what the map does — on
 * a map with a pond in the corner that is a few per cent of it, and on a
 * flooded one it is all of it, which is the honest answer in both cases.
 */
let depthBand = true;
export const setDepthBand = (band: boolean) => { depthBand = band; };

/** Every field the solver keeps, for anything that wants to size a buffer. */
export const fieldNames = FIELDS;

/** Hoisted so a caller can seed the counter the falls dispatch reads. */
export const cliffSlot = CLIFFN_SLOT;
