/**
 * The build cursor's pure parts. The perimeter derivation is the one that can
 * be silently wrong — a mis-mapped edge produces an outline with holes that
 * still looks plausible at a glance.
 */
import { describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, setHeight, setTerrain } from "../grid";
import { HH, HW, cellToWorld } from "../iso";
import {
  cursorSignature, footprintPerimeter, validateErase, validatePaint, validatorFor,
} from "./cursor";

const g = () => {
  const grid = createGrid(8, 8);
  fillTerrain(grid, 1);
  return grid;
};

const rect = (x0: number, y0: number, w: number, h: number) => {
  const out = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) out.push({ x, y });
  return out;
};

describe("footprintPerimeter", () => {
  test("a single cell is its whole diamond — four segments", () => {
    expect(footprintPerimeter(g(), [{ x: 3, y: 3 }], 1)).toHaveLength(4);
  });

  test("interior edges are dropped, so an N×N traces only its outside", () => {
    // 4 cells share 4 internal edges; 16 total - 4 shared pairs*2 = 8
    expect(footprintPerimeter(g(), rect(2, 2, 2, 2), 1)).toHaveLength(8);
    // a 3×3: 36 edges, 12 internal edges counted twice = 36 - 24 = 12
    expect(footprintPerimeter(g(), rect(2, 2, 3, 3), 1)).toHaveLength(12);
    // 5×5 perimeter is 4n = 20
    expect(footprintPerimeter(g(), rect(1, 1, 5, 5), 1)).toHaveLength(20);
  });

  test("the perimeter is closed — every vertex is used an even number of times", () => {
    const segs = footprintPerimeter(g(), rect(2, 2, 3, 3), 1);
    const seen = new Map<string, number>();
    for (const [x0, y0, x1, y1] of segs) {
      for (const k of [`${x0.toFixed(3)},${y0.toFixed(3)}`, `${x1.toFixed(3)},${y1.toFixed(3)}`]) {
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
    }
    for (const [, n] of seen) expect(n % 2).toBe(0);
  });

  test("segments sit on the cell's own diamond, at its own height", () => {
    const grid = g();
    setHeight(grid, 3, 3, 4);
    const [seg] = footprintPerimeter(grid, [{ x: 3, y: 3 }], 1);
    const { wx, wy } = cellToWorld(3, 3, 4, 1);
    // N vertex is the first edge's start: (wx, wy - HH)
    expect(seg[0]).toBeCloseTo(wx, 6);
    expect(seg[1]).toBeCloseTo(wy - HH, 6);
    // ...and its end is the E vertex
    expect(seg[2]).toBeCloseTo(wx + HW, 6);
    expect(seg[3]).toBeCloseTo(wy, 6);
  });

  test("an L shape keeps the notch — the count is not just 4n", () => {
    const cells = [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 }];
    expect(footprintPerimeter(g(), cells, 1)).toHaveLength(8);
  });

  test("out-of-bounds cells contribute nothing", () => {
    expect(footprintPerimeter(g(), [{ x: -1, y: 0 }, { x: 99, y: 0 }], 1)).toHaveLength(0);
  });

  test("scale multiplies the geometry", () => {
    const [a] = footprintPerimeter(g(), [{ x: 3, y: 3 }], 1);
    const [b] = footprintPerimeter(g(), [{ x: 3, y: 3 }], 2);
    expect(b[0]).toBeCloseTo(a[0] * 2, 6);
    expect(b[1]).toBeCloseTo(a[1] * 2, 6);
  });
});

describe("validators", () => {
  test("paint accepts any in-bounds cell and rejects off-map", () => {
    expect(validatePaint(g(), 0, 0).ok).toBe(true);
    expect(validatePaint(g(), -1, 0).ok).toBe(false);
    expect(validatePaint(g(), -1, 0).reason).toBe("off map");
  });

  test("erase rejects a cell that is already void, with a reason", () => {
    const grid = g();
    expect(validateErase(grid, 4, 4).ok).toBe(true);
    setTerrain(grid, 4, 4, 0);
    expect(validateErase(grid, 4, 4).ok).toBe(false);
    expect(validateErase(grid, 4, 4).reason).toBe("already empty");
  });

  test("validatorFor routes erase separately from the paint tools", () => {
    const grid = g();
    setTerrain(grid, 4, 4, 0);
    expect(validatorFor("erase")(grid, 4, 4).ok).toBe(false);
    expect(validatorFor("paintTerrain")(grid, 4, 4).ok).toBe(true);
  });
});

describe("cursorSignature", () => {
  const input = (over = {}) => ({
    cells: rect(2, 2, 2, 2), frame: "a.png", tool: "paintTerrain" as const, scale: 1, ...over,
  });

  test("identical state gives an identical signature — the redraw is skipped", () => {
    const grid = g();
    expect(cursorSignature(grid, input(), validatePaint))
      .toBe(cursorSignature(grid, input(), validatePaint));
  });

  test("a height change under the footprint changes it", () => {
    const grid = g();
    const before = cursorSignature(grid, input(), validatePaint);
    setHeight(grid, 2, 2, 2);
    expect(cursorSignature(grid, input(), validatePaint)).not.toBe(before);
  });

  test("frame, scale, tool and cells each change it", () => {
    const grid = g();
    const base = cursorSignature(grid, input(), validatePaint);
    for (const over of [{ frame: "b.png" }, { scale: 2 }, { tool: "erase" as const }, { cells: rect(2, 2, 3, 3) }]) {
      expect(cursorSignature(grid, input(over), validatePaint)).not.toBe(base);
    }
  });

  test("validity flips it, so a cell becoming blocked forces a redraw", () => {
    const grid = g();
    const i = input({ tool: "erase" as const });
    const before = cursorSignature(grid, i, validateErase);
    setTerrain(grid, 2, 2, 0);
    expect(cursorSignature(grid, i, validateErase)).not.toBe(before);
  });
});
