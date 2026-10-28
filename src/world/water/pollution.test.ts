import { describe, expect, test } from "bun:test";

import { POLLUTED, levelOf } from "../../game/pollution";
import { applyFixture } from "../debug/fixtures";
import { createGrid, type Grid } from "../grid";
import { createWaterField, depthAt, runSources, setWaterEdge, stepWater, type WaterField } from "./field";
import { pollute, pollutionAt, pollutionOf, stepPollution } from "./pollution";

const run = (g: Grid, f: WaterField, secs: number) => {
  for (let n = 0; n < secs * 30; n++) {
    runSources(f, g, 1 / 30);
    stepWater(f, 1 / 30);
    stepPollution(f, 1 / 30);
  }
};
const total = (f: WaterField) => pollutionOf(f.columns).mass.reduce((a, b) => a + b, 0);
/** The wettest tile of a map, to pour into. */
function deepest(g: Grid, f: WaterField): { x: number; y: number } {
  let best = { x: 0, y: 0 }, most = -1;
  for (let y = 2; y < g.h - 2; y++) for (let x = 2; x < g.w - 2; x++) {
    const d = depthAt(f, x, y);
    if (d > most) { most = d; best = { x, y }; }
  }
  return best;
}

describe("pollution in the water", () => {
  test("fouls the water it is poured into, by its concentration", () => {
    expect(levelOf(1, 4)).toBeCloseTo(0.25, 5);
    expect(levelOf(10, 4)).toBe(1);
    expect(levelOf(5, 0.01)).toBe(0);
  });

  test("a river carries it off the map in a few minutes", () => {
    const g = createGrid(48, 48);
    applyFixture(g, "inlet", 1);
    const f = createWaterField(g);
    run(g, f, 10);
    const at = deepest(g, f);
    pollute(f, at.x, at.y, 20);
    run(g, f, 5);
    expect(pollutionAt(f, at.x, at.y)).toBeGreaterThan(0);
    run(g, f, 175);
    expect(total(f)).toBeLessThan(20 * 0.25);
  }, 60_000);

  test("a still lake holds it far longer, spreading it out as it dilutes", () => {
    const g = createGrid(48, 48);
    applyFixture(g, "lake", 1);
    const f = createWaterField(g);
    // Walled in: the fixture's lake runs off the map's edge, and that is a river's way out.
    setWaterEdge(f, false);
    run(g, f, 5);
    const at = deepest(g, f);
    pollute(f, at.x, at.y, 20);
    run(g, f, 3);
    const early = pollutionAt(f, at.x, at.y);
    run(g, f, 177);
    expect(total(f)).toBeGreaterThan(20 * 0.7);
    // Spread: the tile it went in on is cleaner, and the water beside it fouled too.
    expect(pollutionAt(f, at.x, at.y)).toBeLessThan(early);
    const p = pollutionOf(f.columns);
    expect([...p.mass].filter((m) => m > 0.01).length).toBeGreaterThan(9);
  }, 60_000);

  test("on dry ground it soaks in and is gone in two minutes", () => {
    const g = createGrid(24, 24);
    applyFixture(g, "flat", 1);
    const f = createWaterField(g);
    pollute(f, 10, 10, 5);
    run(g, f, 120);
    expect(total(f)).toBeLessThan(0.05);
    expect(POLLUTED).toBeGreaterThan(0);
  }, 30_000);
});
