import { afterEach, describe, expect, test } from "bun:test";

import { resetAllGameStores } from "../../simulation/reset-game-stores";
import { useQuestStore } from "../../state/quest.store";
import { useAgentsStore, runningAgents } from "../../state/agents.store";
import { singularityMult, useAiSingularityStore } from "../../state/ai-singularity.store";
import { useGenerationStore, emptyLog } from "../../state/generation.store";
import { useGeneratorStore } from "../../state/generators.store";
import { useWorldStore } from "../../state/world.store";
import { commit, createHistory } from "../../world/edit/commands";
import { createGrid, fillTerrain, idx } from "../../world/grid";
import { structureDef } from "../../world/structures/def";
import { placeCommand } from "../../world/structures/place";
import { aiDistrict, aiHoldsRoads } from "../../world/ai/district";
import { takesFrom } from "../../world/ai/planner";
import { WARN_MS, warnMs } from "../../world/ai/ai-runner";
import { nextDueIn } from "../../world/events/events";
import { INHERITANCE, fogged, machineCost } from "../machine";
import { traitScores } from "../traits";
import type { Disposition, Effect } from "./types";
import { questJobLean, questWalletMult } from "./effects";

afterEach(() => { useWorldStore.setState({ playing: false }); resetAllGameStores(); });

/** These effects in force, and the AI standing here. */
const arc = (effects: Effect[], disposition: Disposition = { autonomy: 0, machine: 0 }) => useQuestStore.setState({ effects, disposition });

function town() {
  const g = createGrid(64, 14);
  fillTerrain(g, 1);
  for (let x = 0; x < g.w; x++) g.paved[idx(g, x, 5)] = 1;
  commit(g, createHistory(), placeCommand(g, structureDef("datacentre")!, 4, 2)!);
  useWorldStore.getState().loadGrid(g, [null]);
  useWorldStore.setState({ playing: true });
  return useWorldStore.getState().grid;
}

describe("the arc's effects, each where the game reads it", () => {
  test("income", () => {
    const plain = useGeneratorStore.getState().getEmployeeOutputMults("intern").money;
    arc([{ kind: "incomeMult", mult: 1.05 }, { kind: "incomeMult", mult: 1.03 }]);
    expect(useGeneratorStore.getState().getEmployeeOutputMults("intern").money).toBeCloseTo(plain * 1.05 * 1.03);
  });

  test("the wallet, by its effects and by Autonomy", () => {
    arc([{ kind: "walletMax", mult: 2 }], { autonomy: 2, machine: 0 });
    expect(questWalletMult()).toBeCloseTo(3);
    arc([], { autonomy: -2, machine: 0 });
    expect(questWalletMult()).toBeCloseTo(0.75);
  });

  test("the district: further by its effects and 2 tiles a step of Autonomy, and centred where it was moved", () => {
    const g = town();
    const plain = aiDistrict(g, "colleague")!;
    arc([{ kind: "districtRadius", tiles: 3 }, { kind: "districtCentre", at: { x: 40, y: 7 } }], { autonomy: 1, machine: 0 });
    expect(aiDistrict(g, "colleague")).toEqual({ cx: 40, cy: 7, r: plain.r + 5 });
  });

  test("the takeover: a stage sooner or later, by its effects and at ±2 Autonomy", () => {
    expect(takesFrom()).toBe(3);
    arc([], { autonomy: 2, machine: 0 });
    expect(takesFrom()).toBe(2);
    arc([{ kind: "takeoverStage", shift: 1 }], { autonomy: -2, machine: 0 });
    expect(takesFrom()).toBe(5);
  });

  test("the meter", () => {
    const plain = singularityMult();
    arc([{ kind: "meterMult", mult: 0.85 }]);
    expect(singularityMult()).toBeCloseTo(plain * 0.85);
  });

  test("the traits: leant by its effects and the disposition", () => {
    const plain = traitScores(emptyLog());
    arc([{ kind: "leanTrait", to: "elemental", n: 4 }], { autonomy: -1, machine: 2 });
    const s = traitScores(emptyLog());
    expect(s.paranoid - plain.paranoid).toBe(4);
    expect(s.patient - plain.patient).toBe(2);
    expect(s.hivemind - plain.hivemind).toBe(2);
    expect(s.nanny).toBe(plain.nanny);
    expect(questJobLean("farm")).toBeCloseTo(1.3);
    expect(questJobLean("service")).toBeCloseTo(0.7);
  });

  test("a Machine node revealed early, at a discount", () => {
    useGenerationStore.setState({ generation: 2, machine: [INHERITANCE] });
    expect(fogged("machine_n_coolant")).toBe(true);
    const price = machineCost("machine_n_coolant");
    arc([{ kind: "revealMachineNode", id: "machine_n_coolant", discount: 0.5 }]);
    expect(fogged("machine_n_coolant")).toBe(false);
    expect(machineCost("machine_n_coolant")).toBe(Math.round(price / 2));
  });

  test("floods", () => {
    const plain = nextDueIn("river-flood", 0.5);
    arc([{ kind: "floodMult", mult: 1.5 }]);
    expect(nextDueIn("river-flood", 0.5)).toBeCloseTo(plain / 1.5);
    expect(nextDueIn("hackathon", 0.5)).toBeGreaterThan(0);
  });

  test("the agents held to a share, unless the Data Centre is cooled", () => {
    useAgentsStore.setState({ agents: 8, running: null });
    arc([{ kind: "agentCap", share: 0.75, unlessCooled: true }]);
    expect(runningAgents()).toBe(6);
    useQuestStore.setState({ dcCooled: true });
    expect(runningAgents()).toBe(8);
  });

  test("the charter: the Oversight Board's streets stay yours and its warnings are twice as long", () => {
    useAiSingularityStore.setState({ value: 90 });
    expect(aiHoldsRoads()).toBe(true);
    expect(warnMs()).toBe(WARN_MS);
    arc([{ kind: "charter", charter: "oversight" }]);
    expect(aiHoldsRoads()).toBe(false);
    expect(warnMs()).toBe(2 * WARN_MS);
    arc([{ kind: "charter", charter: "mandate" }]);
    expect(aiHoldsRoads()).toBe(true);
  });
});
