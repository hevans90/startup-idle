import { describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, idx, type Grid } from "../grid";
import { COVER, vegAll, vegAt } from "./fields";
import { DIES, SICK, sickness, stressStep, weatherDry } from "./stress";
import { stepVegetation, VEG_DT } from "./step";

/** WHAT HURTS WHAT GROWS: pollution, drought and heat, flooding wearing health down; the sick thinned. @see stress */
const palette = [null, "grass", "wood3"] as const;
/** A 24² level meadow, a wood at 4–11 × 4–11, a pond in the last three columns. */
function land(): Grid {
  const g = createGrid(24, 24); fillTerrain(g, 1);
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) g.terrain[idx(g, x, y)] = 2;
  for (let y = 0; y < 24; y++) for (let x = 21; x < 24; x++) g.pool[idx(g, x, y)] = 2;
  vegAll(g, palette);
  return g;
}
/** `years` of stress steps, from `t0`. */
function run(g: Grid, years: number, s: Parameters<typeof stressStep>[5], t0 = 0.95) {
  for (let k = 0, t = t0; t < t0 + years; k++, t += VEG_DT) stressStep(g, palette, VEG_DT, t, k, s);
}
const H = (g: Grid, x: number, y: number) => g.veg.health[idx(g, x, y)];

describe("stress", () => {
  test("a drought wears a wood down away from the water, little by it, and it mends after", () => {
    const g = land();
    // A wood by the water too.
    for (let y = 4; y < 8; y++) for (let x = 18; x < 21; x++) { g.terrain[idx(g, x, y)] = 2; g.veg.seen[idx(g, x, y)] = -1; vegAt(g, palette, x, y); }
    run(g, 0.2, { dry: 1 });
    expect(H(g, 8, 8)).toBeLessThan(170);
    expect(H(g, 19, 5)).toBeGreaterThan(H(g, 8, 8) + 60);
    // (Mending in an autumn: no summer's hot days in it.)
    run(g, 0.4, {}, 1.55);
    expect(H(g, 8, 8)).toBe(255);
  });

  test("fouled water sickens what stands by it, reeds least; long enough and a wood thins", () => {
    const g = land();
    g.veg.cover[idx(g, 20, 14)] = COVER.reeds; g.veg.cover[idx(g, 20, 4)] = COVER.hedge;
    const fouled = (x: number, y: number) => x >= 21;
    run(g, 0.4, { fouled });
    expect(H(g, 20, 14)).toBeGreaterThan(H(g, 20, 4) + 40);
    expect(H(g, 10, 14)).toBe(255);
    // A wood beside fouled water, a year of it: thinned.
    const w = createGrid(24, 24); fillTerrain(w, 2); vegAll(w, palette);
    run(w, 1.2, { fouled: (x) => x >= 12 });
    let thinned = 0;
    for (let y = 0; y < 24; y++) if (w.veg.density[idx(w, 12, y)] < 3 || w.veg.cover[idx(w, 12, y)] !== COVER.wood) thinned++;
    expect(thinned).toBeGreaterThan(12);
    expect(w.veg.density[idx(w, 2, 2)]).toBe(3);
  });

  test("standing in floodwater hurts a wood and not reeds; a hedge dies of it", () => {
    const g = land();
    const r = idx(g, 2, 2), h = idx(g, 3, 2);
    g.veg.cover[r] = COVER.reeds; g.veg.cover[h] = COVER.hedge;
    for (const i of [r, h, idx(g, 6, 6)]) g.veg.wet[i] = 1;
    run(g, 0.3, {});
    expect(g.veg.health[r]).toBe(255);
    expect(H(g, 6, 6)).toBeLessThan(SICK);
    expect(g.veg.cover[h]).toBe(COVER.grass);
    expect(DIES).toBeLessThan(SICK);
  });

  test("the weather is dry only on the hot dry days of a summer; the step runs it with time away too", () => {
    let hot = 0, winter = 0;
    for (let t = 3; t < 4; t += 1 / 720) { const d = weatherDry(t); if (d > 0.2) { hot++; if ((t % 1) > 0.8 || (t % 1) < 0.1) winter++; } }
    expect(hot).toBeGreaterThan(2);
    expect(winter).toBe(0);
    const g = land();
    stepVegetation(g, palette, 0, {});
    stepVegetation(g, palette, 3, { dry: 0 });
    expect(sickness(255)).toBe(0);
    expect(sickness(30)).toBe(1);
  });
});
