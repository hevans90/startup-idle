/**
 * The river a minute after the map opens, over a set of seeds: a minute of
 * solver a map, so the seeds are split across files that run side by side.
 * @see water-river.test, water-river-2.test
 */
import { describe, expect, test } from "bun:test";

import { generateMap } from "./generate-map";
import { lastPath } from "./water";
import { createGrid } from "../grid";
import { createWaterField, depthAt, runSources, stepWater } from "../water/field";

/**
 * THE OUTCOME, and the only test here that would have caught the fault.
 *
 * Everything else in this file asks about a rule — the bed descends, the ends
 * are on the rim, the feed is a level. This one generates a map, runs it, and
 * asks whether there is still a river on it a minute later. The generator it
 * replaced passed almost every rule-shaped test in this file while producing
 * beds that climbed 38 half steps against 15 of fall, because a climb is only
 * a fault once water is asked to go down it.
 */
export function riverAfterAMinute(seeds: readonly number[]) {
describe("and a minute later there is still a river on the map", () => {
  test(`the channel runs from the edge it enters to the edge it leaves: seeds ${seeds.join(", ")}`, () => {
    let sum = 0, n = 0;
    for (const seed of seeds) {
      const g = createGrid(64, 64);
      generateMap(g, { seed, material: 1, dirt: 2, sand: 3, woods: [4, 5, 6] });
      const spine = [...lastPath];
      expect(spine.length).toBeGreaterThan(20);
      const f = createWaterField(g);
      for (let t = 0; t < 60; t++) {
        for (let k = 0; k < 20; k++) { runSources(f, g, 1 / 20); stepWater(f, 1 / 20); }
      }
      const wet = spine.filter((i) => depthAt(f, i % g.w, (i / g.w) | 0) > 0.5).length;
      const share = wet / spine.length;
      // PER SEED, loosely, because one map in eight has a channel that
      // conveys badly and empties its lower reaches; and across the set
      // tightly, because that has to stay the exception. Measured: 95% mean
      // with the worst seed at 64%, against 66% and 31% before. Since: every
      // seed 94% and over, so each half of the six — its own file, to run side
      // by side — holds the mean on its own (99.6% and 98.1%, 2026-11-03).
      expect(share).toBeGreaterThan(0.55);
      sum += share;
      n++;
    }
    expect(sum / n).toBeGreaterThan(0.85);
    // Six maps — three a file now — at sixty-four tiles, a minute of flow each, and the budget
    // raised with the solver's own cost when bridges became slots — see the
    // note on the drowning test above. It sat close enough to two minutes
    // that a contended run of the whole suite was what tipped it over.
  }, 180_000);
});
}
