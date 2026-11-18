import { describe, expect, test } from "bun:test";

import { RAMP, createGrid, fillTerrain, idx, setHeight, setRamp, surfaceSampler } from "../grid";
import { HEIGHT_UNIT, HH, HW, pickCell } from "../iso";
import { CLIFF, SHELF, cornerZ, drawnCentre, drawnCorner, drawnFlat, drawnHeight, drawnSampler, pinned, shelfOf } from "./drawn";

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

  test("the shore: water beside low land is drawn on a shelf, and every corner they share stands over the water", () => {
    const grid = flat(8, 8);
    // Land at 4 where y < x (a 1:1 stepped bank), water over a bed at -4 to a level of 2 elsewhere.
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      if (y < x) setHeight(grid, x, y, 4);
      else { setHeight(grid, x, y, -4); grid.pool[idx(grid, x, y)] = 6; }
    }
    // A pocket of the bank, land on two sides: a shelf just under the water.
    expect(shelfOf(grid, 3, 3)).toBeCloseTo(2 - SHELF);
    // Its middle is the mean of its corners, so it is as near a plane as they allow.
    expect(drawnCentre(grid, 3, 3)).toBeCloseTo((drawnCorner(grid, 3, 3, 0, 0) + drawnCorner(grid, 3, 3, 1, 0) + drawnCorner(grid, 3, 3, 1, 1) + drawnCorner(grid, 3, 3, 0, 1)) / 4);
    expect(drawnCentre(grid, 3, 3)).toBeLessThan(2);
    // Out in the water: its bed.
    expect(shelfOf(grid, 1, 5)).toBeNull();
    expect(drawnCentre(grid, 1, 5)).toBe(-4);
    // Land and water say the same at every corner they share: over the water in a pocket of the bank, and just
    // under it at the tip of a point of land, so no spur stands out along the tiles' edge.
    for (let k = 2; k < 6; k++) {
      expect(drawnCorner(grid, k, k, 0, 0)).toBeCloseTo(2 - 0.15);
      expect(drawnCorner(grid, k, k, 0, 0)).toBe(drawnCorner(grid, k, k - 1, 0, 1));
      expect(drawnCorner(grid, k, k, 1, 0)).toBeGreaterThan(2);
    }
    // And the pocket's corner out in the water is under it: the shoreline crosses the tile.
    expect(drawnCorner(grid, 3, 3, 0, 1)).toBeLessThan(2);
  });

  test("no shelf at a lip, nor beside one: the water there is drawn down to its fall", () => {
    const grid = flat(8, 4);
    // Land along the top row at 4; water at a level of 2 along the middle, its bed at 0; and off its end, a drop.
    for (let x = 0; x < 8; x++) setHeight(grid, x, 0, 4);
    for (let x = 0; x < 5; x++) for (const y of [1, 2, 3]) { setHeight(grid, x, y, 0); grid.pool[idx(grid, x, y)] = 2; }
    for (const x of [5, 6, 7]) for (const y of [1, 2, 3]) setHeight(grid, x, y, -8);
    expect(shelfOf(grid, 1, 1)).not.toBeNull();
    expect(shelfOf(grid, 4, 1)).toBeNull(); // the lip
    expect(shelfOf(grid, 3, 1)).toBeNull(); // and the tile behind it
  });

  test("land too far over the water is a cliff into it: no shelf", () => {
    const grid = flat(3, 1);
    setHeight(grid, 0, 0, 9);
    for (const x of [1, 2]) { setHeight(grid, x, 0, 0); grid.pool[idx(grid, x, 0)] = 2; }
    expect(shelfOf(grid, 1, 0)).toBeNull();
    expect(drawnCorner(grid, 1, 0, 0, 0)).toBe(0);
    expect(drawnCorner(grid, 0, 0, 1, 0)).toBe(9);
  });

  test("what is pointed at on a bank is the cell drawn there: a point of each cell's drawn face picks that cell", () => {
    const grid = flat(10, 10);
    // Ground falling toward the eye, a half step a tile each way and a little uneven: banks everywhere, none behind another.
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) setHeight(grid, x, y, 24 - x - y - ((x * 7 + y * 3) % 2));
    const at = drawnSampler(grid, surfaceSampler(grid));
    let banks = 0;
    for (let Y = 2; Y < 8; Y++) for (let X = 2; X < 8; X++) {
      if (at(X, Y)?.fan) banks++;
      for (const [u, v] of [[0.5, 0.5], [0.2, 0.3], [0.8, 0.25], [0.7, 0.85], [0.15, 0.8], [0.5, 0.1], [0.9, 0.5]]) {
        const z = drawnHeight(grid, X + u, Y + v);
        const wx = (X + u - (Y + v)) * HW, wy = (X + u + Y + v - 1) * HH - z * HEIGHT_UNIT;
        expect(pickCell(wx, wy, at, { min: -3, max: 27 })).toEqual({ x: X, y: Y });
      }
    }
    expect(banks).toBeGreaterThan(20);
  });
});
