import { describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, idx, setInflow } from "../grid";
import { createWaterField, pourAt } from "../water/field";
import { fluidIndexOf } from "../water/materials";
import { LEVEE_MAX, LEVEE_REACH, leveeCells } from "./levee";

/** A river down column 10 of a flat meadow, coming on at the top; a hill on the right of it. */
function river() {
  const g = createGrid(40, 40);
  fillTerrain(g, 1);
  g.height.fill(4);
  for (let y = 0; y < 40; y++) { g.height[idx(g, 10, y)] = 0; for (let x = 11; x < 40; x++) g.height[idx(g, x, y)] = 30; }
  setInflow(g, 10, 0, 3);
  const field = createWaterField(g);
  for (let y = 0; y < 40; y++) pourAt(field, 10, y, 3, fluidIndexOf("water"));
  return { g, field };
}

describe("a levee", () => {
  test("walls the low bank beside the river near its head, nearest first, and never the high one", () => {
    const { g, field } = river();
    const cells = leveeCells(g, field);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every((c) => c.x === 9)).toBe(true);
    expect(cells[0]).toEqual({ x: 9, y: 0 });
    expect(Math.max(...cells.map((c) => c.y))).toBeLessThanOrEqual(LEVEE_REACH);
  });

  test("leaves out what is built on, and stops at its most walls", () => {
    const { g, field } = river();
    g.structures.set(1, { id: 1, def: "levee", x: 9, y: 0, w: 1, h: 1 });
    g.structureAt[idx(g, 9, 0)] = 1;
    expect(leveeCells(g, field)).not.toContainEqual({ x: 9, y: 0 });
    expect(leveeCells(g, field, 3)).toHaveLength(3);
    expect(LEVEE_MAX).toBeGreaterThan(LEVEE_REACH);
  });

  test("is nowhere on a map with no river", () => {
    const g = createGrid(8, 8);
    expect(leveeCells(g, createWaterField(g))).toEqual([]);
  });
});
