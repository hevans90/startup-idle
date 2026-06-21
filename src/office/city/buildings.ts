import type { GeneratorId } from "../../state/generators.store";
import {
  type BuildingKit,
  KITS,
  LANDMARK_KITS,
} from "./building-kits";

export type { BuildingKit } from "./building-kits";

/**
 * Per-district growth tuning. `empPerBuilding` spreads the district outward (a
 * new plot opens every N employees); `empPerFloor` is the height budget shared
 * across active plots; `tierUp` are the headcounts at which the district climbs
 * to kit tier 1 / tier 2 (better, taller architecture); `landmarkAt` is when the
 * lead plot becomes the district's HQ landmark.
 */
export type DistrictTuning = {
  empPerBuilding: number;
  empPerFloor: number;
  tierUp: [number, number];
  landmarkAt: number;
};

export const DISTRICT_TUNING: Record<GeneratorId, DistrictTuning> = {
  // Interns: a wide, low campus — many short buildings, upgrades early.
  intern: { empPerBuilding: 5, empPerFloor: 4, tierUp: [40, 120], landmarkAt: 80 },
  // Vibe coders: a mid-rise quarter.
  vibe_coder: { empPerBuilding: 14, empPerFloor: 5, tierUp: [120, 400], landmarkAt: 250 },
  // 10x devs: a downtown core — few plots, lots of height, slow to upgrade.
  "10x_dev": { empPerBuilding: 200, empPerFloor: 12, tierUp: [2000, 10000], landmarkAt: 4000 },
};

/** Highest kit tier (0–2) a district has unlocked at this headcount. */
export function districtTier(id: GeneratorId, count: number): number {
  const [t1, t2] = DISTRICT_TUNING[id].tierUp;
  if (count >= t2) return 2;
  if (count >= t1) return 1;
  return 0;
}

export function kitFor(id: GeneratorId, tier: number): BuildingKit {
  const tiers = KITS[id];
  return tiers[Math.max(0, Math.min(tier, tiers.length - 1))];
}

export function landmarkKit(id: GeneratorId): BuildingKit {
  return LANDMARK_KITS[id];
}

/** Stable per-plot hash (no Math.random) → deterministic variety. */
export function plotSeed(mapX: number, mapY: number): number {
  let h = (mapX * 374761393 + mapY * 668265263) >>> 0;
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
  return h >>> 0;
}

/**
 * Pick a kit tier for one plot: mostly the district's current tier, but a
 * deterministic minority drop a tier (or two) so a grown district reads as a
 * mix of newer towers and older low-rises rather than a row of clones.
 */
export function seededTier(seed: number, maxTier: number): number {
  const r = seed % 100;
  if (r < 60) return maxTier;
  if (r < 88) return Math.max(0, maxTier - 1);
  return Math.max(0, maxTier - 2);
}
