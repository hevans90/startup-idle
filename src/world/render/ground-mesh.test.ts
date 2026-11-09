import { describe, expect, test } from "bun:test";

import { VOID, createGrid, fillTerrain, setHeight, setTerrain } from "../grid";
import { GROUND, bandQuads, groundClassOf, groundDraws, wallFoot } from "./ground-mesh";

const GRASS = 1, DIRT = 2, SAND = 3, WOODS = 4, OTHER = 5;
const PALETTE = [
  null, "landscapeTiles_067.png", "landscapeTiles_083.png", "landscapeTiles_059.png",
  "landscapeTiles_067_trees1.png", "landscapeTiles_001.png",
] as const;

function flat(w = 4, h = 4, mat = GRASS) {
  const grid = createGrid(w, h);
  fillTerrain(grid, mat);
  return grid;
}

/** The kinds (0 top, 1 face +x, 2 face +y) of a band's quads, in order. */
const kinds = (q: ReturnType<typeof bandQuads>) =>
  Array.from({ length: q.quads }, (_, k) => q.verts[k * 4 * 6 + 4]);

describe("groundClassOf", () => {
  test("grass, dirt and sand by their frames; woods blend as grass; anything else is nothing", () => {
    expect(groundClassOf(PALETTE, GRASS)).toBe(GROUND.grass);
    expect(groundClassOf(PALETTE, DIRT)).toBe(GROUND.dirt);
    expect(groundClassOf(PALETTE, SAND)).toBe(GROUND.sand);
    expect(groundClassOf(PALETTE, WOODS)).toBe(GROUND.grass);
    expect(groundClassOf(PALETTE, OTHER)).toBe(GROUND.none);
    expect(groundClassOf(PALETTE, VOID)).toBe(GROUND.none);
  });
});

describe("groundDraws", () => {
  test("the shaded materials only: woods and other frames keep their sprites", () => {
    const grid = flat(3, 1);
    setTerrain(grid, 1, 0, WOODS);
    setTerrain(grid, 2, 0, OTHER);
    expect(groundDraws(grid, PALETTE, 0, 0)).toBe(true);
    expect(groundDraws(grid, PALETTE, 1, 0)).toBe(false);
    expect(groundDraws(grid, PALETTE, 2, 0)).toBe(false);
    expect(groundDraws(grid, PALETTE, 5, 0)).toBe(false);
  });
});

describe("wallFoot", () => {
  test("down to a lower neighbour, never up to a higher one", () => {
    const grid = flat(2, 1);
    setHeight(grid, 0, 0, 4);
    setHeight(grid, 1, 0, 1);
    expect(wallFoot(grid, 0, 0, 1, 0)).toBe(1);
    expect(wallFoot(grid, 1, 0, 0, 0)).toBe(1);
  });

  test("off the map or over a void, at least a step down", () => {
    const grid = flat(2, 1);
    expect(wallFoot(grid, 1, 0, 2, 0)).toBe(-2);
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
    setHeight(grid, 1, 1, 3);
    const q = bandQuads(grid, PALETTE, 2);
    // (0, 2) walls off the map's front; (1, 1) down both faces; (2, 0) off the map's side.
    expect(kinds(q)).toEqual([0, 2, 0, 1, 2, 0, 1]);
    // (1, 1)'s +x face: its bottom corners sit 3 half steps below its top.
    const face = 3 * 4 * 6;
    expect(q.verts[face + 2 * 6 + 5]).toBe(3);
    expect(q.verts[face + 2 * 6 + 1] - q.verts[face + 1 * 6 + 1]).toBeCloseTo(3 * 16.5);
  });

  test("cells it does not draw leave no quads; an empty band is one quad at a point", () => {
    const grid = flat(2, 2, OTHER);
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
