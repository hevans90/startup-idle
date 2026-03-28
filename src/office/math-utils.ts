import { inv, Matrix, matrix, multiply } from "mathjs";

import type { TileInstance } from "./map/types";

/**
 * Native tile texture size (flattened isometric diamonds in the Kenney sheets).
 * Grid spacing is derived from these; keep in sync with atlas frame rects.
 */
export const ISO_TILE_WIDTH = 132;
export const ISO_TILE_HEIGHT = 99;

/**
 * Map-axis unit before {@link ISO_WEIGHTS}: one full tile width so each +1 `mapX`
 * / `mapY` shifts anchors by half a tile horizontally (66px at scale 1), matching
 * 132px-wide diamonds with bottom-center anchor.
 */
export const ISO_CELL_STRIDE = ISO_TILE_WIDTH;

/**
 * How far each elevation step `z` moves sprites screen-up (pseudo-vertical).
 * Tuned to {@link ISO_TILE_HEIGHT} for stacked layers.
 */
export const ISO_Z_LIFT_PER_LAYER = ISO_TILE_HEIGHT * 0.5;

/**
 * Must exceed max (mapX + mapY) on the map so elevation dominates draw order.
 * For a 32×32 map, max sum is 62; 1000 leaves room for deep stacks.
 */
export const Z_LAYER_WEIGHT = 1000;

const ISO_WEIGHTS = matrix([
  [0.5, 0.25],
  [-0.5, 0.25],
]);

const INVERSE_ISO = inv(ISO_WEIGHTS) as Matrix;

/** Pixi draw order key: larger = closer to camera / drawn on top. */
export function depthKey(mapX: number, mapY: number, z: number): number {
  return mapX + mapY + z * Z_LAYER_WEIGHT;
}

/**
 * World position (viewport space) for a map cell before wrapper anchoring.
 * z lifts the sprite along the pseudo-vertical (screen-up) in isometric space.
 */
export function mapToWorld(
  mapX: number,
  mapY: number,
  z: number,
  scale: number
): { x: number; y: number } {
  const coordinate = matrix([
    [mapX * ISO_CELL_STRIDE * scale, mapY * ISO_CELL_STRIDE * scale],
  ]);
  const [row] = multiply(coordinate, ISO_WEIGHTS).toArray() as number[][];
  const wx = row[0];
  const wy = row[1];
  const liftPerLayer = ISO_Z_LIFT_PER_LAYER * scale;
  return { x: wx, y: wy - z * liftPerLayer };
}

/**
 * Converts pointer position in viewport world space to tile-plane local space
 * (same frame as mapToWorld output before adding wrapper offsets).
 */
export function viewportWorldToTilePlane(
  viewportWorldX: number,
  viewportWorldY: number,
  wrapperSize: { width: number; height: number }
): { x: number; y: number } {
  return {
    x: viewportWorldX - wrapperSize.width / 2,
    y:
      viewportWorldY -
      wrapperSize.height / 4 +
      ISO_TILE_WIDTH / 2,
  };
}

/** Inverse of the ground (z=0) isometric map; returns integer cell indices. */
export function worldPlaneToMapCell(
  localX: number,
  localY: number,
  scale: number
): { mapX: number; mapY: number } {
  const worldX = localX / (ISO_CELL_STRIDE * scale);
  const worldY = localY / (ISO_CELL_STRIDE * scale);
  const result = multiply(matrix([[worldX, worldY]]), INVERSE_ISO) as Matrix;
  const resultArray = result.toArray() as number[][];
  return {
    mapX: Math.floor(resultArray[0][0]),
    mapY: Math.floor(resultArray[0][1]),
  };
}

/**
 * Top visible tile at the column under the pointer (stack-aware hover).
 */
export function pickTopTileAtPlane(
  tiles: TileInstance[],
  localX: number,
  localY: number,
  scale: number
): { mapX: number; mapY: number; z: number } | null {
  const { mapX, mapY } = worldPlaneToMapCell(localX, localY, scale);
  const stack = tiles.filter((t) => t.mapX === mapX && t.mapY === mapY);
  if (stack.length === 0) return null;
  const z = Math.max(...stack.map((t) => t.z));
  return { mapX, mapY, z };
}
