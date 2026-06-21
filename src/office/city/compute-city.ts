import type { GeneratorId } from "../../state/generators.store";
import {
  type BuildingPart,
  composeBuilding,
  GROUND_PROPS,
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
import { cellKey, type Cell, type Plot } from "./types";
import type { SpriteId } from "../map/types";

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

/** A ground decoration (tree / planter) on an unbuilt plot. */
export type CityProp = Cell & {
  spriteId: SpriteId;
  /** Stable React/sprite key. */
  key: string;
};

export type CityScene = {
  buildings: CityBuilding[];
  props: CityProp[];
};

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

/** Share of eligible unbuilt plots that get a ground prop. */
const GROUND_PROP_DENSITY = 30; // percent

/**
 * Ground props (trees) draw in the raised layer and their sprite spills
 * DOWN-SCREEN (toward +x / +y, the camera-facing corner). To guarantee a tree
 * never laps onto a road and is never tucked behind a building in front of it,
 * those three down-screen cells must be clear of both roads and buildings.
 */
function spillCellsClear(
  x: number,
  y: number,
  roads: Set<string>,
  built: Set<string>,
): boolean {
  for (const [nx, ny] of [
    [x + 1, y],
    [x, y + 1],
    [x + 1, y + 1],
  ]) {
    const k = cellKey(nx, ny);
    if (roads.has(k) || built.has(k)) return false;
  }
  return true;
}

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
  // District-wide lift: every tower rises as the whole district grows (used by
  // 10x devs so each rare hire visibly raises the skyline). Monotonic in count.
  const sharedLift = tune.sharedLiftPer
    ? Math.floor(count / tune.sharedLiftPer)
    : 0;

  const planned: PlannedBuilding[] = [];
  for (let i = 0; i < active; i++) {
    const plot = plots[i];
    const seed = plotSeed(plot.mapX, plot.mapY);
    const isLandmark = i === 0 && count >= tune.landmarkAt;
    const kit = isLandmark ? landmarkKit(id) : kitFor(id, seededTier(seed, tier));
    // Per-building MONOTONIC height: a function of the headcount past this
    // plot's opening threshold (`i * empPerBuilding`), plus the shared district
    // lift — so a building never loses floors when the company grows or a new
    // plot opens. (The old even "spread a total budget across active plots"
    // split redistributed floors as `active` changed, making towers visibly
    // steal floors from one another.)
    const grown =
      1 +
      Math.floor(Math.max(0, count - i * tune.empPerBuilding) / tune.empPerFloor) +
      sharedLift;
    // Landmark stands a little taller; others get a seeded, stable ±0/1 jitter
    // (constant per plot, so it doesn't break monotonicity).
    const bonus = isLandmark ? 2 : (seed >>> 8) % 2;
    const floors = clamp(grown + bonus, 1, kit.maxFloors);
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
  const world = generateWorld();
  const buildings: CityBuilding[] = [];
  const props: CityProp[] = [];

  // First pass: place every district's buildings and record their cells, so
  // ground-prop placement (second pass) can avoid being occluded by any building
  // — including ones in neighbouring districts.
  const builtCells = new Set<string>();
  const plannedByDistrict = new Map<GeneratorId, PlannedBuilding[]>();
  for (const district of world.districts) {
    const planned = planDistrict(district.id, counts[district.id] ?? 0);
    plannedByDistrict.set(district.id, planned);
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
      builtCells.add(cellKey(b.plot.mapX, b.plot.mapY));
    });
  }

  // Second pass: scatter ground props on unbuilt plots, sparsely and
  // deterministically, but only where the sprite's down-screen spill stays clear
  // of roads and buildings — so a tree never laps onto a road nor hides behind a
  // building in front of it. They give way to buildings as a district grows.
  if (GROUND_PROPS.length > 0) {
    for (const district of world.districts) {
      const planned = plannedByDistrict.get(district.id)!;
      for (let i = planned.length; i < district.plots.length; i++) {
        const plot = district.plots[i];
        const seed = plotSeed(plot.mapX, plot.mapY);
        if (seed % 100 >= GROUND_PROP_DENSITY) continue;
        if (!spillCellsClear(plot.mapX, plot.mapY, world.roadCells, builtCells))
          continue;
        props.push({
          mapX: plot.mapX,
          mapY: plot.mapY,
          spriteId: GROUND_PROPS[seed % GROUND_PROPS.length],
          key: `p_${district.id}_${i}`,
        });
      }
    }
  }

  return { buildings, props };
}
