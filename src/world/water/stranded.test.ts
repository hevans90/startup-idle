import { describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, idx, setPaved, type Grid } from "../grid";
import { createWaterField, depthAt, pourAt, stepWater, type WaterField } from "./field";
import { fluidIndexOf } from "./materials";
import { createStranded, fillLevels, findStranded, LOOK_SECONDS, soakStranded, strandedAt, type Stranded } from "./stranded";

/** WATER STRANDED ON LEVEL LAND SOAKS AWAY; a river, a lake and what is one with them do not. @see stranded */
const water = fluidIndexOf("water");
const flat = (n = 16) => { const g = createGrid(n, n); fillTerrain(g, 1); g.height.fill(10); return g; };
const look = (s: Stranded, f: WaterField, g: Grid) => { const n = findStranded(s, f, g); soakStranded(s, f, LOOK_SECONDS); return n; };
const looks = (s: Stranded, f: WaterField, g: Grid, n: number) => { let last = 0; for (let k = 0; k < n; k++) last = look(s, f, g); return last; };
const volume = (f: WaterField) => f.columns.depth.reduce((a, b) => a + b, 0);

describe("stranded water", () => {
  test("a puddle on level land soaks away, after it has been there a little", () => {
    const g = flat(), f = createWaterField(g), s = createStranded(g);
    pourAt(f, 8, 8, 0.5, water);
    const before = volume(f);
    expect(looks(s, f, g, 2)).toBe(0);
    expect(volume(f)).toBe(before);
    expect(look(s, f, g)).toBe(1);
    expect(strandedAt(s, idx(g, 8, 8))).toBe(true);
    expect(volume(f)).toBeLessThan(before);
    looks(s, f, g, 8);
    expect(volume(f)).toBe(0);
    look(s, f, g);
    expect(strandedAt(s, idx(g, 8, 8))).toBe(false);
  });

  test("slower through paving", () => {
    const g = flat(), f = createWaterField(g), s = createStranded(g);
    setPaved(g, 4, 4, 1);
    pourAt(f, 4, 4, 0.5, water); pourAt(f, 10, 10, 0.5, water);
    looks(s, f, g, 5);
    expect(depthAt(f, 4, 4)).toBeGreaterThan(depthAt(f, 10, 10));
    expect(depthAt(f, 4, 4)).toBeLessThan(0.5);
  });

  test("a pond in a hollow stays; what is on the land beside it goes", () => {
    const g = flat(), f0 = [5, 6, 7];
    for (const y of f0) for (const x of f0) g.height[idx(g, x, y)] = 8;
    const f = createWaterField(g), s = createStranded(g);
    for (const y of f0) for (const x of f0) pourAt(f, x, y, 1, water);
    pourAt(f, 8, 6, 0.5, water);
    looks(s, f, g, 12);
    // Its middle untouched, whatever the ground's shape at its edge.
    expect(depthAt(f, 6, 6)).toBeCloseTo(1, 5);
    expect(depthAt(f, 8, 6)).toBeLessThan(0.5);
  });

  test("a slight dip is not a pond", () => {
    const g = flat(), s = createStranded(g), f = createWaterField(g);
    for (const y of [5, 6, 7]) for (const x of [5, 6, 7]) for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) f.columns.ground[(y * 4 + dy) * f.columns.nx + x * 4 + dx] = 9.6;
    pourAt(f, 6, 6, 0.3, water);
    looks(s, f, g, 12);
    expect(depthAt(f, 6, 6)).toBe(0);
  });

  test("water joined to an inflow stays, and goes once it is cut off", () => {
    const g = flat(), f = createWaterField(g), s = createStranded(g);
    g.inflow[idx(g, 0, 8)] = 1;
    for (let x = 0; x <= 9; x++) pourAt(f, x, 8, 0.5, water);
    const before = volume(f);
    expect(looks(s, f, g, 8)).toBe(0);
    expect(volume(f)).toBe(before);
    const c = f.columns;
    for (let cy = 32; cy < 36; cy++) for (let cx = 16; cx < 24; cx++) c.depth[cy * c.nx + cx] = 0;
    looks(s, f, g, 12);
    expect(depthAt(f, 2, 8)).toBe(0.5);
    expect(depthAt(f, 8, 8)).toBe(0);
  });

  test("a running spring keeps its water; other fluids are left", () => {
    const g = flat(), f = createWaterField(g), s = createStranded(g);
    g.source[idx(g, 4, 4)] = 8;
    pourAt(f, 4, 4, 0.5, water);
    pourAt(f, 10, 10, 0.5, fluidIndexOf("slop"));
    const before = volume(f);
    looks(s, f, g, 8);
    expect(volume(f)).toBe(before);
  });

  test("a walled-in map has nowhere to spill: what is in it stays", () => {
    const g = flat();
    expect(fillLevels(g, new Float32Array(256), false)[0]).toBe(Infinity);
    const f = createWaterField(g), s = createStranded(g);
    f.columns.openEdge = false;
    pourAt(f, 8, 8, 0.5, water);
    expect(looks(s, f, g, 6)).toBe(0);
  });

  test("a yard between buildings' walls is no pond: the land under them is level", () => {
    const g = flat(), f = createWaterField(g), s = createStranded(g);
    for (const [x, y] of [[7, 7], [8, 7], [9, 7], [7, 8], [9, 8], [7, 9], [8, 9], [9, 9]]) g.structureAt[idx(g, x, y)] = 0;
    for (const [x, y] of [[7, 7], [8, 7], [9, 7], [7, 8], [9, 8], [7, 9], [8, 9], [9, 9]]) for (let k = 0; k < 16; k++) f.columns.ground[(y * 4 + (k >> 2)) * f.columns.nx + x * 4 + (k & 3)] = 74;
    pourAt(f, 8, 8, 0.5, water);
    looks(s, f, g, 12);
    expect(depthAt(f, 8, 8)).toBe(0);
  });

  test("a spill left to run still goes, all of it", () => {
    const g = flat(24), f = createWaterField(g), s = createStranded(g);
    pourAt(f, 12, 12, 6, water);
    for (let t = 0; t < 60 * 60; t++) { stepWater(f, 1 / 60); if (t % 15 === 0) soakStranded(s, f, 0.25); if (t % 120 === 0) findStranded(s, f, g); }
    expect(volume(f)).toBeLessThan(0.01);
  });
});
