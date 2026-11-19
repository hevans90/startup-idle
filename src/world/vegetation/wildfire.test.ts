import { describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, idx, stampFootprint, type Grid, type Structure } from "../grid";
import { forestTrees } from "../render/forest";
import { COVER, vegAll } from "./fields";
import { stepVegetation } from "./step";
import { startWildfire, stepWildfire, tinderAt, type FireWeather, type Wildfire } from "./wildfire";

/** A WILDFIRE: catching where it is driest, running with the wind, stopped by roads and the brigade, leaving char. @see wildfire */
const palette = [null, "grass", "wood3"] as const;
/** A 32² wood, all of it, a road across it at y = 16. */
function wood(): Grid {
  const g = createGrid(32, 32); fillTerrain(g, 2);
  for (let x = 0; x < 32; x++) g.paved[idx(g, x, 16)] = 1;
  vegAll(g, palette);
  return g;
}
const calm: FireWeather = { dry: 1, wind: [1, 0], rain: 0, brigade: false };
/** `seconds` of the fire, half a second a step. */
function burnFor(g: Grid, f: Wildfire, seconds: number, w = calm) {
  const near = new Set<number>();
  for (let t = 0; t < seconds; t += 0.5) for (const id of stepWildfire(g, palette, f, 0.5, w).near) near.add(id);
  return near;
}
const burnt = (g: Grid, pred: (x: number, y: number) => boolean = () => true) => {
  let n = 0;
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (pred(x, y) && g.veg.cover[idx(g, x, y)] === COVER.burnt) n++;
  return n;
};

describe("wildfire", () => {
  test("nothing healthy catches in a wet year; in a drought the driest wood does", () => {
    const g = wood();
    expect(tinderAt(g, palette, 0)).toBeNull();
    const t = tinderAt(g, palette, 1);
    expect(t).not.toBeNull();
    expect(g.paved[idx(g, t!.x, t!.y)]).toBe(0);
  });

  test("it runs with the wind, leaves the wood burnt, and a road stops it", () => {
    const g = wood(), f = startWildfire(g, 4, 8);
    burnFor(g, f, 90);
    expect(burnt(g)).toBeGreaterThan(40);
    expect(burnt(g, (x) => x > 8)).toBeGreaterThan(burnt(g, (x) => x < 4) * 2);
    expect(burnt(g, (_, y) => y > 16)).toBe(0);
    // Burnt: snags, charred; most grassed over in three years.
    const c = [...Array(32 * 32).keys()].find((i) => g.veg.cover[i] === COVER.burnt)!;
    expect(forestTrees(g, palette, c % 32, (c / 32) | 0).every((t) => t.char === 1)).toBe(true);
    const was = burnt(g);
    stepVegetation(g, palette, 0);
    for (let t = 1 / 360; t <= 3; t += 1 / 360) stepVegetation(g, palette, t);
    expect(burnt(g)).toBeLessThan(was * 0.1);
  });

  test("the brigade holds it where it is and puts it out; rain puts it out", () => {
    for (const w of [{ ...calm, brigade: true }, { ...calm, rain: 0.8 }]) {
      const g = wood(), f = startWildfire(g, 4, 8);
      burnFor(g, f, 10);
      const lit = f.burning.size + f.burnt;
      burnFor(g, f, 30, w);
      expect(f.burning.size).toBe(0);
      expect(f.burnt).toBe(lit);
    }
  });

  test("what is built beside it is named to burn; grass does not carry it", () => {
    const g = wood();
    const s: Structure = { id: 3, def: "house", x: 10, y: 6, w: 1, h: 1 };
    g.structures.set(3, s); stampFootprint(g, s);
    const near = burnFor(g, startWildfire(g, 6, 6), 60);
    expect(near.has(3)).toBe(true);
    const m = createGrid(16, 16); fillTerrain(m, 1); vegAll(m, palette);
    const f = startWildfire(m, 8, 8);
    burnFor(m, f, 60);
    expect(f.burnt).toBeLessThanOrEqual(1);
  });
});
