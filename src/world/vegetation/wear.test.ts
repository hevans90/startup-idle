import { describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, idx, type Grid } from "../grid";
import { vegAll } from "./fields";
import { healWear, wearFrom, WEAR } from "./wear";

/** WEAR: the verges by a road worn by its traffic, a path trodden by walkers off it, both healing. @see wear */
const palette = [null, "grass"] as const;
/** A 16² meadow with a road along y = 8. */
function land(): Grid {
  const g = createGrid(16, 16); fillTerrain(g, 1);
  for (let x = 0; x < 16; x++) g.paved[idx(g, x, 8)] = 1;
  vegAll(g, palette);
  return g;
}
const W = (g: Grid, x: number, y: number) => g.veg.wear[idx(g, x, y)];

describe("wear", () => {
  test("a car on the road wears the verges beside it, a lorry more; not the road, not further", () => {
    const g = land();
    wearFrom(g, palette, [{ x: 4, y: 8, kind: "car" }, { x: 10.2, y: 7.9, kind: "truck" }]);
    expect(W(g, 4, 7)).toBe(WEAR.wheel);
    expect(W(g, 4, 9)).toBe(WEAR.wheel);
    expect(W(g, 10, 9)).toBe(WEAR.heavy);
    expect(W(g, 4, 8)).toBe(0);
    expect(W(g, 4, 6)).toBe(0);
  });

  test("walkers off the paving tread a path, which shows as it wears and heals with nobody on it", () => {
    const g = land();
    // (Enough steps that it shows: an eighth worn.)
    for (let k = 0; k < 8; k++) wearFrom(g, palette, [{ x: 3, y: 3, kind: "person" }]);
    expect(W(g, 3, 3)).toBe(8 * WEAR.across);
    expect(g.veg.changed.has(idx(g, 3, 3))).toBe(true);
    g.veg.changed.clear();
    healWear(g, 0.01);
    expect(W(g, 3, 3)).toBeLessThan(8 * WEAR.across);
    for (let k = 0; k < 60; k++) healWear(g, 0.01);
    expect(W(g, 3, 3)).toBe(0);
    expect(g.veg.changed.has(idx(g, 3, 3))).toBe(true);
  });

  test("nothing wears under water", () => {
    const g = land();
    g.pool[idx(g, 5, 5)] = 2;
    wearFrom(g, palette, [{ x: 5, y: 5, kind: "person" }]);
    expect(W(g, 5, 5)).toBe(0);
  });
});
