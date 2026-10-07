/**
 * World v2 — diagonal-band containers.
 *
 * Cells sharing `x + y` render as one horizontal screen band. Within a band
 * neighbours sit exactly TILE_W apart horizontally at identical Y, and no
 * frame in the atlases is wider than 133px, so **no two static sprites in a
 * band can overlap and their draw order is irrelevant**. Between bands, strict
 * `x + y` order is exactly the column-dominant rule v1 encodes in
 * `cityDepthKey` — and it stays correct under elevation, because height moves
 * a tile up the screen but never sideways.
 *
 * What that buys over v1's single sorted container:
 *   - no global re-sort on edit; adding a sprite is one `addChild`
 *   - dirty tracking is per band, so an edit touches three, not 2,240 sprites
 *   - culling is a contiguous band range, i.e. one comparison per band
 *
 * Each band holds tiers in fixed order:
 *   `static`   terrain and roads — never sorted
 *   `structure` buildings and excavations — never sorted, above the ground
 *   `dynamic`  movers at fractional positions — sorted, and always on top
 *
 * Keeping them apart is what lets a static add avoid triggering any sort,
 * while still letting an agent at (5.3, 7.8) interleave correctly.
 */
import { Container } from "pixi.js";

import { bandCount } from "../iso";

export type BandLayer = {
  /** Add this to the viewport. */
  root: Container;
  /** Band wrapper, index = `x + y`. Culled by its chunk. @see chunks */
  bands: Container[];
  /**
   * CONSECUTIVE BANDS, A RENDER GROUP EACH, and what the cull toggles.
   *
   * A band's `visible` is structural: flipped, the renderer rebuilt the
   * instruction list of the group it is in — the whole stage, every terrain
   * sprite of every band on screen — and the cull flipped one on nearly every
   * frame of a zoom or a pan. On a 128 tile map that was 7 to 8 ms of the
   * render call's CPU on every such frame, against 2 with the view still.
   * A band per render group fixed it in principle and hit Pixi's uniform
   * batch ceiling at 1,221 groups. So a group per CHUNK of bands: a chunk
   * flipping touches only the root's short list of chunks, and nothing in
   * one is re-batched because another came or went. The price is drawing up
   * to a chunk's worth of off-screen bands at either edge. @see BAND_CHUNK
   */
  chunks: Container[];
  /**
   * Terrain COLUMNS per band, drawn beneath the static content.
   *
   * A separate tier because a cell's stacked slabs overlap each other and its
   * own top slab — the one place where order within a band is NOT moot. Two
   * cells in a band are a full tile apart and cannot interfere, so putting
   * every column under every top face resolves it without sorting anything.
   */
  cliffOf: Container[];
  /** Unsorted static content per band. */
  staticOf: Container[];
  /**
   * WATER WITH SOMETHING OVER IT, drawn before the thing that is over it.
   *
   * A band's sort key is `x + y` with height deliberately left out, which is
   * sound while a cell holds one surface and stops being sound the moment it
   * holds two. A bridge is the case: the river under a span and the deck over
   * it are the same cell in the same band, and the water drew last — so a
   * channel running full painted itself across the front of the bridge, the
   * deck showing through in teeth where it stood proud of the flood.
   *
   * There is no sorting to do about it, only an order to state: what is under
   * a roof is under the roof. Roofed water goes here, between the terrain and
   * the paving; everything else stays in `structureOf` with the rest of the
   * water. @see fluid/slots
   */
  underOf: Container[];
  /**
   * Paved overlay per band, drawn over the terrain.
   *
   * A road tile is a full ground tile, so it covers the terrain beneath it
   * rather than blending — which is what lets the material underneath stay
   * whatever it was and reappear when the road is erased.
   */
  pavedOf: Container[];
  /**
   * Structures per band, drawn over the ground and the roads.
   *
   * Its own tier for the same reason `pavedOf` has one: a building's sprites
   * are TALL and must cover the ground of their own band, and re-syncing a
   * terrain cell re-appends its sprite, which would otherwise put the ground
   * back on top of whatever stands on it.
   *
   * Unsorted. A structure's own parts are added ground-first so insertion order
   * stacks them correctly, and two structures in one band are a full tile apart
   * horizontally — no frame is wider than 133px — so they cannot interfere
   * however tall they are.
   */
  structureOf: Container[];
  /** Sorted per-band sublist for movers; draws above the static content. */
  dynamicOf: Container[];
  /** How solid the ground is drawn, so {@link setGroundAlpha} can skip a no-op. */
  groundAlpha: number;
  readonly w: number;
  readonly h: number;
  visibleLo: number;
  visibleHi: number;
};

/** Bands to a chunk. @see BandLayer.chunks */
export const BAND_CHUNK = 16;

/** Whether band b is drawn: its chunk is. @see BandLayer.chunks */
export const bandShown = (layer: BandLayer, b: number) =>
  layer.chunks[Math.floor(b / BAND_CHUNK)]?.visible ?? false;

export function createBandLayer(w: number, h: number): BandLayer {
  const n = bandCount(w, h);
  // THE ROOT IS A RENDER GROUP TOO, so moving or zooming the view is one
  // transform on the GPU rather than a new world transform, and a fresh
  // upload, for every sprite on the map. @see chunks
  const root = new Container({ isRenderGroup: true });
  root.sortableChildren = true;
  const chunks: Container[] = [];
  for (let k = 0; k * BAND_CHUNK < n; k++) {
    const chunk = new Container({ isRenderGroup: true });
    chunk.zIndex = k;
    chunk.sortableChildren = true;
    chunks.push(chunk);
    root.addChild(chunk);
  }

  const bands: Container[] = [];
  const cliffOf: Container[] = [];
  const staticOf: Container[] = [];
  const underOf: Container[] = [];
  const pavedOf: Container[] = [];
  const structureOf: Container[] = [];
  const dynamicOf: Container[] = [];

  for (let b = 0; b < n; b++) {
    const band = new Container();
    band.zIndex = b;

    const cliff = new Container();       // columns, under everything in the band
    // The ONE sorted static tier. A cell's stacked slabs must draw shallowest
    // LAST so each hides the next one's diamond; see render/cliffs.
    cliff.sortableChildren = true;
    const st = new Container();          // no sorting: order within a band is moot
    const under = new Container();       // water beneath a deck. @see underOf
    const paved = new Container();   // one sprite per cell, so order is moot
    const structures = new Container();  // tall, so above the ground and roads
    const dyn = new Container();
    dyn.sortableChildren = true;         // movers sort by frac(x + y)

    band.addChild(cliff);                // columns, terrain, roads, builds, movers
    band.addChild(st);
    band.addChild(under);
    band.addChild(paved);
    band.addChild(structures);
    band.addChild(dyn);

    bands.push(band);
    cliffOf.push(cliff);
    staticOf.push(st);
    underOf.push(under);
    pavedOf.push(paved);
    structureOf.push(structures);
    dynamicOf.push(dyn);
    chunks[Math.floor(b / BAND_CHUNK)].addChild(band);
  }
  // Sorted exactly once, at build. Nothing after this re-sorts the world.
  root.sortChildren();
  for (const c of chunks) c.sortChildren();

  return {
    root, bands, chunks, cliffOf, staticOf, underOf, pavedOf, structureOf, dynamicOf,
    w, h, visibleLo: 0, visibleHi: n - 1, groundAlpha: 1,
  };
}

/**
 * Cull to a contiguous band range, inclusive. Clamped to the map.
 *
 * Callers must WIDEN the range by the map's max height before calling: a tall
 * column in a band beyond the plane-projected range can still be on screen,
 * because height lifts it toward the camera.
 *
 * This culls vertically only. Bands span the full map width, so at high zoom a
 * visible band still draws every cell in it; horizontal culling wants a binary
 * search on x within each band and is deferred until maps grow past ~64×64.
 */
export function setVisibleBands(layer: BandLayer, lo: number, hi: number) {
  const n = layer.bands.length;
  const l = Math.max(0, Math.min(n - 1, lo));
  const r = Math.max(0, Math.min(n - 1, hi));
  if (l === layer.visibleLo && r === layer.visibleHi) return;
  // BY CHUNK: a chunk is shown when any of its bands is wanted. @see chunks
  for (let k = 0; k < layer.chunks.length; k++) {
    const vis = (k + 1) * BAND_CHUNK - 1 >= l && k * BAND_CHUNK <= r;
    if (layer.chunks[k].visible !== vis) layer.chunks[k].visible = vis;
  }
  layer.visibleLo = l;
  layer.visibleHi = r;
}

/**
 * Fade the GROUND — the terrain, the cliff columns under it and the paving on
 * top — so that what is buried in it can be seen.
 *
 * The three tiers below the structure tier, and no others, because "see
 * through the ground" is exactly what it says: water and pipework live above
 * them and keep their own strength, so a buried run shows through the hill it
 * is under while a surface one looks as it always did.
 *
 * Per band and only on a change. Alpha on a CONTAINER rather than on each
 * sprite, so a map of four thousand tiles costs three assignments a band and
 * not four thousand — and the cliff columns under a tile go translucent with
 * it, which is what makes a hillside something you can see into rather than a
 * flat pane of glass.
 */
export function setGroundAlpha(layer: BandLayer, alpha: number) {
  if (layer.groundAlpha === alpha) return;
  for (let b = 0; b < layer.bands.length; b++) {
    layer.cliffOf[b].alpha = alpha;
    layer.staticOf[b].alpha = alpha;
    layer.pavedOf[b].alpha = alpha;
  }
  layer.groundAlpha = alpha;
}

/** How many bands are currently drawn. */
export const visibleBandCount = (layer: BandLayer) =>
  layer.visibleHi - layer.visibleLo + 1;

export function destroyBandLayer(layer: BandLayer) {
  layer.root.destroy({ children: true });
  layer.bands.length = 0;
  layer.chunks.length = 0;
  layer.cliffOf.length = 0;
  layer.staticOf.length = 0;
  layer.underOf.length = 0;
  layer.pavedOf.length = 0;
  layer.dynamicOf.length = 0;
}
