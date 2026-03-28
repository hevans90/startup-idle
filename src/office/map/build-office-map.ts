import type { TerrainKey } from "../sprites";
import type { TileInstance } from "./types";

function terrainAtCell(
  mapX: number,
  mapY: number,
  rows: number,
  cols: number
): TerrainKey {
  if (mapX === Math.floor(cols / 2) || mapX === Math.floor(cols / 2) + 4) {
    return "paving";
  }
  if (
    mapX === Math.floor(cols / 2) + 1 ||
    mapX === Math.floor(cols / 2) + 3
  ) {
    return "asphalt";
  }
  if (mapX === Math.floor(cols / 2) + 2) {
    return "road";
  }
  if (mapX < cols / 2 && mapY < rows / 2) {
    return "dark_green_grass";
  }
  return "dirt";
}

/** Demo column: 3 high stack in the garden quadrant (pseudo-3D brick column). */
const DEMO_STACK_ORIGIN = { mapX: 6, mapY: 6 };

/**
 * Builds a flat list of tile instances (ground + optional stacks).
 * Sorting for draw order is handled in the view via depthKey / zIndex.
 */
export function buildOfficeMap(rows: number, cols: number): TileInstance[] {
  const tiles: TileInstance[] = [];

  for (let mapY = 0; mapY < rows; mapY++) {
    for (let mapX = 0; mapX < cols; mapX++) {
      const terrain = terrainAtCell(mapX, mapY, rows, cols);
      tiles.push({ mapX, mapY, z: 0, terrain });
    }
  }

  const { mapX: sx, mapY: sy } = DEMO_STACK_ORIGIN;
  if (sx < cols && sy < rows) {
    tiles.push({
      mapX: sx,
      mapY: sy,
      z: 1,
      terrain: "dirt",
    });
    tiles.push({
      mapX: sx,
      mapY: sy,
      z: 2,
      terrain: "asphalt",
    });
  }

  return tiles;
}
