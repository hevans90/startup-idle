import { describe, expect, test } from "bun:test";

import { DRY_AGENTS, RIVER_COOLING, SPIRE_WATER, TANK_SECONDS, WATER_PER_AGENT, cooledOf, demandOf, drink, tankOf } from "./cooling";

describe("what a drinker wants", () => {
  test("the Data Centre drinks for every agent past its two dry ones; the AI's own for every one", () => {
    expect(demandOf("datacentre", DRY_AGENTS)).toBe(0);
    expect(demandOf("datacentre", 10)).toBeCloseTo((10 - DRY_AGENTS) * WATER_PER_AGENT);
    expect(demandOf("gpu-farm", 8)).toBeCloseTo(8 * WATER_PER_AGENT);
    expect(demandOf("compute-spire", 0)).toBe(SPIRE_WATER);
  });

  test("training on the river cuts it", () => {
    expect(demandOf("gpu-farm", 8, true)).toBeCloseTo(8 * WATER_PER_AGENT * RIVER_COOLING);
  });

  test("a tank holds its seconds of demand, and something with none", () => {
    expect(tankOf(1)).toBe(TANK_SECONDS);
    expect(tankOf(0)).toBeGreaterThan(0);
  });
});

describe("drinking", () => {
  test("a full tank meets its demand, an empty one meets none, and the share comes round", () => {
    let t = { level: 10, share: 1 };
    for (let k = 0; k < 10; k++) t = drink(t.level, t.share, 1, 0.5);
    expect(t.level).toBeCloseTo(5);
    expect(t.share).toBeCloseTo(1);
    t = { level: 0, share: 1 };
    for (let k = 0; k < 60; k++) t = drink(t.level, t.share, 1, 0.5);
    expect(t.share).toBeLessThan(0.01);
  });

  test("the Data Centre's two dry agents are cooled whatever the water", () => {
    expect(cooledOf("datacentre", 10, 0)).toBe(DRY_AGENTS);
    expect(cooledOf("datacentre", 10, 0.5)).toBe(DRY_AGENTS + 4);
    expect(cooledOf("datacentre", 1, 0)).toBe(1);
    expect(cooledOf("gpu-farm", 8, 0)).toBe(0);
  });
});
