/**
 * SLOP IN THE WATER, as the water's own solver carries it: one fluid at a
 * strength, moved by the same flows that move the water. What is checked is
 * what a player would see — a river takes it away, a lake holds it, a fall
 * takes it down, a flood thins a spill — and that none of it is made or lost
 * on the way. @see fluid/columns ColumnField.foul, plans/pipe-network.md §4
 */
import { describe, expect, test } from "bun:test";

import { CLEAN_MATERIAL, FOUL_MATERIAL, FOUL_SETTLE } from "../../fluid/columns";
import { FULL, POLLUTED, levelOf } from "../../game/pollution";
import { SPILL_DEPTH } from "../../game/slop";
import { applyFixture } from "../debug/fixtures";
import { sludgeAt } from "../events/sludge";
import { createGrid, fillTerrain, idx, setHeight, type Grid } from "../grid";
import { createWaterField, depthAt, pourAt, runSources, setWaterEdge, stepWater, type WaterField } from "./field";
import { fluidIndexOf } from "./materials";
import { foulingIn, pollutionAt, pollutionOf, stepPollution } from "./pollution";

const SLOP = fluidIndexOf("slop"), WATER = fluidIndexOf("water");
const run = (g: Grid, f: WaterField, secs: number) => {
  for (let n = 0; n < secs * 30; n++) {
    runSources(f, g, 1 / 30);
    stepWater(f, 1 / 30);
    stepPollution(f, 1 / 30);
  }
};
/** Let `units` of slop out into a tile, as an outfall does. */
const letOut = (f: WaterField, x: number, y: number, units: number) => pourAt(f, x, y, units * SPILL_DEPTH, SLOP);
const slopIn = (f: WaterField) => foulingIn(f) / SPILL_DEPTH;
/** The wettest tile of a map, to pour into. */
function deepest(g: Grid, f: WaterField): { x: number; y: number } {
  let best = { x: 0, y: 0 }, most = -1;
  for (let y = 2; y < g.h - 2; y++) for (let x = 2; x < g.w - 2; x++) {
    const d = depthAt(f, x, y);
    if (d > most) { most = d; best = { x, y }; }
  }
  return best;
}
/** A walled pond, `deep` half steps of water in it. */
function pond(w: number, h: number, deep: number) {
  const g = createGrid(w, h);
  fillTerrain(g, 1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) setHeight(g, x, y, x === 0 || y === 0 || x === w - 1 || y === h - 1 ? deep + 4 : 0);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) g.pool[idx(g, x, y)] = deep;
  const f = createWaterField(g);
  setWaterEdge(f, false);
  return { g, f };
}

describe("slop in the water", () => {
  test("the two materials that mix are the solver's two", () => {
    expect(WATER).toBe(CLEAN_MATERIAL);
    expect(SLOP).toBe(FOUL_MATERIAL);
  });

  test("fouls it by how much of it is slop, and only where there is water to foul", () => {
    expect(levelOf(FULL / 4, 4)).toBeCloseTo(0.25, 5);
    expect(levelOf(1, 4)).toBe(1);
    expect(levelOf(0.3, 0.01)).toBe(0);
    expect(POLLUTED).toBeGreaterThan(0);
  });

  test("the same slop browns a pond and barely tints a deep one", () => {
    const shallow = pond(8, 8, 1), deep = pond(8, 8, 8);
    letOut(shallow.f, 4, 4, 1);
    letOut(deep.f, 4, 4, 1);
    expect(pollutionAt(shallow.f, 4, 4)).toBeGreaterThan(3 * pollutionAt(deep.f, 4, 4));
    // A unit into a half step of water reads about as fouled as it always did: one in one.
    expect(pollutionAt(shallow.f, 4, 4)).toBeCloseTo(2 / 3, 2);
  });

  test("none is made or lost as the water moves it: only what settles out goes", () => {
    const { g, f } = pond(20, 12, 4);
    letOut(f, 4, 6, 12);
    const before = slopIn(f);
    expect(before).toBeCloseTo(12, 4);
    // Stirred: a wave down the pond, which carries it about.
    pourAt(f, 16, 6, 6, WATER);
    run(g, f, 30);
    expect(slopIn(f) / before).toBeCloseTo(Math.exp(-30 / FOUL_SETTLE), 2);
    // And it has moved: the tile it went in on is cleaner, the water beside it fouled.
    expect(pollutionAt(f, 4, 6)).toBeLessThan(0.5);
    expect(pollutionAt(f, 6, 6) + pollutionAt(f, 4, 8) + pollutionAt(f, 2, 6)).toBeGreaterThan(0);
  }, 30_000);

  test("a river carries it off the map in a few minutes", () => {
    const g = createGrid(48, 48);
    applyFixture(g, "inlet", 1);
    const f = createWaterField(g);
    run(g, f, 10);
    const at = deepest(g, f);
    letOut(f, at.x, at.y, 20);
    run(g, f, 5);
    expect(pollutionAt(f, at.x, at.y)).toBeGreaterThan(0);
    run(g, f, 175);
    expect(slopIn(f)).toBeLessThan(20 * 0.25);
  }, 60_000);

  test("a still lake holds it far longer", () => {
    const g = createGrid(48, 48);
    applyFixture(g, "lake", 1);
    const f = createWaterField(g);
    // Walled in: the fixture's lake runs off the map's edge, and that is a river's way out.
    setWaterEdge(f, false);
    run(g, f, 5);
    const at = deepest(g, f);
    letOut(f, at.x, at.y, 20);
    run(g, f, 180);
    expect(slopIn(f)).toBeGreaterThan(20 * 0.7);
    // The renderer and the town read it a tile at a time: some tile's byte says so.
    expect(pollutionOf(f.columns).any).toBe(true);
  }, 60_000);

  test("a fall takes it down: fouled water over a lip fouls the pool below", () => {
    // A shelf with a pond on it, a lip, and a walled basin four steps below.
    const g = createGrid(20, 10);
    fillTerrain(g, 1);
    for (let y = 0; y < 10; y++) for (let x = 0; x < 20; x++) {
      const wall = x === 0 || y === 0 || x === 19 || y === 9;
      setHeight(g, x, y, wall ? 16 : x < 8 ? 8 : 0);
    }
    for (let y = 1; y < 9; y++) for (let x = 1; x < 8; x++) g.pool[idx(g, x, y)] = 3;
    const f = createWaterField(g);
    setWaterEdge(f, false);
    for (let y = 1; y < 9; y++) for (let x = 1; x < 8; x++) letOut(f, x, y, 0.5);
    const before = slopIn(f);
    run(g, f, 40);
    expect(depthAt(f, 14, 5)).toBeGreaterThan(0.3);
    expect(pollutionAt(f, 14, 5)).toBeGreaterThan(0.05);
    // What went over the lip arrived: nothing was left in the air.
    expect(slopIn(f) / before).toBeGreaterThan(0.93);
    expect(slopIn(f) / before).toBeLessThan(1.001);
  }, 30_000);

  test("slop on a dry street is sludge; a flood over it thins it into fouled water", () => {
    const { g, f } = pond(10, 10, 0);
    letOut(f, 5, 5, 2);
    run(g, f, 2);
    expect(sludgeAt(f, 5, 5)).toBeGreaterThan(0);
    for (let y = 1; y < 9; y++) for (let x = 1; x < 9; x++) pourAt(f, x, y, 4, WATER);
    run(g, f, 20);
    expect(sludgeAt(f, 5, 5)).toBe(0);
    expect(depthAt(f, 5, 5)).toBeGreaterThan(3);
    expect(pollutionAt(f, 5, 5)).toBeGreaterThan(0);
    expect(slopIn(f)).toBeCloseTo(2 * Math.exp(-20 / FOUL_SETTLE), 1);
  }, 30_000);
});
