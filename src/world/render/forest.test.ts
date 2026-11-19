import { describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, idx } from "../grid";
import { canopyOf, forestTrees } from "./forest";

/** WOODS AS WOODS: thick in the heart, thin and ragged at the rim, nothing where nothing may stand. @see forest.ts */
const palette = [null, "grass", "wood3", "wood1"] as const;
const GRASS = 1, WOOD = 2;
/** A 24×24 meadow with a 12×12 wood in it. */
function meadow() {
  const g = createGrid(24, 24); fillTerrain(g, GRASS);
  for (let y = 6; y < 18; y++) for (let x = 6; x < 18; x++) g.terrain[idx(g, x, y)] = WOOD;
  return g;
}
const count = (g: ReturnType<typeof meadow>, x0: number, y0: number, x1: number, y1: number) => {
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) n += forestTrees(g, palette, x, y).length;
  return n / ((x1 - x0) * (y1 - y0));
};

describe("the forest", () => {
  test("the same map, the same trees", () => {
    const a = meadow(), b = meadow();
    for (const [x, y] of [[8, 8], [12, 11], [17, 6], [5, 12]]) expect(forestTrees(a, palette, x, y)).toEqual(forestTrees(b, palette, x, y));
  });

  test("a wood's heart is thick, the spill past its edge thinner, the open meadow bare; and its feet in or beside the cell asked", () => {
    const g = meadow();
    const heart = count(g, 9, 9, 15, 15), rim = count(g, 6, 4, 18, 6), field = count(g, 0, 0, 3, 24);
    expect(heart).toBeGreaterThan(2.5);
    expect(rim).toBeGreaterThan(0);
    expect(rim).toBeLessThan(heart / 2);
    expect(field).toBe(0);
    for (let y = 5; y < 19; y++) for (let x = 5; x < 19; x++) for (const t of forestTrees(g, palette, x, y)) {
      expect(Math.abs(t.u - x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(t.v - y)).toBeLessThanOrEqual(0.5);
      expect(t.size).toBeGreaterThan(0.4);
    }
    expect(canopyOf(g, palette, 12, 12)).toBeCloseTo(1, 6);
    expect(canopyOf(g, palette, 6, 12)).toBeCloseTo(0.75, 6);
  });

  test("no tree on a road, in water, on a deck or under a building — and a road through a wood does not leave it bare", () => {
    const g = meadow();
    for (let x = 6; x < 18; x++) g.paved[idx(g, x, 12)] = 1;
    g.pool[idx(g, 9, 9)] = 1;
    g.deck[idx(g, 14, 9)] = 1;
    for (const [x, y] of [[9, 9], [14, 9], ...Array.from({ length: 12 }, (_, k) => [6 + k, 12])]) expect(forestTrees(g, palette, x, y)).toEqual([]);
    expect(count(g, 9, 14, 15, 17)).toBeGreaterThan(1.5);
  });
});
