/**
 * World v2 — LAND: a company owns part of its map, and buys the rest a
 * parcel at a time. The map is cut into a four by four grid of parcels; a new
 * company starts with the two by two block of them its street runs through
 * most, and under the game's rules builds only on land it owns.
 *
 * Which parcels are owned is kept with the company, not the map: a list of
 * parcel numbers, or null for all of it — what a company that had its map
 * before land was for sale has. @see Session.land
 */
import type { Grid } from "./grid";

/** Parcels across and down every map. */
export const PARCELS = 4;
/** How many a company starts with: a two by two block. @see startingLand */
export const STARTING_PARCELS = 4;

/** Tiles along a parcel's side; the last row and column take what is left. */
export const parcelSize = (g: Grid) => Math.ceil(Math.max(g.w, g.h) / PARCELS);

/** The parcel a tile is in, numbered row by row. */
export function parcelOf(g: Grid, x: number, y: number): number {
  const s = parcelSize(g);
  return Math.min(PARCELS - 1, (y / s) | 0) * PARCELS + Math.min(PARCELS - 1, (x / s) | 0);
}

/** A parcel's tiles, as a rectangle clipped to the map. */
export function parcelRect(g: Grid, p: number): { x0: number; y0: number; x1: number; y1: number } {
  const s = parcelSize(g), px = p % PARCELS, py = (p / PARCELS) | 0;
  return {
    x0: px * s, y0: py * s,
    x1: px === PARCELS - 1 ? g.w : Math.min(g.w, (px + 1) * s),
    y1: py === PARCELS - 1 ? g.h : Math.min(g.h, (py + 1) * s),
  };
}

/** Whether a tile is the company's to build on. */
export const ownsTile = (g: Grid, land: readonly number[] | null, x: number, y: number) =>
  land === null || land.includes(parcelOf(g, x, y));

/**
 * The land a new company starts with: the two by two block of parcels the
 * street runs through most, the middle one on a tie. Somewhere to put a
 * garage on a road is the one thing it must have.
 */
export function startingLand(g: Grid, extra = 0): number[] {
  let best: number[] = [], bestScore = -Infinity;
  for (let py = 0; py < PARCELS - 1; py++) {
    for (let px = 0; px < PARCELS - 1; px++) {
      const block = [py * PARCELS + px, py * PARCELS + px + 1, (py + 1) * PARCELS + px, (py + 1) * PARCELS + px + 1];
      let road = 0;
      for (const p of block) {
        const r = parcelRect(g, p);
        for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) if (g.paved[y * g.w + x]) road++;
      }
      // Towards the middle on a tie, and a little even when not.
      const off = Math.abs(px + 0.5 - (PARCELS - 1) / 2) + Math.abs(py + 0.5 - (PARCELS - 1) / 2);
      const score = road - off * 0.5;
      if (score > bestScore) { bestScore = score; best = block; }
    }
  }
  // AND MORE, for a company whose founders have done this before: the parcels
  // beside it with the most road, one at a time. @see EXTRA_PARCELS
  for (let k = 0; k < extra; k++) {
    let pick = -1, most = -1;
    for (let p = 0; p < PARCELS * PARCELS; p++) {
      if (!buyable(best, p)) continue;
      const r = parcelRect(g, p);
      let road = 0;
      for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) if (g.paved[y * g.w + x]) road++;
      if (road > most) { most = road; pick = p; }
    }
    if (pick < 0) break;
    best = [...best, pick];
  }
  return best.sort((a, b) => a - b);
}

/** Whether a parcel can be bought: not owned, and beside one that is. */
export function buyable(land: readonly number[], p: number): boolean {
  if (land.includes(p) || p < 0 || p >= PARCELS * PARCELS) return false;
  const px = p % PARCELS, py = (p / PARCELS) | 0;
  return land.some((q) => {
    const qx = q % PARCELS, qy = (q / PARCELS) | 0;
    return Math.abs(qx - px) + Math.abs(qy - py) === 1;
  });
}

/**
 * WHAT THE NEXT PARCEL COSTS, the `bought`th bought: the larger of a floor and
 * seconds of income, both growing with every one bought, so land is a
 * mid-game thing to save for and the last of it is late-game.
 */
export function landPrice(bought: number, income: number): number {
  const floor = 400 * 2.5 ** bought;
  const live = Math.max(0, income) * 45 * 1.5 ** bought;
  return Math.round(Math.max(floor, live));
}
