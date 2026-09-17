/**
 * The parameterised SWE against a FROZEN copy of the original.
 *
 * v1's slop pit is visually tuned — its sloshing is the product of specific
 * constants and a specific integration order — so generalising the sim is only
 * safe if it reproduces the original exactly. The reference below is that
 * original, copied verbatim and frozen.
 *
 * DO NOT "FIX" THE REFERENCE. It is not live code and it is not meant to be
 * good; it is the thing being matched. If it and the real implementation ever
 * disagree, the real one changed and the question is whether that was intended.
 */
import { describe, expect, test } from "bun:test";

import {
  createShallowWater, sweSetWet, sweApplyModalForcing, sweApplySourceGrid, sweInitSlosh,
  sweNormalizeMean, sweReset, sweSplash, sweStep, SWE_DEFAULTS,
} from "./shallow-water";

// ── frozen reference: src/office/slop-pit-fluid.ts as it stood ──────────────

const SIM_N = 40;
const SIM_N1 = SIM_N + 1;
const SWE_MAX_AMP = 18;
const GRAVITY = 30;
const MEAN_H = 1.0;
const DRAG_BASE = 0.012;
const DRAG_PEAK = 2.0;
const DIFFUSE = 0.5;

function makeRef() {
  const sweH = new Float32Array(SIM_N1 * SIM_N1);
  const sweU = new Float32Array(SIM_N1 * SIM_N1);
  const sweV = new Float32Array(SIM_N1 * SIM_N1);
  const tmpH = new Float32Array(SIM_N1 * SIM_N1);
  const tmpU = new Float32Array(SIM_N1 * SIM_N1);
  const tmpV = new Float32Array(SIM_N1 * SIM_N1);
  const idx = (i: number, j: number) => i * SIM_N1 + j;

  const _SG = 4;
  const _sgCount = _SG * _SG;
  const _sgPhase = new Float32Array(_sgCount);
  const _sgFreq = new Float32Array(_sgCount);
  const _sgMi = new Int32Array(_sgCount);
  const _sgMj = new Int32Array(_sgCount);
  for (let gi = 0; gi < _SG; gi++) {
    for (let gj = 0; gj < _SG; gj++) {
      const k = gi * _SG + gj;
      _sgPhase[k] = gi * 1.7 + gj * 2.3;
      _sgFreq[k] = 0.18 + gi * 0.07 + gj * 0.05;
      _sgMi[k] = Math.round((gi + 0.5) * SIM_N / _SG);
      _sgMj[k] = Math.round((gj + 0.5) * SIM_N / _SG);
    }
  }

  return {
    h: sweH, u: sweU, v: sweV,

    splash(simI: number, simJ: number, strength: number) {
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
    },

    initSlosh(iAmp: number, jAmp: number) {
      for (let i = 0; i <= SIM_N; i++) {
        for (let j = 0; j <= SIM_N; j++) {
          sweH[idx(i, j)] += iAmp * (i / SIM_N - 0.5) + jAmp * (j / SIM_N - 0.5);
        }
      }
    },

    step(dt: number) {
      const t = Math.min(dt, 0.033);
      const gT = GRAVITY * t;
      const HT = MEAN_H * t;
      const dT = DIFFUSE * t;
      for (let i = 1; i < SIM_N; i++) {
        for (let j = 1; j < SIM_N; j++) {
          const k = idx(i, j);
          const ampF = Math.abs(sweH[k]) / SWE_MAX_AMP;
          const dFac = Math.max(0, 1 - (DRAG_BASE + DRAG_PEAK * ampF * ampF) * t);
          const lap =
            sweH[idx(i - 1, j)] + sweH[idx(i + 1, j)] +
            sweH[idx(i, j - 1)] + sweH[idx(i, j + 1)] - 4 * sweH[k];
          tmpH[k] =
            sweH[k] -
            HT * ((sweU[idx(i + 1, j)] - sweU[idx(i - 1, j)]) * 0.5 +
                  (sweV[idx(i, j + 1)] - sweV[idx(i, j - 1)]) * 0.5) +
            dT * lap;
          tmpU[k] = (sweU[k] - gT * (sweH[idx(i + 1, j)] - sweH[idx(i - 1, j)]) * 0.5) * dFac;
          tmpV[k] = (sweV[k] - gT * (sweH[idx(i, j + 1)] - sweH[idx(i, j - 1)]) * 0.5) * dFac;
        }
      }
      for (let i = 1; i < SIM_N; i++) {
        for (let j = 1; j < SIM_N; j++) {
          const k = idx(i, j);
          sweH[k] = Math.max(-SWE_MAX_AMP, Math.min(SWE_MAX_AMP, tmpH[k]));
          sweU[k] = tmpU[k];
          sweV[k] = tmpV[k];
        }
      }
      for (let k = 0; k <= SIM_N; k++) {
        sweH[idx(0, k)] = sweH[idx(1, k)];
        sweH[idx(SIM_N, k)] = sweH[idx(SIM_N - 1, k)];
        sweU[idx(0, k)] = 0;
        sweU[idx(SIM_N, k)] = 0;
        sweH[idx(k, 0)] = sweH[idx(k, 1)];
        sweH[idx(k, SIM_N)] = sweH[idx(k, SIM_N - 1)];
        sweV[idx(k, 0)] = 0;
        sweV[idx(k, SIM_N)] = 0;
      }
    },

    modalForcing(amp: number, t: number) {
      const s1i = amp * Math.sin(t * 0.29);
      const s1j = amp * Math.sin(t * 0.19);
      const s2i = amp * Math.sin(t * 0.41) * 0.45;
      const s2j = amp * Math.sin(t * 0.37) * 0.45;
      for (let i = 0; i <= SIM_N; i++) {
        const fi1 = Math.sin(Math.PI * i / SIM_N);
        const fi2 = Math.sin(2 * Math.PI * i / SIM_N);
        for (let j = 0; j <= SIM_N; j++) {
          const fj1 = Math.sin(Math.PI * j / SIM_N);
          const fj2 = Math.sin(2 * Math.PI * j / SIM_N);
          sweH[idx(i, j)] += fi1 * s1i + fj1 * s1j + fi2 * s2i + fj2 * s2j;
        }
      }
    },

    sourceGrid(amp: number, t: number) {
      for (let k = 0; k < _sgCount; k++) {
        sweH[idx(_sgMi[k], _sgMj[k])] += amp * Math.sin(t * _sgFreq[k] + _sgPhase[k]);
      }
    },

    normalizeMean() {
      const N = SIM_N1 * SIM_N1;
      let sum = 0;
      for (let k = 0; k < N; k++) sum += sweH[k];
      const mean = sum / N;
      if (Math.abs(mean) > 0.01) {
        for (let k = 0; k < N; k++) sweH[k] -= mean;
      }
    },

    reset() { sweH.fill(0); sweU.fill(0); sweV.fill(0); },
  };
}

// ── equivalence ────────────────────────────────────────────────────────────

const same = (a: Float32Array, b: Float32Array) => {
  expect(a.length).toBe(b.length);
  // Bit-identical, not approximate: the point is that nothing drifted at all.
  for (let k = 0; k < a.length; k++) {
    if (a[k] !== b[k]) {
      throw new Error(`diverged at ${k}: ${a[k]} vs ${b[k]}`);
    }
  }
};

describe("matches the frozen original at 40×40", () => {
  test("a still basin stays still", () => {
    const ref = makeRef();
    const sim = createShallowWater(40, 40);
    for (let n = 0; n < 20; n++) { ref.step(1 / 60); sweStep(sim, 1 / 60); }
    same(sim.h, ref.h);
    expect([...sim.h].every((x) => x === 0)).toBe(true);
  });

  test("a splash propagates identically for 400 steps", () => {
    const ref = makeRef();
    const sim = createShallowWater(40, 40);
    ref.splash(20, 20, -12);
    sweSplash(sim, 20, 20, -12);
    same(sim.h, ref.h);
    for (let n = 0; n < 400; n++) { ref.step(1 / 60); sweStep(sim, 1 / 60); }
    same(sim.h, ref.h);
    same(sim.u, ref.u);
    same(sim.v, ref.v);
  });

  test("a splash against the CORNER matches — where the BC order shows", () => {
    // Two sequential boundary passes instead of one interleaved loop gives
    // different corner values, and a corner reflects a wave twice.
    const ref = makeRef();
    const sim = createShallowWater(40, 40);
    ref.splash(1, 1, -15);
    sweSplash(sim, 1, 1, -15);
    for (let n = 0; n < 300; n++) { ref.step(1 / 60); sweStep(sim, 1 / 60); }
    same(sim.h, ref.h);
    for (const [i, j] of [[0, 0], [0, 40], [40, 0], [40, 40]] as const) {
      expect(sim.h[i * 41 + j]).toBe(ref.h[i * 41 + j]);
    }
  });

  test("the full per-frame sequence matches over 600 frames", () => {
    const ref = makeRef();
    const sim = createShallowWater(40, 40);
    ref.initSlosh(6, -4);
    sweInitSlosh(sim, 6, -4);
    let t = 0;
    for (let n = 0; n < 600; n++) {
      t += 1 / 60;
      ref.modalForcing(0.05, t);
      sweApplyModalForcing(sim, 0.05, t);
      ref.sourceGrid(0.08, t);
      sweApplySourceGrid(sim, 0.08, t);
      ref.step(1 / 60);
      sweStep(sim, 1 / 60);
      if (n % 30 === 0) { ref.normalizeMean(); sweNormalizeMean(sim); }
      if (n === 200) { ref.splash(12, 28, -9); sweSplash(sim, 12, 28, -9); }
    }
    same(sim.h, ref.h);
    same(sim.u, ref.u);
    same(sim.v, ref.v);
  });

  test("reset clears every field", () => {
    const ref = makeRef();
    const sim = createShallowWater(40, 40);
    ref.splash(20, 20, -12); sweSplash(sim, 20, 20, -12);
    ref.step(1 / 60); sweStep(sim, 1 / 60);
    ref.reset(); sweReset(sim);
    same(sim.h, ref.h);
    same(sim.u, ref.u);
    same(sim.v, ref.v);
  });

  test("the oscillator layout is the original's", () => {
    const ref = makeRef();
    const sim = createShallowWater(40, 40);
    ref.sourceGrid(1, 0.5);
    sweApplySourceGrid(sim, 1, 0.5);
    same(sim.h, ref.h);
  });
});

// ── the generalisation ─────────────────────────────────────────────────────

describe("a rectangular basin", () => {
  test("allocates for its own aspect", () => {
    const sim = createShallowWater(64, 16);
    expect(sim.h.length).toBe(65 * 17);
    expect(sim.ni1).toBe(65);
    expect(sim.nj1).toBe(17);
  });

  test("refuses a grid too small to have an interior", () => {
    expect(() => createShallowWater(1, 8)).toThrow();
  });

  test("stays bounded, and inside the basin, for 2000 steps", () => {
    const sim = createShallowWater(48, 12);
    sweInitSlosh(sim, 8, -8);
    for (let n = 0; n < 2000; n++) {
      sweApplyModalForcing(sim, 0.05, n / 60);
      sweStep(sim, 1 / 60);
    }
    for (const x of sim.h) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Math.abs(x)).toBeLessThanOrEqual(SWE_DEFAULTS.maxAmp + 1e-3);
    }
  });

  test("the walls hold: zero normal velocity on all four edges", () => {
    const sim = createShallowWater(24, 10);
    sweSplash(sim, 12, 5, -14);
    for (let n = 0; n < 100; n++) sweStep(sim, 1 / 60);
    for (let j = 0; j <= sim.nj; j++) {
      expect(sim.u[0 * sim.nj1 + j]).toBe(0);
      expect(sim.u[sim.ni * sim.nj1 + j]).toBe(0);
    }
    for (let i = 0; i <= sim.ni; i++) {
      expect(sim.v[i * sim.nj1 + 0]).toBe(0);
      expect(sim.v[i * sim.nj1 + sim.nj]).toBe(0);
    }
  });

  test("a wave crosses the LONG axis more slowly than the short one", () => {
    // The physical point of sizing the grid per tile: waves must take longer to
    // cross a long pit than a short one, which a fixed square grid cannot say.
    const cross = (ni: number, nj: number) => {
      const sim = createShallowWater(ni, nj);
      sweSplash(sim, 1, Math.round(nj / 2), -16);
      for (let n = 0; n < 4000; n++) {
        sweStep(sim, 1 / 60);
        // first time the far wall feels anything
        if (Math.abs(sim.h[sim.ni * sim.nj1 + Math.round(nj / 2)]) > 0.05) return n;
      }
      return Infinity;
    };
    expect(cross(64, 16)).toBeGreaterThan(cross(16, 16));
  });

  test("a square basin is symmetric under transposing the grid", () => {
    const a = createShallowWater(32, 32);
    const b = createShallowWater(32, 32);
    sweSplash(a, 8, 20, -10);
    sweSplash(b, 20, 8, -10);      // the mirrored splash
    for (let n = 0; n < 200; n++) { sweStep(a, 1 / 60); sweStep(b, 1 / 60); }
    for (let i = 0; i <= 32; i++) {
      for (let j = 0; j <= 32; j++) {
        expect(a.h[i * 33 + j]).toBeCloseTo(b.h[j * 33 + i], 5);
      }
    }
  });
});


// ── the wet mask ───────────────────────────────────────────────────────────

describe("a masked basin", () => {
  /** Wet only where `fn` says; everything else is wall. */
  const masked = (ni: number, nj: number, fn: (i: number, j: number) => boolean) => {
    const sim = createShallowWater(ni, nj);
    sweSetWet(sim, fn);
    return sim;
  };
  const at = (s: ReturnType<typeof createShallowWater>, i: number, j: number) => i * s.nj1 + j;

  test("a full mask is still the unmasked case", () => {
    const sim = masked(20, 20, () => true);
    expect(sim.allWet).toBe(true);
  });

  test("dry vertices never move, however hard the basin is driven", () => {
    const sim = masked(24, 24, (i) => i <= 12);          // right half is wall
    sweInitSlosh(sim, 10, 6);
    sweSplash(sim, 6, 12, -16);
    for (let n = 0; n < 500; n++) {
      sweApplyModalForcing(sim, 0.1, n / 60);
      sweStep(sim, 1 / 60);
      sweNormalizeMean(sim);
    }
    for (let i = 13; i <= 24; i++) {
      for (let j = 0; j <= 24; j++) {
        expect(sim.h[at(sim, i, j)]).toBe(0);
        expect(sim.u[at(sim, i, j)]).toBe(0);
      }
    }
  });

  test("a wall stops a wave crossing it", () => {
    // Two chambers, dry column at i=12 between them.
    const sim = masked(24, 12, (i) => i !== 12);
    sweSplash(sim, 4, 6, -16);
    for (let n = 0; n < 600; n++) sweStep(sim, 1 / 60);
    let far = 0;
    for (let i = 13; i <= 24; i++) for (let j = 0; j <= 12; j++) far = Math.max(far, Math.abs(sim.h[at(sim, i, j)]));
    expect(far).toBe(0);
    let near = 0;
    for (let i = 0; i < 12; i++) for (let j = 0; j <= 12; j++) near = Math.max(near, Math.abs(sim.h[at(sim, i, j)]));
    expect(near).toBeGreaterThan(0.1);
  });

  test("open the wall and the wave crosses — pools merging", () => {
    const sim = masked(24, 12, (i) => i !== 12);
    sweSplash(sim, 4, 6, -16);
    for (let n = 0; n < 200; n++) sweStep(sim, 1 / 60);
    sweSetWet(sim, () => true);                          // the wall comes out
    for (let n = 0; n < 600; n++) sweStep(sim, 1 / 60);
    let far = 0;
    for (let i = 16; i <= 24; i++) for (let j = 0; j <= 12; j++) far = Math.max(far, Math.abs(sim.h[at(sim, i, j)]));
    expect(far).toBeGreaterThan(0.01);
  });

  test("an L-shaped pool stays bounded and finite", () => {
    const sim = masked(30, 30, (i, j) => i <= 14 || j <= 14);
    sweInitSlosh(sim, 8, -8);
    for (let n = 0; n < 3000; n++) {
      sweApplyModalForcing(sim, 0.06, n / 60);
      sweStep(sim, 1 / 60);
      sweNormalizeMean(sim);
    }
    for (let k = 0; k < sim.h.length; k++) {
      expect(Number.isFinite(sim.h[k])).toBe(true);
      // The clamp is applied INSIDE the step and `sweNormalizeMean` runs after
      // it, so a value can sit slightly beyond it by the mean that was removed.
      // That is true of an unmasked basin too; a mask only makes the wet
      // fraction smaller and so the shift larger.
      expect(Math.abs(sim.h[k])).toBeLessThanOrEqual(SWE_DEFAULTS.maxAmp * 1.2);
    }
  });

  test("the mean is taken over the WET part, so a big dry margin cannot skew it", () => {
    const small = masked(20, 20, (i, j) => i <= 4 && j <= 4);
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) small.h[at(small, i, j)] = 5;
    sweNormalizeMean(small);
    expect(small.h[at(small, 2, 2)]).toBeCloseTo(0, 6);
  });

  test("state transfers into a LARGER basin unchanged — a pool growing", () => {
    // The lattice is global, so growing is a sub-rectangle copy: no resampling.
    const before = createShallowWater(12, 12);
    sweSplash(before, 6, 6, -12);
    for (let n = 0; n < 120; n++) sweStep(before, 1 / 60);

    const after = createShallowWater(24, 12);
    for (let i = 0; i <= 12; i++) {
      for (let j = 0; j <= 12; j++) {
        after.h[i * after.nj1 + j] = before.h[i * before.nj1 + j];
        after.u[i * after.nj1 + j] = before.u[i * before.nj1 + j];
        after.v[i * after.nj1 + j] = before.v[i * before.nj1 + j];
      }
    }
    for (let i = 0; i <= 12; i++) {
      for (let j = 0; j <= 12; j++) {
        expect(after.h[i * after.nj1 + j]).toBe(before.h[i * before.nj1 + j]);
      }
    }
    // and the wave runs on into the new space rather than stopping at the seam
    for (let n = 0; n < 400; n++) sweStep(after, 1 / 60);
    let grew = 0;
    for (let i = 18; i <= 24; i++) for (let j = 0; j <= 12; j++) grew = Math.max(grew, Math.abs(after.h[i * after.nj1 + j]));
    expect(grew).toBeGreaterThan(0.01);
  });
});
