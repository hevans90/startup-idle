/**
 * WHOLE FRAMES, both solvers, from one scene.
 *
 * The pass comparisons ask whether one pass is faithful from identical bits.
 * This asks the only question that matters to somebody watching the water: run
 * both for a while, does the same thing happen? They are different questions
 * and the second cannot be deduced from the first — a pass can be right to the
 * last bit and a solver built out of those passes still drift, because a
 * threshold somewhere lands on the other side of itself on frame forty.
 *
 * SO IT IS A DRIFT MEASUREMENT AND NOT AN EQUALITY TEST, and it has to be.
 * The two sides round differently in the sixth decimal place from the first
 * substep, and shallow water is chaotic: `compare.ts` measured the horizon on
 * the CPU against itself, and one unit in the last place becomes 3.9e-6 of a
 * half step after a second and 2.1 after twenty. Demanding equality at frame
 * sixty would be demanding that chaos not happen. What is asked instead is
 * what a person would ask — is it the same water? Same volume, same wet
 * extent, same lips, and no cell wildly out.
 *
 * CONSERVATION IS THE HARD PART OF IT. Drift in where the water is, is
 * physics. Drift in HOW MUCH there is, is a bug, and the two are easy to
 * confuse when the only thing being watched is a depth field.
 */
import {
  FLOW_DEFAULTS, activeBox, addWater, createColumnField, totalWater,
  type ColumnField,
} from "../columns";
import { stepFlow } from "../columns";
import { waterInAir } from "../falls";
import { createFlowWash, stepFlowWash } from "../../world/render/flow-wash";
import { createFoam, stepFoam } from "../../world/render/foam";
import { createGpuWater } from "./solver";
import { CARRY_EVERY } from "./state";
import { scene } from "./compare-pass";

export type FrameDiff = {
  frames: number;
  /** Total water, both ways, and the gap between them. */
  volume: {
    cpu: number; gpu: number; drift: number; started: number;
    keptCpu: number; keptGpu: number;
  };
  /** Columns standing wet on each side. */
  wet: { cpu: number; gpu: number };
  /** Cliff edges each solver walked on the last frame. */
  lips: { cpu: number; gpu: number };
  /** Drops in the air each side. */
  drips: { cpu: number; gpu: number };
  /** The deepest disagreement anywhere, against the deepest water. */
  worstDepth: number;
  depthScale: number;
  /** The mean disagreement, which is what drift looks like when it is real. */
  meanDepth: number;
  /** Milliseconds a frame, each way. Host time — the device's own is less. */
  ms: { cpu: number; gpu: number };
  deviceSaid: string | null;
  /** Where the two disagree most, and what each holds there. */
  worstAt: unknown;
  /** The active box each side ended on. A stale one clips a spreading front. */
  box: unknown;
  /** Cells one side counts as in the box and the other does not. */
  boxSaid: unknown[];
  /** What the device's passes were actually dispatched over. */
  region: unknown;
  /** The neighbourhood of the worst cell, where the two differ. */
  patch: unknown[];
  /** What each side held after every frame. @see trace */
  trace: unknown[];
  /**
   * Whether the carried fields were FRESH when `wash` and `foam` were read.
   *
   * They come down once every `CARRY_EVERY` readbacks, so read on any other
   * frame they are the host's copy of half a second ago and the two numbers
   * below mean nothing. False here says the run gave up waiting for a carry
   * and those numbers should be ignored. @see GpuFrame.carried
   */
  carriedFresh: boolean;
  /** How many extra frames it took to get one. */
  carriedWaited: number;
  /** The carried pattern, both ways — advected on the same fluxes. */
  wash: { worst: number; scale: number };
  /** And the white, with which of its three sources the scene reached. */
  foam: {
    worst: number; scale: number; white: number; broke: number;
    splashed: number; landing: number;
  };
  /** Whether the difference is spread thin or concentrated in a few cells. */
  where: unknown;
  /** How much water each side is holding in the AIR rather than in a column. */
  air: { cpu: number; gpu: number };
  ok: boolean;
};

/**
 * How far apart the two may be and still be the same water.
 *
 * A fiftieth of the deepest column, on the mean. Chosen against the horizon
 * rather than against a hope: at sixty frames the CPU's own one-ULP twin has
 * moved about a hundredth of a half step, so anything inside a fiftieth is
 * indistinguishable from the solver disagreeing with itself.
 */
const DRIFT = 0.02;

/** And a thousandth of it on the volume, which is not allowed to drift. */
const LEAK = 0.001;

/**
 * How far apart the WORST single cell may be, against the deepest water.
 *
 * LOOSER THAN IT LOOKS, and deliberately stated rather than tuned, because the
 * clean run's worst cell grows with how long the run is. Measured on the
 * settled scene with nothing wrong, worst over the deepest column:
 *
 *   frames   30      60      90      120     180     240     300
 *   worst    1.6e-4  1.6e-3  8.7e-4  1.3e-3  2.7e-3  1.0e-2  1.3e-2
 *
 * So a fifth of a tenth catches a gross regression at any length anybody runs
 * and will not catch a subtle one at three hundred frames, where the clean
 * value is already two thirds of it. The MEAN is the sensitive half of the
 * verdict — its own clean value is 6.9e-4 at three hundred against a threshold
 * of 0.02 — and this is here to catch the thing a mean hides: one cell wrong
 * by a lot while ten thousand are right.
 */
const WORST = 0.02;

/**
 * THE SPRAY SCENE IS A DIFFERENT REGIME, and pretending otherwise is how a
 * verdict gets ignored.
 *
 * The device hands out a frame's drops by atomic claim and the host in lip
 * order, which is a KNOWN and accepted difference — `drainSpawns` sorts the
 * drip list for the renderer, but the budget draw itself is not sorted, and
 * nobody has decided it should be. Measured on that scene at 120 frames with
 * nothing wrong: worst 0.075 against a 0.02 bound, air 562.115 against
 * 562.927, which is 0.14% against a 0.1% one. Both fail.
 *
 * So the scene that has an accepted divergence says so, rather than the bounds
 * being loosened everywhere to accommodate it. A run that passes these has the
 * spray difference and nothing else; one that fails them has something new.
 */
export const SPRAY_BOUNDS: Bounds = { worst: 0.12, air: 5e-3 };

/** What a run is allowed to differ by. @see WORST, AIR, SPRAY_BOUNDS */
export type Bounds = { worst: number; air: number };

/**
 * How far apart the water each side holds IN THE AIR may be.
 *
 * Tight, because it is measured tight: across seven clean runs from thirty to
 * three hundred frames the two sides' air agreed EXACTLY, to every digit, at
 * every length. It is the one number on this page that does not drift, which
 * makes it the one worth failing on. A fall that stops being handed over, or a
 * landing counted twice, moves it immediately.
 */
const AIR = 1e-3;

export async function compareFrames(
  device: GPUDevice, frames = 60, build: () => ColumnField = scene,
  settle = 30, bounds: Bounds = { worst: WORST, air: AIR },
): Promise<FrameDiff> {
  const cpu = build(), gpu = build();
  // SETTLED THE SAME WAY, ON THE CPU, so both start from identical bits and
  // the frames under test are the only thing being compared.
  for (let n = 0; n < settle; n++) { stepFlow(cpu, 1 / 60); stepFlow(gpu, 1 / 60); }

  const started = totalWater(cpu);
  const trace: unknown[] = [];
  // THE CARRIED PATTERN, both ways. It is a rendering field and it still has
  // to be right: it is advected on the solver's own fluxes, so a wash that
  // drifts is a wash being carried by water that is not there.
  const cpuWash = createFlowWash(cpu);
  const gpuWash = createFlowWash(gpu);
  const cpuFoam = createFoam(cpu);
  const gpuFoam = createFoam(gpu);
  let splashSeen = 0;
  device.pushErrorScope("validation");
  const water = createGpuWater(device, gpu, {
    seed: gpuWash.seed, now: gpuWash.now, foam: gpuFoam.now,
  });
  let cpuMs = 0, gpuMs = 0;
  for (let n = 0; n < frames; n++) {
    const a = performance.now();
    stepFlow(cpu, 1 / 60);
    const box = activeBox(cpu);
    if (box) {
      stepFlowWash(cpuWash, cpu, 1 / 60, box);
      stepFoam(cpuFoam, cpu, 1 / 60, box);
    }
    const b = performance.now();
    await water.stepAwaited(gpu, 1 / 60);
    gpuMs += performance.now() - b;
    cpuMs += b - a;
    // WHAT THE DEVICE HELD AFTER EVERY FRAME. A leak that is steady is one
    // thing and a leak that arrives in a burst is another, and a single number
    // at the end cannot tell them apart.
    // A SPLASH LASTS 0.15s AND THE RUN IS HALF A SECOND, so sampling at the
    // end says nought however many drops landed. Watched every frame instead.
    for (let k = 0; k < cpu.drips.splash.length; k++) {
      if (cpu.drips.splash[k] > splashSeen) splashSeen = cpu.drips.splash[k];
    }
    trace.push({
      n, gpu: +totalWater(gpu).toFixed(4), cpu: +totalWater(cpu).toFixed(4),
      air: +waterInAir(gpu).toFixed(4), lips: gpu.falls.cliffN,
      subs: water.last().substeps,
    });
  }
  // RUN ON UNTIL THE CARRIED FIELDS ACTUALLY COME BACK, before either is read.
  //
  // The wash and the foam come down once every `CARRY_EVERY` readbacks, so on
  // any other frame the host's copy of them is up to half a second old — and
  // this compared it against a CPU foam stepped that same frame, which is not
  // a comparison of two solvers, it is a comparison of a field with its own
  // past. It reported the FULL RANGE of the foam as a disagreement on every
  // run. Stepped on until the fields land, the same two agree to about a
  // hundredth, which is the answer this was supposed to be giving all along.
  //
  // Both sides keep stepping, so nothing is frozen to make the numbers agree:
  // it is the same scene a few frames later. @see GpuFrame.carried
  let waited = 0;
  while (!water.last().carried && waited < CARRY_EVERY * 2) {
    stepFlow(cpu, 1 / 60);
    const box = activeBox(cpu);
    if (box) {
      stepFlowWash(cpuWash, cpu, 1 / 60, box);
      stepFoam(cpuFoam, cpu, 1 / 60, box);
    }
    await water.stepAwaited(gpu, 1 / 60);
    waited++;
  }
  const carriedFresh = water.last().carried;
  const lastFrame = water.last();
  water.destroy();
  const said = (await device.popErrorScope())?.message ?? null;

  let worstDepth = 0, sum = 0, scale = 0, wetCpu = 0, wetGpu = 0;
  let worstAt: unknown = null;
  for (let i = 0; i < cpu.depth.length; i++) {
    const d = Math.abs(cpu.depth[i] - gpu.depth[i]);
    if (d > worstDepth) {
      worstAt = {
        at: `${i % cpu.nx},${(i / cpu.nx) | 0}`,
        cpu: cpu.depth[i], gpu: gpu.depth[i],
        ground: cpu.ground[i],
      };
    }
    worstDepth = Math.max(worstDepth, d);
    sum += d;
    scale = Math.max(scale, cpu.depth[i]);
    if (cpu.depth[i] > cpu.params.dryDepth) wetCpu++;
    if (gpu.depth[i] > gpu.params.dryDepth) wetGpu++;
  }
  const meanDepth = sum / cpu.depth.length;
  const vCpu = totalWater(cpu), vGpu = totalWater(gpu);
  const drift = Math.abs(vCpu - vGpu) / Math.max(1e-9, vCpu);

  // WHICH CELLS EACH SIDE THINKS ARE IN THE BOX. The predicate is "water
  // standing, or water in the air off one of its edges" — see `applyDepths` —
  // so where the two boxes differ, one of those two must differ with it.
  const boxSaid: unknown[] = [];
  const inBoxOf = (g: ColumnField, i: number) =>
    g.depth[i] > 0 || g.falls.air[i * 2] > 0 || g.falls.air[i * 2 + 1] > 0;
  for (let i = 0; i < cpu.depth.length && boxSaid.length < 6; i++) {
    if (inBoxOf(cpu, i) === inBoxOf(gpu, i)) continue;
    boxSaid.push({
      at: `${i % cpu.nx},${(i / cpu.nx) | 0}`,
      depth: [cpu.depth[i], gpu.depth[i]],
      air: [cpu.falls.air[i * 2], gpu.falls.air[i * 2],
        cpu.falls.air[i * 2 + 1], gpu.falls.air[i * 2 + 1]],
    });
  }
  // A PATCH ROUND THE WORST CELL, both ways, because a single number cannot
  // say whether a cell is dry for want of water or for want of a flux.
  const patch: unknown[] = [];
  if (worstAt) {
    const [wx, wy] = (worstAt as { at: string }).at.split(",").map(Number);
    for (let y = wy - 1; y <= wy + 1; y++) {
      for (let x = wx - 3; x <= wx + 2; x++) {
        if (x < 0 || y < 0 || x >= cpu.nx || y >= cpu.ny) continue;
        const i = y * cpu.nx + x;
        if (Math.abs(cpu.depth[i] - gpu.depth[i]) < 1e-12
          && Math.abs(cpu.fx[i] - gpu.fx[i]) < 1e-12) continue;
        patch.push({
          at: `${x},${y}`, ground: cpu.ground[i],
          depth: [+cpu.depth[i].toExponential(3), +gpu.depth[i].toExponential(3)],
          fx: [+cpu.fx[i].toExponential(3), +gpu.fx[i].toExponential(3)],
          fxW: [+cpu.fx[i - 1].toExponential(3), +gpu.fx[i - 1].toExponential(3)],
        });
      }
    }
  }
  // IS THE LOSS SPREAD OR CONCENTRATED? Thin and everywhere is arithmetic;
  // a handful of cells holding all of it is a structure.
  let over = 0, under = 0, overN = 0, underN = 0;
  const worstCells: { at: string; d: number }[] = [];
  for (let i = 0; i < cpu.depth.length; i++) {
    const d = gpu.depth[i] - cpu.depth[i];
    if (d > 0) { over += d; overN++; } else if (d < 0) { under -= d; underN++; }
    if (Math.abs(d) > 1e-3) {
      worstCells.push({ at: `${i % cpu.nx},${(i / cpu.nx) | 0}`, d: +d.toFixed(4) });
    }
  }
  worstCells.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  let worstWash = 0, washScale = 0, worstFoam = 0, foamScale = 0;
  for (let i = 0; i < cpuWash.now.length; i++) {
    worstWash = Math.max(worstWash, Math.abs(cpuWash.now[i] - gpuWash.now[i]));
    washScale = Math.max(washScale, Math.abs(cpuWash.now[i]));
    worstFoam = Math.max(worstFoam, Math.abs(cpuFoam.now[i] - gpuFoam.now[i]));
    foamScale = Math.max(foamScale, cpuFoam.now[i]);
  }
  // READ BEFORE THE VERDICT, because the verdict is one of the things that
  // reads them now. @see AIR
  const airCpu = waterInAir(cpu), airGpu = waterInAir(gpu);
  return {
    /**
     * WHETHER THE CARRIED FIELDS WERE FRESH when they were read.
     *
     * False means the run gave up waiting for a carry, and the wash and foam
     * numbers below are a field against its own past rather than against the
     * other solver's. @see GpuFrame.carried
     */
    carriedFresh, carriedWaited: waited,
    wash: { worst: worstWash, scale: washScale },
    foam: {
      worst: worstFoam, scale: foamScale,
      // WHICH OF THE THREE SOURCES ACTUALLY FIRED. Foam is born from a wave
      // breaking, from a sheet landing, and from a drop splashing, and a
      // comparison on a scene that reaches only the first has not tested the
      // other two — it has agreed with them deleted.
      white: cpuFoam.now.reduce((n, v) => n + (v > 0 ? 1 : 0), 0),
      broke: cpu.broke.reduce((n, v) => n + (v > 0 ? 1 : 0), 0),
      splashed: +splashSeen.toFixed(4),
      landing: (() => {
        let n = 0;
        for (let k = 0; k < cpu.falls.air.length; k++) if (cpu.falls.air[k] > 0) n++;
        return n;
      })(),
    },
    where: {
      gpuHasMore: +over.toFixed(4), cells: overN,
      gpuHasLess: +under.toFixed(4), lessCells: underN,
      top: worstCells.slice(0, 8),
      beyondMilli: worstCells.length,
    },
    trace: trace.slice(0, 12),
    patch,
    region: lastFrame.region,
    boxSaid,
    worstAt,
    box: { cpu: activeBox(cpu), gpu: activeBox(gpu) },
    air: { cpu: +airCpu.toFixed(3), gpu: +airGpu.toFixed(3) },
    frames,
    volume: {
      cpu: +vCpu.toFixed(3), gpu: +vGpu.toFixed(3), drift,
      // WHAT EACH SIDE STARTED WITH. Drift in where the water is, is physics;
      // drift in how much there is, is a bug, and the two are impossible to
      // tell apart without this number.
      started: +started.toFixed(3),
      keptCpu: +((vCpu - started) / started).toExponential(2),
      keptGpu: +((vGpu - started) / started).toExponential(2),
    },
    wet: { cpu: wetCpu, gpu: wetGpu },
    lips: { cpu: cpu.falls.cliffN, gpu: gpu.falls.cliffN },
    drips: { cpu: cpu.drips.live, gpu: gpu.drips.live },
    worstDepth, depthScale: scale, meanDepth,
    ms: { cpu: +(cpuMs / frames).toFixed(3), gpu: +(gpuMs / frames).toFixed(3) },
    deviceSaid: said,
    // THE VERDICT, AND IT HAS TO BE ABLE TO FAIL. It used to be volume and the
    // mean only, so a single cell wrong by a lot and a fall that stopped being
    // handed over both PRINTED a number and passed. @see WORST, AIR
    ok: said === null && drift < LEAK
      && meanDepth < DRIFT * Math.max(1e-9, scale)
      && worstDepth < bounds.worst * Math.max(1e-9, scale)
      && Math.abs(airCpu - airGpu)
         <= bounds.air * Math.max(1e-6, Math.abs(airCpu), Math.abs(airGpu)),
  };
}

/**
 * THE SAME POUR, BOTH WAYS.
 *
 * `compareFrames` settles a scene and then compares two solvers running it.
 * This is the other question, and the one somebody with a brush in their hand
 * actually asks: pour water in, the way the editor does — between frames, into
 * the host's copy, with no relation to where the frame boundary is — and does
 * the same puddle appear?
 *
 * Both sides are poured identically at the same step, so anything that differs
 * afterwards is the solver and not the pour.
 */
export async function checkPour(
  device: GPUDevice, build: () => ColumnField = flat, openEdge = true,
  withCarried = true, frames = 24, onWet = false,
): Promise<unknown> {
  const cpu = build(), gpu = build();
  cpu.openEdge = openEdge;
  gpu.openEdge = openEdge;
  // POURED ONTO WATER, optionally, because that is the case that looked worst:
  // a pour onto a wet floor rather than a dry one.
  if (onWet) {
    for (const f of [cpu, gpu]) {
      for (let y = 20; y < f.ny - 20; y++) {
        for (let x = 20; x < f.nx - 20; x++) addWater(f, x, y, 4, 1);
      }
    }
    for (let n = 0; n < 30; n++) { stepFlow(cpu, 1 / 60); stepFlow(gpu, 1 / 60); }
  }

  const wash = createFlowWash(gpu);
  const foam = createFoam(gpu);
  const water = createGpuWater(
    device, gpu,
    withCarried ? { seed: wash.seed, now: wash.now, foam: foam.now } : undefined,
  );
  const step = async () => {
    stepFlow(cpu, 1 / 60);
    await water.stepAwaited(gpu, 1 / 60);
  };
  for (let n = 0; n < 4; n++) await step();

  // THE POUR, between frames, exactly where a click lands — and the same on
  // both sides to the last bit.
  const cx = (gpu.nx / 2) | 0, cy = (gpu.ny / 2) | 0;
  for (const f of [cpu, gpu]) {
    for (let y = cy - 2; y <= cy + 2; y++) {
      for (let x = cx - 2; x <= cx + 2; x++) addWater(f, x, y, 6, 1);
    }
  }

  const trail: unknown[] = [];
  const spread = (f: ColumnField) => {
    // HOW FAR THE PUDDLE HAS REACHED, each way, which is the thing that looked
    // wrong: water that does not expand in every direction.
    let w = 1e9, e = -1e9, n2 = 1e9, s2 = -1e9, wet = 0;
    for (let i = 0; i < f.depth.length; i++) {
      if (f.depth[i] <= f.params.dryDepth) continue;
      const x = i % f.nx, y = (i / f.nx) | 0;
      wet++;
      if (x < w) w = x; if (x > e) e = x;
      if (y < n2) n2 = y; if (y > s2) s2 = y;
    }
    return { wet, west: cx - w, east: e - cx, north: cy - n2, south: s2 - cy };
  };
  for (let n = 0; n < frames; n++) {
    await step();
    let worst = 0, scale = 0, at = -1;
    for (let i = 0; i < cpu.depth.length; i++) {
      const d = Math.abs(cpu.depth[i] - gpu.depth[i]);
      if (d > worst) { worst = d; at = i; }
      scale = Math.max(scale, cpu.depth[i]);
    }
    if (n % 4 === 3 || n < 3) {
      trail.push({
        n, cpu: spread(cpu), gpu: spread(gpu),
        worst: +worst.toFixed(4), scale: +scale.toFixed(3),
        // WHERE the worst cell is, relative to the pour, and which way it is
        // wrong. A total that sags says water is missing; this says whether it
        // is missing at the spreading FRONT, which would be a dispatch region
        // clipped short, or in the MIDDLE, which would be arithmetic.
        at: at < 0 ? null : {
          dx: (at % cpu.nx) - cx, dy: ((at / cpu.nx) | 0) - cy,
          cpu: +cpu.depth[at].toFixed(3), gpu: +gpu.depth[at].toFixed(3),
        },
        deepest: [+cpu.deepest.toFixed(3), +gpu.deepest.toFixed(3)],
        water: [+totalWater(cpu).toFixed(2), +totalWater(gpu).toFixed(2)],
        // What the device's own clamp ate this frame. @see CLAMP_SLOT
        clamped: water.last().reduce?.clamped ?? null,
        // AND WHERE THE DEVICE'S WATER IS, split three ways. A total says
        // some went missing; this says whether it went missing from the
        // COLUMNS or was banked into the air and never landed.
        gpuSplit: [
          +water.last().deviceWater.toFixed(2),
          +waterInAir(gpu).toFixed(2),
          +(totalWater(gpu) - waterInAir(gpu)
            - gpu.depth.reduce((a, b) => a + b, 0)).toFixed(2),
        ],
        cliffN: water.last().reduce?.cliffN ?? null,
        deltaSum: water.last().reduce?.deltaSum ?? null,
        region: water.last().region,
      });
    }
  }
  // WHICH CELLS THE DEVICE NEVER FILLED, as a picture rather than as a number.
  //
  // A total that sags says water went missing and a worst-cell says where the
  // biggest hole is; neither says what SHAPE the holes are, and the shape is
  // the whole diagnosis. A ring is a dispatch region clipped short. A single
  // cell is arithmetic. A checkerboard or a row is an indexing fault.
  const dry: string[] = [];
  let missing = 0, sum = 0;
  for (let i = 0; i < cpu.depth.length; i++) {
    if (cpu.depth[i] <= cpu.params.dryDepth) continue;
    if (gpu.depth[i] > cpu.params.dryDepth) continue;
    missing++;
    sum += cpu.depth[i];
    if (dry.length < 24) {
      dry.push(`${(i % cpu.nx) - cx},${((i / cpu.nx) | 0) - cy}`);
    }
  }
  // AND THE OTHER WAY ROUND, because a hole in one place and a heap in another
  // is a solver that moved water to the wrong cell rather than one that lost
  // it, and the two read identically in a total.
  let extra = 0;
  for (let i = 0; i < cpu.depth.length; i++) {
    if (gpu.depth[i] > cpu.depth[i]) extra += gpu.depth[i] - cpu.depth[i];
  }
  // AND THE PUDDLE ITSELF, as a picture. Nineteen columns each way around the
  // pour, both sides, one character a cell: the digit is the depth rounded, a
  // dot is dry, and a `#` is a cell the device left dry that the CPU filled.
  // Counts and worst-cells describe a fault; a picture shows its SHAPE, and
  // the shape is what says whether it is a boundary, a stripe or one cell.
  const R = 9;
  const glyph = (v: number, other: number) => {
    if (v > cpu.params.dryDepth) {
      return v >= 10 ? "+" : String(Math.min(9, Math.round(v)));
    }
    return other > cpu.params.dryDepth ? "#" : ".";
  };
  const picture = (a: ColumnField, b: ColumnField) => {
    const rows: string[] = [];
    for (let y = cy - R; y <= cy + R; y++) {
      let row = "";
      for (let x = cx - R; x <= cx + R; x++) {
        const i = y * a.nx + x;
        row += glyph(a.depth[i], b.depth[i]);
      }
      rows.push(row);
    }
    return rows;
  };
  const cpuPic = picture(cpu, gpu), gpuPic = picture(gpu, cpu);
  water.destroy();
  return {
    trail,
    missing, missingWater: +sum.toFixed(2), extraWater: +extra.toFixed(2),
    dry, cpuPic, gpuPic,
  };
}

/**
 * Flat ground, no water: the scene a pour is tried on.
 *
 * 256 SQUARE, which is the map the editor actually has — 64 tiles at four
 * columns each. The first version of this was 96 by 64 and could not
 * reproduce anything, which is its own lesson about harness scenes.
 */
export function flat(): ColumnField {
  // THE EDITOR'S FIELD, to the parameter. 256 square is 64 tiles at four
  // columns each, and the CELL IS A QUARTER, not a half — a column is a
  // quarter of a tile across. That one number matters more than it looks: the
  // spread per step goes as `dt / cell` and the stable step as `cell`, so a
  // scene built at a half is running at twice the step the real map can take
  // and will not show what the real map does. The params are FLOW_DEFAULTS
  // because that is what the world builds with, wind and all.
  return createColumnField(256, 256, { ...FLOW_DEFAULTS }, 0.25);
}

/**
 * HOW FAST THE FRAMES COME in a live-paced harness.
 *
 * `frame` is `requestAnimationFrame`, which is the clock the tick actually
 * runs on and the honest default — but it only runs while the TAB IS IN
 * FRONT. Backgrounded, Chrome drops it to about twice a second, and at that
 * rate every readback has landed long before the next tick: the harness is
 * then measuring the awaited regime while claiming to measure the live one,
 * which is worse than measuring nothing.
 *
 * `free` yields a macrotask through a `MessageChannel` instead. Not a timer —
 * a hidden tab clamps `setTimeout` to about a second, and a channel message is
 * not clamped — so promises and buffer mappings get their turn and nothing
 * waits. Frames then come FASTER than a real one, which leaves the host's copy
 * of the box and the water further behind than the app ever does. That is a
 * harsher version of the same regime rather than a different one, which is the
 * right direction for a harness to be wrong in.
 */
export type Pace = "frame" | "free";

const nextFrame = (pace: Pace) => new Promise((r) => {
  if (pace === "frame") { requestAnimationFrame(() => r(null)); return; }
  const ch = new MessageChannel();
  ch.port1.onmessage = () => { ch.port1.close(); r(null); };
  ch.port2.postMessage(0);
});

/**
 * THE POUR AGAIN, BUT DRIVEN THE WAY THE TICK DRIVES IT.
 *
 * `checkPour` awaits every frame, so the host's copy is never more than one
 * frame behind — and it conserves water to the last bit. The live path does
 * not await: it calls `sync` at the top of a tick and `step` at the bottom,
 * and the readback lands when it lands, three to five frames later. On that
 * path a pour on a flat map loses more than half its water in a second, and
 * nothing in the awaited harness shows it.
 *
 * So this drives the same two calls in the same order with real time passing
 * between frames, which is the only difference left between the two. It exists
 * to make that leak reproducible off the editor, where it can be bisected.
 */
export async function checkPourLive(
  device: GPUDevice, frames = 40, openEdge = false, onWet = false,
  // THE TWIN IS OPTIONAL AND OFF, because it is not free: the CPU solver costs
  // about a tenth of a second a frame on a 256 square map, which is ten times
  // everything else here put together and turns a two second run into half a
  // minute. Conservation does not need it — a flat closed map cannot lose
  // water — so ask for it only when the question is whether it is the SAME
  // water rather than whether it is all still there.
  twin = false,
  build: () => ColumnField = flat,
  // HOW FAST THE FRAMES COME, and it is a question about the TAB rather than
  // about the water. @see nextFrame
  pace: Pace = "frame",
  // HOW FAR THE SECOND POUR LANDS FROM THE FIRST, in columns.
  //
  // Nought puts it back on the puddle, which is the obvious case and the one
  // this always tested. Far away is the case that breaks a band: depth comes
  // back only for the rows the device's region covered, so a pour outside it
  // lands in a row the readback does not touch — and whether that is correct
  // turns on the arrivals still in flight NOT being applied a second time on
  // top of the host's own write. Sixty columns clears any reach the region
  // has.
  away = 0,
): Promise<unknown> {
  const f = build();
  // A CPU TWIN, poured identically at the same frames. Conservation says
  // whether water is lost; only a twin says whether it is the SAME water.
  const cpu = build();
  cpu.openEdge = openEdge;
  // WALLED IN BY DEFAULT, because the question is whether water is LOST and an
  // open edge is a way for it to leave honestly. Nothing on a flat closed map
  // can take any away, so the total is a constant and any dip is a bug. The
  // editor's maps are open, though, so it is worth being able to ask both.
  f.openEdge = openEdge;
  // POURED ONTO WATER, optionally: the case that looked worst by eye, where a
  // pour onto a wet floor read as setting the depth rather than adding to it.
  if (onWet) {
    for (const g of twin ? [f, cpu] : [f]) {
      for (let y = 100; y < 156; y++) {
        for (let x = 100; x < 156; x++) addWater(g, x, y, 3, 1);
      }
      for (let n = 0; n < 20; n++) stepFlow(g, 1 / 60);
    }
  }
  const wash = createFlowWash(f);
  const foam = createFoam(f);
  const water = createGpuWater(device, f, {
    seed: wash.seed, now: wash.now, foam: foam.now,
  });
  const tick = async () => {
    // Exactly the tick's order: take what came back, then let the host write,
    // then submit. And a real frame of real time, so the readback behaves as
    // it does in the app rather than being waited on.
    water.sync(f);
    water.step(f, 1 / 60);
    if (twin) stepFlow(cpu, 1 / 60);
    await nextFrame(pace);
  };
  for (let n = 0; n < 4; n++) await tick();

  const cx = (f.nx / 2) | 0, cy = (f.ny / 2) | 0;
  const spot = cy * f.nx + cx;
  const before = f.depth[spot];
  const pour = (off = 0) => {
    for (const g of twin ? [f, cpu] : [f]) {
      for (let y = cy - 2 + off; y <= cy + 2 + off; y++) {
        for (let x = cx - 2 + off; x <= cx + 2 + off; x++) {
          addWater(g, x, y, 6, 1);
        }
      }
    }
  };
  pour();
  const poured = totalWater(f);

  // EVERY FRAME, not every fourth. What went wrong here was a FLICKER — water
  // present for one frame and gone the next — and a trail that samples every
  // fourth frame can step straight over it and report a smooth decline.
  const trail: number[] = [];
  const cpuTrail: number[] = [];
  // WHAT THE DEVICE ITSELF HOLDS, which is the half of the total that says
  // whose the loss is. @see GpuFrame.deviceWater
  const deviceTrail: number[] = [];
  const flight: number[] = [];
  const reads: number[] = [];
  // The depth AT THE POUR, both ways. A total says water went missing; this
  // says whether it went missing where it was put.
  const site: number[][] = [];
  const subs: number[] = [];
  // WHAT SHOULD BE THERE at each frame, which is the only honest bar: a flat
  // map takes nothing away, so the total is whatever has been poured so far.
  const want: number[] = [];
  let owedUp = 0;
  for (let n = 0; n < frames; n++) {
    // A SECOND POUR PART WAY IN, because the first one lands while nothing is
    // in flight and the interesting window is the other one: the solver is
    // paced, so it cannot upload while a readback is outstanding, and every
    // pour a person makes lands in that window.
    if (n === Math.floor(frames / 2)) { pour(away); owedUp += 150; }
    await tick();
    trail.push(+totalWater(f).toFixed(2));
    const l = water.last();
    deviceTrail.push(+l.deviceWater.toFixed(2));
    // WHETHER A READBACK EVER LANDED AT ALL. A device trail of zeros means
    // either that the device lost every drop or that nothing ever came back to
    // say so, and those look identical from the outside.
    flight.push(l.inFlight);
    reads.push(+l.readMs.toFixed(1));
    if (twin) cpuTrail.push(+totalWater(cpu).toFixed(2));
    site.push([+f.depth[spot].toFixed(3), +cpu.depth[spot].toFixed(3)]);
    subs.push(water.last().substeps);
    want.push(poured + owedUp);
  }
  water.destroy();
  // Against what should be there AT THAT FRAME, not against the first pour —
  // measured the lazy way, a run that poured twice and then lost a third of it
  // still passed, because the minimum was compared with the smaller total.
  // BOTH WAYS. This counted only water going MISSING, and that is half a test:
  // the fault that proved the point was a pour applied TWICE — three hundred
  // poured and four hundred and fifty on the map — and a one-sided check
  // called it a pass. Off is off, whichever way.
  let worst = 0, at = -1;
  for (let i = 0; i < trail.length; i++) {
    const off = Math.abs(want[i] - trail[i]) / want[i];
    if (off > worst) { worst = off; at = i; }
  }
  return {
    poured: +poured.toFixed(2), wasWet: +before.toFixed(3),
    cpuTrail, site,
    // A tenth of a percent either way is beyond any rounding a conserving
    // solver does.
    ok: worst < 0.001,
    offBy: +(worst * 100).toFixed(2) + "%", atFrame: at,
    substeps: [Math.min(...subs), Math.max(...subs)],
    pace, away,
    reads: [Math.min(...reads), Math.max(...reads)],
    flight: [Math.min(...flight), Math.max(...flight)],
    trail, deviceTrail,
  };
}
