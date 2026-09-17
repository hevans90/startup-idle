/**
 * Shallow Water Equations on a RECTANGULAR grid, one instance per body of fluid.
 *
 * Three coupled fields on an (ni+1)×(nj+1) collocated vertex grid:
 *   h  — height perturbation from mean surface (pixels at scale = 1)
 *   u  — i-direction velocity
 *   v  — j-direction velocity
 *
 * Per-tick integration (forward Euler):
 *   ∂h/∂t = −H·(∂u/∂i + ∂v/∂j)     ← mass conservation
 *   ∂u/∂t = −g·∂h/∂i − ν·u          ← momentum + viscous drag
 *   ∂v/∂t = −g·∂h/∂j − ν·v
 *
 * Boundary: Neumann (zero-gradient h, zero-normal velocity), so fluid stays in
 * the basin and reflects off the walls, producing sloshing.
 *
 * CFL stability: dt·√(g·H)/dx ≈ 0.033·√30 ≈ 0.18 << 1  ✓
 *
 * WHY THIS IS SHARED. v1's slop pit had this at module scope — the state arrays
 * were file-level `Float32Array`s — which is what made a second pit impossible,
 * more than any hardcoded footprint did. v2 needs one per excavation and at
 * whatever aspect its footprint has, so the sim takes a size and returns state.
 * v1's module now delegates to one 40×40 instance, because a tuned physics sim
 * is the worst possible thing to keep two diverging copies of.
 *
 * Bit-identical to the original at ni = nj = 40, which
 * `shallow-water.test.ts` proves against a frozen copy of it.
 */

/** Tuning. The defaults are v1's, tuned for thick viscous sludge. */
export type SweParams = {
  /** Wave-speed²; c = √(g·H). */
  gravity: number;
  /** Dimensionless mean depth. */
  meanH: number;
  /** Drag at rest — low, so waves persist. */
  dragBase: number;
  /** Extra drag at peak amplitude — high, so wave-breaking crushes spikes. */
  dragPeak: number;
  /** Laplacian diffusion; smooths sharp spikes into broad waves. */
  diffuse: number;
  /** Max surface perturbation, in pixels at scale = 1. */
  maxAmp: number;
};

export const SWE_DEFAULTS: SweParams = {
  gravity: 30,
  meanH: 1.0,
  dragBase: 0.012,
  dragPeak: 2.0,
  diffuse: 0.5,
  maxAmp: 18,
};

/** How many independent point oscillators {@link sweApplySourceGrid} drives. */
const SOURCE_GRID = 4;

export type ShallowWater = {
  /** Cells per axis. The vertex grid is one larger in each direction. */
  readonly ni: number;
  readonly nj: number;
  readonly ni1: number;
  readonly nj1: number;
  readonly params: SweParams;
  /** Height perturbation, indexed `i * nj1 + j`. */
  readonly h: Float32Array;
  readonly u: Float32Array;
  readonly v: Float32Array;
  /** Per-step scratch, so a frame allocates nothing. */
  readonly tmpH: Float32Array;
  readonly tmpU: Float32Array;
  readonly tmpV: Float32Array;
  /**
   * Which vertices are fluid, 1 or 0. All 1 unless {@link sweSetWet} says
   * otherwise.
   *
   * A pool is not a rectangle once pools can merge, so the sim runs over the
   * bounding box and this says which of it is actually wet. A dry neighbour is
   * treated exactly as the box edge is — zero gradient in h, zero velocity
   * across the face — so the pool's own outline becomes its wall.
   */
  wet: Uint8Array;
  /** True while every vertex is wet, so the masked paths can be skipped. */
  allWet: boolean;
  /** Point-oscillator phases, frequencies and positions. */
  readonly sgPhase: Float32Array;
  readonly sgFreq: Float32Array;
  readonly sgI: Int32Array;
  readonly sgJ: Int32Array;
};

export function createShallowWater(
  ni: number,
  nj: number,
  params: SweParams = SWE_DEFAULTS,
): ShallowWater {
  if (ni < 2 || nj < 2) throw new Error(`shallow water: grid too small (${ni}×${nj})`);
  const ni1 = ni + 1, nj1 = nj + 1;
  const n = ni1 * nj1;
  const count = SOURCE_GRID * SOURCE_GRID;
  const sim: ShallowWater = {
    ni, nj, ni1, nj1, params,
    h: new Float32Array(n),
    u: new Float32Array(n),
    v: new Float32Array(n),
    tmpH: new Float32Array(n),
    tmpU: new Float32Array(n),
    tmpV: new Float32Array(n),
    wet: new Uint8Array(n).fill(1),
    allWet: true,
    sgPhase: new Float32Array(count),
    sgFreq: new Float32Array(count),
    sgI: new Int32Array(count),
    sgJ: new Int32Array(count),
  };
  // A 4×4 grid of independent oscillators. Phases spread across >2π so no two
  // are in phase, frequencies 0.18–0.54 rad/s (periods 11–35 s) so their beat
  // pattern is effectively aperiodic — the eye cannot decompose it into tilts.
  for (let gi = 0; gi < SOURCE_GRID; gi++) {
    for (let gj = 0; gj < SOURCE_GRID; gj++) {
      const k = gi * SOURCE_GRID + gj;
      sim.sgPhase[k] = gi * 1.7 + gj * 2.3;
      sim.sgFreq[k] = 0.18 + gi * 0.07 + gj * 0.05;
      sim.sgI[k] = Math.round((gi + 0.5) * ni / SOURCE_GRID);
      sim.sgJ[k] = Math.round((gj + 0.5) * nj / SOURCE_GRID);
    }
  }
  return sim;
}

const at = (s: ShallowWater, i: number, j: number) => i * s.nj1 + j;

/**
 * Mark which vertices are fluid. `fn` is called for every vertex.
 *
 * Anything left dry keeps whatever `h`/`u`/`v` it held; the step simply stops
 * integrating it, and its neighbours stop seeing it. Callers that care should
 * zero it — {@link sweSetWet} does not, because a caller transferring state
 * from a previous basin wants to place values first and mask second.
 */
export function sweSetWet(s: ShallowWater, fn: (i: number, j: number) => boolean) {
  let all = true;
  for (let i = 0; i <= s.ni; i++) {
    for (let j = 0; j <= s.nj; j++) {
      const w = fn(i, j) ? 1 : 0;
      s.wet[at(s, i, j)] = w;
      if (!w) all = false;
    }
  }
  s.allWet = all;
}

/**
 * Inject a splash impulse centred at grid coordinates (si, sj).
 *
 * Negative strength gives a dip plus outward radial flow — a ripple ring. The
 * radius is in sim cells, so a finer grid means a tighter splash; callers that
 * want a fixed WORLD size scale it themselves.
 */
export function sweSplash(s: ShallowWater, si: number, sj: number, strength: number, radius = 3) {
  const ri = Math.round(si), rj = Math.round(sj);
  for (let di = -radius; di <= radius; di++) {
    for (let dj = -radius; dj <= radius; dj++) {
      const ii = ri + di, jj = rj + dj;
      if (ii < 0 || ii >= s.ni1 || jj < 0 || jj >= s.nj1) continue;
      const dist = Math.sqrt(di * di + dj * dj);
      if (dist > radius) continue;
      const w = 1 - dist / radius;
      if (!s.allWet && !s.wet[at(s, ii, jj)]) continue;
      s.h[at(s, ii, jj)] += strength * w;
      if (dist > 0.01) {
        const inv = 1 / dist;
        s.u[at(s, ii, jj)] += di * inv * strength * 0.25 * w;
        s.v[at(s, ii, jj)] += dj * inv * strength * 0.25 * w;
      }
    }
  }
}

/**
 * Seed a slow slosh with a linear height ramp across the basin.
 *
 * The pressure gradient accelerates fluid toward the low side and the wave
 * bounces back and forth — natural rocking rather than chaotic noise.
 */
export function sweInitSlosh(s: ShallowWater, iAmp: number, jAmp: number) {
  for (let i = 0; i <= s.ni; i++) {
    for (let j = 0; j <= s.nj; j++) {
      const k = at(s, i, j);
      if (!s.allWet && !s.wet[k]) continue;
      s.h[k] += iAmp * (i / s.ni - 0.5) + jAmp * (j / s.nj - 0.5);
    }
  }
}

/** Advance by `dt` seconds, clamped to 33 ms for stability. */
export function sweStep(s: ShallowWater, dt: number) {
  const { ni, nj, h, u, v, tmpH, tmpU, tmpV, params: p } = s;
  const t = Math.min(dt, 0.033);
  const gT = p.gravity * t;
  const HT = p.meanH * t;
  const dT = p.diffuse * t;

  // Interior: central-difference gradients, forward-Euler time. Drag is
  // per-cell and amplitude-dependent — gentle at low h so sloshing persists,
  // aggressive at high h so peaks break instead of spiking.
  const { wet, allWet } = s;
  // A dry neighbour reads back as the cell itself for h and as zero for
  // velocity: zero gradient, no flow across the face. That is the same Neumann
  // wall the box edge gets, so a pool's own outline behaves like its rim.
  // When everything is wet these collapse to a plain array read and the
  // arithmetic is bit-for-bit what it was — see shallow-water.test.ts.
  const hN = allWet
    ? (_k: number, nk: number) => h[nk]
    : (k: number, nk: number) => (wet[nk] ? h[nk] : h[k]);
  const uN = allWet ? (nk: number) => u[nk] : (nk: number) => (wet[nk] ? u[nk] : 0);
  const vN = allWet ? (nk: number) => v[nk] : (nk: number) => (wet[nk] ? v[nk] : 0);

  for (let i = 1; i < ni; i++) {
    for (let j = 1; j < nj; j++) {
      const k = at(s, i, j);
      if (!allWet && !wet[k]) continue;
      const kW = at(s, i - 1, j), kE = at(s, i + 1, j);
      const kS = at(s, i, j - 1), kN = at(s, i, j + 1);
      const ampF = Math.abs(h[k]) / p.maxAmp;
      const dFac = Math.max(0, 1 - (p.dragBase + p.dragPeak * ampF * ampF) * t);
      const lap =
        hN(k, kW) + hN(k, kE) +
        hN(k, kS) + hN(k, kN) - 4 * h[k];
      tmpH[k] =
        h[k] -
        HT * ((uN(kE) - uN(kW)) * 0.5 +
              (vN(kN) - vN(kS)) * 0.5) +
        dT * lap;
      tmpU[k] = (u[k] - gT * (hN(k, kE) - hN(k, kW)) * 0.5) * dFac;
      tmpV[k] = (v[k] - gT * (hN(k, kN) - hN(k, kS)) * 0.5) * dFac;
    }
  }

  for (let i = 1; i < ni; i++) {
    for (let j = 1; j < nj; j++) {
      const k = at(s, i, j);
      if (!allWet && !wet[k]) continue;
      h[k] = Math.max(-p.maxAmp, Math.min(p.maxAmp, tmpH[k]));
      u[k] = tmpU[k];
      v[k] = tmpV[k];
    }
  }

  // Neumann BCs. INTERLEAVED, not two sequential passes: the four corners are
  // written by both branches, so which one lands last — and whether the value
  // it copies has itself been updated yet — depends on the order. Two passes
  // gives different corner values from the original, and the corners are where
  // a wave reflects twice. The bounds checks are what make it work when the
  // grid is not square; at ni === nj this is exactly the original's loop.
  const kMax = Math.max(ni, nj);
  // Copy only between two WET vertices. Copying out of a dry one would import a
  // value the sim never maintains, and copying INTO one would make a wall
  // appear to ripple in the render. `allWet` short-circuits both checks, so a
  // full rectangle runs the original's exact sequence of writes.
  const pair = (a: number, b: number) => allWet || (wet[a] && wet[b]);
  const dry = (a: number) => !allWet && !wet[a];
  for (let k = 0; k <= kMax; k++) {
    if (k <= nj) {
      const lo = at(s, 0, k), lo1 = at(s, 1, k);
      const hi = at(s, ni, k), hi1 = at(s, ni - 1, k);
      if (pair(lo, lo1)) h[lo] = h[lo1];
      if (pair(hi, hi1)) h[hi] = h[hi1];
      if (!dry(lo)) u[lo] = 0;
      if (!dry(hi)) u[hi] = 0;
    }
    if (k <= ni) {
      const lo = at(s, k, 0), lo1 = at(s, k, 1);
      const hi = at(s, k, nj), hi1 = at(s, k, nj - 1);
      if (pair(lo, lo1)) h[lo] = h[lo1];
      if (pair(hi, hi1)) h[hi] = h[hi1];
      if (!dry(lo)) v[lo] = 0;
      if (!dry(hi)) v[hi] = 0;
    }
  }

  // The pool's own outline, treated as the box edge is. Skipped entirely for a
  // full rectangle, which is why the unmasked case stays bit-identical.
  if (!allWet) {
    for (let i = 0; i <= ni; i++) {
      for (let j = 0; j <= nj; j++) {
        const k = at(s, i, j);
        if (!wet[k]) continue;
        if (i > 0 && !wet[at(s, i - 1, j)]) u[k] = 0;
        if (i < ni && !wet[at(s, i + 1, j)]) u[k] = 0;
        if (j > 0 && !wet[at(s, i, j - 1)]) v[k] = 0;
        if (j < nj && !wet[at(s, i, j + 1)]) v[k] = 0;
      }
    }
  }
}

/**
 * Smooth sinusoidal modal forcing across the whole basin, each frame.
 *
 * Uses the basin's own resonant mode shapes — `sin(π·i/n)` peaks at the centre
 * and is zero at both walls, so it can only excite long-wavelength sloshing and
 * never short-wavelength spikes. Four modes at incommensurate frequencies give
 * an aperiodic, axis-neutral pattern with no point peaks.
 */
export function sweApplyModalForcing(s: ShallowWater, amp: number, t: number) {
  const s1i = amp * Math.sin(t * 0.29);            // i mode-1, period ≈ 22 s
  const s1j = amp * Math.sin(t * 0.19);            // j mode-1, period ≈ 33 s
  const s2i = amp * Math.sin(t * 0.41) * 0.45;     // i mode-2, period ≈ 15 s
  const s2j = amp * Math.sin(t * 0.37) * 0.45;     // j mode-2, period ≈ 17 s
  for (let i = 0; i <= s.ni; i++) {
    const fi1 = Math.sin(Math.PI * i / s.ni);
    const fi2 = Math.sin(2 * Math.PI * i / s.ni);
    for (let j = 0; j <= s.nj; j++) {
      const fj1 = Math.sin(Math.PI * j / s.nj);
      const fj2 = Math.sin(2 * Math.PI * j / s.nj);
      const k = at(s, i, j);
      if (!s.allWet && !s.wet[k]) continue;
      s.h[k] += fi1 * s1i + fj1 * s1j + fi2 * s2i + fj2 * s2j;
    }
  }
}

/** One travelling plane wave: direction and pace in LATTICE units. */
export type PlaneWave = {
  /** Radians per lattice step along i and j. */
  ki: number;
  kj: number;
  /** Radians per second. */
  omega: number;
  /** Share of the amplitude. */
  amp: number;
};

/**
 * Force the surface with travelling waves, in WORLD lattice coordinates.
 *
 * Two properties matter, and neither is available from the modal forcing:
 *
 * TRAVELLING, not standing. Modal forcing excites the basin's own modes, so the
 * pattern breathes in place and — because its components periodically cancel —
 * every so often stops dead. A plane wave is always going somewhere, so the
 * surface can never be motionless while one is crossing it. Nothing here is a
 * discrete EVENT either: an impulse dropped in periodically reads as a pulse,
 * and the eye picks the cadence out immediately.
 *
 * WORLD-anchored, not basin-anchored. The phase is taken from the vertex's
 * global lattice position rather than its index in this basin, so the field is
 * one continuous thing across the map. Growing a pool therefore changes nothing
 * about the water already in it: a basin-relative pattern would shift bodily
 * the moment the bounding box moved, which looks exactly like the pool being
 * re-rolled.
 */
export function sweApplyPlaneWaves(
  s: ShallowWater,
  waves: readonly PlaneWave[],
  t: number,
  originI: number,
  originJ: number,
  stride: number,
) {
  for (const w of waves) {
    const a = w.amp;
    const phase = -w.omega * t;
    for (let i = 0; i <= s.ni; i++) {
      const pi = w.ki * (originI + i * stride) + phase;
      for (let j = 0; j <= s.nj; j++) {
        const k = at(s, i, j);
        if (!s.allWet && !s.wet[k]) continue;
        s.h[k] += a * Math.sin(pi + w.kj * (originJ + j * stride));
      }
    }
  }
}

/**
 * Drive the point oscillators — 16 independent height impulses whose
 * superposition is aperiodic and axis-neutral, so there is no visible tilting.
 */
export function sweApplySourceGrid(s: ShallowWater, amp: number, t: number) {
  for (let k = 0; k < s.sgFreq.length; k++) {
    s.h[at(s, s.sgI[k], s.sgJ[k])] += amp * Math.sin(t * s.sgFreq[k] + s.sgPhase[k]);
  }
}

/**
 * Re-centre `h` on zero.
 *
 * Keeps a colour scale reading the actual surface variation rather than
 * drifting with cumulative impulses. Subtracting a constant leaves every
 * gradient unchanged, so velocity and wave propagation are unaffected.
 */
export function sweNormalizeMean(s: ShallowWater) {
  const n = s.h.length;
  let sum = 0, count = 0;
  for (let k = 0; k < n; k++) {
    if (!s.allWet && !s.wet[k]) continue;
    sum += s.h[k];
    count++;
  }
  if (!count) return;
  const mean = sum / count;
  if (Math.abs(mean) > 0.01) {
    for (let k = 0; k < n; k++) {
      if (!s.allWet && !s.wet[k]) continue;
      s.h[k] -= mean;
    }
  }
}

/**
 * Root-mean-square surface displacement over the wet part, in pixels.
 *
 * A measure of how choppy the surface IS, so forcing can be driven to a target
 * instead of set open-loop. RMS rather than peak because it moves smoothly: a
 * peak jumps whenever one vertex happens to crest, and a gain chasing it would
 * pump.
 */
export function sweRms(s: ShallowWater): number {
  let sum = 0, n = 0;
  for (let k = 0; k < s.h.length; k++) {
    if (!s.allWet && !s.wet[k]) continue;
    sum += s.h[k] * s.h[k];
    n++;
  }
  return n ? Math.sqrt(sum / n) : 0;
}

/** Reset to a still, flat surface — after a drain, or on unmount. */
export function sweReset(s: ShallowWater) {
  s.h.fill(0);
  s.u.fill(0);
  s.v.fill(0);
}
