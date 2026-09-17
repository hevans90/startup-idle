/**
 * Column geometry. The slab COUNT is the part worth pinning down: the cell's
 * own skirt already covers one full step, so an off-by-one here either floats
 * a plateau above a gap or stacks a slab nobody can see.
 */
import { describe, expect, test } from "bun:test";
import { Texture } from "pixi.js";

import { HEIGHT_STEP, HEIGHT_UNIT, HH, spriteY, cellToWorld } from "../iso";
import { createGrid, fillTerrain, setHeight, setTerrain } from "../grid";
import { createBandLayer } from "./bands";
import {
  OFF_MAP_HEIGHT, WALL_FRAME, buildCliffs, createCliffLayer, exposedDrop,
  slabCount, slabsFor, syncCliff,
} from "./cliffs";

const PAL = [null, "grass.png"] as const;
const TEX: Record<string, Texture> = {
  "grass.png": new Texture({ source: Texture.EMPTY.source, frame: { x: 0, y: 0, width: 132, height: 99 } as never }),
  [WALL_FRAME]: new Texture({ source: Texture.EMPTY.source, frame: { x: 0, y: 0, width: 132, height: 99 } as never }),
};

const world = (w = 8, h = 8) => {
  const grid = createGrid(w, h);
  fillTerrain(grid, 1);
  return grid;
};

describe("slabsFor", () => {
  test("a one-step drop needs nothing added — the cell's own skirt IS one step", () => {
    expect(slabsFor(0)).toBe(0);
    expect(slabsFor(1)).toBe(0);
    expect(slabsFor(2)).toBe(0);
  });

  test("each further full step adds exactly one slab", () => {
    expect(slabsFor(4)).toBe(1);
    expect(slabsFor(6)).toBe(2);
    expect(slabsFor(8)).toBe(3);
    expect(slabsFor(12)).toBe(5);
  });

  /**
   * Pins the SHARED-EDGE derivation. Measuring down the centre column instead
   * gives one slab fewer, and the shortfall renders as a black wedge along the
   * base of every cliff taller than one step.
   */
  test("the stack's bottom edge meets the lower neighbour's top edge exactly", () => {
    for (let drop = 2; drop <= 40; drop += 2) {
      const stackBottomEdge = HH + slabsFor(drop) * HEIGHT_STEP;
      const neighbourTopEdge = drop * HEIGHT_UNIT;
      expect(stackBottomEdge).toBeGreaterThanOrEqual(neighbourTopEdge);
      // ...and not by more than one slab, so nothing is drawn that cannot be seen
      expect(stackBottomEdge - neighbourTopEdge).toBeLessThan(HEIGHT_STEP);
    }
  });

  test("never negative", () => {
    expect(slabsFor(-4)).toBe(0);
  });
});

describe("exposedDrop", () => {
  test("only the two camera-facing sides count", () => {
    const grid = world();
    setHeight(grid, 4, 4, 6);
    // lower the two HIDDEN neighbours: north (x−1) and east (y−1)
    setHeight(grid, 3, 4, -4);
    setHeight(grid, 4, 3, -4);
    expect(exposedDrop(grid, 4, 4)).toBe(6 - OFF_MAP_HEIGHT);

    // now lower a VISIBLE neighbour further and the drop grows
    setHeight(grid, 5, 4, -4);
    expect(exposedDrop(grid, 4, 4)).toBe(10);
  });

  test("takes the larger of the two visible drops", () => {
    const grid = world();
    setHeight(grid, 4, 4, 4);
    setHeight(grid, 5, 4, 2);   // down-right: drop 2
    setHeight(grid, 4, 5, -2);  // down-left: drop 6
    expect(exposedDrop(grid, 4, 4)).toBe(6);
  });

  test("a flat map exposes nothing anywhere, including at the boundary", () => {
    const grid = world();
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) expect(exposedDrop(grid, x, y)).toBe(0);
    }
  });

  test("a raised boundary cell still shows its column", () => {
    const grid = world();
    setHeight(grid, 7, 7, 6);
    expect(exposedDrop(grid, 7, 7)).toBe(6);
  });

  test("off-map is the fixed datum, so digging elsewhere does not grow edges", () => {
    const grid = world();
    expect(exposedDrop(grid, 7, 3)).toBe(0);
    setHeight(grid, 1, 1, -20);          // a pit far away
    expect(exposedDrop(grid, 7, 3)).toBe(0);
  });

  test("a cell lower than its neighbours exposes nothing", () => {
    const grid = world();
    setHeight(grid, 4, 4, -6);
    expect(exposedDrop(grid, 4, 4)).toBe(0);
  });
});

describe("syncCliff", () => {
  const setup = () => {
    const grid = world();
    const bl = createBandLayer(grid.w, grid.h);
    const cl = createCliffLayer(grid, PAL, 1);
    return { grid, bl, cl };
  };

  test("stacks slabs at HEIGHT_STEP below the cell's own sprite", () => {
    const { grid, bl, cl } = setup();
    setHeight(grid, 4, 4, 8);
    syncCliff(cl, bl, grid, TEX, 4, 4);
    const slabs = cl.slabs[4 * grid.w + 4]!;
    expect(slabs).toHaveLength(3);
    const { wy } = cellToWorld(4, 4, 8, 1);
    const top = spriteY(wy, 99, 1);
    expect(slabs[0].y).toBeCloseTo(top + HEIGHT_STEP, 6);
    expect(slabs[1].y).toBeCloseTo(top + 2 * HEIGHT_STEP, 6);
    expect(slabs[2].y).toBeCloseTo(top + 3 * HEIGHT_STEP, 6);
    expect(slabs.every((s) => s.x === cellToWorld(4, 4, 8, 1).wx)).toBe(true);
  });

  /**
   * The bug this pins down: with slabs drawn in insertion order the DEEPEST
   * one landed on top, and because a tile silhouette's lower V is congruent
   * with the diamond half below it, every slab's upper diamond half was left
   * poking out of the wall as a pair of triangles. It only shows once a stack
   * is more than two slabs deep, which is why a short cliff looked fine.
   */
  test("shallower slabs draw ON TOP, so each hides the next one's diamond", () => {
    const { grid, bl, cl } = setup();
    setHeight(grid, 4, 4, 14);
    syncCliff(cl, bl, grid, TEX, 4, 4);
    const slabs = cl.slabs[4 * grid.w + 4]!;
    expect(slabs.length).toBeGreaterThan(2);

    // z ascends as the slab gets shallower, and the tier is sorted by it
    expect(bl.cliffOf[8].sortableChildren).toBe(true);
    const byDepth = [...slabs].sort((a, b) => a.y - b.y);   // shallowest first
    for (let i = 1; i < byDepth.length; i++) {
      expect(byDepth[i - 1].zIndex).toBeGreaterThan(byDepth[i].zIndex);
    }
  });

  test("a slab gained later still sorts above the ones below it", () => {
    const { grid, bl, cl } = setup();
    setHeight(grid, 4, 4, 10);
    syncCliff(cl, bl, grid, TEX, 4, 4);
    setHeight(grid, 4, 4, 16);            // grows the stack
    syncCliff(cl, bl, grid, TEX, 4, 4);
    const slabs = cl.slabs[4 * grid.w + 4]!;
    const byDepth = [...slabs].sort((a, b) => a.y - b.y);
    for (let i = 1; i < byDepth.length; i++) {
      expect(byDepth[i - 1].zIndex).toBeGreaterThan(byDepth[i].zIndex);
    }
  });

  test("lands in the band's cliff tier, beneath the static content", () => {
    const { grid, bl, cl } = setup();
    setHeight(grid, 4, 4, 6);
    syncCliff(cl, bl, grid, TEX, 4, 4);
    const band = bl.bands[8];
    expect(cl.slabs[4 * grid.w + 4]![0].parent).toBe(bl.cliffOf[8]);
    expect(band.getChildIndex(bl.cliffOf[8])).toBeLessThan(band.getChildIndex(bl.staticOf[8]));
  });

  test("shrinks in place when the drop reduces, and clears at zero", () => {
    const { grid, bl, cl } = setup();
    setHeight(grid, 4, 4, 12);
    syncCliff(cl, bl, grid, TEX, 4, 4);
    expect(cl.slabs[4 * grid.w + 4]).toHaveLength(5);

    setHeight(grid, 4, 4, 4);
    syncCliff(cl, bl, grid, TEX, 4, 4);
    expect(cl.slabs[4 * grid.w + 4]).toHaveLength(1);

    setHeight(grid, 4, 4, 0);
    syncCliff(cl, bl, grid, TEX, 4, 4);
    expect(cl.slabs[4 * grid.w + 4]).toBeNull();
  });

  test("a void cell has no column, even when it is 'higher'", () => {
    const { grid, bl, cl } = setup();
    setHeight(grid, 4, 4, 8);
    setTerrain(grid, 4, 4, 0);
    syncCliff(cl, bl, grid, TEX, 4, 4);
    expect(cl.slabs[4 * grid.w + 4]).toBeNull();
  });

  test("scale multiplies the stacking interval", () => {
    const { grid, bl } = setup();
    const cl = createCliffLayer(grid, PAL, 2);
    setHeight(grid, 4, 4, 8);
    syncCliff(cl, bl, grid, TEX, 4, 4);
    const slabs = cl.slabs[4 * grid.w + 4]!;
    const { wy } = cellToWorld(4, 4, 8, 2);
    expect(slabs[0].y).toBeCloseTo(spriteY(wy, 99, 2) + HEIGHT_STEP * 2, 6);
  });

  test("buildCliffs covers a plateau's exposed sides only", () => {
    const { grid, bl, cl } = setup();
    for (let y = 2; y <= 5; y++) for (let x = 2; x <= 5; x++) setHeight(grid, x, y, 8);
    buildCliffs(cl, bl, grid, TEX);
    // interior cells of the plateau look onto equal height on both visible sides
    expect(cl.slabs[3 * grid.w + 3]).toBeNull();
    // the down-right and down-left edges are exposed
    expect(cl.slabs[3 * grid.w + 5]).toHaveLength(3);
    expect(cl.slabs[5 * grid.w + 3]).toHaveLength(3);
    // a one-step lip adds nothing
    setHeight(grid, 6, 6, 2);
    syncCliff(cl, bl, grid, TEX, 6, 6);
    expect(cl.slabs[6 * grid.w + 6]).toBeNull();
    expect(slabCount(cl)).toBeGreaterThan(0);
  });
});

describe("wall material", () => {
  test("slabs are the WALL frame, not the cell's own surface tile", () => {
    const grid = world();
    const bl = createBandLayer(grid.w, grid.h);
    const cl = createCliffLayer(grid, PAL, 1);
    setHeight(grid, 4, 4, 12);
    syncCliff(cl, bl, grid, TEX, 4, 4);
    const slabs = cl.slabs[4 * grid.w + 4]!;
    expect(slabs.length).toBeGreaterThan(0);
    // the surface tiles draw grass with a green lip down their sides, so
    // stacking them stripes the wall whatever the draw order
    expect(slabs.every((s) => s.texture === TEX[WALL_FRAME])).toBe(true);
    expect(slabs.every((s) => s.texture !== TEX["grass.png"])).toBe(true);
  });

  test("no column where the wall frame is missing from the atlas", () => {
    const grid = world();
    const bl = createBandLayer(grid.w, grid.h);
    const cl = createCliffLayer(grid, PAL, 1);
    setHeight(grid, 4, 4, 12);
    syncCliff(cl, bl, grid, { "grass.png": TEX["grass.png"] }, 4, 4);
    expect(cl.slabs[4 * grid.w + 4]).toBeNull();
  });
});
