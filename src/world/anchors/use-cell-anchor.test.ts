import { describe, expect, test } from "bun:test";
import { HH, cellToWorld } from "../iso";
import { heightWorldPx, projectCell } from "./use-cell-anchor";

// identity projection, so we can assert on world coords directly
const identity = (x: number, y: number) => ({ x, y });

describe("projectCell", () => {
  test("anchors to the cell's TOP vertex, not its centre", () => {
    const p = projectCell({ x: 3, y: 4 }, 0, 1, identity);
    const { wx, wy } = cellToWorld(3, 4, 0, 1);
    expect(p).toEqual({ x: wx, y: wy - HH });
  });

  test("follows the cell's height up-screen", () => {
    const flat = projectCell({ x: 2, y: 2 }, 0, 1, identity);
    const up = projectCell({ x: 2, y: 2 }, 2, 1, identity); // one full step
    expect(up.y).toBeCloseTo(flat.y - 33, 6);
    expect(up.x).toBe(flat.x); // height never moves x
  });

  test("lift raises the anchor further, in height units", () => {
    const base = projectCell({ x: 1, y: 1 }, 0, 1, identity);
    const lifted = projectCell({ x: 1, y: 1 }, 0, 1, identity, 2);
    expect(lifted.y).toBeCloseTo(base.y - 33, 6);
  });

  test("uses the supplied projection", () => {
    const p = projectCell({ x: 0, y: 0 }, 0, 1, (x, y) => ({ x: x + 100, y: y + 50 }));
    expect(p).toEqual({ x: 100, y: 50 - HH });
  });

  test("scales", () => {
    const a = projectCell({ x: 4, y: 2 }, 0, 1, identity);
    const b = projectCell({ x: 4, y: 2 }, 0, 2, identity);
    expect(b.x).toBeCloseTo(a.x * 2, 6);
  });
});

describe("heightWorldPx", () => {
  test("half steps to px", () => {
    expect(heightWorldPx(1)).toBe(16.5);
    expect(heightWorldPx(2)).toBe(33);
  });
});
