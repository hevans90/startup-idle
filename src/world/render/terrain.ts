/**
 * World v2 — the terrain layer: the ground, shaded.
 *
 * Grass, dirt and sand, their walls and their slopes are drawn by one mesh a
 * band from a per-cell data texture (`ground-mesh.ts`); this is the layer the
 * scene holds for it, and what an edit tells of the cells it touched. There
 * are no ground tiles: where there is no canvas to shade on (a test), the
 * ground is not drawn.
 *
 * The world sits at its natural coordinates — cell (0,0) at world (0,0) — with
 * no wrapper-size origin; the camera does that job.
 */
import { structureOf, type Grid } from "../grid";
import { structureDef } from "../structures/def";
import type { BandLayer } from "./bands";
import { createGroundMesh, flushGround, groundDraws, markGround, type GroundMesh } from "./ground-mesh";

/** ~1px overdraw so neighbours hide sub-pixel diamond seams at fractional zoom. */
export const TILE_BLEED = 1.02;

/** Material index → the material's name. Index 0 is VOID and must stay unused. */
export type Palette = readonly (string | null)[];

export type TerrainLayer = {
  palette: Palette;
  scale: number;
  /** The shaded ground, made at the first build; null where there is no canvas. @see createGroundMesh */
  ground: GroundMesh | null;
  /** Whether to shade the ground at the first build. */
  shades: boolean;
};

/** Whether the ground is shaded here: wherever there is a canvas. */
export const shadesGround = () =>
  typeof document !== "undefined" && !!document.createElement("canvas").getContext?.("2d");

export function createTerrainLayer(_grid: Grid, palette: Palette, scale = 1, shades = shadesGround()): TerrainLayer {
  return { palette, scale, ground: null, shades };
}

/** Whether the shaded ground draws this cell. */
export const meshDraws = (tl: TerrainLayer, grid: Grid, x: number, y: number) =>
  !!tl.ground && groundDraws(grid, tl.palette, x, y);

/** Whether a `clearsTerrain` structure stands on this cell. */
export function hidesTerrain(grid: Grid, x: number, y: number): boolean {
  const s = structureOf(grid, x, y);
  return s ? structureDef(s.def)?.clearsTerrain === true : false;
}

/** Tell the ground of one cell that changed. Cheap enough to call per edited cell; {@link flushTerrain} sends the batch. */
export function syncCell(tl: TerrainLayer, grid: Grid, x: number, y: number): void {
  if (tl.ground) markGround(tl.ground, grid, tl.palette, x, y);
}

/** Build every cell. Only for first paint or a full reload. */
export function buildTerrain(tl: TerrainLayer, bl: BandLayer, grid: Grid): void {
  if (tl.shades && !tl.ground) tl.ground = createGroundMesh(grid, bl, tl.palette, tl.scale);
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) syncCell(tl, grid, x, y);
  }
  flushTerrain(tl, grid);
}

/** Send the shaded ground what the syncs since the last flush changed. Once after a batch of {@link syncCell}s. */
export function flushTerrain(tl: TerrainLayer, grid: Grid): void {
  if (tl.ground) flushGround(tl.ground, grid, tl.palette);
}
