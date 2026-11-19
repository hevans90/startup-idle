/**
 * THE VEGETATION STEP: the fields (@see ./fields) through the years. Pure and seeded — the same map, the same
 * years, the same woods — and driven by the calendar, not the frame: a step every ten seconds of play, and time
 * away caught up in a few big steps, never replayed.
 *
 * - **Growth**: a sapling is mature in two years.
 * - **Spread**: a grown wood seeds the open ground beside it; grass so seeded goes to scrub, scrub to a young
 *   wood, and a wood thickens to as many trees as the wood round it has. A ring at most a step, so time away
 *   spreads a wood a few cells and never across the map.
 * - **Kept open**: nothing seeds next to a road or a building (verges are mown), on a cell built over or under
 *   water, or in the meadows a slow noise leaves open.
 * - **The shore**: reeds take the grass at the water's edge, and give it back where the water has gone — the water
 *   as it stands now (@see wetFrom); under it nothing else grows.
 * - Burnt ground grasses over in a year, stumps rot into it.
 * - **Stress** after each step: pollution, drought and heat, flooding wearing health down, and the sick thinned.
 *   @see ./stress
 * - **What the player planted** grows up and stays as it is: a row, a hedge, a bed. A field with no farm in reach
 *   goes back to grass; one with, is cut each harvest (@see HARVEST), and counted in `veg.harvest` to be paid.
 */
import { idx, inBounds, type Grid } from "../grid";
import { COVER, HARVEST, MATURE, covered, growable, vegAt, vegHash, vegNoise, waterNear } from "./fields";
import { stressStep, type Stress } from "./stress";
import { farmsOf, harvestable, tended } from "./tend";

type Palette = readonly (string | null)[];

/** A step: a share of a year. Ten seconds of play. */
export const VEG_DT = 1 / 360;
/** The most steps a catch-up is cut into. */
const CATCH_UP_STEPS = 8;
/** Years from sapling to mature. */
const GROW_YEARS = 2;
/** Rates, a year: open ground beside a grown wood seeded; scrub grown up into a wood; a wood thickening by a tree; reeds coming and going. */
const SEED = 0.25, SCRUB_UP = 0.6, THICKEN = 0.35, REEDS = 0.2, BURNT = 1, ROT = 1, FALLOW = 2;
/** A wood is old enough to seed from halfway grown. */
const SEEDS_FROM = 128;

/** The chance something with `rate` a year happens in `dt` years. */
const chance = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/** Whether open ground is KEPT open: beside a road or a building, or in a meadow. */
function keptOpen(g: Grid, x: number, y: number): boolean {
  if (vegNoise(x, y, 7, 0x0be1) > 0.68) return true;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!inBounds(g, x + dx, y + dy)) continue;
    const j = idx(g, x + dx, y + dy);
    if (g.paved[j] || g.structureAt[j] >= 0) return true;
  }
  return false;
}

/** How a sapling's age shows: in eighths, so the trees are drawn again only when that changes. */
export const ageStep = (age: number) => age >> 5;

/**
 * One step of `dt` years, the `k`th: what each cell becomes, read from the fields as they were before it, then
 * written. Returns whether anything changed (and notes what in `veg.changed`).
 */
export function vegStep(g: Grid, palette: Palette, dt: number, k: number): boolean {
  const V = g.veg, W = g.w, H = g.h;
  const writes: number[] = [], farms = farmsOf(g);
  const set = (i: number, cover: number, density: number, age: number) => { writes.push(i, cover, density, age); };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = vegAt(g, palette, x, y);
    if (!growable(g, palette, i) || covered(g, x, y)) continue;
    const cover = V.cover[i], density = V.density[i], age = V.age[i];
    // (Under water now: nothing grows, and nothing comes; reeds as they are.)
    if (V.wet[i] && cover !== COVER.reeds) continue;
    const r = vegHash(i, k, 0x7ea5), r2 = vegHash(i, k, 0x51de);
    // GROWTH, as a whole number of the age byte: what is left over, by chance.
    let grown = age;
    if (age < MATURE && (cover === COVER.wood || cover === COVER.scrub || cover === COVER.row || cover === COVER.hedge || cover === COVER.burnt)) {
      const inc = (dt * MATURE) / GROW_YEARS, whole = Math.floor(inc);
      grown = Math.min(MATURE, age + whole + (vegHash(i, k, 0x6a0e) < inc - whole ? 1 : 0));
    }
    // The wood round it: cells with trees, and those grown enough to seed.
    let trees = 0, seeds = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dy) || !inBounds(g, x + dx, y + dy)) continue;
      const j = vegAt(g, palette, x + dx, y + dy);
      if (V.cover[j] !== COVER.wood || !V.density[j]) continue;
      trees++;
      if (V.density[j] >= 2 && V.age[j] >= SEEDS_FROM) seeds++;
    }
    switch (cover) {
      case COVER.wood: {
        const target = trees >= 6 ? 3 : trees >= 3 ? 2 : 1;
        if (density < target && r < chance(THICKEN, dt)) set(i, COVER.wood, density + 1, grown);
        else if (grown !== age) set(i, cover, density, grown);
        break;
      }
      case COVER.scrub:
        if (r < chance(SCRUB_UP, dt)) set(i, COVER.wood, 1, 0);
        else if (grown !== age) set(i, cover, density, grown);
        break;
      case COVER.grass: case COVER.meadow:
        if (seeds && !keptOpen(g, x, y) && r < chance(SEED * Math.min(1, seeds / 2), dt)) set(i, COVER.scrub, 0, 0);
        else if (cover === COVER.grass && r2 < chance(REEDS, dt) && waterNear(g, x, y, 1) <= 1) set(i, COVER.reeds, 0, MATURE);
        break;
      case COVER.reeds:
        if (r2 < chance(REEDS * 2, dt) && waterNear(g, x, y, 1) > 1) set(i, COVER.grass, 0, MATURE);
        break;
      case COVER.burnt:
        // (Its age the time since: the char greening over. @see render/ground-mesh)
        if (r < chance(BURNT, dt)) set(i, COVER.grass, 0, MATURE);
        else if (grown !== age) set(i, cover, density, grown);
        break;
      case COVER.stumps:
        if (r < chance(ROT, dt)) set(i, COVER.grass, 0, MATURE);
        break;
      case COVER.row: case COVER.hedge:
        if (grown !== age) set(i, cover, density, grown);
        break;
      case COVER.field:
        if (!tended(farms, x, y) && r < chance(FALLOW, dt)) set(i, COVER.grass, 0, MATURE);
        break;
    }
  }
  for (let w = 0; w < writes.length; w += 4) {
    const i = writes[w], was = [V.cover[i], V.density[i], ageStep(V.age[i])];
    V.cover[i] = writes[w + 1]; V.density[i] = writes[w + 2]; V.age[i] = writes[w + 3];
    if (was[0] !== V.cover[i] || was[1] !== V.density[i] || was[2] !== ageStep(V.age[i])) V.changed.add(i);
  }
  const changed = writes.length > 0;
  if (changed) V.rev++;
  return changed;
}

/**
 * WHERE WATER STANDS NOW, from the live water (`depth`, half steps): trees are not drawn there, reeds are, and
 * nothing grows. On the wall's clock, not the calendar's: the water moves whether or not the year does.
 */
export function wetFrom(g: Grid, depth: (x: number, y: number) => number): boolean {
  const V = g.veg;
  let any = false;
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    // (Wet at a half step, dry again below a quarter: an edge the water laps does not flicker.)
    const i = idx(g, x, y), d = depth(x, y), w = d >= 1 ? 1 : d < 0.5 ? 0 : V.wet[i];
    if (w !== V.wet[i]) { V.wet[i] = w; V.changed.add(i); any = true; }
  }
  if (any) V.rev++;
  return any;
}

/** THE HARVEST, each time the year passes it between `t0` and `t1`: the fields cut then, to be paid for. */
function reap(g: Grid, t0: number, t1: number) {
  const times = Math.floor(t1 - HARVEST) - Math.floor(t0 - HARVEST);
  if (times > 0) g.veg.harvest += harvestable(g) * times;
}

/**
 * Bring the fields to the calendar's year `t`: a step every {@link VEG_DT}, and a longer gap — time away — in at
 * most eight. A map never stepped, or a calendar set back, starts from where it is.
 */
export function stepVegetation(g: Grid, palette: Palette, t: number, stress?: Stress): boolean {
  const V = g.veg;
  if (V.t < 0 || t < V.t) { V.t = t; return false; }
  const gap = t - V.t, n = Math.floor(gap / VEG_DT);
  if (!n) return false;
  // (Growth and spread, then what hurts them: stress only where it is asked for, so the tests of growth stand alone.)
  const step = (dt: number) => {
    const k = Math.round(V.t / VEG_DT);
    const a = vegStep(g, palette, dt, k);
    return (stress ? stressStep(g, palette, dt, V.t, k, stress) : false) || a;
  };
  let any = false;
  if (n <= CATCH_UP_STEPS) {
    for (let s = 0; s < n; s++) { reap(g, V.t, V.t + VEG_DT); V.t += VEG_DT; any = step(VEG_DT) || any; }
  } else {
    const dt = gap / CATCH_UP_STEPS;
    for (let s = 0; s < CATCH_UP_STEPS; s++) { reap(g, V.t, V.t + dt); V.t += dt; any = step(dt) || any; }
  }
  return any;
}
