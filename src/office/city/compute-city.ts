import type { GeneratorId } from "../../state/generators.store";
import {
  type BuildingPart,
  composeBuilding,
} from "./building-kits";
import {
  DISTRICT_TUNING,
  districtTier,
  kitFor,
  landmarkKit,
  plotSeed,
  seededTier,
} from "./buildings";
import type { BuildingKit } from "./buildings";
import { generateWorld } from "./generate-world";
import type { Cell, Plot } from "./types";

export type CityBuilding = Cell & {
  district: GeneratorId;
  floors: number;
  /** The district's HQ tower (lead plot, past the landmark milestone). */
  isLandmark: boolean;
  /** Ready-to-render sprite stack (ground → mids → roof → props). */
  parts: BuildingPart[];
  /** Stable React key. */
  key: string;
};

export type CityScene = {
  buildings: CityBuilding[];
};

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

export type PlannedBuilding = {
  plot: Plot;
  kit: BuildingKit;
  floors: number;
  isLandmark: boolean;
  seed: number;
};

/**
 * Plan a district's active buildings for a headcount: which plots are built,
 * the kit each uses (tier-varied per plot, landmark on the lead plot once the
 * milestone is hit), and how tall each grows. New plots open as the count rises
 * (`empPerBuilding`) and the height budget (`empPerFloor`) is spread across
 * them, so the skyline both widens and rises — each tower capped at its kit's
 * `maxFloors`. Deterministic in `count` (seeded by plot position).
 */
export function planDistrict(
  id: GeneratorId,
  count: number,
): PlannedBuilding[] {
  if (count <= 0) return [];
  const tune = DISTRICT_TUNING[id];
  const plots = generateWorld().districts.find((d) => d.id === id)?.plots ?? [];
  if (plots.length === 0) return [];

  const active = clamp(Math.ceil(count / tune.empPerBuilding), 1, plots.length);
  const tier = districtTier(id, count);
  const floorsTotal = Math.ceil(count / tune.empPerFloor);
  const base = Math.floor(floorsTotal / active);
  const extra = floorsTotal % active;

  const planned: PlannedBuilding[] = [];
  for (let i = 0; i < active; i++) {
    const plot = plots[i];
    const seed = plotSeed(plot.mapX, plot.mapY);
    const isLandmark = i === 0 && count >= tune.landmarkAt;
    const kit = isLandmark ? landmarkKit(id) : kitFor(id, seededTier(seed, tier));
    const raw = base + (i < extra ? 1 : 0);
    // Landmark stands a little taller; others get a seeded ±0/1 jitter.
    const bonus = isLandmark ? 2 : (seed >>> 8) % 2;
    const floors = clamp(raw + bonus, 1, kit.maxFloors);
    planned.push({ plot, kit, floors, isLandmark, seed });
  }
  return planned;
}

/** Floor count of each active building in a district (heights only). */
export function districtBuildingFloors(
  id: GeneratorId,
  count: number,
): number[] {
  return planDistrict(id, count).map((b) => b.floors);
}

/**
 * The derived city scene: which buildings exist, where, how tall, and the exact
 * sprite parts to draw. Pure and deterministic in `counts` (stable keys → no
 * remount/flicker).
 */
export function computeCity(
  counts: Partial<Record<GeneratorId, number>>,
): CityScene {
  const buildings: CityBuilding[] = [];
  for (const district of generateWorld().districts) {
    const planned = planDistrict(district.id, counts[district.id] ?? 0);
    planned.forEach((b, i) => {
      buildings.push({
        mapX: b.plot.mapX,
        mapY: b.plot.mapY,
        district: district.id,
        floors: b.floors,
        isLandmark: b.isLandmark,
        parts: composeBuilding(b.kit, b.floors, b.seed),
        key: `b_${district.id}_${i}`,
      });
    });
  }
  return { buildings };
}
