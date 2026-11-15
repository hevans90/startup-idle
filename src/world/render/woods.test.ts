import { describe, expect, test } from "bun:test";

import { treesIn, treesOf } from "./woods";

describe("woods", () => {
  test("a wooded material says how many trees it carries, by its name now or the one a map was saved with", () => {
    expect(treesIn("wood1")).toBe(1);
    expect(treesIn("wood3")).toBe(3);
    expect(treesIn("grass")).toBe(0);
    expect(treesIn("landscapeTiles_067_trees2.png")).toBe(2);
    expect(treesIn("landscapeTiles_067.png")).toBe(0);
    expect(treesIn(null)).toBe(0);
  });
  test("a cell's trees are the same every time, inside the cell, back to front", () => {
    for (const n of [1, 2, 3]) {
      const t = treesOf(12, 7, n);
      expect(t).toHaveLength(n);
      expect(treesOf(12, 7, n)).toEqual(t);
      for (const k of t) {
        expect(Math.abs(k.u - 12)).toBeLessThan(0.5);
        expect(Math.abs(k.v - 7)).toBeLessThan(0.5);
      }
      for (let k = 1; k < n; k++) expect(t[k].u + t[k].v).toBeGreaterThanOrEqual(t[k - 1].u + t[k - 1].v);
    }
  });
});
