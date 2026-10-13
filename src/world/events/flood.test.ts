import { describe, expect, test } from "bun:test";

import {
  FLOOD_HOLD, FLOOD_OVER, FLOOD_SECONDS, FLOOD_UP, REPAIR_SECONDS, damage, damagedAway, floodPeak, isDamaged, portShut, repairedIn, riseAt, riverHead, stepRepairs,
} from "./flood";
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

describe("flood damage", () => {
  test("idles a house and shuts a port until the crew has been round each, one at a time, once the water is down", () => {
    const g = createGrid(12, 12);
    g.structures.set(1, { id: 1, def: "kit:intern.t0", x: 1, y: 1, w: 1, h: 1, residents: 2 });
    g.structures.set(2, { id: 2, def: "seaport", x: 5, y: 5, w: 2, h: 2 });
    damage(g, [1, 2]);
    expect(damagedAway(g)).toEqual({ intern: 2 });
    expect(portShut(2)).toBe(true);
    expect(repairedIn(2)).toBe(2 * REPAIR_SECONDS);
    expect(stepRepairs(g, REPAIR_SECONDS, true)).toEqual([]);
    expect(stepRepairs(g, REPAIR_SECONDS + 1, false)).toEqual([1]);
    expect(isDamaged(1)).toBe(false);
    expect(repairedIn(2)).toBe(REPAIR_SECONDS - 1);
    expect(stepRepairs(g, REPAIR_SECONDS, false)).toEqual([2]);
    expect(portShut(2)).toBe(false);
  });

  test("is not carried onto another map", () => {
    const g = createGrid(4, 4), other = createGrid(4, 4);
    g.structures.set(1, { id: 1, def: "kit:intern.t0", x: 1, y: 1, w: 1, h: 1 });
    other.structures.set(1, { id: 1, def: "kit:intern.t0", x: 1, y: 1, w: 1, h: 1 });
    damage(g, [1]);
    stepRepairs(other, 0, false);
    expect(isDamaged(1)).toBe(false);
  });
});
