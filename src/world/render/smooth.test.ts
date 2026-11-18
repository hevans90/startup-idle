import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, idx, setHeight } from "../grid";
import { bandQuads } from "./ground-mesh";
import { drawnCorner, drawnHeight, smoothAt, smoothPlain } from "./drawn";
import { setGroundMode } from "./ground-mode";

const PALETTE = [null, "grass"] as const;
function rough(n = 12) {
  const grid = createGrid(n, n);
  fillTerrain(grid, 1);
  let seed = 99;
  const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) setHeight(grid, x, y, Math.floor(rnd() * 12));
  return grid;
}

describe("the ground as one continuous surface", () => {
  beforeAll(() => setGroundMode("smooth"));
  afterAll(() => setGroundMode("steps"));

  test("goes through every cell's own height at its middle", () => {
    const grid = rough();
    for (let y = 2; y < 10; y++) for (let x = 2; x < 10; x++) expect(smoothPlain(grid, x + 0.5, y + 0.5)).toBeCloseTo(grid.height[idx(grid, x, y)], 9);
  });

  test("never overshoots: between cells it stays within what the cells round it are", () => {
    const grid = rough();
    for (let y = 2; y < 9; y += 0.31) for (let x = 2; x < 9; x += 0.37) {
      let lo = Infinity, hi = -Infinity;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const h = grid.height[idx(grid, Math.floor(x) + dx, Math.floor(y) + dy)]; lo = Math.min(lo, h); hi = Math.max(hi, h); }
      const z = smoothPlain(grid, x, y);
      expect(z).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(z).toBeLessThanOrEqual(hi + 1e-9);
    }
  });

  test("an even slope is a plane, and level ground level", () => {
    const grid = createGrid(8, 8);
    fillTerrain(grid, 1);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) setHeight(grid, x, y, x * 2);
    expect(smoothPlain(grid, 3.5, 4)).toBeCloseTo(6, 9);
    expect(smoothPlain(grid, 4, 4.2)).toBeCloseTo(7, 9);
    expect(smoothPlain(grid, 4.25, 3.9)).toBeCloseTo(7.5, 9);
  });

  test("one surface: every cell says the same at a corner they share, however rough the ground — no wall, no wedge", () => {
    const grid = rough();
    for (let Y = 1; Y < 12; Y++) for (let X = 1; X < 12; X++) {
      const at = [drawnCorner(grid, X - 1, Y - 1, 1, 1), drawnCorner(grid, X, Y - 1, 0, 1), drawnCorner(grid, X - 1, Y, 1, 0), drawnCorner(grid, X, Y, 0, 0)];
      expect(Math.max(...at) - Math.min(...at)).toBeLessThan(1e-9);
    }
    // And the mesh has no wall inside the map: only tops, and the map's own edge.
    for (let b = 4; b < 16; b++) {
      const q = bandQuads(grid, PALETTE, b);
      for (let k = 0; k < q.quads; k++) {
        const kind = q.verts[k * 4 * 7 + 4];
        if (kind < 0.5) continue;
        const gu = q.verts[k * 4 * 7 + 2], gv = q.verts[k * 4 * 7 + 3];
        expect(gu === 12 || gv === 12).toBe(true);
      }
    }
  });

  test("built ground is flat across its tile, and the bare ground beside it comes to meet it at its edge", () => {
    const grid = rough();
    grid.paved[idx(grid, 5, 5)] = 1;
    const h = grid.height[idx(grid, 5, 5)];
    for (const [fx, fy] of [[5, 5], [5.5, 5.5], [6, 5.3], [5.2, 6], [6, 6]]) expect(drawnHeight(grid, fx, fy)).toBeCloseTo(h, 9);
    // Just off its edge, on bare ground: all but at its height; half a tile off, the bare ground's own.
    expect(Math.abs(smoothAt(grid, 6.02, 5.5) - h)).toBeLessThan(0.2);
    expect(smoothPlain(grid, 6.5, 5.5)).toBeCloseTo(grid.height[idx(grid, 6, 5)], 9);
  });

  test("it wanders: a straight crest is not drawn straight, level ground stays level, and it is never read more than a third of a tile aside", () => {
    const grid = createGrid(16, 16);
    fillTerrain(grid, 1);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) setHeight(grid, x, y, y >= 8 ? 6 : 0);
    // Along the middle of the face, the height differs from tile to tile.
    const along = Array.from({ length: 10 }, (_, k) => smoothAt(grid, 3 + k, 8));
    expect(Math.max(...along) - Math.min(...along)).toBeGreaterThan(0.5);
    // Well back on the level it is level; and nowhere is it outside what the plain surface is within a third of a tile.
    for (let x = 2; x < 14; x += 0.7) { expect(smoothAt(grid, x, 3.5)).toBeCloseTo(0, 9); expect(smoothAt(grid, x, 12.5)).toBeCloseTo(6, 9); }
    for (let x = 2; x < 14; x += 0.43) for (let y = 6.5; y < 9.5; y += 0.21) {
      const z = smoothAt(grid, x, y);
      expect(z).toBeGreaterThanOrEqual(smoothPlain(grid, x, y - 0.34) - 1e-9);
      expect(z).toBeLessThanOrEqual(smoothPlain(grid, x, y + 0.34) + 1e-9);
    }
  });
});
