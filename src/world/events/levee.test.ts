import { describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, idx, setInflow } from "../grid";
import { LEVEE_MAX, leveeCells, leveeMax } from "./levee";

/** A river down column 10 of a flat meadow, coming on at the top; a hill on the right of it; a home on the meadow. */
function river(home = true) {
  const g = createGrid(40, 40);
  fillTerrain(g, 1);
  g.height.fill(4);
  for (let y = 0; y < 40; y++) {
    g.height[idx(g, 10, y)] = 0;
    g.pool[idx(g, 10, y)] = 3;
    for (let x = 11; x < 40; x++) g.height[idx(g, x, y)] = 30;
  }
  setInflow(g, 10, 0, 3);
  if (home) put(g, 1, "kit:intern.t0", 7, 6);
  return g;
}
function put(g: ReturnType<typeof createGrid>, id: number, def: string, x: number, y: number) {
  g.structures.set(id, { id, def, x, y, w: 1, h: 1 });
  g.structureAt[idx(g, x, y)] = id;
  g.rev++;
}

describe("a levee", () => {
  test("walls the low bank the flood would come over to a home, nearest the head first, and never the high one", () => {
    const g = river();
    const cells = leveeCells(g);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every((c) => c.x === 9)).toBe(true);
    expect(cells[0]).toEqual({ x: 9, y: 0 });
  });

  test("with nothing at risk, walls the bank from the head", () => {
    const cells = leveeCells(river(false));
    expect(cells[0]).toEqual({ x: 9, y: 0 });
  });

  test("leaves out what is built on, and stops at its most walls", () => {
    const g = river();
    put(g, 2, "levee", 9, 0);
    expect(leveeCells(g)).not.toContainEqual({ x: 9, y: 0 });
    expect(leveeCells(g, 3)).toHaveLength(3);
    expect(leveeMax(createGrid(10, 10))).toBe(LEVEE_MAX);
    expect(leveeMax(createGrid(200, 200))).toBeGreaterThan(LEVEE_MAX);
  });

  test("is nowhere on a map with no river", () => {
    expect(leveeCells(createGrid(8, 8))).toEqual([]);
  });
});
