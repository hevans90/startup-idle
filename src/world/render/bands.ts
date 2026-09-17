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
  /** Band wrapper, index = `x + y`. Toggle `.visible` to cull. */
  bands: Container[];
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

export function createBandLayer(w: number, h: number): BandLayer {
  const n = bandCount(w, h);
  const root = new Container();
  root.sortableChildren = true;

  const bands: Container[] = [];
  const cliffOf: Container[] = [];
  const staticOf: Container[] = [];
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
    const paved = new Container();   // one sprite per cell, so order is moot
    const structures = new Container();  // tall, so above the ground and roads
    const dyn = new Container();
    dyn.sortableChildren = true;         // movers sort by frac(x + y)

    band.addChild(cliff);                // columns, terrain, roads, builds, movers
    band.addChild(st);
    band.addChild(paved);
    band.addChild(structures);
    band.addChild(dyn);

    bands.push(band);
    cliffOf.push(cliff);
    staticOf.push(st);
    pavedOf.push(paved);
    structureOf.push(structures);
    dynamicOf.push(dyn);
    root.addChild(band);
  }
  // Sorted exactly once, at build. Nothing after this re-sorts the world.
  root.sortChildren();

  return {
    root, bands, cliffOf, staticOf, pavedOf, structureOf, dynamicOf,
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
  for (let b = 0; b < n; b++) {
    const vis = b >= l && b <= r;
    if (layer.bands[b].visible !== vis) layer.bands[b].visible = vis;
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
  layer.cliffOf.length = 0;
  layer.staticOf.length = 0;
  layer.pavedOf.length = 0;
  layer.dynamicOf.length = 0;
}
