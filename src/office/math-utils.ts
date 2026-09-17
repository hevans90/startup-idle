import type { TileInstance } from "./map/types";
import {
  ISO_TILE_WIDTH,
  Z_LAYER_WEIGHT,
  worldPlaneToMapCell,
} from "../iso/projection";

// Phase 0: moved to `src/iso/`. Re-exported here so v1 call sites are unchanged.
export {
  ISO_TILE_WIDTH,
  ISO_TILE_HEIGHT,
  ISO_CELL_STRIDE,
  ISO_Z_LIFT_PER_LAYER,
  Z_LAYER_WEIGHT,
  FLOOR_LIFT,
  cityDepthKey,
  mapToWorld,
  stackedWorldY,
  worldPlaneToMapCell,
} from "../iso/projection";

/** Pixi draw order key: larger = closer to camera / drawn on top. */
export function depthKey(mapX: number, mapY: number, z: number): number {
  return mapX + mapY + z * Z_LAYER_WEIGHT;
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
