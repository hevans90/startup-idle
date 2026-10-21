import { afterEach, describe, expect, test } from "bun:test";

import { resetAllGameStores } from "../../simulation/reset-game-stores";
import { useAgentsStore } from "../../state/agents.store";
import { useGenerationStore } from "../../state/generation.store";
import { useGeneratorStore } from "../../state/generators.store";
import { useSessionStore } from "../../state/session.store";
import { DESKLESS, NIGHT_SHIFT, desklessShare } from "../agents/commute";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain } from "../grid";
import { PACING, nextDueIn } from "../events/events";
import { resetCooling, stepCooling, tankFor } from "../projects/cooling";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { creditWallet } from "./wallet";

const own = (...ids: string[]) => useGenerationStore.setState({ machine: ids.map((id) => `machine_n_${id}`) });

afterEach(() => { resetCooling(); resetAllGameStores(); });

describe("the Machine's notables, the second set", () => {
  test("Coolant Loop: the AI's buildings share their water", () => {
    const g = createGrid(20, 20);
    fillTerrain(g, 1);
    const h = createHistory();
    commit(g, h, placeCommand(g, { ...structureDef("ai-node")!, placement: undefined }, 4, 4)!);
    commit(g, h, placeCommand(g, { ...structureDef("compute-spire")!, placement: undefined }, 10, 10)!);
    const [a, b] = [...g.structures.values()];
    stepCooling(g, 0, false, 0.01);
    const share = () => [tankFor(a.id)!, tankFor(b.id)!].map((t) => t.level / t.capacity);
    Object.assign(tankFor(a.id)!, { level: tankFor(a.id)!.capacity });
    Object.assign(tankFor(b.id)!, { level: 0 });
    stepCooling(g, 0, false, 0.01);
    expect(share()[1]).toBeLessThan(0.05);
    own("coolant");
    stepCooling(g, 0, false, 0.01);
    // Pooled: each at the same share of what it holds.
    expect(share()[1]).toBeGreaterThan(0.1);
    expect(share()[1]).toBeCloseTo(share()[0], 2);
  });

  test("Market Maker: convoys twice as often", () => {
    const plain = nextDueIn("convoy", 0.5);
    own("market");
    expect(nextDueIn("convoy", 0.5)).toBeCloseTo(plain / 2);
    expect(nextDueIn("hackathon", 0)).toBe(PACING.hackathon.between[0]);
  });

  test("Night Shift: those without a desk work at 70%", () => {
    expect(desklessShare()).toBe(DESKLESS);
    own("nightshift");
    expect(desklessShare()).toBe(NIGHT_SHIFT);
  });

  test("Self-Funding: a tenth of what the agents add, into the wallet", () => {
    useGeneratorStore.setState({ getMoneyPerSecond: () => 100 } as never);
    useAgentsStore.setState({ agents: 10, running: 10 } as never);
    useSessionStore.getState().setAiWallet({ aiShare: 0, aiWallet: 0 });
    creditWallet(1);
    expect(useSessionStore.getState().aiWallet).toBe(0);
    useSessionStore.getState().setAiWallet({ aiShare: 0.01 });
    own("selffund");
    creditWallet(1);
    expect(useSessionStore.getState().aiWallet).toBeGreaterThan(1);
  });
});
