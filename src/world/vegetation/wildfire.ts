/**
 * A WILDFIRE: dry, sick woods, scrub, heath and fields catching and burning across the map with the wind, a cell
 * at a time, each left burnt — charred ground and snags that grass over in a year (@see ./step). Roads, paving,
 * water and bare grass stop it; rain puts it out; the fire brigade holds it where it is and puts it out. What is
 * built next to a burning cell is the scene's to burn out (@see events/damage burn). Live, not saved: a fire is
 * an event's while it lasts. @see events/defs/wildfire
 */
import { inBounds, idx, type Grid } from "../grid";
import { COVER, covered, vegAt, vegHash, vegNoise } from "./fields";

type Palette = readonly (string | null)[];

export type Wildfire = {
  /** Cells burning, and the seconds each has left. */
  burning: Map<number, number>;
  /** Cells burnt out so far. */
  burnt: number;
  /** A step count, for its seeded chances. */
  k: number;
};

/** How well each cover burns, 0–1: a wood by its trees. */
export function fuelOf(g: Grid, i: number): number {
  const V = g.veg;
  switch (V.cover[i]) {
    case COVER.wood: return 0.55 + 0.15 * V.density[i];
    case COVER.scrub: return 0.8;
    case COVER.meadow: return 0.6;
    case COVER.hedge: case COVER.row: return 0.6;
    case COVER.field: return 0.45;
    case COVER.bed: return 0.25;
    default: return 0;
  }
}

/** How dry a cell is to burn, 0–1: sick plants, and the drought or heat over everything (`dry`). */
export const drynessOf = (g: Grid, i: number, dry: number) => Math.min(1, (1 - g.veg.health[i] / 255) * 0.9 + dry * 0.65);

/** Least dryness × fuel for a wood to catch at all. */
export const CATCHES = 0.42;

/**
 * WHERE ONE WOULD START: the driest thing that burns, on open ground away from what is built — none if nothing
 * is dry enough. (`dry`: the drought or heat over everything, 0–1.)
 */
export function tinderAt(g: Grid, palette: Palette, dry: number): { x: number; y: number; dryness: number } | null {
  let best: { x: number; y: number; dryness: number } | null = null, most = CATCHES;
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const i = vegAt(g, palette, x, y), f = fuelOf(g, i);
    if (f < 0.5 || covered(g, x, y) || g.veg.wet[i]) continue;
    // (A little of where, so the same driest wood is not always the one.)
    const score = f * drynessOf(g, i, dry) * (0.9 + 0.2 * vegNoise(x, y, 3, 0xf12e));
    if (score > most) { most = score; best = { x, y, dryness: Math.min(1, score / 0.8) }; }
  }
  return best;
}

/** Set a fire going at a cell. */
export function startWildfire(g: Grid, x: number, y: number): Wildfire {
  return { burning: new Map([[idx(g, x, y), burnTime(fuelOf(g, idx(g, x, y)))]]), burnt: 0, k: 0 };
}

/** Seconds a cell burns, by its fuel. */
const burnTime = (fuel: number) => 6 + 12 * fuel;
/** Cells caught a second, at the most: by the fuel and dryness of where it goes, and the wind behind it. */
const SPREAD = 0.4;

export type FireWeather = {
  /** The drought or heat over everything, 0–1. */
  dry: number;
  /** Which way the wind blows, cells: the fire runs with it. */
  wind: readonly [number, number];
  /** How hard it is raining, 0–1: enough, and it is going out. */
  rain: number;
  /** The fire brigade at it: it spreads no further and goes out the faster. */
  brigade: boolean;
};

/**
 * `dt` seconds of a fire: each burning cell catching those round it that burn, and burning down; one burnt out is
 * left burnt. Returns the structures beside a burning cell (to burn out) and whether anything changed on the map.
 */
export function stepWildfire(g: Grid, palette: Palette, f: Wildfire, dt: number, w: FireWeather): { near: Set<number>; changed: boolean } {
  const V = g.veg, near = new Set<number>();
  f.k++;
  const out = w.brigade ? 3 : w.rain > 0.3 ? 4 : 1;
  const spreads = !w.brigade && w.rain <= 0.3;
  const caught: number[] = [];
  let changed = false;
  for (const [i, left] of f.burning) {
    const x = i % g.w, y = (i / g.w) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dy) || !inBounds(g, x + dx, y + dy)) continue;
      const j = idx(g, x + dx, y + dy), s = g.structureAt[j];
      if (s >= 0) { near.add(s); continue; }
      if (!spreads || f.burning.has(j) || covered(g, x + dx, y + dy)) continue;
      vegAt(g, palette, x + dx, y + dy);
      if (V.wet[j]) continue;
      const fuel = fuelOf(g, j);
      if (!fuel) continue;
      // With the wind it runs; against it it creeps; a diagonal is further.
      const len = dx && dy ? Math.SQRT2 : 1, along = (dx * w.wind[0] + dy * w.wind[1]) / len;
      const rate = SPREAD * fuel * drynessOf(g, j, w.dry) * Math.max(0.15, 1 + 1.4 * along) / len;
      if (vegHash(j, f.k, 0xf1e1) < 1 - Math.exp(-rate * dt)) caught.push(j);
    }
    const l = left - dt * out;
    if (l > 0) { f.burning.set(i, l); continue; }
    // BURNT OUT: charred, the trees snags.
    f.burning.delete(i);
    f.burnt++;
    V.density[i] = V.cover[i] === COVER.wood ? V.density[i] : 0;
    V.cover[i] = COVER.burnt; V.age[i] = 0; V.health[i] = 255;
    V.changed.add(i); changed = true;
  }
  for (const j of caught) if (!f.burning.has(j)) f.burning.set(j, burnTime(fuelOf(g, j)));
  if (changed) V.rev++;
  return { near, changed };
}

export { windAt } from "../weather";
