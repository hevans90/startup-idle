import { describe, expect, test } from "bun:test";

import { FLOOD_HOLD, FLOOD_OVER, FLOOD_SECONDS, FLOOD_UP, floodPeak, riseAt, riverHead } from "./flood";
import { createGrid, setInflow } from "../grid";

describe("a flood's rise", () => {
  test("climbs, holds and falls back to nothing", () => {
    expect(riseAt(0, 6)).toBe(0);
    expect(riseAt(FLOOD_UP / 2, 6)).toBe(3);
    expect(riseAt(FLOOD_UP + FLOOD_HOLD / 2, 6)).toBe(6);
    expect(riseAt(FLOOD_SECONDS, 6)).toBe(0);
  });

  test("tops the lowest bank near the head, by a little", () => {
    const g = createGrid(12, 12);
    g.height.fill(16);
    for (let y = 0; y < 12; y++) for (let x = 0; x < 3; x++) g.height[y * 12 + x] = 0;
    g.height[5 * 12 + 4] = 12;
    setInflow(g, 0, 5, 8);
    expect(floodPeak(g)).toBe(12 - 8 + FLOOD_OVER);
    expect(floodPeak(createGrid(4, 4))).toBe(0);
  });
});

describe("the river's head", () => {
  test("is the middle of the inflow, and there is none without one", () => {
    const g = createGrid(8, 8);
    expect(riverHead(g)).toBeNull();
    setInflow(g, 0, 3, 2);
    setInflow(g, 0, 5, 2);
    expect(riverHead(g)).toEqual({ x: 0, y: 4 });
  });
});
