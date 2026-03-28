import type { TerrainKey } from "../sprites";

/** One placed tile in map space; z=0 is ground, higher z stacks upward (screen-up). */
export type TileInstance = {
  mapX: number;
  mapY: number;
  z: number;
  terrain: TerrainKey;
};
