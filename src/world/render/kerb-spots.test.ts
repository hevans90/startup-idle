/** A JOB'S MACHINES PULL OVER on the verge, a tile each, never two in one place — whichever job each is for. */
import { beforeEach, describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, idx } from "../grid";
import { kerbFrame, kerbHeld, kerbReset, kerbSpot } from "./kerb-spots";

const map = () => {
  const g = createGrid(30, 20);
  fillTerrain(g, 1);
  for (let x = 0; x < 30; x++) g.paved[idx(g, x, 5)] = 1;
  return g;
};

describe("kerb spots", () => {
  beforeEach(() => kerbReset());

  test("each machine of two jobs side by side has a spot of its own, on the verge beside a road tile, nose along the road, off both jobs", () => {
    const g = map();
    // Two jobs leaving the road a tile apart, as a road built a piece at a time would not, but two side by side might.
    g.roadJobs.push({ id: 1, cells: [6, 7, 8].map((y) => ({ x: 10, y, z: 0, deck: false, from: 0, fresh: true })), levelled: [], t: 0, tm: 0, dug: 0, opened: 0, lengths: [3], delivered: 0, deliveries: 1, cost: 1, overland: [], stalled: 0, at: 0 });
    g.roadJobs.push({ id: 2, cells: [6, 7, 8].map((y) => ({ x: 11, y, z: 0, deck: false, from: 0, fresh: true })), levelled: [], t: 0, tm: 0, dug: 0, opened: 0, lengths: [3], delivered: 0, deliveries: 1, cost: 1, overland: [], stalled: 0, at: 0 });
    const spots = new Map<string, { x: number; y: number; heading: number }>();
    for (const job of [1, 2]) for (let k = 0; k < 10; k++) {
      const s = kerbSpot(g, `road:${job}:m${k}`, { x: 9 + job, y: 5 });
      expect(s).not.toBeNull();
      spots.set(`${job}:${k}`, s!);
    }
    const cells = new Set([...spots.values()].map((s) => `${Math.round(s.x)},${Math.round(s.y)}`));
    expect(cells.size).toBe(20);
    for (const s of spots.values()) {
      // Beside the road (y 5), on a tile that is not road and not either job's.
      expect(Math.abs(s.y - 5)).toBeCloseTo(0.68, 5);
      const cx = Math.round(s.x), cy = Math.round(s.y);
      expect(g.paved[idx(g, cx, cy)]).toBe(0);
      expect(cy !== 5 && (cx === 10 || cx === 11) && cy > 5).toBe(false);
      // Nose along the road: east or west.
      expect(Math.abs(Math.sin(s.heading))).toBeLessThan(1e-9);
    }
    // Asked again, each keeps its own.
    expect(kerbSpot(g, "road:1:m0", { x: 10, y: 5 })).toEqual(spots.get("1:0")!);
  });

  test("a spot is given up by a machine no longer drawn, and kept by one that is", () => {
    const g = map();
    const a = kerbSpot(g, "a", { x: 10, y: 5 })!, b = kerbSpot(g, "b", { x: 10, y: 5 })!;
    expect(a).not.toEqual(b);
    for (let k = 0; k < 5; k++) { kerbFrame(); kerbSpot(g, "b", { x: 10, y: 5 }); }
    expect(kerbHeld().has("a")).toBe(false);
    expect(kerbHeld().has("b")).toBe(true);
    // (Its spot free again: the next to ask has it.)
    expect(kerbSpot(g, "c", { x: 10, y: 5 })).toEqual(a);
  });

  test("not on a building, nor on a cell that has become road", () => {
    const g = map();
    for (let x = 8; x <= 12; x++) { g.structureAt[idx(g, x, 4)] = 99; g.structureAt[idx(g, x, 6)] = 99; }
    const s = kerbSpot(g, "a", { x: 10, y: 5 })!;
    expect(Math.abs(Math.round(s.x) - 10)).toBeGreaterThanOrEqual(3);
    g.paved[idx(g, Math.round(s.x), Math.round(s.y))] = 1;
    g.rev++;
    const t = kerbSpot(g, "a", { x: 10, y: 5 })!;
    expect(g.paved[idx(g, Math.round(t.x), Math.round(t.y))]).toBe(0);
  });
});
