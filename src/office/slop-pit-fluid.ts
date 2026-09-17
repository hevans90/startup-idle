/**
 * Shallow Water Equations (SWE) fluid simulation for the slop pit surface.
 *
 * Three coupled fields on a SIM_N×SIM_N collocated grid:
 *   h  — height perturbation from mean surface (pixels at scale=1)
 *   u  — i-direction velocity
 *   v  — j-direction velocity
 *
 * Per-tick integration (forward Euler):
 *   ∂h/∂t = −H·(∂u/∂i + ∂v/∂j)     ← mass conservation
 *   ∂u/∂t = −g·∂h/∂i − ν·u          ← momentum + viscous drag
 *   ∂v/∂t = −g·∂h/∂j − ν·v
 *
 * Boundary: Neumann (zero-gradient h, zero-normal velocity) so fluid stays
 * in the pit and reflects off walls, producing sloshing.
 *
 * CFL stability: dt·√(g·H)/dx ≈ 0.033·√45 ≈ 0.22 << 1  ✓
 */

export const SIM_N = 40; // grid cells per side
export const SIM_N1 = SIM_N + 1; // vertex count per side (21)

/** Pit depth in HH units (HH = ISO_CELL_STRIDE·scale/4). */
export const PIT_DEPTH_HH = 3;

/** Max surface perturbation in pixels (at scale=1). */
export const SWE_MAX_AMP = 18;

// SWE parameters — tuned for thick viscous sludge
const GRAVITY = 30; // wave-speed² (c = √(g·H) ≈ 5.5 cells/s → crosses pit in ~3.6 s)
const MEAN_H = 1.0; // dimensionless mean depth
// Amplitude-dependent drag: low at rest (waves persist), high at peaks (wave-breaking).
// At h=0: effective drag ≈ DRAG_BASE → time constant ~20 s → eternal gentle sloshing.
// At h=SWE_MAX_AMP: effective drag ≈ DRAG_BASE+DRAG_PEAK → time constant ~0.4 s → peaks crushed.
const DRAG_BASE = 0.012; // time constant ~83 s — waves barely decay between forcing pulses
const DRAG_PEAK = 2.0;
// Laplacian diffusion coefficient — smooths sharp spikes into broad waves.
// Stability bound: DIFFUSE * 4 * dt < 1 → max safe ≈ 7.6; 0.5 * 4 * 0.033 = 0.066 ✓
const DIFFUSE = 0.5; // aggressive smoothing keeps energy in long-wavelength modes

// State arrays — (SIM_N1)² elements, indexed [i*SIM_N1 + j]
export const sweH = new Float32Array(SIM_N1 * SIM_N1); // height perturbation
const sweU = new Float32Array(SIM_N1 * SIM_N1); // i-velocity
const sweV = new Float32Array(SIM_N1 * SIM_N1); // j-velocity
// Per-step temporaries — avoids allocating per frame
const tmpH = new Float32Array(SIM_N1 * SIM_N1);
const tmpU = new Float32Array(SIM_N1 * SIM_N1);
const tmpV = new Float32Array(SIM_N1 * SIM_N1);

function idx(i: number, j: number) {
  return i * SIM_N1 + j;
}

/**
 * Inject a splash impulse centred at sim-grid coordinates (simI, simJ).
 * Negative strength creates a dip + outward radial flow → ripple ring.
 * simI, simJ are in [0, SIM_N]; the caller maps from screen/iso coords.
 */
export function sweSplash(simI: number, simJ: number, strength: number) {
  const ri = Math.round(simI);
  const rj = Math.round(simJ);
  const r = 3;
  for (let di = -r; di <= r; di++) {
    for (let dj = -r; dj <= r; dj++) {
      const ii = ri + di;
      const jj = rj + dj;
      if (ii < 0 || ii >= SIM_N1 || jj < 0 || jj >= SIM_N1) continue;
      const dist = Math.sqrt(di * di + dj * dj);
      if (dist > r) continue;
      const w = 1 - dist / r;
      sweH[idx(ii, jj)] += strength * w;
      if (dist > 0.01) {
        const inv = 1 / dist;
        sweU[idx(ii, jj)] += di * inv * strength * 0.25 * w;
        sweV[idx(ii, jj)] += dj * inv * strength * 0.25 * w;
      }
    }
  }
}

/**
 * Apply a linear height ramp across the whole grid to seed a slow slosh.
 * iAmp tilts along the i-axis, jAmp along the j-axis (both in pixels at scale=1).
 * The pressure gradient immediately accelerates fluid toward the low side and
 * the resulting wave bounces back and forth — natural rocking without chaotic noise.
 */
export function sweInitSlosh(iAmp: number, jAmp: number) {
  for (let i = 0; i <= SIM_N; i++) {
    for (let j = 0; j <= SIM_N; j++) {
      sweH[idx(i, j)] += iAmp * (i / SIM_N - 0.5) + jAmp * (j / SIM_N - 0.5);
    }
  }
}

/** Advance simulation by dt seconds (clamped to 33 ms for stability). */
export function sweStep(dt: number) {
  const t = Math.min(dt, 0.033);
  const gT = GRAVITY * t;
  const HT = MEAN_H * t;
  const dT = DIFFUSE * t;

  // Interior update: central-difference spatial gradients, forward-Euler time.
  // Drag is per-cell and amplitude-dependent: gentle at low h (eternal sloshing),
  // aggressive at high h (breaks peaks, prevents chaotic spikes).
  for (let i = 1; i < SIM_N; i++) {
    for (let j = 1; j < SIM_N; j++) {
      const k = idx(i, j);
      const ampF = Math.abs(sweH[k]) / SWE_MAX_AMP;
      const dFac = Math.max(0, 1 - (DRAG_BASE + DRAG_PEAK * ampF * ampF) * t);
      // Laplacian of h — smooths sharp spikes into broad waves
      const lap =
        sweH[idx(i - 1, j)] +
        sweH[idx(i + 1, j)] +
        sweH[idx(i, j - 1)] +
        sweH[idx(i, j + 1)] -
        4 * sweH[k];
      tmpH[k] =
        sweH[k] -
        HT *
          ((sweU[idx(i + 1, j)] - sweU[idx(i - 1, j)]) * 0.5 +
            (sweV[idx(i, j + 1)] - sweV[idx(i, j - 1)]) * 0.5) +
        dT * lap;
      tmpU[k] =
        (sweU[k] - gT * (sweH[idx(i + 1, j)] - sweH[idx(i - 1, j)]) * 0.5) *
        dFac;
      tmpV[k] =
        (sweV[k] - gT * (sweH[idx(i, j + 1)] - sweH[idx(i, j - 1)]) * 0.5) *
        dFac;
    }
  }

  // Write back with height clamped
  for (let i = 1; i < SIM_N; i++) {
    for (let j = 1; j < SIM_N; j++) {
      const k = idx(i, j);
      sweH[k] = Math.max(-SWE_MAX_AMP, Math.min(SWE_MAX_AMP, tmpH[k]));
      sweU[k] = tmpU[k];
      sweV[k] = tmpV[k];
    }
  }

  // Neumann BCs: zero normal velocity, copy height to ghost cells
  for (let k = 0; k <= SIM_N; k++) {
    // i-boundaries
    sweH[idx(0, k)] = sweH[idx(1, k)];
    sweH[idx(SIM_N, k)] = sweH[idx(SIM_N - 1, k)];
    sweU[idx(0, k)] = 0;
    sweU[idx(SIM_N, k)] = 0;
    // j-boundaries
    sweH[idx(k, 0)] = sweH[idx(k, 1)];
    sweH[idx(k, SIM_N)] = sweH[idx(k, SIM_N - 1)];
    sweV[idx(k, 0)] = 0;
    sweV[idx(k, SIM_N)] = 0;
  }
}

/**
 * Apply smooth sinusoidal modal forcing across the whole grid each frame.
 * Uses the basin's natural resonant mode shapes — sin(π·i/N) peaks at the
 * centre and is zero at both walls, so it can only excite long-wavelength
 * sloshing, never short-wavelength spikes.  Four modes at incommensurate
 * frequencies produce an aperiodic, axis-neutral pattern with no point peaks.
 */
export function sweApplyModalForcing(amp: number, t: number) {
  const s1i = amp * Math.sin(t * 0.29);   // i mode-1, period ≈ 22 s
  const s1j = amp * Math.sin(t * 0.19);   // j mode-1, period ≈ 33 s
  const s2i = amp * Math.sin(t * 0.41) * 0.45; // i mode-2, period ≈ 15 s
  const s2j = amp * Math.sin(t * 0.37) * 0.45; // j mode-2, period ≈ 17 s
  for (let i = 0; i <= SIM_N; i++) {
    const fi1 = Math.sin(Math.PI       * i / SIM_N);
    const fi2 = Math.sin(2 * Math.PI   * i / SIM_N);
    for (let j = 0; j <= SIM_N; j++) {
      const fj1 = Math.sin(Math.PI     * j / SIM_N);
      const fj2 = Math.sin(2 * Math.PI * j / SIM_N);
      sweH[idx(i, j)] += fi1 * s1i + fj1 * s1j + fi2 * s2i + fj2 * s2j;
    }
  }
}

// 4×4 grid of independent point oscillators — pre-computed at module load.
// Phases spread across >2π so no two sources are in phase with each other.
// Frequencies vary across 0.18–0.54 rad/s (periods 11–35 s) so their beat
// pattern is effectively aperiodic: the eye cannot decompose it into simple tilts.
const _SG      = 4;
const _sgCount = _SG * _SG;
const _sgPhase = new Float32Array(_sgCount);
const _sgFreq  = new Float32Array(_sgCount);
const _sgMi    = new Int32Array(_sgCount);
const _sgMj    = new Int32Array(_sgCount);
for (let gi = 0; gi < _SG; gi++) {
  for (let gj = 0; gj < _SG; gj++) {
    const k      = gi * _SG + gj;
    _sgPhase[k]  = gi * 1.7 + gj * 2.3;            // spread over ~2×2π
    _sgFreq[k]   = 0.18 + gi * 0.07 + gj * 0.05;   // 0.18–0.54 rad/s
    _sgMi[k]     = Math.round((gi + 0.5) * SIM_N / _SG); // evenly spaced, interior
    _sgMj[k]     = Math.round((gj + 0.5) * SIM_N / _SG);
  }
}

/**
 * Apply 16 independent oscillating height impulses across the grid.
 * Each source has a distinct frequency and phase so their superposition is
 * aperiodic and axis-neutral — no visible side-to-side tilting.
 */
export function sweApplySourceGrid(amp: number, t: number) {
  for (let k = 0; k < _sgCount; k++) {
    sweH[idx(_sgMi[k], _sgMj[k])] += amp * Math.sin(t * _sgFreq[k] + _sgPhase[k]);
  }
}

/**
 * Subtract the mean of sweH from every cell so the colour scale stays centred
 * on the actual surface variation rather than drifting with cumulative impulses.
 * Subtracting a constant from h leaves all gradients unchanged, so velocity and
 * wave propagation are completely unaffected.
 */
export function sweNormalizeMean() {
  const N = SIM_N1 * SIM_N1;
  let sum = 0;
  for (let k = 0; k < N; k++) sum += sweH[k];
  const mean = sum / N;
  if (Math.abs(mean) > 0.01) {
    for (let k = 0; k < N; k++) sweH[k] -= mean;
  }
}

/** Reset to still, flat surface — call after drain. */
export function sweReset() {
  sweH.fill(0);
  sweU.fill(0);
  sweV.fill(0);
}
