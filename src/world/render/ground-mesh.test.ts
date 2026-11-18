import { describe, expect, test } from "bun:test";

import { RAMP, VOID, createGrid, fillTerrain, packRamp, setHeight, setRamp, setTerrain, type RampDir } from "../grid";
import { GROUND, bandQuads, cornerZ, groundClassOf, groundDraws, slopeLight, wallFoot } from "./ground-mesh";

const GRASS = 1, DIRT = 2, SAND = 3, WOODS = 4, OTHER = 5;
// The fifth is a frame from the old tile browser, as an old save's palette has it: grass now.
const PALETTE = [null, "grass", "dirt", "landscapeTiles_059.png", "wood1", "landscapeTiles_001.png"] as const;

function flat(w = 4, h = 4, mat = GRASS) {
  const grid = createGrid(w, h);
  fillTerrain(grid, mat);
  return grid;
}

/** The kinds (0 top — whose word there is the light on it, under a half — 1 face +x, 2 face +y, 3 fringe) of a band's quads, in order. */
const kinds = (q: ReturnType<typeof bandQuads>) =>
  Array.from({ length: q.quads }, (_, k) => { const w = q.verts[k * 4 * 6 + 4]; return w < 0.5 ? 0 : w; });

describe("groundClassOf", () => {
  test("grass, dirt and sand by name, old names too; woods blend as grass; a frame the game no longer has is grass", () => {
    expect(groundClassOf(PALETTE, GRASS)).toBe(GROUND.grass);
    expect(groundClassOf(PALETTE, DIRT)).toBe(GROUND.dirt);
    expect(groundClassOf(PALETTE, SAND)).toBe(GROUND.sand);
    expect(groundClassOf(PALETTE, WOODS)).toBe(GROUND.grass);
    expect(groundClassOf(PALETTE, OTHER)).toBe(GROUND.grass);
    expect(groundClassOf(PALETTE, VOID)).toBe(GROUND.none);
  });
});

describe("groundDraws", () => {
  test("every cell with ground on it, and none off the map", () => {
    const grid = flat(3, 1);
    setTerrain(grid, 1, 0, WOODS);
    setTerrain(grid, 2, 0, OTHER);
    expect(groundDraws(grid, PALETTE, 0, 0)).toBe(true);
    expect(groundDraws(grid, PALETTE, 1, 0)).toBe(true);
    expect(groundDraws(grid, PALETTE, 2, 0)).toBe(true);
    expect(groundDraws(grid, PALETTE, 5, 0)).toBe(false);
  });
});

describe("wallFoot", () => {
  test("down to a lower neighbour, never up to a higher one", () => {
    const grid = flat(2, 1);
    setHeight(grid, 0, 0, 6);
    setHeight(grid, 1, 0, 1);
    expect(wallFoot(grid, 0, 0, 1, 0)).toBe(1);
    expect(wallFoot(grid, 1, 0, 0, 0)).toBe(1);
  });

  test("off the map or over a void, at least a step down", () => {
    const grid = flat(2, 1);
    // Off the map: the map's one underside, a little under the lowest ground on its edge.
    expect(wallFoot(grid, 1, 0, 2, 0)).toBe(-3);
    setHeight(grid, 0, 0, 6);
    setTerrain(grid, 1, 0, VOID);
    expect(wallFoot(grid, 0, 0, 1, 0)).toBe(0);
  });
});

describe("bandQuads", () => {
  test("a flat field inside the map is tops only", () => {
    const grid = flat(4, 4);
    const q = bandQuads(grid, PALETTE, 2);
    expect(kinds(q)).toEqual([0, 0, 0]);
    expect(q.idx.length).toBe(q.quads * 6);
  });

  test("the map's front edges get their walls", () => {
    const grid = flat(2, 2);
    // Band 2 is the front corner (1, 1): both faces hang off the map.
    expect(kinds(bandQuads(grid, PALETTE, 2))).toEqual([0, 1, 2]);
  });

  test("a raised cell walls down to its lower neighbours in front, its depth in half steps", () => {
    const grid = flat(3, 3);
    setHeight(grid, 1, 1, 5); // a cliff: over a bank's reach, so it stands on walls
    const q = bandQuads(grid, PALETTE, 2);
    // (0, 2) walls off the map's front; (1, 1) down both faces, and fringes
    // over the lower ground behind it; (2, 0) off the map's side.
    expect(kinds(q)).toEqual([0, 2, 0, 1, 2, 3, 3, 0, 1]);
    // (1, 1)'s +x face: its bottom corners sit 5 half steps below its top.
    const face = 3 * 4 * 6;
    expect(q.verts[face + 2 * 6 + 5]).toBe(5);
    expect(q.verts[face + 2 * 6 + 1] - q.verts[face + 1 * 6 + 1]).toBeCloseTo(5 * 16.5);
  });

  test("a step within a bank's reach is a slope: a fan of four, and no wall between the cells", () => {
    const grid = flat(3, 3);
    setHeight(grid, 1, 1, 2);
    const q = bandQuads(grid, PALETTE, 2);
    // (0, 2): a fan, and its wall off the map's front; (1, 1): a fan only; (2, 0): a fan and the map's side.
    expect(kinds(q)).toEqual([0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    // A top's last word is its height: (1, 1)'s middle at its own, its corners at the mean of the four cells there.
    const fan = 5 * 4 * 6;
    expect(q.verts[fan + 5]).toBe(2);
    expect(q.verts[fan + 6 + 5]).toBe(0.5);
  });

  test("cells it does not draw leave no quads; an empty band is one quad at a point", () => {
    const grid = flat(2, 2, VOID);
    const q = bandQuads(grid, PALETTE, 1);
    expect(q.quads).toBe(1);
    expect(Array.from(q.verts).every((n) => n === 0)).toBe(true);
  });

  test("the top's corners land on the cell's diamond, as cellToWorld puts its centre", () => {
    const grid = flat(3, 3);
    const q = bandQuads(grid, PALETTE, 0, 1);
    const xs = [0, 1, 2, 3].map((k) => q.verts[k * 6]), ys = [0, 1, 2, 3].map((k) => q.verts[k * 6 + 1]);
    // Diamond round cell 0's centre at the origin: top, right, bottom, left.
    expect(xs).toEqual([0, 66, 0, -66]);
    expect(ys).toEqual([-33, 0, 33, 0]);
  });
});

describe("ramps", () => {
  test("a ramp's top tilts up toward its high edge", () => {
    const grid = flat(3, 3);
    // S: high toward +x, a full step (2 half steps).
    setRamp(grid, 1, 1, RAMP.S);
    expect(cornerZ(grid, 1, 1, 0, 0)).toBe(0);
    expect(cornerZ(grid, 1, 1, 1, 0)).toBe(2);
    expect(cornerZ(grid, 1, 1, 1, 1)).toBe(2);
    setRamp(grid, 1, 1, packRamp(RAMP.E, 1) as RampDir);
    expect(cornerZ(grid, 1, 1, 0, 0)).toBe(1);
    expect(cornerZ(grid, 1, 1, 0, 1)).toBe(0);
  });

  test("a ramp is drawn by the mesh at its own plane, and the bare ground in front comes up to meet it", () => {
    const grid = flat(3, 3);
    setRamp(grid, 1, 1, RAMP.W); // high toward +y: its +y face is a full step, its +x face a wedge
    expect(groundDraws(grid, PALETTE, 1, 1)).toBe(true);
    // The ground beside it comes up to meet it (@see drawn.ts): no wall at either face.
    expect(wallFoot(grid, 1, 1, 2, 1, 0, 0, 0)).toBe(0);
    expect(wallFoot(grid, 1, 1, 2, 1, 0, 1, 2)).toBe(2);
    expect(wallFoot(grid, 1, 1, 1, 2, 0, 0, 2)).toBe(2);
    expect(wallFoot(grid, 1, 1, 1, 2, 1, 0, 2)).toBe(2);
    const q = bandQuads(grid, PALETTE, 2);
    // Only the map's own edges: (0, 2) off its front, (2, 0) off its side.
    expect(kinds(q).filter((k) => k === 1 || k === 2)).toEqual([2, 1]);
  });

  test("a level cell's wall stops at the ramp in front where the ramp rises to meet it", () => {
    const grid = flat(3, 3);
    setHeight(grid, 1, 1, 2);
    // In front along +x, a ramp rising toward −x (N) up to the cell's height: no wall at all.
    setRamp(grid, 2, 1, RAMP.N);
    expect(wallFoot(grid, 1, 1, 2, 1, 0, 0, 2)).toBe(2);
    expect(wallFoot(grid, 1, 1, 2, 1, 0, 1, 2)).toBe(2);
    expect(kinds(bandQuads(grid, PALETTE, 2)).filter((k) => k === 1)).toEqual([1]);
  });

  test("slopes facing the light are brighter, the others darker, level ones neither", () => {
    expect(slopeLight(RAMP.NONE)).toBe(0);
    expect(slopeLight(RAMP.S)).toBeGreaterThan(0);
    expect(slopeLight(RAMP.E)).toBeGreaterThan(0);
    expect(slopeLight(RAMP.N)).toBeLessThan(0);
    expect(slopeLight(RAMP.W)).toBeLessThan(0);
    expect(Math.abs(slopeLight(packRamp(RAMP.S, 1)))).toBeLessThan(slopeLight(RAMP.S));
  });
});

describe("fringe", () => {
  test("grass stands over a road behind it, and only over the edges it meets", () => {
    const grid = flat(3, 3);
    // Band 2: (0, 2) and (2, 0) wall off the map's edges.
    expect(kinds(bandQuads(grid, PALETTE, 2))).toEqual([0, 2, 0, 0, 1]);
    grid.paved[1 * 3 + 0] = 1; // (0, 1): behind (0, 2)'s upper-right edge and (1, 1)'s upper-left
    const q = bandQuads(grid, PALETTE, 2);
    expect(kinds(q)).toEqual([0, 2, 3, 0, 3, 0, 1]);
    // A fringe's ground is its cell, its last word its height.
    const f = 4 * 4 * 6;
    expect([q.verts[f + 2], q.verts[f + 3], q.verts[f + 5]]).toEqual([1, 1, 0]);
  });

  test("no fringe from a cell that isn't bare level grass", () => {
    const grid = flat(3, 3, DIRT);
    grid.paved[1 * 3 + 0] = 1;
    expect(kinds(bandQuads(grid, PALETTE, 2))).toEqual([0, 2, 0, 0, 1]);
  });
});
