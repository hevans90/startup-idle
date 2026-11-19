import { describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, idx } from "../grid";
import { COVER, vegAll, vegAt } from "../vegetation/fields";
import { forestTrees, scatterOn } from "./forest";

/** WHAT LIES ABOUT: boulders under a face, tufts in a meadow, nothing on water or what is built. @see forest scatterOn */
const palette = [null, "grass"] as const;
function land() {
  const g = createGrid(40, 40); fillTerrain(g, 1);
  // A crag: x ≥ 20 stood up eight steps.
  for (let y = 0; y < 40; y++) for (let x = 20; x < 40; x++) g.height[idx(g, x, y)] = 8;
  g.minHeight = 0; g.maxHeight = 8;
  vegAll(g, palette);
  return g;
}
const kinds = (g: ReturnType<typeof land>, x0: number, x1: number, kind: string) => {
  let n = 0;
  for (let y = 0; y < 40; y++) for (let x = x0; x <= x1; x++) n += forestTrees(g, palette, x, y).filter((t) => t.kind === kind).length;
  return n;
};

describe("scatter", () => {
  test("boulders lie under a face, none out on the level", () => {
    const g = land();
    expect(kinds(g, 19, 19, "rock")).toBeGreaterThan(10);
    expect(kinds(g, 4, 14, "rock")).toBe(0);
  });

  test("tufts in a meadow; nothing under water or on paving", () => {
    const g = land();
    for (let y = 0; y < 40; y++) for (let x = 0; x < 10; x++) g.veg.cover[vegAt(g, palette, x, y)] = COVER.meadow;
    expect(kinds(g, 0, 9, "tuft")).toBeGreaterThan(40);
    for (let y = 0; y < 40; y++) { g.paved[idx(g, 19, y)] = 1; }
    expect(kinds(g, 19, 19, "rock")).toBe(0);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 10; x++) g.pool[idx(g, x, y)] = 2;
    for (let y = 0; y < 40; y++) for (let x = 0; x < 10; x++) expect(scatterOn(g, palette, x, y).length).toBe(0);
  });
});
