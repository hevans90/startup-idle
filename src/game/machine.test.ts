import { afterEach, describe, expect, test } from "bun:test";
import Decimal from "break_infinity.js";

import { resetAllGameStores } from "../simulation/reset-game-stores";
import { useGenerationStore } from "../state/generation.store";
import { usePrestigeStore } from "../state/prestige.store";
import { inherited } from "../world/ai/planner";
import { INHERITANCE, MACHINE_RINGS, NOTABLES, NOTABLE_COST, NOTABLE_STEP, RING_COST, machineCost, notable, buyMachine, fogged, grantInheritance, machineBlocked, machineGraph } from "./machine";
import { MODULES, moduleLevel } from "./modules";

afterEach(() => resetAllGameStores());

const node = (m: string, ring: number) => `machine_${m}_${ring}`;

describe("the Machine", () => {
  test("is a spoke of three minors for every module, round Inheritance, its notables between", () => {
    const { nodes, edges } = machineGraph();
    expect(nodes.length).toBe(1 + MODULES.length * MACHINE_RINGS + NOTABLES.length);
    expect(edges.filter(([a]) => a === INHERITANCE).length).toBe(MODULES.length);
  });

  test("is under the fog till the first Ascension, then a ring an Ascension", () => {
    expect(fogged(node("seed-round", 1))).toBe(true);
    useGenerationStore.setState({ generation: 2 });
    grantInheritance();
    expect(fogged(node("seed-round", 1))).toBe(false);
    expect(fogged(node("seed-round", 2))).toBe(true);
    useGenerationStore.setState({ generation: 3 });
    expect(fogged(node("seed-round", 2))).toBe(false);
  });

  test("is bought with Weights, a node beside one bought, and a module's level is its nodes bought", () => {
    useGenerationStore.setState({ generation: 4, weights: 1 });
    grantInheritance();
    expect(machineBlocked(node("rack-density", 1))).toBe("weights");
    expect(machineBlocked(node("rack-density", 2))).toBe("unreached");
    useGenerationStore.setState({ weights: 100 });
    expect(buyMachine(node("rack-density", 1))).toBe(true);
    expect(buyMachine(node("rack-density", 2))).toBe(true);
    expect(useGenerationStore.getState().weights).toBe(100 - RING_COST[1] - RING_COST[2]);
    expect(moduleLevel("rack-density")).toBe(2);
    expect(buyMachine(node("rack-density", 2))).toBe(false);
  });

  test("a notable is bought beside a second-ring node, each dearer than the last", () => {
    useGenerationStore.setState({ generation: 3, weights: 1000 });
    grantInheritance();
    expect(machineBlocked("machine_n_freight")).toBe("unreached");
    buyMachine(node("quiet-model", 1));
    buyMachine(node("quiet-model", 2));
    expect(machineCost("machine_n_freight")).toBe(NOTABLE_COST);
    expect(buyMachine("machine_n_freight")).toBe(true);
    expect(notable("freight")).toBe(true);
    expect(machineCost("machine_n_airlift")).toBe(NOTABLE_COST + NOTABLE_STEP);
  });

  test("is never bought with Equity", () => {
    useGenerationStore.setState({ generation: 4 });
    grantInheritance();
    usePrestigeStore.setState({ equity: new Decimal(1e9) });
    expect(usePrestigeStore.getState().canAllocate(node("seed-round", 1))).toBe(false);
    usePrestigeStore.getState().allocatePath(node("seed-round", 1));
    expect(usePrestigeStore.getState().allocated).not.toContain(node("seed-round", 1));
  });

  test("Inheritance: the AI works for the player till the Overseer", () => {
    expect(inherited("manager")).toBe(false);
    grantInheritance();
    expect(inherited("colleague")).toBe(true);
    expect(inherited("manager")).toBe(true);
    expect(inherited("overseer")).toBe(false);
  });
});
