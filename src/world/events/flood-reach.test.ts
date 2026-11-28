import { describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, idx, setInflow } from "../grid";
import { atRisk, floodReach, floodReachOf, keptDryBy } from "./flood-reach";
import { fourWay } from "../../state/world.store";

/** A river down column 10 of a flat meadow, coming on at the top; a hill on the right of it. */
function river() {
  const g = createGrid(40, 40);
  fillTerrain(g, 1);
  g.height.fill(4);
  for (let y = 0; y < 40; y++) {
    g.height[idx(g, 10, y)] = 0;
    g.pool[idx(g, 10, y)] = 3;
    for (let x = 11; x < 40; x++) g.height[idx(g, x, y)] = 30;
  }
  setInflow(g, 10, 0, 3);
  return g;
}
function put(g: ReturnType<typeof createGrid>, id: number, def: string, x: number, y: number) {
  g.structures.set(id, { id, def, x, y, w: 1, h: 1 });
  g.structureAt[idx(g, x, y)] = id;
  g.rev++;
}

describe("the flood line", () => {
  test("covers the low meadow beside the river, not the hill, and fades with distance", () => {
    const r = floodReach(river());
    expect(r.peak).toBeGreaterThan(0);
    expect(r.depth[idx(river(), 9, 5)]).toBeGreaterThan(0);
    expect(r.depth[idx(river(), 12, 5)]).toBe(0);
    expect(r.depth[idx(river(), 0, 5)]).toBeLessThan(r.depth[idx(river(), 9, 5)]);
  });

  test("puts a home on the meadow at risk, and one on the hill not", () => {
    const g = river();
    put(g, 1, "kit:intern.t0", 8, 6);
    put(g, 2, "kit:intern.t0", 13, 6);
    expect([...atRisk(g, floodReach(g))]).toEqual([1]);
  });

  test("is stopped by a wall along the bank, all of it", () => {
    const g = river();
    put(g, 1, "kit:intern.t0", 7, 6);
    expect(keptDryBy(g, Array.from({ length: 40 }, (_, y) => ({ x: 9, y })))).toBe(1);
    for (let y = 0; y < 40; y++) put(g, 100 + y, "levee", 9, y);
    expect(floodReachOf(g).risk.size).toBe(0);
  });

  test("a ring of walls dragged on the slant keeps a home dry, and is drawn a side at a time", () => {
    const g = river();
    put(g, 1, "kit:intern.t0", 6, 6);
    // A diamond round it, its corners joined so each wall meets the next by a side. @see fourWay
    const corners = [{ x: 6, y: 4 }, { x: 8, y: 6 }, { x: 6, y: 8 }, { x: 4, y: 6 }, { x: 6, y: 4 }];
    const line: { x: number; y: number }[] = [];
    for (let k = 0; k + 1 < corners.length; k++) {
      const a = corners[k], b = corners[k + 1], n = Math.abs(b.x - a.x);
      for (let t = 0; t < n; t++) line.push({ x: a.x + Math.sign(b.x - a.x) * t, y: a.y + Math.sign(b.y - a.y) * t });
    }
    const ring = fourWay(line);
    for (let k = 1; k < ring.length; k++) expect(Math.abs(ring[k].x - ring[k - 1].x) + Math.abs(ring[k].y - ring[k - 1].y)).toBe(1);
    expect(keptDryBy(g, ring.filter((c) => c.x !== 6 || c.y !== 6))).toBe(1);
  });

  test("is nothing on a map with no river", () => {
    expect(floodReach(createGrid(8, 8)).peak).toBe(0);
  });
});
