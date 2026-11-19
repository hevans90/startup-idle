/**
 * WHAT HURTS WHAT GROWS: the `health` field (@see ./fields) worn down by what a plant stands in, and given back
 * when that stops. A wood long sick thins, a tree at a time, and dies back to scrub; a hedge, a row or a bed dies
 * to grass. Sick trees are drawn browner (@see render/tree-mesh); dry, sick ground is tinder (@see ./wildfire).
 *
 * - **Pollution**: fouled water within a cell of it. Reed beds take it best.
 * - **Drought and heat**: a drought or a heatwave under way (the scene's), and the hottest dry days of a summer
 *   (the weather's) — on ground away from water, and worse the higher it is.
 * - **Flooding**: standing in water that is not its own. Reeds live in it.
 *
 * Pure and seeded like the step it runs in. The weather's share is the calendar's, so time away has it too;
 * what the scene passes (pollution, the events) is what is there now. @see stepVegetation
 */
import { inBounds, type Grid } from "../grid";
import { weatherAt } from "../weather";
import { COVER, heightShare, vegAt, vegHash, waterNear } from "./fields";

type Palette = readonly (string | null)[];

/** What the scene knows of now: fouled water by a cell, and how dry an event under way makes it (0–1). */
export type Stress = { fouled?: (x: number, y: number) => boolean; dry?: number };

/** Health lost a year, out of one, to each at its worst; and won back a year without any. */
export const HURT = { fouled: 1.2, reeds: 0.3, dry: 2.4, flood: 4 } as const;
export const RECOVER = 1.5;
/** Below this health a wood thins, faster the sicker; a planting dies below `DIES`. Out of 255. */
export const SICK = 110, DIES = 50;
/** Trees lost a year, at the sickest. */
const THIN = 3;

/** Whether a cover is something living that stress reaches. */
const LIVING: ReadonlySet<number> = new Set([COVER.wood, COVER.scrub, COVER.meadow, COVER.reeds, COVER.field, COVER.hedge, COVER.bed, COVER.row]);

/** How dry the WEATHER makes it at `t` (years), 0–1: the hot dry days of a summer. */
export function weatherDry(t: number): number {
  const w = weatherAt(t);
  const k = Math.max(0, Math.min(1, (w.temp - 18) / 6));
  return k * k * (1 - w.fall);
}

const chance = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/** Whether fouled water is within a cell. */
function fouledNear(g: Grid, s: Stress, x: number, y: number): boolean {
  if (!s.fouled) return false;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inBounds(g, x + dx, y + dy) && s.fouled(x + dx, y + dy)) return true;
  return false;
}

/**
 * One step of `dt` years at `t`, the `k`th: each living cell's health worn or mended, and the sick thinned. Marks
 * what shows (a tree's health in eighths, a tree lost) in `veg.changed`; returns whether anything did.
 */
export function stressStep(g: Grid, palette: Palette, dt: number, t: number, k: number, s: Stress = {}): boolean {
  const V = g.veg, dry = Math.max(s.dry ?? 0, weatherDry(t));
  let shown = false;
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const i = vegAt(g, palette, x, y), cover = V.cover[i];
    if (!LIVING.has(cover)) continue;
    let load = 0;
    if (V.wet[i] && cover !== COVER.reeds) load += HURT.flood;
    if (fouledNear(g, s, x, y)) load += cover === COVER.reeds ? HURT.reeds : HURT.fouled;
    if (dry > 0 && cover !== COVER.reeds) {
      // (By water the roots reach it; high up it is driest.)
      const moist = waterNear(g, x, y, 2) <= 2 ? 0.25 : 1;
      load += HURT.dry * dry * moist * (0.75 + 0.5 * heightShare(g, i));
    }
    const was = V.health[i];
    const h = load > 0 ? Math.max(0, was - load * dt * 255) : Math.min(255, was + RECOVER * dt * 255);
    // (Whole steps, the fraction by chance: a short step still mends.)
    const whole = Math.floor(h), next = whole + (vegHash(i, k, 0x4ea1) < h - whole ? 1 : 0);
    V.health[i] = Math.min(255, next);
    if (was >> 5 !== V.health[i] >> 5) { V.changed.add(i); shown = true; }
    // THE SICK: a wood thins; what was planted dies.
    const hp = V.health[i];
    if (hp >= SICK) continue;
    if (cover === COVER.wood || cover === COVER.scrub) {
      if (vegHash(i, k, 0x7419) >= chance(THIN * (1 - hp / SICK), dt)) continue;
      if (cover === COVER.wood && V.density[i] > 1) V.density[i]--;
      else if (cover === COVER.wood) { V.cover[i] = COVER.scrub; V.density[i] = 0; V.age[i] = 0; }
      else { V.cover[i] = COVER.grass; V.age[i] = 255; }
      V.changed.add(i); shown = true;
    } else if (hp < DIES && (cover === COVER.hedge || cover === COVER.row || cover === COVER.bed)) {
      V.cover[i] = COVER.grass; V.density[i] = 0; V.age[i] = 255; V.health[i] = 128;
      V.changed.add(i); shown = true;
    }
  }
  if (shown) V.rev++;
  return shown;
}

/** How sick a cell's plants look, 0 well to 1 dying. @see render/tree-mesh */
export const sickness = (health: number) => Math.max(0, Math.min(1, (200 - health) / 170));
