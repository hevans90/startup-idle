import type { GeneratorId } from "../../state/generators.store";
import {
  type BuildingKit,
  KITS,
  LANDMARK_KITS,
} from "./building-kits";

export type { BuildingKit } from "./building-kits";

/**
 * Per-district growth tuning. `empPerBuilding` spreads the district outward (a
 * new plot opens every N employees); `empPerFloor` is how many employees raise a
 * single tower one floor; `tierUp` are the headcounts at which the district
 * climbs to kit tier 1 / tier 2 (better, taller architecture); `landmarkAt` is
 * when the lead plot becomes the district's HQ landmark.
 *
 * `sharedLiftPer` (optional) makes the WHOLE district rise together: every this
 * many employees, every existing tower gains a floor. Interns/vibe coders sprawl
 * wide so they leave it off, but 10x devs are rare and elite — you'll only ever
 * have a handful — so each one visibly lifts the entire downtown skyline.
 */
export type DistrictTuning = {
  empPerBuilding: number;
  empPerFloor: number;
  tierUp: [number, number];
  landmarkAt: number;
  sharedLiftPer?: number;
};

export const DISTRICT_TUNING: Record<GeneratorId, DistrictTuning> = {
  // Interns: a wide, low campus — many short buildings, upgrades early.
  intern: { empPerBuilding: 5, empPerFloor: 4, tierUp: [40, 120], landmarkAt: 80 },
  // Vibe coders: a mid-rise quarter — opens buildings briskly and rises a touch
  // faster than the intern campus, so it reads as a real district at the modest
  // headcounts vibe coders actually reach (not a couple of 1-floor stubs).
  vibe_coder: { empPerBuilding: 7, empPerFloor: 3, tierUp: [24, 72], landmarkAt: 45 },
  // 10x devs: a boutique downtown. Headcount is tiny but each dev is elite, so
  // it's scaled for the ~1–20 range: a new tower every couple of devs, fast tier
  // upgrades, an early HQ, and a shared lift so every new dev raises the whole
  // skyline. Pair with tall 10x kit `maxFloors` (tune live in the labeller) for
  // a proper skyscraper financial district.
  "10x_dev": {
    empPerBuilding: 2,
    empPerFloor: 2,
    tierUp: [4, 10],
    landmarkAt: 2,
    sharedLiftPer: 3,
  },
};

/**
 * Flavour names per district, indexed by kit tier (0 → 2), plus the HQ landmark.
 * A building's tier comes from {@link seededTier}, so a grown district shows a
 * mix (a few Penthouses among the Lofts). Tunable — purely cosmetic.
 */
export const BUILDING_NAMES: Record<
  GeneratorId,
  { tiers: [string, string, string]; landmark: string }
> = {
  intern: {
    tiers: ["Intern Bullpen", "Intern Block", "Intern Tower"],
    landmark: "Intern HQ",
  },
  vibe_coder: {
    tiers: ["Vibe Garage", "Vibe Lofts", "Vibe Penthouses"],
    landmark: "Vibe Tower",
  },
  "10x_dev": {
    tiers: ["Dev Cabin", "Dev Lab", "Dev Penthouse"],
    landmark: "10x Spire",
  },
};

/** Display name for a building given its kit tier and whether it's the HQ. */
export function buildingName(
  id: GeneratorId,
  tier: number,
  isLandmark: boolean,
): string {
  const names = BUILDING_NAMES[id];
  if (isLandmark) return names.landmark;
  return names.tiers[Math.max(0, Math.min(tier, names.tiers.length - 1))];
}

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
