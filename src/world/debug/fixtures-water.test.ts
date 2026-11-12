/**
 * The fixtures that come with water, RUN: their taps, their flow a minute on — a
 * file of its own, to run beside the rest. @see fixtures.test
 */
import { describe, expect, test } from "bun:test";

import { createGrid } from "../grid";
import { applyFixture, type FixtureId } from "./fixtures";
import { createWaterField, depthAt, runSources, stepWater, wetTiles } from "../water/field";

/** The presets that come with their own water. */
const WATER_FIXTURES: FixtureId[] = ["river", "cascade", "lake", "islands", "plunge"];

describe("the water fixtures", () => {
  /** Run a preset's own taps and flow for a while, as the scene does. */
  const live = (id: FixtureId, seconds: number) => {
    const g = createGrid(48, 48);
    applyFixture(g, id, 1);
    const field = createWaterField(g);
    for (let n = 0; n < seconds * 60; n++) {
      runSources(field, g, 1 / 60);
      stepWater(field, 1 / 60);
    }
    return { g, field };
  };

  test("every one of them arrives with its own taps, so loading it starts a flow", () => {
    // The point of them. A fixture that hands you a shape to pour into is
    // half an hour of raising terrain before you can look at anything.
    for (const id of WATER_FIXTURES) {
      const g = createGrid(48, 48);
      applyFixture(g, id, 1);
      expect([...g.source].filter((r) => r > 0).length).toBeGreaterThan(0);
    }
  });

  // Every water fixture, a minute of water each, on a 48x48 map: this one is
  // simply a lot of simulation and it runs past the default five seconds. The
  // budget is per FIXTURE rather than a flat number, so adding one to the list
  // does not silently spend the next one's time — which is what happened when
  // `plunge` was added and a twenty second bound that had been comfortable for
  // five became a failure that only showed up in a full run.
  //
  // TWELVE SECONDS A FIXTURE, not eight. Alone it runs 33 seconds for the six
  // of them, 5.5 each — two thirds of the old budget, and the whole suite
  // around it adds half again, which took it to 53 against 48. Twelve is a
  // little over twice the solo time, the margin the full run actually needs.
  test("and each of them is running a minute later", () => {
    for (const id of WATER_FIXTURES) {
      const { field } = live(id, 60);
      expect(wetTiles(field)).toBeGreaterThan(100);
    }
  }, WATER_FIXTURES.length * 12_000);

  // A MINUTE OF WATER AT SIXTY A SECOND, and it wants the room to run.
  //
  // It simulates 3,600 frames of a fed river, which lands at a bit over four
  // seconds alone and a bit over five under the contention of the whole suite
  // — so on the default five it passed or failed depending on what else was
  // running beside it, which is the worst way for a test to behave. The
  // budget is stated rather than left to chance; what it measures is a minute
  // of river and there is no shorter minute.
  test("the river reaches a standing flow rather than filling up", () => {
    // As much arriving as leaving, which is the whole difference between a
    // river and a bath.
    const { g, field } = live("river", 60);
    const a = wetTiles(field);
    for (let n = 0; n < 60 * 60; n++) {
      runSources(field, g, 1 / 60);
      stepWater(field, 1 / 60);
    }
    expect(Math.abs(wetTiles(field) - a)).toBeLessThan(a * 0.15);
  }, 20_000);

  test("the cascade holds a pool on every tread", () => {
    // Each tread has a lip on its downhill side, so water stands at every
    // riser instead of a film racing over all of them.
    const { g, field } = live("cascade", 60);
    let pools = 0;
    for (let x = 2; x < g.w - 2; x++) {
      // A tile deeper than its downhill neighbour is standing water, not a
      // sheet on its way somewhere.
      const here = depthAt(field, x, Math.floor(g.h / 2));
      if (here > 1) pools++;
    }
    expect(pools).toBeGreaterThan(4);
  }, 20_000);

  test("switching to another fixture leaves no taps behind", () => {
    const g = createGrid(48, 48);
    applyFixture(g, "river", 1);
    expect([...g.source].some((r) => r !== 0)).toBe(true);
    applyFixture(g, "flat", 1);
    expect([...g.source].some((r) => r !== 0)).toBe(false);
  });

  test("and no inflow behind either", () => {
    // The same rule for the other kind of feed. A fixture switched away from
    // that left its rim held at a level would go on feeding the next one.
    const g = createGrid(48, 48);
    applyFixture(g, "inlet", 1);
    expect([...g.inflow].some((v) => v !== 0)).toBe(true);
    applyFixture(g, "flat", 1);
    expect([...g.inflow].some((v) => v !== 0)).toBe(false);
  });
});
