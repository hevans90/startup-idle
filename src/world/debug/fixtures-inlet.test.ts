/**
 * The inlet fixture, RUN: a river arriving over the map's edge, held there — a
 * file of its own, to run beside the rest. @see fixtures.test
 */
import { describe, expect, test } from "bun:test";

import { createGrid, setSource, type Grid } from "../grid";
import { applyFixture } from "./fixtures";
import { SOURCE_RATE, createWaterField, depthAt, runSources, stepWater, totalVolume } from "../water/field";

/**
 * The inlet fixture — a river arriving over the map's edge.
 *
 * NOT IN `WATER_FIXTURES` (fixtures-water.test), and the reason is the point of it: every fixture on
 * that list is checked for having its own TAPS, and this one deliberately has
 * none. Its water comes over the boundary. @see buildInlet
 *
 * The channel and the valley wall are found from the ground itself — the
 * lowest and highest cells of each column — rather than from the sine the
 * fixture drew them with. A test that recomputes the fixture's own shape
 * checks that two copies of one formula agree, which they always will.
 */
describe("the inlet fixture", () => {
  const built = (feed: "inflow" | "spring") => {
    const g = createGrid(48, 48);
    applyFixture(g, "inlet", 1);
    if (feed === "spring") {
      // The same cells, fed the other way, so the comparison is only about how
      // the water arrives. @see SOURCE_RATE
      const at = [...g.inflow].map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
      g.inflow.fill(0);
      for (const i of at) setSource(g, i % g.w, (i / g.w) | 0, SOURCE_RATE);
    }
    const chan: number[] = [], wall: number[] = [];
    for (let x = 0; x < g.w; x++) {
      let lo = Infinity, hi = -Infinity;
      for (let y = 0; y < g.h; y++) {
        const v = g.height[y * g.w + x];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      for (let y = 0; y < g.h; y++) {
        const v = g.height[y * g.w + x];
        if (v <= lo + 1) chan.push(y * g.w + x);
        if (v >= hi - 1) wall.push(y * g.w + x);
      }
    }
    return { g, field: createWaterField(g), chan, wall };
  };

  const runFor = (g: Grid, field: ReturnType<typeof createWaterField>, secs: number) => {
    for (let n = 0; n < secs * 60; n++) {
      runSources(field, g, 1 / 60);
      stepWater(field, 1 / 60);
    }
  };

  const wetIn = (
    field: ReturnType<typeof createWaterField>, g: Grid, cells: readonly number[],
  ) => cells.filter((i) => depthAt(field, i % g.w, (i / g.w) | 0) > 0.5).length;

  test("the channel is full the moment the map opens", () => {
    // NOT AFTER A MINUTE. Fed from dry this channel takes about that long to
    // reach its far edge, and for that minute the map is showing something
    // that is not what it is. Nothing has stepped here.
    const { g, field, chan } = built("inflow");
    expect(wetIn(field, g, chan)).toBeGreaterThan(chan.length * 0.95);
    // AND ALL THE WAY DOWN IT, which "most of it is wet" does not say on its
    // own: full for four fifths of its length and dry at the mouth is a long
    // pond, not a river that leaves by the far side.
    const far = Math.max(...chan
      .filter((i) => depthAt(field, i % g.w, (i / g.w) | 0) > 0.5)
      .map((i) => i % g.w));
    expect(far).toBe(g.w - 1);
  });

  test("and the inflow HOLDS it there, rather than it draining away", () => {
    // MEASURED BY VOLUME, not by how many tiles are wet, and the difference
    // is the whole test. A tile counts as wet with half a half step on it, so
    // a channel emptying under a film reads as full the entire way down: the
    // spring below keeps 97% of its tiles wet while losing nearly three
    // quarters of its water. What "full" means is how much is in it.
    const { g, field } = built("inflow");
    const spawned = totalVolume(field, g);
    runFor(g, field, 120);
    expect(totalVolume(field, g)).toBeGreaterThanOrEqual(spawned);
  }, 40000);

  test("where the same ground fed by a spring loses most of it", () => {
    // THE FIXTURE CAN FAIL, which is what it is for. This grade and this cut
    // are the ones generated maps actually have, and at a spring's rate the
    // channel drains from full to about a quarter of what it opened with —
    // barely better than feeding it nothing at all. A change that quietly
    // turned the boundary back into a tap would be caught here rather than
    // looking like a map that goes off slowly.
    const { g, field } = built("spring");
    const spawned = totalVolume(field, g);
    runFor(g, field, 120);
    expect(totalVolume(field, g)).toBeLessThan(spawned * 0.5);
  }, 40000);

  test("and it never gets out of the valley, however hard it is fed", () => {
    // The level is held two half steps ABOVE the channel's brim, so this is
    // the boundary being asked to overfill and failing to. Checked at the
    // moment it opens and then every half minute, rather than only at the
    // end: a flood that came and drained would pass a test that just looked
    // afterwards.
    const { g, field, wall } = built("inflow");
    expect(wetIn(field, g, wall)).toBe(0);
    for (let m = 0; m < 4; m++) {
      runFor(g, field, 30);
      expect(wetIn(field, g, wall)).toBe(0);
    }
  }, 30000);

  test("and it settles to a standing flow instead of filling the map", () => {
    // As much leaving as arriving. An inflow that did not settle would be the
    // old failure with a new name: measured, the volume moves by well under a
    // percent between the second minute and the fourth.
    const { g, field } = built("inflow");
    runFor(g, field, 120);
    const settled = totalVolume(field, g);
    runFor(g, field, 120);
    expect(Math.abs(totalVolume(field, g) - settled)).toBeLessThan(settled * 0.05);
    // FIFTY SECONDS: 22 alone and 31 in a full run, which is three quarters
    // of the forty it had — the next one to fail on time, found from the
    // suite's own timings before it did. Twice the solo time and a bit.
  }, 50_000);
});
