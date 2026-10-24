import { afterEach, describe, expect, test } from "bun:test";
import Decimal from "break_infinity.js";

import { resetAllGameStores } from "../../simulation/reset-game-stores";
import { HARD_TAKEOFF_AT, singularityMult, stageOf, useAiSingularityStore } from "../../state/ai-singularity.store";
import { useGenerationStore } from "../../state/generation.store";
import { useMoneyStore } from "../../state/money.store";
import { useWorldStore } from "../../state/world.store";
import { spendForBuild } from "../../game/build-cost";
import { AIR_GAP_BOOST, agentBonus } from "../../game/agents";
import { INHERITANCE, notable } from "../../game/machine";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx } from "../grid";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { aiDistrict, aiHoldsRoads, asAi } from "./district";
import { chooseAction, inherited } from "./planner";
import { priceOfAi } from "./wallet";

/** The Machine with these bought: Inheritance and a keystone, and any notables. */
const own = (...ids: string[]) => useGenerationStore.setState({ machine: [INHERITANCE, ...ids] });

/** A road along row 5, a finished Data Centre on it, loaded into the game. */
function town() {
  const g = createGrid(64, 14);
  fillTerrain(g, 1);
  for (let x = 0; x < g.w; x++) g.paved[idx(g, x, 5)] = 1;
  commit(g, createHistory(), placeCommand(g, structureDef("datacentre")!, 4, 2)!);
  useWorldStore.getState().loadGrid(g, [null]);
  useWorldStore.setState({ playing: true });
  return useWorldStore.getState().grid;
}

afterEach(() => {
  useWorldStore.setState({ playing: false });
  resetAllGameStores();
});

describe("the Machine's keystones", () => {
  test("Alignment: it never turns — nothing taken, its streets never closed — and the meter rises half as fast", () => {
    const plain = singularityMult();
    useAiSingularityStore.setState({ value: 90 });
    own();
    expect(inherited("overseer")).toBe(false);
    expect(aiHoldsRoads()).toBe(true);
    own("machine_k_alignment");
    expect(inherited("overseer")).toBe(true);
    expect(inherited("ascension")).toBe(true);
    expect(aiHoldsRoads()).toBe(false);
    expect(singularityMult()).toBeCloseTo(plain / 2);
  });

  test("Hard Takeoff: the Overseer at 60%, its district the whole map, and what it builds free", () => {
    const g = town();
    expect(stageOf(HARD_TAKEOFF_AT).stage).toBe("manager");
    expect(Number.isFinite(aiDistrict(g, "colleague")!.r)).toBe(true);
    own("machine_k_takeoff");
    expect(stageOf(HARD_TAKEOFF_AT - 1).stage).toBe("colleague");
    expect(stageOf(HARD_TAKEOFF_AT).stage).toBe("overseer");
    expect(aiDistrict(g, "colleague")!.r).toBe(Infinity);
    expect(priceOfAi(g, { kind: "place", def: "gpu-farm", at: { x: 20, y: 3 }, why: "" })).toBe(0);
    useMoneyStore.setState({ money: new Decimal(100) });
    // Free to the AI; the player still pays.
    expect(asAi(() => spendForBuild(new Decimal(1e6)))).toBe(true);
    expect(useMoneyStore.getState().money.toNumber()).toBe(100);
    expect(spendForBuild(new Decimal(1e6))).toBe(false);
    expect(spendForBuild(new Decimal(40))).toBe(true);
    expect(useMoneyStore.getState().money.toNumber()).toBe(60);
  });

  test("Air Gap: no district, no jobs, every agent's boost doubled, and the map's notables dark", () => {
    const g = town();
    const plain = agentBonus(10);
    own("machine_k_airgap", "machine_n_freight", "machine_n_selffund");
    expect(aiDistrict(g, "overseer")).toBeNull();
    for (let k = 0; k < 20; k++) expect(chooseAction(g, "manager")).toBeNull();
    expect(agentBonus(10) - 1).toBeCloseTo((plain - 1) * AIR_GAP_BOOST);
    expect(notable("freight")).toBe(false);
    expect(notable("selffund")).toBe(true);
  });
});
