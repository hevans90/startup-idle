/**
 * SHARED (Phase 0). Bodies moved verbatim from `src/office/**`; the original
 * modules re-export them so v1 call sites are untouched. Do NOT change behaviour
 * here — v2 adds siblings alongside instead.
 */

import { inv, Matrix, matrix, multiply } from "mathjs";

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

/**
 * Column-dominant draw order for stacked city buildings: a cell closer to the
 * camera (larger mapX+mapY) ALWAYS draws over one further back, regardless of
 * height — then `floor` stacks sprites within a single column. This is the
 * inverse weighting of {@link depthKey} (which lets elevation dominate, correct
 * only for sparse terrain overlays, wrong for tall towers).
 */
export function cityDepthKey(
  mapX: number,
  mapY: number,
  floor: number,
): number {
  return (mapX + mapY) * Z_LAYER_WEIGHT + floor;
}

/**
 * Per-floor screen-up lift for stacked building modules. Calibrated to the
 * Kenney flat-top module wall height (≈ ISO_TILE_HEIGHT / 3), so successive
 * floors sit flush instead of floating (the terrain {@link ISO_Z_LIFT_PER_LAYER}
 * is too large for these modules).
 */
export const FLOOR_LIFT = 33;

/** Screen-Y of a building floor stacked on a base at `baseWorldY`. */
export function stackedWorldY(baseWorldY: number, floorIndex: number): number {
  return baseWorldY - floorIndex * FLOOR_LIFT;
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

/* ── v2 additions (the mathjs versions above are untouched) ─────────────── */

/**
 * Closed-form twin of {@link mapToWorld} for the v2 world engine's hot paths.
 * `mapToWorld` allocates a mathjs `matrix` per call, which is fine for v1's
 * one-shot builds but not for per-cell work. Pinned to the original by an
 * equivalence test in `projection.test.ts` — neither may drift.
 */
export function cellToWorldFast(
  mapX: number,
  mapY: number,
  z: number,
  scale: number,
): { x: number; y: number } {
  const s = ISO_CELL_STRIDE * scale;
  return {
    x: (mapX - mapY) * s * 0.5,
    y: (mapX + mapY) * s * 0.25 - z * ISO_Z_LIFT_PER_LAYER * scale,
  };
}

/** Closed-form twin of {@link worldPlaneToMapCell}. */
export function worldPlaneToCellFast(
  localX: number,
  localY: number,
  scale: number,
): { mapX: number; mapY: number } {
  const a = localX / (ISO_CELL_STRIDE * scale * 0.5);
  const b = localY / (ISO_CELL_STRIDE * scale * 0.25);
  return { mapX: Math.floor((a + b) / 2), mapY: Math.floor((b - a) / 2) };
}
