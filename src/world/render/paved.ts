/**
 * World v2 — the paved overlay.
 *
 * One sprite per paved cell, drawn over the terrain in the same band. A road
 * tile is a full 132×99 ground tile, so it covers rather than blends — which is
 * what lets the material underneath survive unchanged and reappear when the
 * road is erased.
 *
 * The frame comes from {@link roadSpriteFor}, so it is chosen by the same mask
 * the connectivity graph reads. `exact: false` picks are kept and counted, not
 * dropped: a substituted tile still faces the right way, and a hole in the
 * middle of a network is worse than a slightly wrong family. The count is what
 * the debug overlay reports.
 */
import { Sprite, type Texture } from "pixi.js";

import { GROUND_FRAME_H, bandOf, cellToWorld, spriteY } from "../iso";
import { RAMP, idx, inBounds, rampDir, rampRise, VOID, type Grid } from "../grid";
import { maskAt } from "../roads/mask";
import { pavedRampFrame } from "../ramp-art";
import { roadSpriteFor, type RoadTable } from "../roads/table";
import type { BandLayer } from "./bands";
import { TILE_BLEED } from "./terrain";

export type PavedLayer = {
  /** Sprite per cell, parallel to the grid; null where unpaved. */
  sprites: (Sprite | null)[];
  /** Frames last applied, so a re-sync can skip an unchanged cell. */
  frames: (string | null)[];
  table: RoadTable;
  scale: number;
  /** Cells drawing a substituted tile — reported, never hidden. */
  inexact: number;
};

export function createPavedLayer(grid: Grid, table: RoadTable, scale = 1): PavedLayer {
  const n = grid.w * grid.h;
  return {
    sprites: new Array(n).fill(null),
    frames: new Array(n).fill(null),
    table,
    scale,
    inexact: 0,
  };
}

/** Reconcile one cell's road sprite: add, re-texture, reposition or remove. */
export function syncPaved(
  pl: PavedLayer,
  bl: BandLayer,
  grid: Grid,
  textures: Record<string, Texture>,
  x: number,
  y: number,
): void {
  if (!inBounds(grid, x, y)) return;
  const i = idx(grid, x, y);
  const existing = pl.sprites[i];

  if (grid.paved[i] === VOID) {
    if (existing) {
      existing.parent?.removeChild(existing);
      existing.destroy();
      pl.sprites[i] = null;
      if (pl.frames[i] !== null) pl.frames[i] = null;
    }
    return;
  }

  // A RAMP cell's road is the tilted paved-ramp tile, not an autotiled flat
  // one. Drawn here in the paved tier, so the terrain underneath is untouched
  // and reappears when the road goes.
  const ramp = rampDir(grid.ramp[i]);
  const pick = ramp !== RAMP.NONE
    ? { frame: pavedRampFrame(ramp, rampRise(grid.ramp[i])), notches: [] as const }
    : roadSpriteFor(pl.table, maskAt(grid, x, y));
  const tex = pick.frame ? textures[pick.frame] : undefined;
  if (!tex) {
    // no art for this mask at all — leave the cell bare so the gap is VISIBLE
    if (existing) {
      existing.parent?.removeChild(existing);
      existing.destroy();
      pl.sprites[i] = null;
    }
    pl.frames[i] = null;
    return;
  }

  let s = existing;
  if (!s) {
    s = new Sprite(tex);
    s.anchor.set(0.5, 1);
    s.roundPixels = true;
    bl.pavedOf[bandOf(x, y)].addChild(s);
    pl.sprites[i] = s;
  } else if (s.texture !== tex) {
    s.texture = tex;
  }
  pl.frames[i] = pick.frame;
  const { wx, wy } = cellToWorld(x, y, grid.height[i], pl.scale);
  s.x = wx;
  // A slope frame is anchored by the STANDARD ground height, not its own: the
  // extra height on a ramp frame is a deeper skirt below the low side, so using
  // the real frame height would push the whole tile down by that much. See
  // GROUND_FRAME_H.
  s.y = spriteY(wy, ramp !== RAMP.NONE ? GROUND_FRAME_H : tex.height, pl.scale);
  s.scale.set(pl.scale * TILE_BLEED);
}

/** Build every paved cell. Only for first paint or a full reload. */
export function buildPaved(
  pl: PavedLayer,
  bl: BandLayer,
  grid: Grid,
  textures: Record<string, Texture>,
): void {
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) syncPaved(pl, bl, grid, textures, x, y);
  }
  recountInexact(pl, grid);
}

/** How many paved cells are drawing a substituted tile, and how many none at all. */
export function recountInexact(pl: PavedLayer, grid: Grid): { inexact: number; missing: number } {
  let inexact = 0, missing = 0;
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      const i = idx(grid, x, y);
      if (grid.paved[i] === VOID) continue;
      if (rampDir(grid.ramp[i]) !== RAMP.NONE) continue;   // drawn by its ramp art
      const pick = roadSpriteFor(pl.table, maskAt(grid, x, y));
      if (!pick.frame) missing++;
      else if (!pick.exact) inexact++;
    }
  }
  pl.inexact = inexact;
  return { inexact, missing };
}

/** How many cells are drawing a baked inner-corner variant. */
export const notchedCount = (pl: PavedLayer) =>
  pl.frames.reduce((n, f) => n + (f?.startsWith("roadCorner_") ? 1 : 0), 0);

export const pavedCount = (pl: PavedLayer) =>
  pl.sprites.reduce((n, s) => n + (s ? 1 : 0), 0);
