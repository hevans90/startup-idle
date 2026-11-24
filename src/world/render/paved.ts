/**
 * World v2 — the paved overlay.
 *
 * One sprite per paved cell, drawn over the ground in the same band, its
 * texture painted in code for the cell's look and its neighbours' edges
 * (`road-paint.ts`). The ground underneath survives unchanged and reappears
 * when the road is erased. Where there is no canvas to paint on (a test),
 * roads are not drawn.
 */
import { Sprite, type RenderGroup, type Renderer, type Texture } from "pixi.js";

import { GROUND_FRAME_H, bandOf, cellToWorld, spriteY } from "../iso";
import { keyOf, looksOf, type Look } from "../roads/looks";
import { createRoadPainter, LOD_RES, planeOf, type CellPaint, type RoadPainter } from "./road-paint";
import { idx, inBounds, surfaceHeightAt, VOID, type Grid } from "../grid";
import type { BandLayer } from "./bands";
import { road, roadCorner } from "./drawn";
import { groundMode } from "./ground-mode";
import { SNOW_STEPS } from "./snow-cover";

/** Whether a cell's road lies on the continuous surface, through its drawn corners, and is not a level block or a ramp's plane. @see drawn.ts roadCorner */
const lies = (grid: Grid, x: number, y: number) => groundMode() === "smooth" && road(grid, x, y);
/** The height a cell's road sprite is put at: its surface's, or on the continuous surface its lowest corner. */
function baseOf(grid: Grid, x: number, y: number): number {
  if (!lies(grid, x, y)) return surfaceHeightAt(grid, x, y);
  return Math.min(roadCorner(grid, x, y), roadCorner(grid, x + 1, y), roadCorner(grid, x + 1, y + 1), roadCorner(grid, x, y + 1));
}
/**
 * A cell's road surface over `z`: its ramp's plane; or on the continuous surface its four corners (@see CellPaint.zc),
 * each as the ground's mesh has it, so the tile is painted on just what is drawn under it.
 */
export function planeAt(grid: Grid, x: number, y: number, ramp: number, z: number): Pick<CellPaint, "z0" | "zu" | "zv" | "zc"> {
  if (!lies(grid, x, y)) return planeOf(ramp, surfaceHeightAt(grid, x, y) - z);
  // (To a 48th of a half step: what is the same is keyed the same.)
  const q = (n: number) => Math.round((n - z) * 48) / 48;
  const zc = [q(roadCorner(grid, x, y)), q(roadCorner(grid, x + 1, y)), q(roadCorner(grid, x + 1, y + 1)), q(roadCorner(grid, x, y + 1))] as const;
  // On one plane, as a plane: a level tile, or one that climbs straight.
  if (zc[0] + zc[2] === zc[1] + zc[3]) return { z0: zc[0], zu: zc[1] - zc[0], zv: zc[3] - zc[0] };
  return { z0: zc[0], zu: zc[1] - zc[0], zv: zc[3] - zc[0], zc };
}

export type PavedLayer = {
  /** Sprite per cell, parallel to the grid; null where unpaved. */
  sprites: (Sprite | null)[];
  /** How much snow lies on the roads, in steps of {@link SNOW_STEPS}: painted into every tile. @see snowPaved */
  snow: number;
  /** The look last painted for each cell, as its key. */
  frames: (string | null)[];
  scale: number;
  /** ROADS PAINTED IN CODE, or null wherever there is no canvas to paint on. @see createRoadPainter */
  painter: RoadPainter | null;
  /** Every cell's look, as last worked out. @see refreshLooks */
  looks: (Look | null)[];
  /** The street's level and its zebras, per cell. @see dressPaved */
  dress: Uint8Array | undefined;
  /** Where the parking bays are, per cell, as the lanes have them: set by the scene. @see agents/lanes/graph bayMarksOf */
  bays?: (grid: Grid) => Uint16Array | undefined;
  /** Whether tiles are still waiting to be painted with the snow as it is now. @see snowPaved */
  snowing?: boolean;
  /** Each cell's level of detail, as its sprite draws it now. @see lodPaved */
  lod: Uint8Array;
  /** The level wanted on screen, as last asked for. */
  lodWant: number;
  /** The view it was wanted for, so a cell laid in it is painted at that level straight away. */
  lodView: View | null;
  /** Since when each closer level has had nothing drawing it, ms; undefined while it is drawn. @see evictUnused */
  lodIdle: (number | undefined)[];
  /** Looks drawn by something other than a cell's own sprite — a road being built, shown as the road it will be — kept as a cell's are. @see plannedTile */
  ghost?: Set<string>;
};

type View = { left: number; top: number; right: number; bottom: number };

/** Whether roads are painted here: wherever there is a canvas. */
export const paintsRoads = () =>
  typeof document !== "undefined" && !!document.createElement("canvas").getContext?.("2d");

export function createPavedLayer(grid: Grid, scale = 1, renderer?: Renderer, painter: RoadPainter | null = renderer && paintsRoads() ? createRoadPainter(renderer) : null): PavedLayer {
  const n = grid.w * grid.h;
  return {
    sprites: new Array(n).fill(null),
    snow: 0,
    frames: new Array(n).fill(null),
    scale,
    painter,
    looks: [],
    dress: undefined,
    lod: new Uint8Array(n),
    lodWant: 0,
    lodView: null,
    lodIdle: [],
  };
}

/** Whether two looks are the same look: every part of each. */
function sameLook(a: Look | null | undefined, b: Look | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  // (Field by field, by name: gone over for every cell of the map after an edit of its roads.)
  return a.open === b.open && a.diag === b.diag && a.ramp === b.ramp && a.lvl === b.lvl && a.vr === b.vr && a.ctr === b.ctr && a.mk === b.mk
    && a.wx === b.wx && a.gw === b.gw && a.stop === b.stop && a.arrow === b.arrow && a.box === b.box && a.yl === b.yl && a.zz === b.zz
    && a.zeb === b.zeb && a.xing === b.xing && a.slow === b.slow && a.rb === b.rb && a.bay === b.bay && a.spd === b.spd;
}

/**
 * Work out every cell's look again: before syncing cells after an edit. The
 * cells whose parking bays or lane markings changed — a street's lay-bys can
 * move along it, and its lanes' markings change the length of it, out of an
 * edit's reach — to sync too.
 */
export function refreshLooks(pl: PavedLayer, grid: Grid): number[] {
  if (!pl.painter) return [];
  const old = pl.looks;
  pl.looks = looksOf(grid, pl.dress, pl.bays?.(grid));
  const changed: number[] = [];
  // (Any of a cell's look, not only its bays and its lines: the lanes it is read from may have been built since. @see deferLanes)
  if (old.length === pl.looks.length) for (let i = 0; i < old.length; i++) if (!sameLook(old[i], pl.looks[i])) changed.push(i);
  return changed;
}

/**
 * A street's level or a zebra changed: the cells whose look did are painted
 * again. `dress` is per cell. @see dressOf
 */
export function dressPaved(pl: PavedLayer, bl: BandLayer, grid: Grid, dress: Uint8Array): void {
  if (!pl.painter) return;
  if (pl.dress && pl.dress.length === dress.length && pl.dress.every((v, i) => v === dress[i])) { pl.dress = dress; return; }
  pl.dress = dress;
  refreshLooks(pl, grid);
  for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) syncPaved(pl, bl, grid, x, y);
}

/** Looks with nothing painted on their surfaces: the road as it is laid, before it is lined. */
export const unlinedLooks = (looks: readonly (Look | null)[]): (Look | null)[] =>
  looks.map((l) => (l ? { ...l, ctr: "", mk: "", gw: "", stop: "", arrow: "", box: 0, yl: false, zz: "", zeb: "", xing: "", slow: "", bay: "", spd: "" } : l));

/**
 * THE TILE A CELL WILL BE, for a road still being built: its texture from the
 * same painter as the roads that stand, off `looks` — those of the map as it
 * will be, whole or with nothing yet painted on them ({@link unlinedLooks}) —
 * and where its sprite goes. Null where there is no painter or no road planned there.
 * @see roads/jobs plannedGrid, render/road-works
 */
export function plannedTile(pl: PavedLayer, planned: Grid, looks: readonly (Look | null)[], x: number, y: number): { tex: Texture; x: number; y: number } | null {
  if (!pl.painter) return null;
  const paint = paintOf(looks, planned, x, y);
  if (!paint) return null;
  (pl.ghost ??= new Set()).add(paint.key);
  const { wx, wy } = cellToWorld(x, y, baseOf(planned, x, y), pl.scale);
  return { tex: pl.painter.textureFor(paint.key, paint.cells, paint.ramp, 0), x: wx, y: spriteY(wy, GROUND_FRAME_H, pl.scale) };
}

/** The cells a cell's texture paints, itself and the neighbours it joins, and their key. */
function paintOf(looks: readonly (Look | null)[], grid: Grid, x: number, y: number, snow = 0): { key: string; cells: CellPaint[]; ramp: boolean; snow: number } | null {
  const L = looks[idx(grid, x, y)];
  if (!L) return null;
  const z = baseOf(grid, x, y);
  const cells: CellPaint[] = [];
  let key = keyOf(L), ramp = L.ramp !== 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const nx = x + dx, ny = y + dy;
    if (!inBounds(grid, nx, ny)) continue;
    const N = dx === 0 && dy === 0 ? L : looks[idx(grid, nx, ny)];
    if (!N) continue;
    if (dx || dy) {
      // Only what it joins: across an open side, or a corner level with it.
      const side = dx < 0 ? 0 : dx > 0 ? 1 : dy < 0 ? 2 : 3;
      const corner = (dx > 0 ? 1 : 0) + (dy > 0 ? 2 : 0);
      if (dx && dy ? !(L.diag & (1 << corner)) || L.ramp || N.ramp : !(L.open & (1 << side))) continue;
    }
    const plane = planeAt(grid, nx, ny, N.ramp, z);
    if (plane.z0 > 0 || plane.zu || plane.zv || plane.zc) ramp = true;
    const zc = plane.zc ? `,${plane.zc.join(",")}` : "";
    // A neighbour's wear is in its middle, never in the margin: leave it out of the key.
    if (dx || dy) key += `|${dx},${dy},${plane.z0},${plane.zu},${plane.zv}${zc}:${keyOf({ ...N, vr: 0 })}`;
    // (And its own: two tiles of one look on two slopes are two textures.)
    else if (plane.z0 || plane.zu || plane.zv || zc) key += `|s${plane.z0},${plane.zu},${plane.zv}${zc}`;
    cells.push({ look: dx || dy ? { ...N, vr: 0 } : N, dx, dy, ...plane });
  }
  // (Whole a little before the ground's is: what is built shows every flake, and a thin cover as one.) Keyed by the
  // strength it is painted at, so two steps that look the same are one tile, painted once.
  const strength = Math.min(1, (snow / SNOW_STEPS) * 1.4);
  if (strength) key += `|❄${Math.round(strength * 100)}`;
  return { key, cells, ramp, snow: strength };
}

/**
 * SNOW ON THE ROADS: `step` of {@link SNOW_STEPS} lying, painted into every road's tile over the road — the
 * pavements white, the kerbs still to be seen, the gutters ploughed up, slush in the tyre tracks (@see road-paint
 * paintGroundSnow). Each tile its own key a step, so going back and forth is the painter's cache; the tiles are
 * painted again a few a frame by {@link lodPaved}, each keeping what it had till then.
 */
export function snowPaved(pl: PavedLayer, grid: Grid, step: number): void {
  if (step === pl.snow || !pl.painter) return;
  pl.snow = step;
  pl.snowing = true;
  if (pl.looks.length !== grid.w * grid.h) refreshLooks(pl, grid);
  for (let i = 0; i < pl.sprites.length; i++) {
    if (!pl.sprites[i]) continue;
    pl.frames[i] = paintOf(pl.looks, grid, i % grid.w, (i / grid.w) | 0, step)?.key ?? null;
  }
}

/** Reconcile one cell's road sprite: add, re-texture, reposition or remove. */
export function syncPaved(
  pl: PavedLayer,
  bl: BandLayer,
  grid: Grid,
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

  if (!pl.painter) return;
  if (pl.looks.length !== grid.w * grid.h) refreshLooks(pl, grid);
  const paint = paintOf(pl.looks, grid, x, y, pl.snow);
  if (!paint) return;
  const { wx, wy } = cellToWorld(x, y, baseOf(grid, x, y), pl.scale);
  const sy = spriteY(wy, GROUND_FRAME_H, pl.scale);
  // At the level the screen shows it at, from its first frame: a road laid
  // close up is never drawn blurred and then sharpened.
  pl.lod[i] = pl.lodView && inView(pl, wx, sy, pl.lodView) ? pl.lodWant : 0;
  // UNDER SNOW, its bare road first if its snowy tile is not painted yet, the snow a few tiles a frame after: a
  // winter's map all at once was seconds. @see lodPaved
  let tex = paint.snow ? pl.painter.peek(paint.key, pl.lod[i]) : undefined;
  if (!tex && paint.snow) {
    const bare = paintOf(pl.looks, grid, x, y, 0)!;
    tex = pl.painter.textureFor(bare.key, bare.cells, bare.ramp, pl.lod[i]);
    pl.snowing = true;
  } else tex ??= pl.painter.textureFor(paint.key, paint.cells, paint.ramp, pl.lod[i], paint.snow);
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
      // The map's own level is cheap and always wanted; a closer one waits its turn — and so does a tile the snow
      // has changed, which keeps what it has (the whole map's, all at once, was a hitch).
      if ((lod > 0 || pl.snowing) && performance.now() - t0 > budgetMs) { done = false; continue; }
      const paint = paintOf(pl.looks, grid, i % grid.w, (i / grid.w) | 0, pl.snow);
      if (!paint) continue;
      tex = P.textureFor(paint.key, paint.cells, paint.ramp, lod, paint.snow);
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
    // (And what a road being built is shown as. @see plannedTile)
    if (pl.ghost) for (const k of pl.ghost) own.add(k);
    P.keep(0, own);
    if (want > 0) P.keep(want, close);
    for (let l = 1; l < LOD_RES.length; l++) {
      if (l === want) pl.lodIdle[l] = undefined;
      else pl.lodIdle[l] ??= performance.now();
    }
    pl.snowing = false;
  } else {
    pl.lodIdle[want] = undefined;
    // THE SNOW STILL COMING: the looks no sprite shows any more are let go as it goes, by what the sprites show
    // and not what they are to — else every look is painted beside the one it replaces, and the level's pages,
    // which are never given back, are twice what the town needs for good. @see RoadPainter.keyOf
    if (pl.snowing) {
      const shown = new Set<string>();
      for (const s of pl.sprites) {
        const k = s ? P.keyOf(s.texture) : undefined;
        if (k) shown.add(k);
      }
      if (pl.ghost) for (const k of pl.ghost) shown.add(k);
      P.keep(0, shown);
    }
  }
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
export function buildPaved(pl: PavedLayer, bl: BandLayer, grid: Grid): void {
  refreshLooks(pl, grid);
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) syncPaved(pl, bl, grid, x, y);
  }
}

export const pavedCount = (pl: PavedLayer) =>
  pl.sprites.reduce((n, s) => n + (s ? 1 : 0), 0);
