/**
 * Two solvers on one scene, stepped in lockstep and diffed.
 *
 * THE FALSIFIER FOR THE COMPUTE PORT, and it exists before the thing it is
 * meant to falsify. Porting seven passes to WGSL and then discovering they
 * disagree with the reference is how three weeks becomes six: the disagreement
 * is found at the end, in the whole, with no way to say which pass owns it.
 *
 * WHAT THIS CANNOT DO, and the reason it is shaped the way it is: SHALLOW
 * WATER IS CHAOTIC. Two solvers that differ only in rounding — f32 on the
 * device against JavaScript's f64 intermediates, and `sin` implementations
 * that WGSL allows several ULP of slack in — do not stay close.
 *
 * MEASURED, because the rate is the whole of what makes this usable. One ULP
 * of difference in ONE cell of a settled pond, and then left alone:
 *
 *   1 second  (60 frames)    3.9e-6      no cell past 1e-4
 *   5 seconds (300)          3.1e-1      101 cells
 *   20 seconds (1200)        2.1e0       339 cells
 *
 * Five orders of magnitude in four seconds, then saturation — the two ponds
 * are simply different ponds after that, both of them right. The same shape
 * with the wind on and with it off, so it is the water and not the forcing.
 *
 * So PER-CELL COMPARISON HAS A HORIZON OF ABOUT A SECOND, and {@link HORIZON}
 * is that number. Past it a diff is measuring Lyapunov growth rather than
 * correctness, and a harness that reported it as failure would have its
 * tolerance widened until it reported nothing at all, and then be furniture.
 *
 * So it measures two different things and keeps them apart:
 *
 *  - PER CELL, over a short horizon. A real fault — a transposed index, a
 *    missing term, a pass that never ran — shows up immediately and enormous,
 *    thousands of times rounding scale, usually on frame one. This is where
 *    bugs are caught.
 *  - INVARIANTS, over any horizon. Total water, water in the air, the wet
 *    count. These are structural: both solvers conserve by construction, so
 *    they do NOT diverge chaotically, and a drift in total volume is a bug at
 *    any distance out. This is where bugs that survive the short horizon are
 *    caught.
 *
 * And it reports the SHAPE of the divergence, because the shape says which of
 * the two you are looking at. Rounding grows smoothly out of 1e-7. A fault is
 * a step.
 */
import { totalWater, type ColumnField } from "./columns";
import { waterInAir } from "./falls";

/**
 * How many frames a per-cell diff is worth anything over.
 *
 * Sixty, which is a second. At that distance a one-ULP seed has grown to about
 * 4e-6 — forty times under the default tolerance — and has moved no cell past
 * it at all. By five seconds it has moved a hundred. See the table above: this
 * is not a judgement, it is where the measurement stops supporting the claim.
 */
export const HORIZON = 60;

/** The state two solvers have to agree about. */
export type Snapshot = {
  depth: Float32Array;
  fx: Float32Array;
  fy: Float32Array;
  /** Per edge, `i * 2 + axis`. @see FallState.air */
  air: Float32Array;
};

/**
 * One solver, however its state is stored.
 *
 * `read` is async because the GPU's is: getting state off the device means a
 * staging buffer and a `mapAsync`. The CPU's returns its arrays directly.
 */
export type Candidate = {
  name: string;
  step: (dt: number) => void | Promise<void>;
  read: () => Snapshot | Promise<Snapshot>;
};

/** How far apart the two were at one moment. */
export type Divergence = {
  frame: number;
  /** Largest absolute difference in each array. */
  depth: number;
  fx: number;
  fy: number;
  air: number;
  /** How many cells differ by more than the tolerance. */
  cells: number;
  /**
   * Difference in what each solver holds ALTOGETHER — cells and air together.
   * Structural: both conserve by construction, so this does not drift with
   * chaos the way either half does on its own.
   */
  volume: number;
  /** How the total is split. Reported, not judged — the split wanders. */
  inAir: number;
};

export type Report = {
  a: string;
  b: string;
  frames: number;
  /** Every sampled frame, so the SHAPE of the divergence can be read. */
  trace: Divergence[];
  /** The largest each quantity reached over the run. */
  worst: Divergence;
  /** The first sampled frame where the depth difference passed `tol`. */
  firstOver: number | null;
  /**
   * What the numbers mean.
   *
   *  - `same`: inside tolerance the whole way. The two are the same solver.
   *  - `drifting`: cells differ but the invariants hold. Two correct solvers
   *    rounding differently, which over a long enough run is every pair.
   *  - `different`: the invariants broke, or the cells parted immediately and
   *    hugely. A fault, and one worth finding before anything else.
   */
  verdict: "same" | "drifting" | "different";
};

/** What a snapshot of a CPU field looks like. */
export const snapshotOf = (f: ColumnField): Snapshot => ({
  depth: f.depth.slice(),
  fx: f.fx.slice(),
  fy: f.fy.slice(),
  air: f.falls.air.slice(),
});

/** A `Candidate` backed by the CPU solver, which is also the reference. */
export const cpuCandidate = (
  name: string, f: ColumnField, step: (f: ColumnField, dt: number) => void,
): Candidate => ({
  name,
  step: (dt) => step(f, dt),
  read: () => snapshotOf(f),
});

/** Total water a snapshot's cells are holding, air not included. */
const held = (s: Snapshot) => {
  let v = 0;
  for (let i = 0; i < s.depth.length; i++) v += s.depth[i];
  return v;
};

const inAir = (s: Snapshot) => {
  let v = 0;
  for (let k = 0; k < s.air.length; k++) v += s.air[k];
  return v;
};

function maxAbs(a: Float32Array, b: Float32Array): number {
  let m = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > m) m = d;
  }
  return m;
}

function countOver(a: Float32Array, b: Float32Array, tol: number): number {
  let n = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (Math.abs(a[i] - b[i]) > tol) n++;
  }
  return n;
}

export type CompareOptions = {
  /** How many frames to step. */
  frames?: number;
  /** Sample the difference every this many frames. */
  every?: number;
  dt?: number;
  /**
   * What counts as the same, in half steps.
   *
   * A depth is drawn at `HEIGHT_UNIT` pixels per half step, so 1e-3 is a
   * six-hundredth of a pixel and nothing anyone can see. The default is far
   * tighter than that on purpose: the point of the short horizon is to catch
   * faults, and a fault is never marginal.
   */
  tol?: number;
  /**
   * What counts as conserved. Total volume is structural rather than chaotic,
   * so this is a fraction of the water present, not an absolute.
   */
  volumeTol?: number;
};

/**
 * Step both, diff both, and say what kind of difference it is.
 *
 * Neither candidate is stepped before the first sample, so frame 0 in the
 * trace is the scene as built — if the two disagree THERE, they were never
 * given the same scene and nothing after it means anything. That mistake is
 * cheap to make and expensive to chase.
 */
export async function compareSolvers(
  a: Candidate, b: Candidate, opts: CompareOptions = {},
): Promise<Report> {
  const frames = opts.frames ?? HORIZON;
  const every = opts.every ?? 10;
  const dt = opts.dt ?? 1 / 60;
  const tol = opts.tol ?? 1e-4;
  const volumeTol = opts.volumeTol ?? 1e-4;

  const trace: Divergence[] = [];
  let firstOver: number | null = null;

  const sample = async (frame: number) => {
    const sa = await a.read(), sb = await b.read();
    const d: Divergence = {
      frame,
      depth: maxAbs(sa.depth, sb.depth),
      fx: maxAbs(sa.fx, sb.fx),
      fy: maxAbs(sa.fy, sb.fy),
      air: maxAbs(sa.air, sb.air),
      cells: countOver(sa.depth, sb.depth, tol),
      // THE TOTAL, not each half. Water moves between the cells and the air
      // every step, and two solvers that have diverged hold DIFFERENT amounts
      // in each at any instant while holding the same amount altogether.
      // Measured separately, the split is chaotic and the check fires on two
      // perfectly conservative solvers — which it did, the first time the
      // physics under it changed at all.
      // Each TOTAL formed first, then subtracted. Written as
      // `held(a) + inAir(a) - held(b) - inAir(b)` it evaluates left to right,
      // so a large cell sum swallows a small air sum before the other side is
      // taken off — and two bit-identical solvers come back differing.
      volume: Math.abs((held(sa) + inAir(sa)) - (held(sb) + inAir(sb))),
      inAir: Math.abs(inAir(sa) - inAir(sb)),
    };
    if (firstOver === null && d.depth > tol) firstOver = frame;
    trace.push(d);
    return d;
  };

  await sample(0);
  for (let n = 1; n <= frames; n++) {
    await a.step(dt);
    await b.step(dt);
    if (n % every === 0 || n === frames) await sample(n);
  }

  const worst = trace.reduce((m, d) => ({
    frame: d.depth > m.depth ? d.frame : m.frame,
    depth: Math.max(m.depth, d.depth),
    fx: Math.max(m.fx, d.fx),
    fy: Math.max(m.fy, d.fy),
    air: Math.max(m.air, d.air),
    cells: Math.max(m.cells, d.cells),
    volume: Math.max(m.volume, d.volume),
    inAir: Math.max(m.inAir, d.inAir),
  }));

  // The volume bar is relative to how much water there is: a map holding
  // 40,000 half steps and one holding four cannot share an absolute one.
  const scale = Math.max(1, held(await a.read()));
  // `inAir` is reported because it is worth seeing, and NOT judged, for the
  // reason above: it is a share of the total and the share wanders.
  const conserved = worst.volume / scale <= volumeTol;

  // WHEN it parted, not only whether. A fault is there at the first sample,
  // enormous; rounding takes the whole of the horizon to become visible at
  // all. And a solver that loses water is wrong however slowly it does it.
  //
  // Conservation alone is not enough to tell them apart, which is worth
  // writing down because it was tried: a flux scaled by 0.999 every step
  // conserves perfectly and is a fault, and it came back as drifting.
  const early = firstOver !== null && firstOver <= HORIZON;
  const verdict = worst.depth <= tol ? "same"
    : early || !conserved ? "different"
      : "drifting";

  return { a: a.name, b: b.name, frames, trace, worst, firstOver, verdict };
}

/** The report as something readable in a console or a test failure. */
export function formatReport(r: Report): string {
  const lines = [
    `${r.a} vs ${r.b} over ${r.frames} frames: ${r.verdict.toUpperCase()}`,
    `  worst  depth ${r.worst.depth.toExponential(2)}`
    + `  fx ${r.worst.fx.toExponential(2)}`
    + `  fy ${r.worst.fy.toExponential(2)}`
    + `  air ${r.worst.air.toExponential(2)}`,
    `  volume drift ${r.worst.volume.toExponential(2)}`
    + `   in air ${r.worst.inAir.toExponential(2)}`,
    `  first past tolerance: ${r.firstOver ?? "never"}`,
    "  trace (frame: max |depth difference|)",
  ];
  for (const d of r.trace) {
    lines.push(`    ${String(d.frame).padStart(5)}: ${d.depth.toExponential(2)}`
      + `  ${d.cells} cells`);
  }
  return lines.join("\n");
}

/** Both counts, as a state the simulation is in rather than a difference. */
export const invariantsOf = (f: ColumnField) => ({
  volume: totalWater(f),
  inAir: waterInAir(f),
});
