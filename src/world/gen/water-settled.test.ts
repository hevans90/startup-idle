/**
 * The rivers a new map opens with, RUN: the solver for minutes on end, so a
 * file of its own to run beside the rest. @see water.test
 */
import { describe, expect, test } from "bun:test";

import { generateMap } from "./generate-map";
import { createGrid } from "../grid";
import { createWaterField, runSources, stepWater, totalVolume, wetTiles } from "../water/field";

const MATS = { material: 1, dirt: 2, sand: 3, woods: [4, 5, 6] };

/**
 * THE MAP MUST NOT DROWN.
 *
 * An open edge is a map's only outlet, so a spring is a promise that its
 * channel gets there. When it does not, nothing throws and nothing looks wrong
 * for the first minute — the water just keeps coming, and a map left open for
 * twenty turns into a swamp. The failure is invisible at the moment it is made
 * and only shows up in play, which is exactly the kind a test has to go
 * looking for.
 *
 * So these RUN THE SOLVER and watch. The first is the default and is held
 * strictly: standing water finds its level inside a minute and then stops, so
 * a map you leave open costs nothing. The second is the same map with springs
 * turned on, and it is held LOOSELY on purpose — a fed channel that is
 * intercepted by a deeper basin fills it before draining, which is correct and
 * slow, and the bound here is the difference between slow and unbounded.
 */
describe("a map opens settled", () => {
  const run = (seed: number, seconds: number, params = {}) => {
    const g = createGrid(48, 48);
    generateMap(g, { seed, ...MATS, params: { springs: 0, ...params } });
    const f = createWaterField(g);
    const dt = 1 / 20;
    const at: number[] = [];
    for (let s = 0; s < seconds; s++) {
      for (let k = 0; k < 20; k++) { runSources(f, g, dt); stepWater(f, dt); }
      at.push(totalVolume(f, g));
    }
    return { at, wet: wetTiles(f, g), cells: g.w * g.h };
  };

  // Two simulated minutes of solver, three times over: its own timeout, or a
  // busy machine fails it for being busy.
  for (const seed of [11, 4242, 7]) {
    test(`seed ${seed} finds its level and stays there`, () => {
      const r = run(seed, 120);
      // ONE-SIDED, AND THAT IS THE POINT. With no source the water can only
      // leave — the map's edge is open and a channel runs off it — so a fall
      // is the system working and a RISE is water appearing from nowhere.
      // Measured with springs off, a wet 48² map sheds about 5% over a hundred
      // seconds and never gains any.
      expect(r.at[119]).toBeLessThanOrEqual(r.at[20] + 1);
      // TWO-SIDED ON PURPOSE. A ceiling alone is satisfied by having no river,
      // which is the easiest way to pass it and the worst way: the map has to
      // be wet enough to have one and dry enough not to be a swamp.
      expect(r.wet).toBeGreaterThan(r.cells / 100);
      expect(r.wet).toBeLessThan(r.cells / 3);
    }, 30_000);
  }

  /**
   * Seed 11 is here by name because it is the one that showed the fault. At
   * the spring rate this started with — six half steps a second — it reached
   * 922 of 4,096 tiles under water and was still rising by over a thousand a
   * minute. @see SPRING_RATE
   */
  // Its own timeout: three minutes of solver on two maps is real work, and the
  // default five seconds is not a statement about this test. Doubled when
  // bridges became slots in the same field rather than a second one nothing
  // stepped: a generated map has spans along its river, water now genuinely
  // crosses them, and the solver is about a tenth slower for carrying the
  // storey — measured on seed 7 at 48 tiles, 2.91s of wall clock for thirty
  // seconds of flow before and 3.25 after. @see ColumnField.layers
  test("and a fed one does not drown, even on the seed that used to", () => {
    for (const seed of [11, 4242]) {
      const r = run(seed, 180, { springs: 1 });
      // A LOOSER CEILING THAN THE PER-SEED ONE ABOVE, and only for these two.
      // They are the historically wettest seeds, and a river is now allowed
      // to cross the street — the corridor round it used to be forced dry and
      // is now valley like anywhere else, which is worth about three points
      // of wet on a 48² map. Measured minute by minute they sit at 34-36% and
      // are flat or falling: 38, 36, 36, 35, 35, 34. That is the claim this
      // test makes, and the stability assertions below are what carry it —
      // the ceiling is only here to stop a swamp passing them.
      expect(r.wet).toBeLessThan(r.cells * 0.4);
      // Still filling is allowed; filling as fast as it started is not.
      // ONLY RISES COUNT. Written as `early * 1.5` it inverts the moment the
      // map is DRAINING, where a smaller fall is a bigger number and a
      // perfectly stable map fails for settling too gently.
      //
      // AND THE SLACK IS A SHARE OF THE WATER, not a flat fifty. A settled map
      // wanders a few tenths of a percent minute to minute, and since deep
      // water is calmed these lakes stand higher and hold about seven percent
      // more: seed 11 read 27569, 27535, 27601, 27569, 27448, 27353 minute by
      // minute for six minutes — settled, then falling — and failed fifty on
      // the third minute's +66. @see calmChop
      const early = Math.max(0, r.at[119] - r.at[59]);
      const late = r.at[179] - r.at[119];
      expect(late).toBeLessThan(early * 1.5 + r.at[119] * 0.003);
    }
    // A HUNDRED SECONDS, not sixty: six simulated minutes of a fed map, 45
    // seconds alone and 68 inside the full suite. A little over twice the
    // solo time, which is the margin the full run needs.
  }, 100_000);
});
