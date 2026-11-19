import { describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, idx } from "../grid";
import { vegAll } from "../vegetation/fields";
import { FALL_MOST, fallWanted } from "./falling";
import { forestTrees } from "./forest";

/** FALLING LEAVES AND PETALS: a few trees in view, by the season. @see falling */
const palette = [null, "grass", "wood3"] as const;
function wood() {
  const g = createGrid(32, 32); fillTerrain(g, 1);
  for (let y = 4; y < 28; y++) for (let x = 4; x < 28; x++) g.terrain[idx(g, x, y)] = 2;
  vegAll(g, palette);
  return g;
}
const all = () => true;

describe("falling", () => {
  test("leaves in the autumn, a few trees, only those in view", () => {
    const g = wood(), t = 6.66;
    const fall = fallWanted(g, palette, t, all);
    expect(fall.length).toBe(FALL_MOST);
    expect(fall.every((f) => f.what === "leaves")).toBe(true);
    expect(fallWanted(g, palette, t, (x) => x < 16).every((f) => f.x < 16)).toBe(true);
    expect(fallWanted(g, palette, t, () => false)).toEqual([]);
  });

  test("none in the summer or the winter", () => {
    const g = wood();
    expect(fallWanted(g, palette, 6.4, all)).toEqual([]);
    expect(fallWanted(g, palette, 6.9, all)).toEqual([]);
  });

  test("petals in the spring, only off what blossoms", () => {
    const g = wood();
    for (const f of fallWanted(g, palette, 6.11, all)) {
      expect(f.what).toBe("petals");
      expect(forestTrees(g, palette, f.x, f.y).some((tr) => tr.kind === "cherry" || tr.kind === "apple")).toBe(true);
    }
  });
});
