/**
 * World v2 — terrain sprites.
 *
 * One sprite handle per cell, held in an array parallel to the grid, so an
 * edit re-textures or repositions in place. v1 destroys and rebuilds all
 * ~2,240 ground and road sprites whenever any dependency changes, which is
 * fine for a world built once and unusable for an editor.
 *
 * The world sits at its natural coordinates — cell (0,0) at world (0,0) — with
 * no wrapper-size origin. v1 offsets everything by `width/2, height/4`, which
 * couples tile positions to the canvas size and has to be repeated at every
 * call site. Here the camera does that job.
 */
import { Sprite, type Texture } from "pixi.js";

import { cellToWorld, bandOf, spriteY } from "../iso";
import { VOID, idx, inBounds, structureOf, type Grid } from "../grid";
import { structureDef } from "../structures/def";
import type { BandLayer } from "./bands";

/** ~1px overdraw so neighbours hide sub-pixel diamond seams at fractional zoom. */
export const TILE_BLEED = 1.02;

/** Material index → atlas frame name. Index 0 is VOID and must stay unused. */
export type Palette = readonly (string | null)[];

export type TerrainLayer = {
  /** Sprite per cell, parallel to the grid; null where the cell is void. */
  sprites: (Sprite | null)[];
  palette: Palette;
  scale: number;
};

export function createTerrainLayer(grid: Grid, palette: Palette, scale = 1): TerrainLayer {
  return { sprites: new Array(grid.w * grid.h).fill(null), palette, scale };
}

/**
 * Reconcile one cell: add, re-texture, reposition or remove its sprite.
 * Cheap enough to call per edited cell; no band is rebuilt and nothing sorts.
 */
/** Whether a `clearsTerrain` structure stands on this cell. */
export function hidesTerrain(grid: Grid, x: number, y: number): boolean {
  const s = structureOf(grid, x, y);
  return s ? structureDef(s.def)?.clearsTerrain === true : false;
}

export function syncCell(
  tl: TerrainLayer,
  bl: BandLayer,
  grid: Grid,
  textures: Record<string, Texture>,
  x: number,
  y: number,
): void {
  if (!inBounds(grid, x, y)) return;
  const i = idx(grid, x, y);
  const mat = grid.terrain[i];
  // A structure with `clearsTerrain` draws no ground under itself — the pit is
  // a bare void. Suppressed at RENDER time and not in the layer: the material
  // stays whatever it was, so it comes straight back when the structure goes.
  const hidden = hidesTerrain(grid, x, y);
  const frame = mat === VOID || hidden ? null : (tl.palette[mat] ?? null);
  const tex = frame ? textures[frame] : undefined;

  const existing = tl.sprites[i];

  if (!tex) {
    if (existing) {
      existing.parent?.removeChild(existing);
      existing.destroy();
      tl.sprites[i] = null;
    }
    return;
  }

  const { wx, wy } = cellToWorld(x, y, grid.height[i], tl.scale);
  let s = existing;
  if (!s) {
    s = new Sprite(tex);
    s.anchor.set(0.5, 1);          // bottom-centre; spriteY accounts for the skirt
    s.roundPixels = true;
    bl.staticOf[bandOf(x, y)].addChild(s);
    tl.sprites[i] = s;
  } else if (s.texture !== tex) {
    s.texture = tex;
  }
  s.x = wx;
  s.y = spriteY(wy, tex.height, tl.scale);
  s.scale.set(tl.scale * TILE_BLEED);
}

/** Build every cell. Only for first paint or a full reload. */
export function buildTerrain(
  tl: TerrainLayer,
  bl: BandLayer,
  grid: Grid,
  textures: Record<string, Texture>,
): void {
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) syncCell(tl, bl, grid, textures, x, y);
  }
}

/** Reconcile a cell and its four neighbours — the fallout of one edit. */
export function syncCellAndNeighbours(
  tl: TerrainLayer,
  bl: BandLayer,
  grid: Grid,
  textures: Record<string, Texture>,
  x: number,
  y: number,
): void {
  syncCell(tl, bl, grid, textures, x, y);
  syncCell(tl, bl, grid, textures, x - 1, y);
  syncCell(tl, bl, grid, textures, x + 1, y);
  syncCell(tl, bl, grid, textures, x, y - 1);
  syncCell(tl, bl, grid, textures, x, y + 1);
}

/** Number of live sprites — for the debug readout and for tests. */
export const spriteCount = (tl: TerrainLayer) =>
  tl.sprites.reduce((n, s) => n + (s ? 1 : 0), 0);
