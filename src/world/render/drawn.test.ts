import { describe, expect, test } from "bun:test";

import { RAMP, createGrid, fillTerrain, idx, setHeight, setRamp } from "../grid";
import { CLIFF, cornerZ, drawnCorner, drawnFlat, drawnHeight, pinned } from "./drawn";

function flat(w = 4, h = 4) {
  const grid = createGrid(w, h);
  fillTerrain(grid, 1);
  return grid;
}
const CORNERS: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];

describe("the drawn surface", () => {
  test("level ground is level, and a point on it at its height", () => {
    const grid = flat();
    for (const [u, v] of CORNERS) expect(drawnCorner(grid, 1, 1, u, v)).toBe(0);
    expect(drawnFlat(grid, 1, 1)).toBe(true);
    expect(drawnHeight(grid, 1.3, 2.7)).toBe(0);
  });

  test("a step within a bank's reach: the corner between is the mean of the cells that meet there, the middle the cell's own", () => {
    const grid = flat();
    for (let y = 0; y < 4; y++) for (let x = 2; x < 4; x++) setHeight(grid, x, y, 2);
    expect(drawnCorner(grid, 1, 1, 1, 0)).toBe(1);
    expect(drawnCorner(grid, 2, 1, 0, 0)).toBe(1);
    expect(drawnCorner(grid, 1, 1, 0, 0)).toBe(0);
    expect(drawnFlat(grid, 1, 1)).toBe(false);
    expect(drawnHeight(grid, 1.5, 1.5)).toBe(0);
    expect(drawnHeight(grid, 2.5, 1.5)).toBe(2);
    expect(drawnHeight(grid, 2, 1.5)).toBe(1);
    expect(drawnHeight(grid, 1.75, 1.5)).toBeCloseTo(0.5);
  });

  test("a bigger step is a cliff: each side keeps its own", () => {
    const grid = flat();
    for (let y = 0; y < 4; y++) for (let x = 2; x < 4; x++) setHeight(grid, x, y, CLIFF + 1);
    expect(drawnCorner(grid, 1, 1, 1, 0)).toBe(0);
    expect(drawnCorner(grid, 2, 1, 0, 0)).toBe(CLIFF + 1);
  });

  test("no crack: every two cells that share a corner and are within a bank of each other say the same there", () => {
    const grid = flat(12, 12);
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) setHeight(grid, x, y, Math.floor(rnd() * 3));
    for (let Y = 1; Y < 12; Y++) for (let X = 1; X < 12; X++) {
      const at = [drawnCorner(grid, X - 1, Y - 1, 1, 1), drawnCorner(grid, X, Y - 1, 0, 1), drawnCorner(grid, X - 1, Y, 1, 0), drawnCorner(grid, X, Y, 0, 0)];
      expect(new Set(at).size).toBe(1);
    }
  });

  test("paving pins a cell flat, and the bare cell beside it takes the whole slope", () => {
    const grid = flat();
    setHeight(grid, 1, 1, 2);
    grid.paved[idx(grid, 1, 1)] = 1;
    expect(pinned(grid, 1, 1)).toBe(true);
    for (const [u, v] of CORNERS) expect(drawnCorner(grid, 1, 1, u, v)).toBe(2);
    // Its neighbour, bare at 0: up to the road's 2 along the edge they share, its own height in the middle.
    expect(drawnCorner(grid, 2, 1, 0, 0)).toBe(2);
    expect(drawnCorner(grid, 2, 1, 0, 1)).toBe(2);
    expect(drawnHeight(grid, 2.5, 1.5)).toBe(0);
  });

  test("a ramp keeps its plane", () => {
    const grid = flat();
    setRamp(grid, 1, 1, RAMP.S);
    for (const [u, v] of CORNERS) expect(drawnCorner(grid, 1, 1, u, v)).toBe(cornerZ(grid, 1, 1, u, v));
    expect(drawnHeight(grid, 1.5, 1.5)).toBe(1);
  });

  test("ground beside standing water comes down to its level at the tile's edge; the bed is flat", () => {
    const grid = flat();
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) setHeight(grid, x, y, 4);
    setHeight(grid, 1, 1, 0);
    grid.pool[idx(grid, 1, 1)] = 2;
    for (const [u, v] of CORNERS) expect(drawnCorner(grid, 1, 1, u, v)).toBe(0);
    expect(drawnCorner(grid, 2, 1, 0, 0)).toBe(2);
    expect(drawnCorner(grid, 2, 1, 1, 0)).toBe(4);
  });
});
