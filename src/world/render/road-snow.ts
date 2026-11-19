/**
 * SNOW ON THE ROADS: the pavements and verges under it, and the carriageway along the way it goes trodden and
 * driven to grey slush — a Graphics a band, over that band's roads (@see paved), on each cell's own surface, faded
 * in by the snow lying (@see snow-cover). Drawn while snow lies, again when the roads change; nothing at all with
 * none. On the continuous surface only, as the ground's snow is.
 */
import { Graphics } from "pixi.js";

import { HEIGHT_UNIT, HH, HW, bandOf } from "../iso";
import type { Look } from "../roads/looks";
import type { BandLayer } from "./bands";
import { idx, VOID, type Grid } from "../grid";
import { planeAt } from "./paved";
import { fadeWithSnow } from "./snow-cover";

/** The snow, and the slush where the wheels and feet go: as much of the road as the carriageway is wide. */
const SNOW = 0xeef2f6, SLUSH = 0x8f9297, SLUSH_A = 0.85, HALF = 0.21, OVER = 0.04;

export type RoadSnow = { bands: (Graphics | null)[]; drawn: unknown; rev: number; on: boolean; at: number };

export const createRoadSnow = (): RoadSnow => ({ bands: [], drawn: null, rev: -1, on: false, at: -Infinity });

/** Each side's way out of a cell, as (du, dv): the bits of `Look.open`. @see roads/looks sideOf */
const OUT: readonly [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];

/**
 * Bring the roads' snow to now (`now`, ms): `lying` whether any lies; `looks` the roads' looks (a new list when
 * they change). Drawn again when the roads do, or the snow comes or goes — and when the map has, looked at every
 * couple of seconds (its count moves for much besides the roads).
 */
export function syncRoadSnow(rs: RoadSnow, bl: BandLayer, grid: Grid, looks: readonly (Look | null)[], lying: boolean, scale: number, now: number): void {
  if (!lying) {
    if (rs.on) { for (const g of rs.bands) g?.clear(); rs.on = false; rs.drawn = null; }
    return;
  }
  if (rs.on && rs.drawn === looks && (rs.rev === grid.rev || now - rs.at < 2000)) return;
  rs.on = true; rs.drawn = looks; rs.rev = grid.rev; rs.at = now;
  for (const g of rs.bands) g?.clear();
  const bandFor = (b: number) => {
    let g = rs.bands[b];
    if (!g || g.destroyed) {
      g = rs.bands[b] = new Graphics();
      g.context.batchMode = "batch";
      g.eventMode = "none";
      fadeWithSnow(g);
    }
    // (Over the band's roads, whatever was put in after it.)
    const parent = bl.pavedOf[b];
    if (g.parent !== parent || parent.children[parent.children.length - 1] !== g) parent.addChild(g);
    return g;
  };
  for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) {
    const i = idx(grid, x, y), L = looks[i];
    if (grid.paved[i] === VOID || !L) continue;
    const pl = planeAt(grid, x, y, L.ramp, 0), zc = pl.zc;
    // The surface at (a, b) across the cell, each from -½ to ½: between its four corners.
    const cz = [0, 1, 2, 3].map((k) => (zc ? zc[k] : pl.z0 + (k === 1 || k === 2 ? pl.zu : 0) + (k >= 2 ? pl.zv : 0)));
    const P = (a: number, b: number): number[] => {
      const s = a + 0.5, t = b + 0.5;
      const z = cz[0] * (1 - s) * (1 - t) + cz[1] * s * (1 - t) + cz[2] * s * t + cz[3] * (1 - s) * t;
      const u = x + a, v = y + b;
      return [(u - v) * HW * scale, (u + v) * HH * scale - z * HEIGHT_UNIT * scale];
    };
    const g = bandFor(bandOf(x, y));
    // (A little over the cell: over the road's kerb drawn into its margin, and over the next band's edge — a seam
    // there showed the road through it. Where two overlap it is whiter for a moment, as the snow comes and goes.)
    const E = 0.5 + OVER;
    g.poly([...P(-E, -E), ...P(E, -E), ...P(E, E), ...P(-E, E)]).fill({ color: SNOW });
    // The way it goes: the middle, and out through each open side.
    const H = HALF;
    g.poly([...P(-H, -H), ...P(H, -H), ...P(H, H), ...P(-H, H)]).fill({ color: SLUSH, alpha: SLUSH_A });
    OUT.forEach(([du, dv], s) => {
      if (!(L.open & (1 << s))) return;
      const a0 = du ? Math.min(du * H, du * 0.5) : -H, a1 = du ? Math.max(du * H, du * 0.5) : H;
      const b0 = dv ? Math.min(dv * H, dv * 0.5) : -H, b1 = dv ? Math.max(dv * H, dv * 0.5) : H;
      g.poly([...P(a0, b0), ...P(a1, b0), ...P(a1, b1), ...P(a0, b1)]).fill({ color: SLUSH, alpha: SLUSH_A });
    });
  }
}

/** Let the bands' snow go. */
export function destroyRoadSnow(rs: RoadSnow): void {
  for (const g of rs.bands) g?.destroy();
  rs.bands = []; rs.on = false; rs.drawn = null;
}
