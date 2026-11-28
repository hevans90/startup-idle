/**
 * THE VEGETATION FIELDS (`grid.veg`): what covers each cell, how many trees stand on it and how grown they are,
 * how healthy, how trampled — a byte each, saved. The forest is drawn from them (@see render/forest) and the
 * vegetation step changes them with the years (@see ./step).
 *
 * A cell's fields are taken from its ground material the first time they are read after that material changed:
 * a `woodN` tile is a wood of N trees, mature and healthy; grass is grass, reeds at the water's edge, heath on the
 * heights. So an old save, a new map and a tile painted in the editor all need nothing done to them. @see vegAt
 */
import { VOID, idx, inBounds, structureOf, type Grid } from "../grid";
import { treesIn } from "../terrain-names";

export const COVER = {
  none: 0, grass: 1, meadow: 2, scrub: 3, wood: 4, reeds: 5, field: 6, burnt: 7,
  // The player's: where trees were felled (`density` how many), and what they planted. @see vegetation/tend
  stumps: 8, hedge: 9, bed: 10, row: 11,
} as const;
export type Cover = (typeof COVER)[keyof typeof COVER];

/** The farm whose fields these are: within this many cells of it (the furthest of x and y). @see vegetation/tend */
export const FARM_REACH = 3;
/**
 * DRONE FARMING, as the fields know it: a farm reaches a tile further, and its lost ground is field again at once,
 * not at the next harvest. Told by the game each frame. @see notable "drones"
 */
let drones = false;
export const setDroneFarming = (on: boolean) => { drones = on; };
export const droneFarming = () => drones;
/** How far a farm reaches now. */
export const farmReach = () => FARM_REACH + (drones ? 1 : 0);

/** Mature, on the age byte. */
export const MATURE = 255;

type Palette = readonly (string | null)[];

export const vegHash = (x: number, y: number, salt: number) =>
  ((Math.imul(Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ salt, 0x85ebca6b) >>> 8) & 0xffff) / 0x10000;

/** Whether a cell's material is ground things grow on: grass or a wood. */
export function growable(g: Grid, palette: Palette, i: number): boolean {
  const mat = g.terrain[i];
  if (mat === VOID) return false;
  const name = palette[mat] ?? "";
  return name === "grass" || /^wood/.test(name);
}

/** Whether a cell is BUILT OVER or under water, so nothing grows on it now: paved, a deck, a main, a building, a pool. */
export function covered(g: Grid, x: number, y: number): boolean {
  const i = idx(g, x, y);
  return !!(g.paved[i] || g.pool[i] > 0 || g.deck[i] || g.main[i] || structureOf(g, x, y));
}

/** How high a cell is on its map, 0 the lowest ground to 1 the highest. */
export function heightShare(g: Grid, i: number): number {
  const span = g.maxHeight - g.minHeight;
  return span > 0 ? (g.height[i] - g.minHeight) / span : 0.5;
}

/** Whether water stands on a cell: from the start, or now. */
export const wetAt = (g: Grid, i: number) => g.pool[i] > 0 || g.veg.wet[i] > 0;

/** How far the nearest standing water is, in cells (the furthest of x and y), up to `r`; `r + 1` if none so near. */
export function waterNear(g: Grid, x: number, y: number, r = 2): number {
  let best = r + 1;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const d = Math.max(Math.abs(dx), Math.abs(dy));
    if (d >= best || !inBounds(g, x + dx, y + dy)) continue;
    const j = idx(g, x + dx, y + dy);
    if (g.pool[j] > 0 || g.veg.wet[j]) best = d;
  }
  return best;
}

/** A slow noise, 0–1, over the map. */
export function vegNoise(x: number, y: number, scale: number, salt: number): number {
  const fx = x / scale, fy = y / scale, ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy;
  const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v), h = (a: number, b: number) => vegHash(a, b, salt);
  return (h(ix, iy) * (1 - su) + h(ix + 1, iy) * su) * (1 - sv) + (h(ix, iy + 1) * (1 - su) + h(ix + 1, iy + 1) * su) * sv;
}
/** How thick the heath is over a cell, 0–1: in patches, not spread even. */
export const heathOf = (x: number, y: number) => Math.max(0, Math.min(1, (vegNoise(x, y, 6, 0x4ea7) - 0.5) / 0.2));

/** A cell's fields from its material alone. @see vegAt */
function derive(g: Grid, palette: Palette, x: number, y: number) {
  const V = g.veg, i = idx(g, x, y), mat = g.terrain[i];
  V.seen[i] = mat;
  V.age[i] = MATURE; V.health[i] = 255; V.wear[i] = 0; V.density[i] = 0;
  if (!growable(g, palette, i)) { V.cover[i] = COVER.none; return; }
  const n = treesIn(palette[mat]);
  if (n) { V.cover[i] = COVER.wood; V.density[i] = n; return; }
  // Reeds along most of a shore; heath in patches on the heights.
  const r = vegHash(x, y, 0x5eed);
  if (g.pool[i] === 0 && waterNear(g, x, y, 1) <= 1 && r < 0.6) V.cover[i] = COVER.reeds;
  else if (heightShare(g, i) > 0.62 && heathOf(x, y) > 0) V.cover[i] = COVER.meadow;
  else V.cover[i] = COVER.grass;
}

/** Bring a cell's fields up to date with its material, and give its index. */
export function vegAt(g: Grid, palette: Palette, x: number, y: number): number {
  const i = idx(g, x, y);
  if (g.veg.seen[i] !== g.terrain[i]) derive(g, palette, x, y);
  return i;
}

/** Every cell brought up to date: before the fields are saved, so none is saved never read. */
export function vegAll(g: Grid, palette: Palette) {
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) vegAt(g, palette, x, y);
}
