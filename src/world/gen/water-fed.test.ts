/**
 * A fed river, RUN for a minute against the same map unfed: a file of its own
 * to run beside the rest. @see water.test
 */
import { describe, expect, test } from "bun:test";

import { generateMap } from "./generate-map";
import { createGrid } from "../grid";
import { createWaterField, poolSnapshot, runSources, stepWater } from "../water/field";

/**
 * AND IT FLOWS — which is the only thing that keeps a river full.
 *
 * A course runs from one edge of the map to another and both ends are open, so
 * standing water drains out of them: what holds the level up is water arriving
 * at the top as fast as it leaves at the bottom. That makes the SOURCE RATE a
 * correctness matter rather than a decoration, and it is easy to get wrong in
 * the quiet direction — a rate too low looks like nothing at all, just a
 * channel that happens to be dry.
 *
 * So this runs the solver and compares the same map fed and unfed.
 */
describe("a fed river fills its own channel", () => {
  const MATS3 = { material: 1, dirt: 2, sand: 3, woods: [4, 5, 6] };

  /** What share of the cut holds water after a minute of running. */
  const wetShare = (seed: number, springs: number) => {
    const bare = createGrid(48, 48), g = createGrid(48, 48);
    generateMap(bare, { seed, ...MATS3, params: { rivers: 0, lakes: 0 } });
    generateMap(g, { seed, ...MATS3, params: { lakes: 0, springs } });
    const cut: number[] = [];
    for (let i = 0; i < g.height.length; i++) {
      if (g.height[i] < bare.height[i]) cut.push(i);
    }
    if (!cut.length) return null;
    const f = createWaterField(g);
    const dt = 1 / 20;
    for (let s = 0; s < 60; s++) {
      for (let k = 0; k < 20; k++) { runSources(f, g, dt); stepWater(f, dt); }
    }
    const snap = poolSnapshot(f, g);
    return cut.filter((i) => snap[i] > 0).length / cut.length;
  };

  test("feeding it wets far more of the cut than leaving it dry", () => {
    let fedTotal = 0, dryTotal = 0, n = 0;
    for (const seed of [0, 4, 7]) {
      const fed = wetShare(seed, 1), dry = wetShare(seed, 0);
      if (fed === null || dry === null) continue;
      fedTotal += fed; dryTotal += dry; n++;
    }
    expect(n).toBeGreaterThan(1);
    expect(fedTotal / n).toBeGreaterThan(dryTotal / n + 0.15);
  }, 60_000);
});
