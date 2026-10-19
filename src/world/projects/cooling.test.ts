import { afterEach, describe, expect, test } from "bun:test";

import { DRY_AGENTS, WATER_PER_AGENT } from "../../game/cooling";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, type Grid } from "../grid";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { assignAgents, fillTank, hotAgents, resetCooling, stepCooling, tankFor } from "./cooling";

/** A Data Centre, two racks in its reach, and a GPU farm in it too. */
function town(): { g: Grid; dc: number; farm: number } {
  const g = createGrid(30, 20);
  fillTerrain(g, 1);
  const h = createHistory();
  const put = (def: string, x: number, y: number) => {
    commit(g, h, placeCommand(g, { ...structureDef(def)!, placement: undefined }, x, y)!);
    return [...g.structures.values()].find((s) => s.def === def && s.x === x && s.y === y)!.id;
  };
  const dc = put("datacentre", 10, 10);
  put("rack", 14, 10);
  put("rack", 14, 12);
  const farm = put("gpu-farm", 6, 10);
  return { g, dc, farm };
}

afterEach(resetCooling);

describe("who cools whom", () => {
  test("the racks in reach fill first, the Data Centre's; then the AI's own", () => {
    const { g, dc, farm } = town();
    const a = assignAgents(g, 20);
    expect(a.get(dc)).toBe(8);
    expect(a.get(farm)).toBe(8);
    expect(assignAgents(g, 5).get(farm)).toBe(0);
  });
});

describe("the tanks", () => {
  test("start full, so nothing runs hot at once", () => {
    const { g } = town();
    stepCooling(g, 16, false, 1);
    expect(hotAgents()).toBeCloseTo(0, 6);
  });

  test("run dry without pipes: all but the Data Centre's two run hot", () => {
    const { g, dc } = town();
    for (let k = 0; k < 600; k++) stepCooling(g, 16, false, 0.5);
    expect(tankFor(dc)!.level).toBeCloseTo(0, 6);
    expect(hotAgents()).toBeCloseTo(16 - DRY_AGENTS, 1);
  });

  test("kept topped up, stay cool", () => {
    const { g, dc, farm } = town();
    for (let k = 0; k < 600; k++) {
      stepCooling(g, 16, false, 0.5);
      fillTank(dc, (8 - DRY_AGENTS) * WATER_PER_AGENT * 0.5);
      fillTank(farm, 8 * WATER_PER_AGENT * 0.5);
    }
    expect(hotAgents()).toBeLessThan(0.01);
  });

  test("take no more than their room", () => {
    const { g, dc } = town();
    stepCooling(g, 16, false, 1);
    expect(fillTank(dc, 1e9)).toBeLessThan(1);
  });
});
