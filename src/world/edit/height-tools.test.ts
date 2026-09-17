/**
 * Height ops. The one that can be subtly wrong is `smooth`: computing from a
 * partly-updated field makes the result depend on the order cells arrive in,
 * so the same stroke would smooth differently for a rect than for a line.
 */
import { describe, expect, test } from "bun:test";

import { createGrid, idx, setHeight } from "../grid";
import { HEIGHT_MAX, HEIGHT_MIN, clampHeight, heightDirtyCells, heightWrites, median } from "./height-tools";

const g = (w = 8, h = 8) => createGrid(w, h, 1);
const cells = (...pairs: [number, number][]) => pairs.map(([x, y]) => ({ x, y }));
const rect = (x0: number, y0: number, w: number, h: number) => {
  const out = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) out.push({ x, y });
  return out;
};

describe("raise / lower", () => {
  test("a full step is 2 half-steps — one slab skirt", () => {
    const grid = g();
    expect(heightWrites(grid, cells([2, 2]), "raise")).toEqual([{ x: 2, y: 2, value: 2 }]);
    expect(heightWrites(grid, cells([2, 2]), "lower")).toEqual([{ x: 2, y: 2, value: -2 }]);
  });

  test("step 1 is the half step the artset actually has", () => {
    const grid = g();
    expect(heightWrites(grid, cells([2, 2]), "raise", { step: 1 })[0].value).toBe(1);
  });

  test("raising is relative to each cell, not to a shared base", () => {
    const grid = g();
    setHeight(grid, 2, 2, 6);
    const w = heightWrites(grid, cells([2, 2], [3, 3]), "raise");
    expect(w.map((r) => r.value)).toEqual([8, 2]);
  });

  test("off-map cells are dropped rather than clamped onto the edge", () => {
    expect(heightWrites(g(), cells([-1, 0], [99, 3]), "raise")).toEqual([]);
  });

  test("clamped so Int8 can never wrap a hill into a pit", () => {
    const grid = g();
    setHeight(grid, 1, 1, HEIGHT_MAX);
    expect(heightWrites(grid, cells([1, 1]), "raise")[0].value).toBe(HEIGHT_MAX);
    setHeight(grid, 1, 1, HEIGHT_MIN);
    expect(heightWrites(grid, cells([1, 1]), "lower")[0].value).toBe(HEIGHT_MIN);
    expect(clampHeight(1e9)).toBe(HEIGHT_MAX);
    expect(clampHeight(-1e9)).toBe(HEIGHT_MIN);
  });
});

describe("flatten", () => {
  test("defaults to the median, so the target is a height that actually occurs", () => {
    const grid = g();
    setHeight(grid, 0, 0, 0);
    setHeight(grid, 1, 0, 4);
    setHeight(grid, 2, 0, 10);
    const w = heightWrites(grid, cells([0, 0], [1, 0], [2, 0]), "flatten");
    expect(new Set(w.map((r) => r.value))).toEqual(new Set([4]));
  });

  test("an explicit reference overrides the median", () => {
    const grid = g();
    setHeight(grid, 1, 0, 4);
    const w = heightWrites(grid, cells([0, 0], [1, 0]), "flatten", { reference: 6 });
    expect(w.every((r) => r.value === 6)).toBe(true);
  });

  test("median takes the lower of a middle pair", () => {
    expect(median([0, 2, 4, 6])).toBe(2);
    expect(median([5])).toBe(5);
    expect(median([])).toBe(0);
  });
});

describe("smooth", () => {
  test("pulls a spike down toward its neighbours", () => {
    const grid = g();
    setHeight(grid, 4, 4, 10);
    const [w] = heightWrites(grid, cells([4, 4]), "smooth");
    // (10 + 0 + 0 + 0 + 0) / 5 = 2
    expect(w.value).toBe(2);
  });

  test("does NOT depend on the order the cells arrive in", () => {
    const build = () => {
      const grid = g();
      setHeight(grid, 3, 3, 8);
      setHeight(grid, 4, 3, 4);
      return grid;
    };
    const patch = rect(2, 2, 4, 4);
    const forward = heightWrites(build(), patch, "smooth");
    const backward = heightWrites(build(), [...patch].reverse(), "smooth");
    const key = (r: { x: number; y: number; value: number }) => `${r.x},${r.y}=${r.value}`;
    expect(new Set(forward.map(key))).toEqual(new Set(backward.map(key)));
  });

  test("a flat field is left alone", () => {
    const grid = g();
    for (let i = 0; i < grid.height.length; i++) grid.height[i] = 6;
    grid.maxHeight = grid.minHeight = 6;
    expect(heightWrites(grid, rect(2, 2, 3, 3), "smooth").every((r) => r.value === 6)).toBe(true);
  });

  test("an edge cell reads off-map as itself, so the border is not dented", () => {
    const grid = g();
    for (let i = 0; i < grid.height.length; i++) grid.height[i] = 6;
    grid.maxHeight = grid.minHeight = 6;
    const [w] = heightWrites(grid, cells([0, 0]), "smooth");
    expect(w.value).toBe(6);
  });
});

describe("heightDirtyCells", () => {
  test("includes the four neighbours, because a face belongs to the taller cell", () => {
    const grid = g();
    const d = heightDirtyCells(grid, cells([4, 4]));
    expect(d).toHaveLength(5);
    expect(new Set(d.map((c) => `${c.x},${c.y}`)))
      .toEqual(new Set(["4,4", "3,4", "5,4", "4,3", "4,5"]));
  });

  test("deduplicates and clips, so a stroke does not re-sync a cell twice", () => {
    const grid = g();
    const d = heightDirtyCells(grid, cells([0, 0], [1, 0]));
    expect(new Set(d.map((c) => idx(grid, c.x, c.y))).size).toBe(d.length);
    expect(d.every((c) => c.x >= 0 && c.y >= 0)).toBe(true);
  });
});
