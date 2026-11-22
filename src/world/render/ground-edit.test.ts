import { beforeAll, describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, setHeight, setPaved, type Grid } from "../grid";
import { createBandLayer } from "./bands";
import { createGroundMesh, destroyGroundMesh, flushGround, markGround, type GroundMesh } from "./ground-mesh";
import { setGroundMode } from "./ground-mode";

const PALETTE = [null, "grass", "dirt"] as const;

/** A map of hills, the same every time. */
function hills(n = 28): Grid {
  const grid = createGrid(n, n);
  fillTerrain(grid, 1);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) setHeight(grid, x, y, Math.round(3 * Math.sin(x * 0.45) + 2.5 * Math.cos(y * 0.6) + (x * y) % 3));
  return grid;
}
/** Everything the ground draws from, copied. */
const drawn = (gm: GroundMesh) => ({
  cells: gm.cells.slice(), edges: gm.edges.slice(), shade: gm.shade.slice(),
  verts: gm.meshes.map((m) => Array.from(m.geometry.attributes.aPosition.buffer.data as Float32Array)),
});
/** As the scene tells the ground of an edit. @see world-scene.tsx */
function told(gm: GroundMesh, grid: Grid, x: number, y: number) {
  markGround(gm, grid, PALETTE, x, y); markGround(gm, grid, PALETTE, x - 1, y); markGround(gm, grid, PALETTE, x, y - 1);
  flushGround(gm, grid, PALETTE);
}

describe("the ground after an edit", () => {
  beforeAll(() => setGroundMode("smooth"));

  test("is the ground a new mesh would make of the map: texels, quads and shade", () => {
    const grid = hills(), bl = createBandLayer(grid.w, grid.h);
    const gm = createGroundMesh(grid, bl, PALETTE, 1);
    const edits: [number, number, () => void][] = [
      [6, 9, () => setHeight(grid, 6, 9, grid.height[9 * grid.w + 6] + 4)],
      [19, 14, () => setHeight(grid, 19, 14, grid.height[14 * grid.w + 19] - 3)],
      [12, 12, () => setPaved(grid, 12, 12, 1)],
      [2, 25, () => setHeight(grid, 2, 25, 9)],
      [26, 1, () => setHeight(grid, 26, 1, 8)],
    ];
    for (const [x, y, edit] of edits) { edit(); told(gm, grid, x, y); }
    const after = drawn(gm);
    destroyGroundMesh(gm);
    const fresh = createGroundMesh(grid, createBandLayer(grid.w, grid.h), PALETTE, 1);
    const want = drawn(fresh);
    expect(Array.from(after.cells)).toEqual(Array.from(want.cells));
    expect(Array.from(after.edges)).toEqual(Array.from(want.edges));
    expect(Array.from(after.shade)).toEqual(Array.from(want.shade));
    expect(after.verts).toEqual(want.verts);
  });

  test("a cell told it changed that did not leaves the ground as it was, and its copy good", () => {
    const grid = hills(), gm = createGroundMesh(grid, createBandLayer(grid.w, grid.h), PALETTE, 1);
    const rev = gm.rev;
    told(gm, grid, 10, 10);
    expect(gm.rev).toBe(rev);
    expect(gm.dirty.size).toBe(0);
    setHeight(grid, 10, 10, grid.height[10 * grid.w + 10] + 2);
    told(gm, grid, 10, 10);
    expect(gm.rev).toBeGreaterThan(rev);
  });
});
