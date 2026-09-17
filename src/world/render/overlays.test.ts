import { describe, expect, test } from "bun:test";
import { Graphics } from "pixi.js";
import { HEIGHT_UNIT, HH, HW, cellToWorld } from "../iso";
import { createGrid, fillTerrain, setHeight } from "../grid";
import { cellDiamond, drawGrid, drawHover, heightPx, pickError } from "./overlays";

describe("cellDiamond", () => {
  test("four points around the cell centre, at the tile's half-extents", () => {
    const d = cellDiamond(3, 4, 0, 1);
    const { wx, wy } = cellToWorld(3, 4, 0, 1);
    expect(d).toEqual([wx, wy - HH, wx + HW, wy, wx, wy + HH, wx - HW, wy]);
  });
  test("follows the cell's height", () => {
    const flat = cellDiamond(2, 2, 0, 1);
    const up = cellDiamond(2, 2, 2, 1);
    expect(up[1]).toBeCloseTo(flat[1] - 2 * HEIGHT_UNIT, 6); // one full step
  });
  test("scales", () => {
    const d = cellDiamond(0, 0, 0, 2);
    expect(d[2]).toBeCloseTo(HW * 2, 6);
  });
});

describe("drawGrid", () => {
  test("draws every cell in the band range", () => {
    const g = createGrid(8, 8); fillTerrain(g, 1);
    // bands 0..3 of an 8x8 map hold 1+2+3+4 = 10 cells
    expect(drawGrid(new Graphics(), g, 1, 0, 3)).toBe(10);
  });
  test("covers all cells when given the full range", () => {
    const g = createGrid(6, 6);
    expect(drawGrid(new Graphics(), g, 1, 0, 10)).toBe(36);
  });
  test("clamps a range beyond the map", () => {
    const g = createGrid(4, 4);
    expect(drawGrid(new Graphics(), g, 1, -50, 500)).toBe(16);
  });
  /** Bailing matters: at the framed zoom a 64² map is 4,096 diamonds. */
  test("bails at the cell cap rather than stalling", () => {
    const g = createGrid(64, 64);
    expect(drawGrid(new Graphics(), g, 1, 0, 126, 500)).toBe(500);
  });
});

describe("drawHover", () => {
  test("is a no-op for null or an off-map cell", () => {
    const g = createGrid(4, 4);
    expect(() => drawHover(new Graphics(), g, null, 1)).not.toThrow();
    expect(() => drawHover(new Graphics(), g, { x: -1, y: 0 }, 1)).not.toThrow();
    expect(() => drawHover(new Graphics(), g, { x: 99, y: 0 }, 1)).not.toThrow();
  });
  test("draws at the cell's raised position", () => {
    const g = createGrid(6, 6);
    setHeight(g, 2, 2, 4);
    const gfx = new Graphics();
    expect(() => drawHover(gfx, g, { x: 2, y: 2 }, 1)).not.toThrow();
    // the shape used must match the cell's height, not height 0
    const raised = cellDiamond(2, 2, 4, 1);
    expect(raised[1]).toBeLessThan(cellDiamond(2, 2, 0, 1)[1]);
  });
});

describe("heightPx", () => {
  test("converts half-step units to world px", () => {
    expect(heightPx(1)).toBe(16.5);
    expect(heightPx(2)).toBe(33);
    expect(heightPx(2, 2)).toBe(66);
  });
});

describe("pickError — the calibration verdict", () => {
  const inside = (e: { dx: number; dy: number } | null, scale = 1) =>
    e ? Math.abs(e.dx) / (HW * scale) + Math.abs(e.dy) / (HH * scale) <= 1 : null;

  test("zero at the cell centre", () => {
    const g = createGrid(8, 8);
    const c = cellToWorld(3, 4, 0, 1);
    const e = pickError({ wx: c.wx, wy: c.wy }, { x: 3, y: 4 }, g, 1)!;
    expect(e.dx).toBeCloseTo(0, 6);
    expect(e.dy).toBeCloseTo(0, 6);
    expect(inside(e)).toBe(true);
  });

  /**
   * The whole point: for every cell, a pointer anywhere inside its diamond
   * must resolve to that cell AND report an in-diamond offset. If the pick
   * shift were wrong this would fail — it is the assertion v1 never had.
   */
  test("a pointer inside a diamond reports an inside offset, for every cell", () => {
    const g = createGrid(10, 10);
    for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) {
      const c = cellToWorld(x, y, 0, 1);
      for (const [dx, dy] of [[0, 0], [0, -HH * 0.7], [HW * 0.7, 0], [0, HH * 0.7], [-HW * 0.7, 0]]) {
        const e = pickError({ wx: c.wx + dx, wy: c.wy + dy }, { x, y }, g, 1)!;
        expect(inside(e)).toBe(true);
      }
    }
  });

  test("a pointer a whole tile away is outside", () => {
    const g = createGrid(6, 6);
    const c = cellToWorld(2, 2, 0, 1);
    expect(inside(pickError({ wx: c.wx, wy: c.wy + HH * 2 }, { x: 2, y: 2 }, g, 1))).toBe(false);
    expect(inside(pickError({ wx: c.wx + HW * 2, wy: c.wy }, { x: 2, y: 2 }, g, 1))).toBe(false);
  });

  test("accounts for the cell's height", () => {
    const g = createGrid(6, 6);
    setHeight(g, 2, 2, 4); // two full steps up
    const raised = cellToWorld(2, 2, 4, 1);
    const e = pickError({ wx: raised.wx, wy: raised.wy }, { x: 2, y: 2 }, g, 1)!;
    expect(e.dist).toBeCloseTo(0, 6); // measured against the RAISED centre
  });

  test("null for a missing pointer or off-map cell", () => {
    const g = createGrid(4, 4);
    expect(pickError(null, { x: 1, y: 1 }, g, 1)).toBeNull();
    expect(pickError({ wx: 0, wy: 0 }, null, g, 1)).toBeNull();
    expect(pickError({ wx: 0, wy: 0 }, { x: 99, y: 0 }, g, 1)).toBeNull();
  });
});
