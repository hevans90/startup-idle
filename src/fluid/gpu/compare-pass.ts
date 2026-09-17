/**
 * One pass on the device against the same pass on the CPU, from one state.
 *
 * NARROWER THAN `fluid/compare` ON PURPOSE. That one steps two whole solvers
 * and is the right instrument once there are two whole solvers; this one gives
 * both sides bit-identical input, runs a SINGLE pass, and diffs what comes
 * out. A disagreement here has exactly one candidate, which is the whole
 * reason to port a pass at a time.
 *
 * It also removes chaos from the question entirely. `fluid/compare` has to
 * reason about a horizon because divergence compounds over frames; one pass
 * run once from one state cannot compound anything, so any difference at all
 * is either rounding — which is bounded and tiny and can be stated — or a bug.
 *
 * `bun test` cannot run WGSL, so this is a browser instrument. It is exposed
 * as `window.__accelCompare()` and reports numbers rather than drawing
 * anything.
 */
import {
  FLOW_DEFAULTS, MATERIAL_SLOTS, accelerate, activeBox, addWater,
  applyDepths, applyLandings, createColumnField, diffuseBreaking, divergence,
  limit,
  stepFlow, type ColumnField, type PassConsts,
} from "../columns";
import { markCliffs, stepFalls } from "../falls";
import { FALL_MIN } from "../falls";
import { dripRoom } from "../drips";
import { createAccelerate } from "./accelerate";
import { createApply, readReduce, reduceSeed } from "./apply";
import { createDiffuse } from "./diffuse";
import { ACC, LAND_SCALE, createFalls, drainSpawns } from "./falls";
import { createLandings } from "./landings";
import { createCliffs } from "./cliffs";
import { createDivergence } from "./divergence";
import { createLimit } from "./limit";
import {
  CLIFFN_SLOT, REDUCE_SLOTS, SPAWNED_SLOT, createGpuState, readField, readRaw,
  upload, writeConsts,
  type GpuState,
} from "./state";
import type { Box } from "./accelerate";

/**
 * The passes, in order, each as its pair of twins.
 *
 * A CHAIN rather than one pass, because a pass that is right on its own and
 * wrong after the one before it is a real thing: the second reads what the
 * first wrote, and "the same arithmetic" is not the same claim as "the same
 * arithmetic on the same input". Comparing `accelerate` alone and then
 * `accelerate, limit` costs one more run and tests composition for free.
 */
const PASSES = [
  "diffuse", "accelerate", "limit", "divergence", "apply", "falls", "landings",
] as const;
export type PassName = (typeof PASSES)[number];

/**
 * The scene every pass is compared on, built from a recipe rather than taken
 * from the live world.
 *
 * From a RECIPE because the comparison has to be the same twice: whatever
 * someone has been pouring into the map is not a fixture, and a harness whose
 * answer depends on it cannot be trusted when it says yes.
 *
 * Chosen to exercise what the pass actually branches on — a lumpy bed so the
 * sill reconstruction matters, cliffs so some edges are dry on one side, a dry
 * margin so the carry gate fires, and the wind ON so the coarse wind grid is
 * being indexed. A flat full rectangle would pass with half the shader
 * missing.
 *
 * TWO CLIFFS, FACING EAST AND SOUTH, and that is not decoration. With only an
 * east-facing one, deleting the divergence's check on whether an ARRIVING
 * southward move had been diverted into the air changed nothing and the
 * comparison still came back clean — the branch was never taken. That is the
 * same gap `divergence.test.ts` had, found the same way, which is twice now:
 * anything with a per-axis branch needs terrain on both axes or half of it is
 * decoration.
 */
export function scene(wind = FLOW_DEFAULTS.wind): ColumnField {
  const f = createColumnField(96, 64, { ...FLOW_DEFAULTS, wind }, 0.5);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 96; x++) {
      // THE DROP HAS TO STAY UNDER `BREAK`, which is eight, or the sheet
      // sprays — and the device has no drips, so a spraying fall makes the two
      // disagree for a reason that is not a fault. The lumpy bed runs to +3,
      // so a floor at -2 gives a drop of at most five. Set at -6 it reached
      // nine, sprayed, and the comparison reported 110 edges of difference.
      f.ground[y * 96 + x] = x > 70 || y > 50 ? -2 : ((x * 7 + y * 5) % 7) - 3;
    }
  }
  for (let y = 6; y < 58; y++) {
    for (let x = 6; x < 66; x++) addWater(f, x, y, 6, 1);
  }
  return f;
}

/**
 * A COLLAPSING POUR, which is the scene the other two never are.
 *
 * `scene` is a settled sheet over a lumpy bed and it is the right scene for
 * the sill reconstruction, the carry gate and the wind — but nothing in it
 * ever asks a cell to send out more water than it holds, so THE LIMITER NEVER
 * FIRES. Every pass came back clean on it while a pour on a flat map was
 * losing eight per cent of its water in twenty four frames, and that is the
 * gap: a comparison is only as good as the branches its scene reaches.
 *
 * So: the editor's own field — 256 square at a quarter of a tile, because the
 * step and the spread both go as `cell` and a coarser scene runs a different
 * solver — flat, with a five-by-five block of six dropped in the middle. That
 * block is six deep against neighbours that are dry, which is the largest head
 * difference the engine can produce, and it is over its means on the first
 * step by a wide margin.
 */
export function pour(): ColumnField {
  const f = createColumnField(256, 256, { ...FLOW_DEFAULTS }, 0.25);
  const cx = 128, cy = 128;
  for (let y = cy - 2; y <= cy + 2; y++) {
    for (let x = cx - 2; x <= cx + 2; x++) addWater(f, x, y, 6, 1);
  }
  return f;
}

/**
 * A scene that SPRAYS, which the one above deliberately does not.
 *
 * `scene` keeps its drop under `BREAK` so that the five passes before the
 * falls are compared on water that is only flowing. That was the right scene
 * while the spray had nowhere to go on the device, and it is still the right
 * one for those five — but it means the shed branch, the outbox and the drain
 * are reached by nothing at all. This is the scene for them: a shelf high
 * enough that the front passes eight and the sheet starts coming apart.
 *
 * A SHELF WITH A NOTCH, for the same reason `falls-order.test.ts` uses one —
 * off a straight cliff every lip has its own landing and its own outbox slot,
 * so nothing about the ordering is under test. The notch puts two lips within
 * a throw of each other.
 */
export function spray(): ColumnField {
  const f = createColumnField(96, 64, { ...FLOW_DEFAULTS, wind: 0 }, 0.5);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 96; x++) {
      const up = x < 48 || (y > 24 && y < 40 && x < 60);
      f.ground[y * 96 + x] = up ? 26 : 0;
    }
  }
  for (let y = 8; y < 56; y++) {
    for (let x = 6; x < 44; x++) addWater(f, x, y, 8, 1);
  }
  return f;
}

/**
 * A copy of a live field, so the comparison can be pointed at the map someone
 * is actually building rather than at a fixture.
 *
 * Every typed array copied by name. Written generically because `ColumnField`
 * has forty-odd of them and a hand-written clone would be one `landing` short
 * the first time somebody added an array — which is the kind of omission that
 * shows up as a physics difference and gets blamed on a shader.
 */
export function cloneOf(f: ColumnField): ColumnField {
  const out = createColumnField(f.nx, f.ny, f.params, f.cell) as ColumnField;
  const src = f as unknown as Record<string, unknown>;
  const dst = out as unknown as Record<string, unknown>;
  for (const key of Object.keys(src)) {
    const v = src[key];
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
      const target = dst[key];
      if (ArrayBuffer.isView(target) && target.constructor === v.constructor) {
        (target as unknown as { set: (a: unknown) => void }).set(v);
      }
    } else if (typeof v === "number" || typeof v === "boolean") {
      dst[key] = v;
    }
  }
  // The box and the falls are objects of their own.
  out.box.x0 = f.box.x0; out.box.y0 = f.box.y0;
  out.box.x1 = f.box.x1; out.box.y1 = f.box.y1;
  // The box, the falls and the DRIPS are objects of their own. The drips used
  // to be left out, which was invisible until the spray went over: a clone
  // whose drip list was empty had a different `dripRoom` from its original,
  // so the two sides shed at different rates and the comparison was between
  // two scenes rather than two solvers.
  for (const [a, b] of [
    [f.falls, out.falls], [f.drips, out.drips],
  ] as [Record<string, unknown>, Record<string, unknown>][]) {
    for (const key of Object.keys(a)) {
      const v = a[key];
      if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
        (b[key] as unknown as { set: (x: unknown) => void }).set(v);
      } else if (typeof v === "number" || typeof v === "boolean") {
        b[key] = v;
      }
    }
  }
  return out;
}

export type PassDiff = {
  pass: string;
  /** The worst cell, worked through, so a disagreement can be read. */
  worked?: unknown;
  /** What the device objected to, if it objected. @see compareAccelerate */
  deviceSaid?: string | null;
  cells: number;
  /** Largest absolute difference, and where. */
  fx: number;
  fy: number;
  at: { x: number; y: number } | null;
  /** The largest flux either side produced, so the difference has a scale. */
  scale: number;
  /** `fx` difference as a fraction of that scale. */
  relative: number;
  /** The worst difference in ULPs of the operands that produced it. */
  worstUlps?: number;
  /** How many edges the limiter actually moved — see the note at its call. */
  limited?: number;
  /** How many edges each pass moved, and how many cells are breaking. */
  moved?: Partial<Record<string, number>>;
  breaking?: number;
  /** Cells where `delta` differs by more than rounding — must be nought. */
  deltaExact?: number;
  /** Cells where it differs at all, and the worst, against `delta`'s scale. */
  notBitEqual?: number;
  worstDelta?: number;
  deltaScale?: number;
  airDiff?: number;
  matDiff?: number;
  matWinner?: number;
  airDiff2?: number;
  frontDiff?: number;
  landDiff?: number;
  worstLand?: number;
  landAt?: unknown;
  landTotals?: unknown;
  /** Cliff edges the pass walked — nought means it was never exercised. */
  fellN?: number;
  /** Cells the landings actually put water into. Nought means untested. */
  landed?: number;
  /**
   * The SPRAY: how many drops each side shed, and whether the drops match.
   * `lost` is outbox overflow, which costs drops and never water.
   */
  sprayed?: unknown;
  /** For each differing edge, how near a branch it sat. @see stepFalls */
  straddle?: unknown[];
  dripDiff?: number;
  worstDrip?: number;
  dripAt?: unknown;
  worstAir?: number;
  worstFront?: number;
  airAt2?: unknown;
  frontAt?: unknown;
  depthDiff?: number;
  worstDepth?: number;
  depthScale?: number;
  rateDiff?: number;
  worstRate?: number;
  rateScale?: number;
  brokeDiff?: number;
  /** The box, the deepest column and the breaking flag, both ways. */
  reduceSaid?: unknown;
  /** What the cells that exceeded the bar actually look like. */
  offenderFlux?: unknown;
  /** How many edges differ by more than one f32 ULP of the values involved. */
  beyondRounding: number;
  ok: boolean;
};

/**
 * What one f32 ULP is worth at a magnitude.
 *
 * The bar a difference has to clear before it is a fault rather than the
 * device and JavaScript rounding the same arithmetic differently. Generous by
 * a factor of eight: the CPU accumulates in f64 and stores in f32, so a single
 * expression can legitimately land a few ULP away, and a real fault is never
 * within a factor of eight of rounding.
 */
const ulpOne = (v: number) => Math.max(Math.abs(v), 1e-6) * 2 ** -23;
const ulpAt = (v: number) => ulpOne(v) * 8;

/**
 * Does a difference matter? BOTH tests, and the conjunction is the point.
 *
 * Beyond rounding OF ITS OWN OPERANDS, or a fault in a branch only a few cells
 * take would hide behind the scene's largest flux. AND beyond rounding at the
 * SCENE'S scale, or ordinary cancellation is reported as a fault — measured on
 * the first clean run, 169 cells exceeded the per-operand bar and every one of
 * them carried a flux under 0.05 against a scene reaching 30.8, with absolute
 * differences around 1e-9. A near-zero flux computed two ways is near-zero
 * twice; the ULP count is large only because the denominator is small.
 *
 * Either test alone is wrong in a way that matters. Together they say: this is
 * a difference the arithmetic cannot explain, in a quantity big enough to move
 * water.
 */
const matters = (diff: number, operand: number, scale: number) =>
  diff > ulpAt(operand) && diff > ulpAt(scale);

/**
 * Run the accelerate pass both ways from one state and diff it.
 *
 * `settle` frames of CPU solver first, so the state under test is water that
 * has been doing something rather than a rectangle of still depth — a pass
 * that only handles the easy case passes on a flat scene.
 */
export async function compareAccelerate(
  device: GPUDevice, settle = 90, build: () => ColumnField = scene,
  through: PassName = "limit", solo = false,
): Promise<PassDiff> {
  // Two fields from one recipe, stepped identically, so both sides start from
  // the same bits. Building one and copying it would do as well; building two
  // also proves the recipe is deterministic, which everything here rests on.
  const cpu = build();
  const gpuSide = build();
  for (let n = 0; n < settle; n++) {
    stepFlow(cpu, 1 / 60);
    stepFlow(gpuSide, 1 / 60);
  }
  // A snapshot of a live map arrives with landings already banked from
  // whatever step it was taken in. Cleared, or the comparison counts them
  // twice and blames the pass.
  for (const f of [cpu, gpuSide]) {
    f.landing.fill(0); f.impulse.fill(0);
    f.landMat.fill(0); f.landBest.fill(0);
    f.kickX.fill(0); f.kickY.fill(0); f.capX.fill(0); f.capY.fill(0);
  }

  // A DRY COLUMN HOLDING WATER IN THE AIR, planted where nothing else is.
  //
  // `applyDepths` keeps such a column in the box on purpose — dropped out, the
  // fall stops being stepped and whatever is falling hangs there for ever. In
  // a settled scene that branch never decides anything, because the box is
  // already the whole wet region: deleting it from the shader changed nothing
  // and the comparison stayed clean. So the case is put there rather than
  // waited for, on both sides identically, at a corner the water has not
  // reached.
  // It has to be at the BOX'S EDGE to decide anything, and the column has to
  // be otherwise empty. Planted in the middle it changes nothing — the box
  // already covers it — which is how the first version of this passed with the
  // branch deleted. So: the whole of the last wet column dried out, with water
  // left in the air on one cell of it. With the branch, the box still reaches
  // that column; without it, the box is one narrower.
  const edge = activeBox(cpu);
  if (!edge) throw new Error("nothing wet: the scene never got going");
  for (const f of [cpu, gpuSide]) {
    for (let y = 0; y < f.ny; y++) f.depth[y * f.nx + edge.x1] = 0;
    f.falls.air[((edge.y0 + 1) * f.nx + edge.x1) * 2] = 0.5;
  }

  const region = activeBox(cpu);
  if (!region) throw new Error("nothing wet: the scene never got going");

  // The constants a substep works out, worked out here the same way — see
  // `PassConsts`. `keepOf` is filled by the same rule the substep uses.
  const dt = 1 / 60;
  const p = cpu.params;
  const consts = {
    x0: region.x0, y0: region.y0, x1: region.x1, y1: region.y1,
    gain: p.gravity * dt / cpu.cell,
    bedGain: p.bedDrag * dt,
    hMax: (cpu.cell / p.maxDt) ** 2 / (2 * p.gravity),
    minHead: p.minSlope * cpu.cell,
    spread: dt / cpu.cell,
    diffScale: dt / (cpu.cell * cpu.cell),
    dt,
  };
  const keep = Math.pow(p.drag, dt);
  for (const f of [cpu, gpuSide]) {
    for (let m = 0; m < MATERIAL_SLOTS; m++) {
      f.keepOf[m] = f.dragOf[m] > 0 ? Math.pow(f.dragOf[m], dt) : keep;
    }
  }

  const before = { fx: gpuSide.fx.slice(), fy: gpuSide.fy.slice() };
  // ERROR SCOPES AROUND ALL OF IT. A compute pass that fails validation does
  // not throw and does not draw: it silently does nothing, and the readback
  // then shows the input unchanged — which reads exactly like a physics bug
  // and sent the first run of this comparison chasing arithmetic for an hour.
  // Anything the device objects to comes back as the answer instead.
  device.pushErrorScope("internal");

  // The device runs the pass on the state as it stands...
  // The cliff index has to exist before it can be uploaded or walked.
  markCliffs(cpu);
  markCliffs(gpuSide);
  // THE VALIDATION SCOPE STARTS BEFORE THE UPLOAD. It used to start after, so
  // a `writeBuffer` the device refused was invisible and read back as zeroes
  // — which looks exactly like a shader that never ran, and was chased as one.
  device.pushErrorScope("validation");
  const state = createGpuState(device, gpuSide);
  upload(state, gpuSide);
  // The reduction starts inside out — see `reduceSeed`. Seeded here rather
  // than in a shader because a dispatch cannot clear what it is about to
  // combine into without a pass of its own.
  //
  // AND THE DRIP ALLOWANCE IS RESAMPLED HERE, not taken off the field as it
  // stands. `stepFalls` sets it at its own top, so the CPU is about to use
  // `dripRoom` of the list as it is NOW, while the field's stored `room` is
  // from the last frame's falls — before that frame's drips landed. Handing
  // the device the stored one gave it 0.292 against the CPU's 0.320, which is
  // a different scene rather than a different solver.
  const seed = reduceSeed(gpuSide.nx, gpuSide.ny);
  // The host built the cliff index for this comparison, so it says how long
  // it is. In the frame loop the CLIFF PASS writes this slot instead.
  seed[CLIFFN_SLOT] = gpuSide.falls.cliffN;
  device.queue.writeBuffer(state.reduce, 0, seed);
  writeConsts(state, {
    ...consts, windDepth: 2.5, dryDepth: p.dryDepth, fallMin: FALL_MIN,
    openEdge: gpuSide.openEdge,
    gravity: p.gravity, breaking: p.breaking, diffScale: consts.diffScale,
    room: dripRoom(gpuSide.drips), cell: gpuSide.cell,
    cliffN: gpuSide.falls.cliffN, frameDt: consts.dt, arriveN: 0, wantN: 0,
  }, gpuSide.wnx, gpuSide.wstride);
  const upTo = PASSES.indexOf(through);
  // SOLO runs just the one pass, on state both sides uploaded identically.
  //
  // It is the only way to ask whether a pass is bit-identical to its twin.
  // Down a chain it cannot be: the fluxes reaching pass 3 already differ by
  // pass 1's f32 rounding, so pass 3's output differs too, correctly and by
  // about as much. Demanding exact equality there reported 3906 cells and the
  // shader was right — the test was asking the wrong question.
  // SOLO RUNS ONE PASS — except the landings, which run with the falls, and
  // that is not a convenience. Pass 6 applies what pass 5 banked; on its own
  // it is handed an empty bank and does nothing, and so agrees perfectly with
  // a version of itself that had been deleted. There is no state in which it
  // can be asked a question except the one the pass before it leaves.
  const from = solo ? (upTo === 6 ? 5 : upTo) : 0;
  // BUILT ONLY AS FAR AS THE CHAIN RUNS. Creating every pipeline regardless
  // means a shader that will not compile fails the comparison of passes BEFORE
  // it — which is the opposite of what comparing a chain is for, and is
  // exactly what happened when pass 3 first used a reserved word.
  const builders = [
    createDiffuse, createAccelerate, createLimit, createDivergence, createApply,
  ];
  const gpuPasses: ((e: GPUCommandEncoder, st: GpuState, b: Box) => void)[] = [];
  for (let k = from; k <= Math.min(upTo, 4); k++) {
    gpuPasses.push(builders[k](device).encode);
  }
  // The falls dispatch over the CLIFF SET rather than the box, so they take a
  // count instead of a region — see `gpu/falls`.
  const falls = upTo >= 5 ? createFalls(device) : null;
  if (falls) {
    const n = gpuSide.falls.cliffN;
    gpuPasses.push((e, st) => falls.encode(e, st, n));
  }
  if (upTo >= 6) {
    const l = createLandings(device);
    gpuPasses.push((e, st) => l.encode(e, st));
  }
  let landed = 0;
  const cpuPasses: ((f: ColumnField, c: PassConsts) => void)[] =
    [
      diffuseBreaking, accelerate, limit, divergence, applyDepths,
      (fld, c) => stepFalls(fld, c.dt, { x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 }),
      // Takes no consts: what it applies was banked by the pass before it —
      // and counted here, because applying it is also what CLEARS it.
      (fld) => {
        for (let i = 0; i < fld.landing.length; i++) if (fld.landing[i] > 0) landed++;
        applyLandings(fld);
      },
    ];
  const enc = device.createCommandEncoder({ label: "pass-compare" });
  for (const run of gpuPasses) run(enc, state, region);
  device.queue.submit([enc.finish()]);

  // ...and the CPU runs the same ones on its own copy of the same state.
  //
  // WITH A COUNT OF WHAT EACH PASS ACTUALLY DID. A pass compared on a scene
  // that never makes it act is a pass nobody has tested: the limiter in
  // particular does nothing at all unless some cell is trying to send out more
  // water than it has, and a scene where that never happens would agree
  // perfectly with a limiter that had been deleted.
  // Snapshotted BETWEEN the passes, not before both: taken before
  // `accelerate` this counts every edge that pass moved, which is nearly all
  // of them, and reports a limiter doing plenty when it may have done nothing.
  // WHAT EACH PASS ACTUALLY DID. A pass compared on a scene that never makes
  // it act is a pass nobody has tested — the limiter does nothing unless a
  // cell is overdrawn, and the DIFFUSION does nothing at all unless something
  // is breaking. Counted per pass, between that pass and the one before it.
  const moved: Partial<Record<PassName, number>> = {};
  for (let k = from; k <= upTo; k++) {
    const wasFx = cpu.fx.slice(), wasFy = cpu.fy.slice();
    cpuPasses[k](cpu, consts);
    let n = 0;
    for (let i = 0; i < cpu.fx.length; i++) {
      if (cpu.fx[i] !== wasFx[i] || cpu.fy[i] !== wasFy[i]) n++;
    }
    moved[PASSES[k]] = n;
  }
  const limited = moved.limit ?? 0;

  const gx = await readField(state, "fx");
  const gy = await readField(state, "fy");
  const ran = (k: number) => from <= k && k <= upTo;
  const gd = ran(3) ? await readField(state, "delta") : null;
  const ga = ran(3) ? await readField(state, "air") : null;
  const gm = ran(3) ? await readField(state, "bestMat") : null;
  // PASS 4 WRITES THE DEPTHS AND THE THREE NUMBERS NOBODY OWNS. Comparing the
  // fluxes alone would pass with the whole of it deleted, and the reduction —
  // the deepest column, the box, whether anything is breaking — is the part
  // with atomics in it and so the part most worth diffing.
  // PASS 6 WRITES THE DEPTH AND THE MATERIAL AS WELL, which is the whole of
  // what it is for, so it wants the same readbacks pass 4 does. Compared with
  // only the fluxes it would agree with itself deleted.
  const wrote = ran(4) || ran(6);
  const gDepth = wrote ? await readField(state, "depth") : null;
  const gRate = ran(4) ? await readField(state, "rate") : null;
  const gBroke = ran(4) ? await readField(state, "broke") : null;
  const gAge = ran(4) ? await readField(state, "breakAge") : null;
  const gReduce = ran(4) ? readReduce(new Int32Array(
    (await readRaw(device, state.reduce, REDUCE_SLOTS * 4)),
  )) : null;


  const internal = await device.popErrorScope();
  const validation = await device.popErrorScope();
  const complaint = validation?.message ?? internal?.message ?? null;
  if (complaint) {
    return {
      pass: through, cells: cpu.fx.length, fx: NaN, fy: NaN, at: null,
      scale: 0, relative: NaN, beyondRounding: cpu.fx.length, ok: false,
      deviceSaid: complaint,
    };
  }

  // The scene's scale first, because the bar is relative to it.
  let scene = 0;
  for (let i = 0; i < cpu.fx.length; i++) {
    scene = Math.max(scene, Math.abs(cpu.fx[i]), Math.abs(cpu.fy[i]));
  }

  let worstX = 0, worstY = 0, at: { x: number; y: number } | null = null;
  const scale = scene;
  let beyond = 0, worstUlps = 0;
  for (let i = 0; i < cpu.fx.length; i++) {
    const dx = Math.abs(cpu.fx[i] - gx[i]);
    const dy = Math.abs(cpu.fy[i] - gy[i]);
    if (dx > worstX) { worstX = dx; at = { x: i % cpu.nx, y: (i / cpu.nx) | 0 }; }
    if (dy > worstY) worstY = dy;
    // AGAINST THE OPERANDS, not against the answer. The head is a DIFFERENCE
    // of two surfaces, so it cancels: a cell where the two sides are nearly
    // level produces a tiny head out of two large numbers, and an error of one
    // ULP of those numbers is enormous as a fraction of the result. Judging by
    // the result would call ordinary cancellation a fault, and judging by the
    // largest flux on the map would let a real fault hide in a quiet corner.
    // The operands are what the arithmetic actually rounded.
    const ox = Math.max(Math.abs(before.fx[i]), Math.abs(cpu.fx[i]));
    const oy = Math.max(Math.abs(before.fy[i]), Math.abs(cpu.fy[i]));
    worstUlps = Math.max(worstUlps, dx / ulpOne(ox), dy / ulpOne(oy));
    if (matters(dx, ox, scene) || matters(dy, oy, scene)) beyond++;
  }

  // Every cell that exceeded the bar, with the flux it carries, so the excess
  // can be explained rather than tuned away.
  const offenders: { flux: number; diff: number; ulps: number }[] = [];
  for (let i = 0; i < cpu.fx.length; i++) {
    const dx = Math.abs(cpu.fx[i] - gx[i]);
    const ox = Math.max(Math.abs(before.fx[i]), Math.abs(cpu.fx[i]));
    if (matters(dx, ox, scene)) offenders.push({ flux: ox, diff: dx, ulps: dx / ulpOne(ox) });
  }
  offenders.sort((u, v) => v.ulps - u.ulps);

  // PASS 3 WRITES MORE THAN THE FLUXES, and a comparison that only ever looks
  // at `fx` and `fy` would pass with the whole of it deleted. `delta` is what
  // the depths are about to be moved by; `air` is what went over a lip and has
  // to arrive later; `bestMat` is what a cell that fills this step is made of.
  //
  // `delta` is also the one array where the two sides should agree EXACTLY
  // rather than to rounding — the gather is bit-identical to the scatter by
  // construction, see divergence.test.ts — so it is held to zero, not to a
  // ULP bar. If that ever stops being true it is the shape of the pass that
  // has changed, not the arithmetic, and that is worth failing loudly for.
  let deltaExact = 0, airDiff = 0, matDiff = 0;
  let worstDelta = 0, notBitEqual = 0, deltaScale = 0, matWinner = 0;
  if (gd && ga && gm) {
    for (let y = region.y0; y <= region.y1; y++) {
      for (let x = region.x0; x <= region.x1; x++) {
        const i = y * cpu.nx + x;
        const dd = Math.abs(cpu.delta[i] - gd[i]);
        if (dd > worstDelta) worstDelta = dd;
        if (dd !== 0) notBitEqual++;
        if (matters(dd, Math.abs(cpu.delta[i]), scene)) deltaExact++;
        if (cpu.bestMat[i] !== gm[i]) {
          matDiff++;
          // HOW BIG WAS THE THING THAT WON. `bestMat` is an argmax over the
          // arriving moves, and the credit fires on any move above nought — so
          // a move of plus a billionth on one side and minus a billionth on
          // the other flips it. That is a sign change at zero, which is what
          // f32 and f64 rounding differ by, and it means nothing: the material
          // is only read by a cell that was dry and is filling, and a cell
          // filling from a billionth of a half step is not filling.
          matWinner = Math.max(matWinner, cpu.bestIn[i]);
        }
      }
    }
    for (let y = region.y0; y <= region.y1; y++) {
      for (let x = region.x0; x <= region.x1; x++) {
        deltaScale = Math.max(deltaScale, Math.abs(cpu.delta[y * cpu.nx + x]));
      }
    }
    for (let k = 0; k < cpu.falls.air.length; k++) {
      const d = Math.abs(cpu.falls.air[k] - ga[k]);
      if (matters(d, Math.abs(cpu.falls.air[k]), scene)) airDiff++;
    }
  }

  // PASS 5 writes the fall state and BANKS its landings in fixed point. The
  // banked side is read back as the integers it is, and turned into the half
  // steps the CPU holds, so the two can be compared at all.
  let airDiff2 = 0, frontDiff = 0, landDiff = 0, worstLand = 0;
  let worstAir = 0, worstFront = 0, fellN = 0;
  let dripDiff = 0, worstDrip = 0;
  const straddle: unknown[] = [];
  let dripAt: unknown = null, sprayed: unknown = null;
  let landAt: unknown = null;
  let landTotals: unknown = null;
  let airAt2: unknown = null, frontAt: unknown = null;
  if (ran(5)) {
    const gAir = await readField(state, "air");
    const gFront = await readField(state, "front");
    const gHead = await readField(state, "head");
    const acc = new Int32Array(await readRaw(device, state.acc, state.cells * 4 * 4));
    for (let k = 0; k < cpu.falls.air.length; k++) {
      const da = Math.abs(cpu.falls.air[k] - gAir[k]);
      const df = Math.abs(cpu.falls.front[k] - gFront[k]);
      if (da > worstAir) { worstAir = da; airAt2 = { k, cpu: cpu.falls.air[k], gpu: gAir[k] }; }
      if (df > worstFront) {
        worstFront = df;
        frontAt = {
          k, cpu: cpu.falls.front[k], gpu: gFront[k],
          drop: cpu.ground[k >> 1] - (cpu.depth[(k >> 1) + ((k & 1) ? cpu.nx : 1)] > cpu.params.dryDepth
            ? cpu.ground[(k >> 1) + ((k & 1) ? cpu.nx : 1)] + cpu.depth[(k >> 1) + ((k & 1) ? cpu.nx : 1)]
            : cpu.ground[(k >> 1) + ((k & 1) ? cpu.nx : 1)]),
        };
      }
      if (matters(da, Math.abs(cpu.falls.air[k]), scene)) {
        airDiff2++;
        // HOW CLOSE WAS THIS EDGE TO A BRANCH? `stepFalls` compares the head
        // and the front against the drop, and an edge sitting a rounding step
        // from either lands on different sides for an f32 and an f64 — where
        // the consequence is not a rounding difference but a whole fall
        // emptied or kept. Reported so that "it is only rounding" is something
        // measured rather than assumed.
        const ii = k >> 1, jj = ii + ((k & 1) ? cpu.nx : 1);
        const bes = cpu.depth[jj] > cpu.params.dryDepth
          ? cpu.ground[jj] + cpu.depth[jj] : cpu.ground[jj];
        const dropAt = cpu.ground[ii] - bes;
        straddle.push({
          at: `${ii % cpu.nx},${(ii / cpu.nx) | 0}`,
          headVsDrop: +(cpu.falls.head[k] - dropAt).toPrecision(4),
          frontVsDrop: +(cpu.falls.front[k] - dropAt).toPrecision(4),
          headVsFront: +(cpu.falls.head[k] - cpu.falls.front[k]).toPrecision(4),
          gpuHead: +(gHead ? gHead[k] - dropAt : NaN).toPrecision(4),
          air: +cpu.falls.air[k].toPrecision(4), diff: +da.toPrecision(4),
        });
      }
      if (df > 1e-4) frontDiff++;
    }
    // ONLY WHILE THE BANK IS STILL THERE. Pass 6 spends it and clears the
    // CPU's side as it goes, so run to the landings this compares a cleared
    // array against a full one and reports every cell. What pass 6 did with
    // it is compared through the DEPTH instead, which is the point of it.
    const banked = upTo === 5;
    let cpuTotal = 0, gpuTotal = 0;
    for (let i = 0; banked && i < cpu.landing.length; i++) {
      cpuTotal += cpu.landing[i];
      gpuTotal += acc[ACC.landing * state.cells + i] / LAND_SCALE;
    }
    landTotals = { cpu: +cpuTotal.toFixed(6), gpu: +gpuTotal.toFixed(6) };
    for (let i = 0; banked && i < cpu.landing.length; i++) {
      const got = acc[ACC.landing * state.cells + i] / LAND_SCALE;
      const d = Math.abs(cpu.landing[i] - got);
      if (d > worstLand) {
        worstLand = d;
        landAt = { cell: `${i % cpu.nx},${(i / cpu.nx) | 0}`, cpu: cpu.landing[i], gpu: got };
      }
      // A fixed point unit is one part in 2^20 of a half step — 9.5e-7 — so
      // the two cannot agree closer than that however right they both are.
      if (d > 4 / LAND_SCALE) landDiff++;
    }
    fellN = cpu.falls.cliffN;

    // THE SPRAY, which is the one thing pass 5 cannot finish on its own. The
    // shader posts a request per drop; here it is drained through the very
    // `dropFrom` the CPU path used, into the clone's own drip list, and the
    // two lists are compared drop for drop. Nothing about the drop's ARC is
    // written twice — only the decision to shed is, and that is what this is
    // measuring.
    const raw = new Int32Array(await readRaw(device, state.reduce, REDUCE_SLOTS * 4));
    const claimed = raw[SPAWNED_SLOT];
    const outbox = await readField(state, "spawn");
    const before = gpuSide.drips.live;
    const drained = drainSpawns(gpuSide, outbox, claimed);
    let airCpu = 0, airGpu = 0;
    for (let n = 0; n < cpu.falls.air.length; n++) {
      airCpu += cpu.falls.air[n]; airGpu += gAir[n];
    }
    sprayed = {
      cpu: cpu.drips.live - before, gpu: gpuSide.drips.live - before,
      shed: drained.shed, crowns: drained.crowns, lost: drained.lost,
      airCpu: +airCpu.toFixed(5), airGpu: +airGpu.toFixed(5),
    };
    const A = cpu.drips, B = gpuSide.drips;
    const live = Math.max(A.live, B.live);
    // EACH QUANTITY AGAINST ITS OWN SCALE — a position runs to the width of
    // the map and a volume is a quarter, and judging the second by the first
    // would pass with the volumes deleted.
    const parts: [string, Float32Array, Float32Array][] = [
      ["cx", A.cx, B.cx], ["cy", A.cy, B.cy], ["z", A.z, B.z],
      ["vx", A.vx, B.vx], ["vy", A.vy, B.vy], ["vz", A.vz, B.vz],
      ["volume", A.volume, B.volume], ["shape", A.shape, B.shape],
    ];
    for (const [name, a, b] of parts) {
      let partScale = 0;
      for (let n = 0; n < live; n++) partScale = Math.max(partScale, Math.abs(a[n]));
      for (let n = 0; n < live; n++) {
        const d = Math.abs(a[n] - b[n]);
        if (d > worstDrip) {
          worstDrip = d;
          dripAt = { drop: n, part: name, cpu: a[n], gpu: b[n] };
        }
        if (matters(d, Math.abs(a[n]), partScale)) dripDiff++;
      }
    }
    for (let n = 0; n < live; n++) if (A.material[n] !== B.material[n]) dripDiff++;
    if (A.live !== B.live) dripDiff++;
  }

  let depthDiff = 0, rateDiff = 0, brokeDiff = 0, worstDepth = 0, worstRate = 0;
  let depthScale = 0, rateScale = 0;
  const gMaterial = ran(6) ? await readField(state, "material") : null;
  if (gMaterial) {
    for (let i = 0; i < cpu.material.length; i++) {
      if (cpu.material[i] !== gMaterial[i]) matDiff++;
    }
  }
  if (gDepth) {
    // EACH QUANTITY AGAINST ITS OWN SCALE, worked out before anything is
    // judged. Handing the rate comparison a scale of one — the depth's order
    // of magnitude, not the rate's, which is half steps per SECOND and runs to
    // hundreds — reported 293 cells, and every one of them was rounding.
    for (let y = region.y0; y <= region.y1; y++) {
      for (let x = region.x0; x <= region.x1; x++) {
        const i = y * cpu.nx + x;
        depthScale = Math.max(depthScale, cpu.depth[i]);
        rateScale = Math.max(rateScale, cpu.rate[i]);
      }
    }
    // Pass 6 writes the depth but not the breaking state, so it reads back
    // the one and not the other. Guarded here rather than at the top, so that
    // adding a pass cannot quietly skip a comparison.
    const breaks = gRate && gBroke && gAge;
    for (let y = region.y0; y <= region.y1; y++) {
      for (let x = region.x0; x <= region.x1; x++) {
        const i = y * cpu.nx + x;
        const dd = Math.abs(cpu.depth[i] - gDepth[i]);
        worstDepth = Math.max(worstDepth, dd);
        if (matters(dd, Math.abs(cpu.depth[i]), depthScale)) depthDiff++;
        if (!breaks) continue;
        const dr = Math.abs(cpu.rate[i] - gRate[i]);
        worstRate = Math.max(worstRate, dr);
        if (matters(dr, Math.abs(cpu.rate[i]), rateScale)) rateDiff++;
        // `broke` is a nought-to-one ramp and `breakAge` a clock that is
        // either running or minus one. What matters about the age is WHICH,
        // not its value: a breaker that has been going a hair longer on one
        // side is not a disagreement, one that is not going at all is.
        if (Math.abs(cpu.broke[i] - gBroke[i]) > 1e-5) brokeDiff++;
        if ((cpu.breakAge[i] < 0) !== (gAge[i] < 0)) brokeDiff++;
      }
    }
  }
  const reduceSaid = gReduce ? {
    gpu: gReduce,
    cpu: {
      x0: cpu.box.x0, y0: cpu.box.y0, x1: cpu.box.x1, y1: cpu.box.y1,
      deepest: cpu.deepest, breaking: cpu.breaking,
    },
    boxAgrees: gReduce.x0 === cpu.box.x0 && gReduce.y0 === cpu.box.y0
      && gReduce.x1 === cpu.box.x1 && gReduce.y1 === cpu.box.y1,
    deepestAgrees: Math.abs(gReduce.deepest - cpu.deepest) <= ulpAt(cpu.deepest),
    breakingAgrees: gReduce.breaking === cpu.breaking,
  } : null;

  const worked = at ? (() => {
    const i = at.y * cpu.nx + at.x, j = i + 1;
    return {
      groundI: cpu.ground[i], groundJ: cpu.ground[j],
      depthI: cpu.depth[i], depthJ: cpu.depth[j],
      before: before.fx[i], cpuAfter: cpu.fx[i], gpuAfter: gx[i],
    };
  })() : null;

  // DESTROYED ONLY ONCE EVERYTHING HAS BEEN READ, which is here and nowhere
  // earlier. It used to go straight after the flux readbacks, so every array
  // pass 5 reads — air, front, the cliff index — came back as zeroes from a
  // dead buffer. That looks exactly like a shader whose threads never ran, and
  // was chased as one: fifteen edges reported as an unexplained physics
  // difference, and the shader was right the whole time.
  state.destroy();

  return {
    pass: PASSES.slice(from, upTo + 1).join(" + "),
    worked,
    cells: cpu.fx.length,
    fx: worstX,
    fy: worstY,
    at,
    scale,
    relative: scale > 0 ? worstX / scale : 0,
    /** How many edges the LIMITER moved. Nought means it was never tested. */
    limited,
    /** How many edges EACH pass moved — see the note at the loop. */
    moved,
    /** How many cells are breaking at all, which the diffusion needs. */
    breaking: (() => { let n = 0; for (const b of cpu.broke) if (b > 0) n++; return n; })(),
    deltaExact,
    /** Cells where `delta` differs AT ALL, and by how much, against its scale. */
    notBitEqual,
    worstDelta,
    deltaScale,
    airDiff,
    matDiff,
    depthDiff,
    worstDepth,
    depthScale,
    rateDiff,
    worstRate,
    rateScale,
    brokeDiff,
    reduceSaid,
    /** The largest arriving move at any cell whose material flipped. */
    matWinner,
    /** Pass 5: the fall state, and the landings it banked. */
    airDiff2,
    frontDiff,
    landDiff,
    worstLand,
    landAt,
    landTotals,
    fellN,
    landed,
    sprayed,
    straddle: straddle.slice(0, 6),
    dripDiff,
    worstDrip,
    dripAt,
    worstAir,
    worstFront,
    airAt2,
    frontAt,
    /** The worst difference measured in ULPs of the operands that made it. */
    worstUlps,
    /** How big the flux is where the bar was exceeded — see the note above. */
    offenderFlux: offenders.length ? {
      worst: offenders[0],
      median: offenders[Math.floor(offenders.length / 2)],
      biggestFlux: offenders.reduce((m, o) => Math.max(m, o.flux), 0),
    } : null,
    beyondRounding: beyond,
    // `bestMat` is an ARGMAX and a chain's inputs differ by rounding, so which
    // of two near-equal arrivals wins can legitimately flip. Solo it must not.
    ok: beyond === 0 && deltaExact === 0 && airDiff === 0
      && depthDiff === 0 && rateDiff === 0 && brokeDiff === 0
      && airDiff2 === 0 && frontDiff === 0 && landDiff === 0
      && (!reduceSaid
        || (reduceSaid.boxAgrees && reduceSaid.deepestAgrees
          && reduceSaid.breakingAgrees))
      && dripDiff === 0 && matDiff === 0,
  };
}

/**
 * THE CLIFF INDEX, both ways.
 *
 * Its own comparison rather than a seventh link in the chain, because it is
 * not a pass in a substep: it runs once a frame, before any of them, and what
 * it produces is the set the falls pass is dispatched over. Comparing it by
 * running it in the chain would be comparing it by its effects on water, one
 * step removed from the thing that can be wrong.
 *
 * AS A SET, NOT AS A LIST. `markCliffs` emits ascending and the device emits
 * in whatever order its threads reach the atomic, so comparing element by
 * element would report every edge on a scene where both are perfectly right.
 * Sorted, the question is the one worth asking: are these the same edges?
 */
export async function compareCliffs(
  device: GPUDevice, settle = 90, build: () => ColumnField = scene,
  fresh = false,
): Promise<{
  ok: boolean; cpuN: number; gpuN: number; missing: number[]; extra: number[];
  colDiff: number; throwDiff: number; worstThrow: number; seeded: number;
  deviceSaid: string | null;
}> {
  const cpu = build(), gpuSide = build();
  for (let n = 0; n < settle; n++) { stepFlow(cpu, 1 / 60); stepFlow(gpuSide, 1 / 60); }
  // EVERY LIP A NEW ONE, which is the state of the first frame after a map is
  // loaded and the only one in which the launch is seeded rather than eased.
  // A settled scene never reaches that branch, so comparing only settled
  // scenes compares it with the branch deleted — which is how six earlier
  // faults in this port hid.
  if (fresh) { cpu.falls.cliffCol.fill(0); gpuSide.falls.cliffCol.fill(0); }

  const state = createGpuState(device, gpuSide);
  device.pushErrorScope("validation");
  device.pushErrorScope("internal");
  upload(state, gpuSide);
  const p = gpuSide.params;
  writeConsts(state, {
    x0: 0, y0: 0, x1: gpuSide.nx - 1, y1: gpuSide.ny - 1,
    gain: 0, bedGain: 0, hMax: 0, minHead: 0, spread: 0, dt: 1 / 60,
    windDepth: 2.5, dryDepth: p.dryDepth, fallMin: FALL_MIN,
    openEdge: gpuSide.openEdge,
    gravity: p.gravity, breaking: p.breaking, diffScale: 0,
    room: dripRoom(gpuSide.drips), cell: gpuSide.cell, cliffN: 0, frameDt: 1 / 60, arriveN: 0, wantN: 0,
  }, gpuSide.wnx, gpuSide.wstride);
  device.queue.writeBuffer(state.reduce, 0, reduceSeed(gpuSide.nx, gpuSide.ny));

  const enc = device.createCommandEncoder({ label: "cliffs-compare" });
  createCliffs(device).encode(enc, state);
  device.queue.submit([enc.finish()]);

  // HOW MANY COLUMNS THE LAUNCH IS ACTUALLY SEEDED AT, counted before the CPU
  // runs, because running it is what changes them. Nought means the scene has
  // no NEW lip in it and the seeding branch went untested.
  const wasCol = cpu.falls.cliffCol.slice();
  markCliffs(cpu);
  let seeded = 0;
  for (let i = 0; i < wasCol.length; i++) {
    if (!wasCol[i] && cpu.falls.cliffCol[i]) seeded++;
  }

  const gCliff = await readField(state, "cliff");
  const gCol = await readField(state, "cliffCol");
  const gThrowX = await readField(state, "throwX");
  const gThrowY = await readField(state, "throwY");
  const gpuN = readReduce(new Int32Array(
    await readRaw(device, state.reduce, REDUCE_SLOTS * 4),
  )).cliffN;

  const mine = new Set([...cpu.falls.cliff.slice(0, cpu.falls.cliffN)]);
  const theirs = new Set([...gCliff.slice(0, Math.min(gpuN, gCliff.length))]);
  const missing = [...mine].filter((k) => !theirs.has(k)).slice(0, 8);
  const extra = [...theirs].filter((k) => !mine.has(k)).slice(0, 8);

  let colDiff = 0, throwDiff = 0, worstThrow = 0;
  for (let i = 0; i < gCol.length; i++) {
    if (cpu.falls.cliffCol[i] !== gCol[i]) colDiff++;
    const dx = Math.abs(cpu.falls.throwX[i] - gThrowX[i]);
    const dy = Math.abs(cpu.falls.throwY[i] - gThrowY[i]);
    worstThrow = Math.max(worstThrow, dx, dy);
    if (dx > 1e-5 || dy > 1e-5) throwDiff++;
  }

  const said = (await device.popErrorScope())?.message
    ?? (await device.popErrorScope())?.message ?? null;
  state.destroy();
  return {
    ok: said === null && gpuN === cpu.falls.cliffN && !missing.length
      && !extra.length && colDiff === 0 && throwDiff === 0,
    cpuN: cpu.falls.cliffN, gpuN, missing, extra, colDiff, throwDiff,
    worstThrow, seeded, deviceSaid: said,
  };
}
