import type { GeneratorId } from "../../state/generators.store";
import type { SpriteId } from "../map/types";

export type BuildingStyle = {
  /** Stackable flat-top floor module (verified to tile at FLOOR_LIFT). */
  module: SpriteId;
  /** Roof cap placed on top of the top floor. */
  roof: SpriteId;
  /** Per-district colour identity (Pixi tint). */
  tint: number;
  /** Employees before another plot opens (district spreads outward). */
  empPerBuilding: number;
  /** Employees per added floor (height budget). */
  empPerFloor: number;
  /** Tallest a single building grows. */
  maxFloors: number;
};

// One proven stackable module + roof, recoloured per district for identity.
const MODULE: SpriteId = "buildingTiles_044.png";
const ROOF: SpriteId = "buildingTiles_073.png";

export const BUILDING_STYLES: Record<GeneratorId, BuildingStyle> = {
  // Interns: a wide, low campus — many short buildings (low height ratio).
  intern: {
    module: MODULE,
    roof: ROOF,
    tint: 0xdfe6f0,
    empPerBuilding: 5,
    empPerFloor: 4,
    maxFloors: 3,
  },
  // Vibe coders: a mid-rise quarter, warm pink/red.
  vibe_coder: {
    module: MODULE,
    roof: ROOF,
    tint: 0xff9bb3,
    empPerBuilding: 14,
    empPerFloor: 5,
    maxFloors: 6,
  },
  // 10x devs: glassy downtown skyscrapers — few plots, lots of height.
  "10x_dev": {
    module: MODULE,
    roof: ROOF,
    tint: 0x8ec9ff,
    empPerBuilding: 200,
    empPerFloor: 12,
    maxFloors: 14,
  },
};
