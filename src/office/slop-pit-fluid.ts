/**
 * The slop pit's fluid surface — v1's single instance of the shared SWE sim.
 *
 * The simulation itself moved to `src/fluid/shallow-water.ts`, parameterised by
 * grid size and with its state in an object, because World v2 needs one per
 * excavation and at whatever aspect the footprint has. The state arrays living
 * at module scope here is what made a second pit impossible, more than any
 * hardcoded footprint did.
 *
 * This module is now a thin binding: one 40×40 instance, and the same exports
 * v1 already imports. `sweH` is the instance's own array — the same object, not
 * a copy — so `office.tsx` keeps reading live values with no change at all.
 *
 * Behaviour is unchanged, and not merely believed to be: `shallow-water.test.ts`
 * holds a frozen copy of the original and proves the parameterised version
 * bit-identical to it at this size, forcing and splashes included.
 */
import {
  createShallowWater,
  sweApplyModalForcing as applyModalForcing,
  sweApplySourceGrid as applySourceGrid,
  sweInitSlosh as initSlosh,
  sweNormalizeMean as normalizeMean,
  sweReset as reset,
  sweSplash as splash,
  sweStep as step,
  SWE_DEFAULTS,
} from "../fluid/shallow-water";

/** Grid cells per side. */
export const SIM_N = 40;
/** Vertex count per side. */
export const SIM_N1 = SIM_N + 1;

/** Pit depth in HH units (HH = ISO_CELL_STRIDE·scale/4). */
export const PIT_DEPTH_HH = 3;

/** Max surface perturbation in pixels (at scale=1). */
export const SWE_MAX_AMP = SWE_DEFAULTS.maxAmp;

const sim = createShallowWater(SIM_N, SIM_N);

/** Height perturbation, indexed `[i*SIM_N1 + j]`. The sim's own array. */
export const sweH = sim.h;

/**
 * Inject a splash impulse centred at sim-grid coordinates (simI, simJ).
 * Negative strength creates a dip + outward radial flow → ripple ring.
 * simI, simJ are in [0, SIM_N]; the caller maps from screen/iso coords.
 */
export const sweSplash = (simI: number, simJ: number, strength: number) =>
  splash(sim, simI, simJ, strength);

/** Apply a linear height ramp across the whole grid to seed a slow slosh. */
export const sweInitSlosh = (iAmp: number, jAmp: number) => initSlosh(sim, iAmp, jAmp);

/** Advance simulation by dt seconds (clamped to 33 ms for stability). */
export const sweStep = (dt: number) => step(sim, dt);

/** Smooth sinusoidal modal forcing across the whole grid, each frame. */
export const sweApplyModalForcing = (amp: number, t: number) =>
  applyModalForcing(sim, amp, t);

/** Drive the 16 independent point oscillators. */
export const sweApplySourceGrid = (amp: number, t: number) => applySourceGrid(sim, amp, t);

/** Re-centre `sweH` on zero so a colour scale does not drift with impulses. */
export const sweNormalizeMean = () => normalizeMean(sim);

/** Reset to still, flat surface — call after drain. */
export const sweReset = () => reset(sim);
