import type { GeneratorId } from "../../state/generators.store";
import type { SpriteId, TileInstance } from "../map/types";

/** A building derived from employee counts; `key` is a stable React key. */
export type PlacedObject = TileInstance & { key: string };

export type BuildingTier = {
  /** Lowest employee count at which this tier's sprite is used. */
  minCount: number;
  spriteId: SpriteId;
};

export type EmployeeBuildingConfig = {
  /** Rectangular block of ground cells this type fills (inclusive bounds). */
  zone: { x0: number; y0: number; x1: number; y1: number };
  /** Employees represented by one structure (aggregation). */
  perStructure: number;
  /** Hard cap on structures drawn (also bounded by zone capacity). */
  maxStructures: number;
  /** Visual tiers, ascending by `minCount`. */
  tiers: BuildingTier[];
};

/** Placed buildings sit on the ground plane (no vertical lift). */
export const EMPLOYEE_PLACEMENT_Z = 0;

/**
 * Per-type campus config. Sprite ids are atlas SubTexture names (see
 * public/isometric_assets/buildings). Zones avoid the road at mapX 9–10 of the
 * default 20×14 map: interns fill the left grass, vibe coders and 10x devs take
 * the right dirt lots (top / bottom).
 */
export const EMPLOYEE_BUILDINGS: Record<GeneratorId, EmployeeBuildingConfig> = {
  intern: {
    zone: { x0: 1, y0: 1, x1: 7, y1: 12 },
    perStructure: 5,
    maxStructures: 40,
    tiers: [
      { minCount: 1, spriteId: "buildingTiles_000.png" },
      { minCount: 25, spriteId: "buildingTiles_008.png" },
      { minCount: 100, spriteId: "buildingTiles_038.png" },
    ],
  },
  vibe_coder: {
    zone: { x0: 13, y0: 1, x1: 18, y1: 6 },
    perStructure: 3,
    maxStructures: 30,
    tiers: [
      { minCount: 1, spriteId: "buildingTiles_017.png" },
      { minCount: 10, spriteId: "buildingTiles_033.png" },
      { minCount: 50, spriteId: "buildingTiles_040.png" },
    ],
  },
  "10x_dev": {
    zone: { x0: 13, y0: 7, x1: 18, y1: 12 },
    perStructure: 2,
    maxStructures: 30,
    tiers: [
      { minCount: 1, spriteId: "buildingTiles_106.png" },
      { minCount: 10, spriteId: "buildingTiles_113.png" },
      { minCount: 50, spriteId: "buildingTiles_085.png" },
    ],
  },
};

/** Highest tier whose `minCount` is satisfied, or null if `count` is below all. */
function tierForCount(
  tiers: BuildingTier[],
  count: number,
): BuildingTier | null {
  let chosen: BuildingTier | null = null;
  for (const tier of tiers) {
    if (count >= tier.minCount) chosen = tier;
  }
  return chosen;
}

function zoneCellCapacity(zone: EmployeeBuildingConfig["zone"]): number {
  return (zone.x1 - zone.x0 + 1) * (zone.y1 - zone.y0 + 1);
}

/**
 * Structures to draw for `count` employees: aggregated by `perStructure`, then
 * clamped by `maxStructures` and the zone's cell capacity.
 */
export function structuresForCount(
  cfg: EmployeeBuildingConfig,
  count: number,
): number {
  if (count <= 0) return 0;
  const aggregated = Math.ceil(count / cfg.perStructure);
  return Math.min(aggregated, cfg.maxStructures, zoneCellCapacity(cfg.zone));
}

/**
 * Deterministic map from employee counts to placed buildings: same counts →
 * identical output (stable keys), so React/Pixi never remount on re-render.
 * Each type fills its zone row-major with its current tier's sprite.
 */
export function computeOfficePlacements(
  counts: Partial<Record<GeneratorId, number>>,
): PlacedObject[] {
  const placements: PlacedObject[] = [];
  for (const id of Object.keys(EMPLOYEE_BUILDINGS) as GeneratorId[]) {
    const cfg = EMPLOYEE_BUILDINGS[id];
    const count = counts[id] ?? 0;
    const tier = tierForCount(cfg.tiers, count);
    if (!tier) continue;

    const structures = structuresForCount(cfg, count);
    const width = cfg.zone.x1 - cfg.zone.x0 + 1;
    for (let i = 0; i < structures; i++) {
      placements.push({
        mapX: cfg.zone.x0 + (i % width),
        mapY: cfg.zone.y0 + Math.floor(i / width),
        z: EMPLOYEE_PLACEMENT_Z,
        spriteId: tier.spriteId,
        key: `emp_${id}_${i}`,
      });
    }
  }
  return placements;
}
