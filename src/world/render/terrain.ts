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

import { GROUND_FRAME_H, RAMP, bandOf, cellToWorld, rampDir, rampRise, spriteY } from "../iso";
import { terrainRampFrame } from "../ramp-art";
import { VOID, idx, inBounds, structureOf, type Grid } from "../grid";
import { structureDef } from "../structures/def";
import type { BandLayer } from "./bands";
import { createGroundMesh, flushGround, groundDraws, markGround, type GroundMesh } from "./ground-mesh";

/** ~1px overdraw so neighbours hide sub-pixel diamond seams at fractional zoom. */
export const TILE_BLEED = 1.02;

/** Material index → atlas frame name. Index 0 is VOID and must stay unused. */
export type Palette = readonly (string | null)[];

export type TerrainLayer = {
  /** Sprite per cell, parallel to the grid; null where the cell is void, or the mesh draws it. */
  sprites: (Sprite | null)[];
  palette: Palette;
  scale: number;
  /**
   * THE GROUND, SHADED: grass, dirt and sand drawn by a shader, made at the
   * first build. Null for the sheet's tiles everywhere (`?ground=sprite`, and
   * where there is no canvas). @see createGroundMesh
   */
  ground: GroundMesh | null;
  /** Whether to shade the ground at the first build. */
  shades: boolean;
};

/** Whether the ground is shaded here: in a browser, unless the URL asks for the sheet's. */
export const shadesGround = () =>
  typeof document !== "undefined" && !!document.createElement("canvas").getContext?.("2d")
  && !(typeof location !== "undefined" && /[?&]ground=sprite\b/.test(location.search));

export function createTerrainLayer(grid: Grid, palette: Palette, scale = 1, shades = shadesGround()): TerrainLayer {
  return { sprites: new Array(grid.w * grid.h).fill(null), palette, scale, ground: null, shades };
}

/** Whether the shaded ground draws this cell, so its sprite and its cliff slabs stand down. */
export const meshDraws = (tl: TerrainLayer, grid: Grid, x: number, y: number) =>
  !!tl.ground && groundDraws(grid, tl.palette, x, y);

/**
 * A ground tile's INNER twin: the same tile with its lip and sides painted
 * its top's colour, baked by `bake:padded` for the common ground frames. Zoomed
 * out, a mip level averages a tile's front edge with the darker lip under it —
 * a dark line along every row of a field. Used only where nothing shows that
 * lip anyway. @see covered
 */
export const innerFrame = (frame: string) => frame.replace(/\.png$/, "_inner.png");

/**
 * Whether both tiles in front of a cell — (x+1,y) and (x,y+1) — stand flat, at
 * least as high, and are drawn, so they hide its lip and sides.
 */
export function covered(grid: Grid, x: number, y: number): boolean {
  const h = grid.height[idx(grid, x, y)];
  for (const [nx, ny] of [[x + 1, y], [x, y + 1]] as const) {
    if (!inBounds(grid, nx, ny)) return false;
    const j = idx(grid, nx, ny);
    if (grid.terrain[j] === VOID || grid.height[j] < h || rampDir(grid.ramp[j]) !== RAMP.NONE || hidesTerrain(grid, nx, ny)) return false;
  }
  return true;
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
  // The shaded ground hears of every cell, drawn by it or not: its neighbours blend toward it.
  if (tl.ground) markGround(tl.ground, grid, tl.palette, x, y);
  if (meshDraws(tl, grid, x, y)) {
    const old = tl.sprites[i];
    if (old) { old.parent?.removeChild(old); old.destroy(); tl.sprites[i] = null; }
    return;
  }
  const mat = grid.terrain[i];
  // A structure with `clearsTerrain` draws no ground under itself — the pit is
  // a bare void. Suppressed at RENDER time and not in the layer: the material
  // stays whatever it was, so it comes straight back when the structure goes.
  const hidden = hidesTerrain(grid, x, y);
  // A SLOPED cell draws the tilted ground tile instead of the flat one. The
  // ramp layer used to affect only the paved renderer, so a hillside could be
  // stepped but never sloped — see edit/slope.
  const ramp = rampDir(grid.ramp[i]);
  const frame = mat === VOID || hidden
    ? null
    : (ramp !== RAMP.NONE
        ? terrainRampFrame(ramp, rampRise(grid.ramp[i])) ?? (tl.palette[mat] ?? null)
        : (tl.palette[mat] ?? null));
  const tex = frame
    ? (ramp === RAMP.NONE && covered(grid, x, y) && textures[innerFrame(frame)]) || textures[frame]
    : undefined;

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
  // A slope frame is anchored by the STANDARD ground height, not its own: the
  // extra height on one is a deeper skirt below its low side. See GROUND_FRAME_H.
  s.y = spriteY(wy, ramp !== RAMP.NONE ? GROUND_FRAME_H : tex.height, tl.scale);
  s.scale.set(tl.scale * TILE_BLEED);
}

/** Build every cell. Only for first paint or a full reload. */
export function buildTerrain(
  tl: TerrainLayer,
  bl: BandLayer,
  grid: Grid,
  textures: Record<string, Texture>,
): void {
  if (tl.shades && !tl.ground) tl.ground = createGroundMesh(grid, bl, tl.palette, tl.scale);
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) syncCell(tl, bl, grid, textures, x, y);
  }
  flushTerrain(tl, grid);
}

/** Send the shaded ground what the syncs since the last flush changed. Once after a batch of {@link syncCell}s. */
export function flushTerrain(tl: TerrainLayer, grid: Grid): void {
  if (tl.ground) flushGround(tl.ground, grid, tl.palette);
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
