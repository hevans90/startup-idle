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
import { Sprite, type RenderGroup, type Renderer, type Texture } from "pixi.js";

import { GROUND_FRAME_H, bandOf, cellToWorld, spriteY } from "../iso";
import { keyOf, looksOf, type Look } from "../roads/looks";
import { createRoadPainter, LOD_RES, planeOf, type CellPaint, type RoadPainter } from "./road-paint";
import { RAMP, idx, inBounds, rampDir, rampRise, surfaceHeightAt, VOID, type Grid } from "../grid";
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
  /**
   * ROADS PAINTED IN CODE, or null for the sheet's sprites (`?roads=sprite`,
   * and wherever there is no canvas to paint on). @see createRoadPainter
   */
  painter: RoadPainter | null;
  /** Every cell's look, as last worked out. @see refreshLooks */
  looks: (Look | null)[];
  /** The street's level and its zebras, per cell. @see dressPaved */
  dress: Uint8Array | undefined;
  /** Where the parking bays are, per cell, as the lanes have them: set by the scene. @see agents/lanes/graph bayMarksOf */
  bays?: (grid: Grid) => Uint8Array | undefined;
  /** Each cell's level of detail, as its sprite draws it now. @see lodPaved */
  lod: Uint8Array;
  /** The level wanted on screen, as last asked for. */
  lodWant: number;
  /** The view it was wanted for, so a cell laid in it is painted at that level straight away. */
  lodView: View | null;
  /** Since when each closer level has had nothing drawing it, ms; undefined while it is drawn. @see evictUnused */
  lodIdle: (number | undefined)[];
};

type View = { left: number; top: number; right: number; bottom: number };

/** Whether roads are painted in code here: in a browser, unless the URL asks for the sheet's. */
export const paintsRoads = () =>
  typeof document !== "undefined" && !!document.createElement("canvas").getContext?.("2d")
  && !(typeof location !== "undefined" && /[?&]roads=sprite\b/.test(location.search));

export function createPavedLayer(grid: Grid, table: RoadTable, scale = 1, renderer?: Renderer, painter: RoadPainter | null = renderer && paintsRoads() ? createRoadPainter(renderer) : null): PavedLayer {
  const n = grid.w * grid.h;
  return {
    sprites: new Array(n).fill(null),
    frames: new Array(n).fill(null),
    table,
    scale,
    inexact: 0,
    painter,
    looks: [],
    dress: undefined,
    lod: new Uint8Array(n),
    lodWant: 0,
    lodView: null,
    lodIdle: [],
  };
}

/**
 * Work out every cell's look again: before syncing cells after an edit. The
 * cells whose parking bays changed — a street's lay-bys can move along it, out
 * of an edit's reach — to sync too.
 */
export function refreshLooks(pl: PavedLayer, grid: Grid): number[] {
  if (!pl.painter) return [];
  const old = pl.looks;
  pl.looks = looksOf(grid, pl.dress, pl.bays?.(grid));
  const changed: number[] = [];
  if (old.length === pl.looks.length) for (let i = 0; i < old.length; i++) if ((old[i]?.bay ?? "") !== (pl.looks[i]?.bay ?? "")) changed.push(i);
  return changed;
}

/**
 * A street's level or a zebra changed: the cells whose look did are painted
 * again. `dress` is per cell. @see dressOf
 */
export function dressPaved(pl: PavedLayer, bl: BandLayer, grid: Grid, textures: Record<string, Texture>, dress: Uint8Array): void {
  if (!pl.painter) return;
  if (pl.dress && pl.dress.length === dress.length && pl.dress.every((v, i) => v === dress[i])) { pl.dress = dress; return; }
  pl.dress = dress;
  refreshLooks(pl, grid);
  for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) syncPaved(pl, bl, grid, textures, x, y);
}

/** The cells a cell's texture paints, itself and the neighbours it joins, and their key. */
function paintOf(pl: PavedLayer, grid: Grid, x: number, y: number): { key: string; cells: CellPaint[]; ramp: boolean } | null {
  const L = pl.looks[idx(grid, x, y)];
  if (!L) return null;
  const z = surfaceHeightAt(grid, x, y);
  const cells: CellPaint[] = [];
  let key = keyOf(L), ramp = L.ramp !== 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const nx = x + dx, ny = y + dy;
    if (!inBounds(grid, nx, ny)) continue;
    const N = dx === 0 && dy === 0 ? L : pl.looks[idx(grid, nx, ny)];
    if (!N) continue;
    if (dx || dy) {
      // Only what it joins: across an open side, or a corner level with it.
      const side = dx < 0 ? 0 : dx > 0 ? 1 : dy < 0 ? 2 : 3;
      const corner = (dx > 0 ? 1 : 0) + (dy > 0 ? 2 : 0);
      if (dx && dy ? !(L.diag & (1 << corner)) || L.ramp || N.ramp : !(L.open & (1 << side))) continue;
    }
    const plane = planeOf(N.ramp, surfaceHeightAt(grid, nx, ny) - z);
    if (plane.z0 > 0 || plane.zu || plane.zv) ramp = true;
    // A neighbour's wear is in its middle, never in the margin: leave it out of the key.
    if (dx || dy) key += `|${dx},${dy},${plane.z0},${plane.zu},${plane.zv}:${keyOf({ ...N, vr: 0 })}`;
    cells.push({ look: dx || dy ? { ...N, vr: 0 } : N, dx, dy, ...plane });
  }
  return { key, cells, ramp };
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
    pl.lod[i] = 0;
    return;
  }

  if (pl.painter) {
    if (pl.looks.length !== grid.w * grid.h) refreshLooks(pl, grid);
    const paint = paintOf(pl, grid, x, y);
    if (!paint) return;
    const { wx, wy } = cellToWorld(x, y, surfaceHeightAt(grid, x, y), pl.scale);
    const sy = spriteY(wy, GROUND_FRAME_H, pl.scale);
    // At the level the screen shows it at, from its first frame: a road laid
    // close up is never drawn blurred and then sharpened.
    pl.lod[i] = pl.lodView && inView(pl, wx, sy, pl.lodView) ? pl.lodWant : 0;
    const tex = pl.painter.textureFor(paint.key, paint.cells, paint.ramp, pl.lod[i]);
    let s = existing;
    if (!s) {
      s = new Sprite(tex);
      s.roundPixels = true;
      bl.pavedOf[bandOf(x, y)].addChild(s);
      pl.sprites[i] = s;
    } else if (s.texture !== tex) s.texture = tex;
    s.anchor.set(tex.defaultAnchor?.x ?? 0.5, tex.defaultAnchor?.y ?? 1);
    pl.frames[i] = paint.key;
    s.x = wx;
    // Its frame's bottom where a ground frame's is; no bleed, its margins meet its neighbours'.
    s.y = sy;
    s.scale.set(pl.scale);
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
  // AT THE SURFACE, which for a deck is up in the air with a gap under it.
  // The terrain tier still draws the ground below, so the riverbed and the
  // water on it stay visible either side of a span. @see Grid.deck
  const { wx, wy } = cellToWorld(x, y, surfaceHeightAt(grid, x, y), pl.scale);
  s.x = wx;
  // A slope frame is anchored by the STANDARD ground height, not its own: the
  // extra height on a ramp frame is a deeper skirt below the low side, so using
  // the real frame height would push the whole tile down by that much. See
  // GROUND_FRAME_H.
  s.y = spriteY(wy, ramp !== RAMP.NONE ? GROUND_FRAME_H : tex.height, pl.scale);
  s.scale.set(pl.scale * TILE_BLEED);
}

/** Whether a sprite at `(x, y)` shows in `view`: its frame reaches a tile and a bit either side of its anchor, and up a ramp's pad. */
function inView(pl: PavedLayer, x: number, y: number, view: View) {
  const mx = 80 * pl.scale, up = 150 * pl.scale, down = 20 * pl.scale;
  return x + mx > view.left && x - mx < view.right && y + down > view.top && y - up < view.bottom;
}

/**
 * DETAIL BY ZOOM: the cells on screen drawn at level `want`, the rest at the
 * map's own. `view` is the visible part of the world, in the sprites' space.
 * New textures are painted until `budgetMs` is spent; returns false if any
 * cell is still waiting, so the caller asks again next frame.
 *
 * NOTHING ON SCREEN FLICKERS. A cell waiting for its texture keeps the one it
 * has, whatever level that is. A level is let go only once nothing draws it,
 * and one that has filled its pages paints a new look over one no cell draws
 * any more. @see RoadPainter.keep
 */
export function lodPaved(pl: PavedLayer, grid: Grid, want: number, view: View, budgetMs: number): boolean {
  const P = pl.painter;
  if (!P) return true;
  if (pl.looks.length !== grid.w * grid.h) refreshLooks(pl, grid);
  pl.lodWant = want;
  pl.lodView = view;
  const t0 = performance.now();
  let done = true;
  for (let i = 0; i < pl.sprites.length; i++) {
    const s = pl.sprites[i], key = pl.frames[i];
    if (!s || !key) continue;
    const lod = inView(pl, s.x, s.y, view) ? want : 0;
    let tex = P.peek(key, lod);
    if (!tex) {
      // The map's own level is cheap and always wanted; a closer one waits its turn.
      if (lod > 0 && performance.now() - t0 > budgetMs) { done = false; continue; }
      const paint = paintOf(pl, grid, i % grid.w, (i / grid.w) | 0);
      if (!paint) continue;
      tex = P.textureFor(paint.key, paint.cells, paint.ramp, lod);
    }
    if (s.texture !== tex) s.texture = tex;
    pl.lod[i] = lod;
  }
  // Every cell has what it should: the looks of this level that no cell draws
  // now may be painted over. @see RoadPainter.keep
  // A LEVEL left behind is kept a while, though: zoomed out and back in, it is
  // there still, not painted all over again. @see evictUnused
  if (done) {
    // The map's own level too: a look the streets have since changed out of
    // was kept for good, a page of them every few times the town was dressed.
    const own = new Set<string>(), close = new Set<string>();
    for (let i = 0; i < pl.sprites.length; i++) {
      const key = pl.frames[i];
      if (!key || !pl.sprites[i]) continue;
      if (pl.lod[i] === 0) own.add(key);
      else if (pl.lod[i] === want) close.add(key);
    }
    P.keep(0, own);
    if (want > 0) P.keep(want, close);
    for (let l = 1; l < LOD_RES.length; l++) {
      if (l === want) pl.lodIdle[l] = undefined;
      else pl.lodIdle[l] ??= performance.now();
    }
  } else pl.lodIdle[want] = undefined;
  // Painted this frame, shown this frame. @see RoadPainter.flush
  P.flush();
  return done;
}

/** How long a closer level is kept with nothing drawing it, ms. */
const LOD_KEEP_MS = 30_000;

/**
 * A closer level unused for `LOD_KEEP_MS` let go: its pages kept spare to
 * paint again, not destroyed. Call once a frame.
 */
export function evictUnused(pl: PavedLayer, now = performance.now()): void {
  const P = pl.painter;
  if (!P) return;
  for (let l = 1; l < pl.lodIdle.length; l++) {
    const since = pl.lodIdle[l];
    if (since === undefined || now - since < LOD_KEEP_MS || l === pl.lodWant || pl.lod.includes(l)) continue;
    pl.lodIdle[l] = undefined;
    if (P.evict(l)) rebind(pl);
  }
}

/** The paved sprites' render groups, to rebuild: they may list a page let go. @see RoadPainter.reap */
function rebind(pl: PavedLayer) {
  const groups = new Set<RenderGroup>();
  for (const s of pl.sprites) if (s?.parentRenderGroup) groups.add(s.parentRenderGroup);
  for (const g of groups) g.structureDidChange = true;
}

/** Build every paved cell. Only for first paint or a full reload. */
export function buildPaved(
  pl: PavedLayer,
  bl: BandLayer,
  grid: Grid,
  textures: Record<string, Texture>,
): void {
  refreshLooks(pl, grid);
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) syncPaved(pl, bl, grid, textures, x, y);
  }
  recountInexact(pl, grid);
}

/** How many paved cells are drawing a substituted tile, and how many none at all. */
export function recountInexact(pl: PavedLayer, grid: Grid): { inexact: number; missing: number } {
  // Painted roads have a look for every shape: nothing stands in, nothing is missing.
  if (pl.painter) { pl.inexact = 0; return { inexact: 0, missing: 0 }; }
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
