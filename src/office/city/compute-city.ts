import type { GeneratorId } from "../../state/generators.store";
import { BUILDING_STYLES } from "./buildings";
import { generateWorld } from "./generate-world";
import type { Cell } from "./types";

export type CityBuilding = Cell & {
  district: GeneratorId;
  floors: number;
  /** Stable React key. */
  key: string;
};

export type CityScene = {
  buildings: CityBuilding[];
};

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

/**
 * Floor counts for a district's active buildings, given its employee count.
 * New buildings open as the count grows (`empPerBuilding`) and the total height
 * budget (`empPerFloor`) is spread evenly across them — so the skyline both
 * widens and rises, each tower capped at `maxFloors`.
 */
export function districtBuildingFloors(
  id: GeneratorId,
  count: number,
): number[] {
  if (count <= 0) return [];
  const style = BUILDING_STYLES[id];
  const plots = generateWorld().districts.find((d) => d.id === id)?.plots ?? [];
  const active = clamp(
    Math.ceil(count / style.empPerBuilding),
    1,
    plots.length,
  );
  const floorsTotal = Math.ceil(count / style.empPerFloor);
  const base = Math.floor(floorsTotal / active);
  const extra = floorsTotal % active;

  const floors: number[] = [];
  for (let i = 0; i < active; i++) {
    floors.push(clamp(base + (i < extra ? 1 : 0), 1, style.maxFloors));
  }
  return floors;
}

/**
 * The derived city scene: which buildings exist, where, and how tall. Pure and
 * deterministic in `counts` (stable keys → no remount/flicker).
 */
export function computeCity(
  counts: Partial<Record<GeneratorId, number>>,
): CityScene {
  const buildings: CityBuilding[] = [];
  for (const district of generateWorld().districts) {
    const floorsList = districtBuildingFloors(
      district.id,
      counts[district.id] ?? 0,
    );
    floorsList.forEach((floors, i) => {
      const plot = district.plots[i];
      buildings.push({
        mapX: plot.mapX,
        mapY: plot.mapY,
        district: district.id,
        floors,
        key: `b_${district.id}_${i}`,
      });
    });
  }
  return { buildings };
}
