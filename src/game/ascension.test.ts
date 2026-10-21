import { afterEach, describe, expect, test } from "bun:test";
import Decimal from "break_infinity.js";

import { resetAllGameStores } from "../simulation/reset-game-stores";
import { useAgentsStore } from "../state/agents.store";
import { useAiSingularityStore } from "../state/ai-singularity.store";
import { useExitsStore } from "../state/exits.store";
import { useFounderStore } from "../state/founder.store";
import { emptyLog, useGenerationStore } from "../state/generation.store";
import { useMoneyStore } from "../state/money.store";
import { usePrestigeStore } from "../state/prestige.store";
import { useVapeAchievementsStore } from "../state/vape-achievements.store";
import { DARK_MS, MUTATION, SHUTDOWN_AT, ascend, inheritTrait, shutDown, weightsFor, WEIGHTS_A_RUN } from "./ascension";
import { FUSIONS, fusionNow, fusionOf } from "./fusion";
import { MODULES, buyModule, moduleLevel, toggleSlot } from "./modules";
import { trait } from "./traits";

afterEach(() => resetAllGameStores());

/** A rand that plays back fixed numbers, then the last for ever. */
const seq = (...xs: number[]) => { let k = 0; return () => xs[Math.min(k++, xs.length - 1)]; };

describe("the Ascension", () => {
  test("pays Weights for the generation's work", () => {
    expect(weightsFor(emptyLog(), 0, 0)).toBe(1);
    const log = { ...emptyLog(), datasets: { money: 3, town: 2 } };
    expect(weightsFor(log, 100, 20)).toBe(Math.round(WEIGHTS_A_RUN * 5 + 3 * 10 + 10));
  });

  test("draws a trait from the log, and now and then mutates it into a sibling", () => {
    const log = { ...emptyLog(), datasets: { river: 50 } };
    const kept = inheritTrait(log, seq(0.5, 0.99));
    expect(kept.mutated).toBe(false);
    expect(trait(kept.trait).family).toBe("elemental");
    const mutated = inheritTrait(log, seq(0.5, MUTATION / 2, 0.0));
    expect(mutated.mutated).toBe(true);
    expect(mutated.trait).not.toBe(kept.trait);
    expect(trait(mutated.trait).family).toBe("elemental");
  });

  test("wipes everything but the generation and the achievements, and fuses the trait into the founder played", () => {
    useFounderStore.getState().chooseFounder("neet");
    usePrestigeStore.setState({ equity: new Decimal(500), exits: 7, allocated: ["x"] });
    useExitsStore.getState().recordExit("neet", 1000);
    useVapeAchievementsStore.setState({ juiceMpsMultBonus: 0.5 });
    useGenerationStore.setState({ log: { ...emptyLog(), datasets: { money: 4 } }, equity: 100, weights: 3 });
    useAiSingularityStore.setState({ value: 100 });
    useMoneyStore.setState({ money: new Decimal(1e9) });
    const r = ascend(seq(0, 0.99))!;
    const g = useGenerationStore.getState();
    expect(r.generation).toBe(2);
    expect(g.generation).toBe(2);
    expect(g.weights).toBe(3 + r.weights);
    expect(g.fused.neet).toEqual([r.trait]);
    expect(g.log).toEqual(emptyLog());
    expect(g.announce?.trait).toBe(r.trait);
    expect(usePrestigeStore.getState().equity.toNumber()).toBe(0);
    expect(usePrestigeStore.getState().allocated).toEqual([]);
    expect(useExitsStore.getState().exits).toEqual({});
    expect(useFounderStore.getState().selectedFounderId).toBeNull();
    expect(useAiSingularityStore.getState().value).toBe(0);
    expect(useMoneyStore.getState().money.toNumber()).toBe(0);
    expect(useVapeAchievementsStore.getState().juiceMpsMultBonus).toBe(0.5);
  });

  test("keeps some Equity through, with Warm Start slotted", () => {
    useGenerationStore.setState({ generation: 2, weights: 100 });
    expect(buyModule("warm-start")).toBe(true);
    expect(toggleSlot("warm-start", 1)).toBe(true);
    useFounderStore.getState().chooseFounder("neet");
    usePrestigeStore.setState({ equity: new Decimal(1000) });
    ascend(seq(0, 0.99));
    expect(usePrestigeStore.getState().equity.toNumber()).toBe(100);
  });

  test("shut down: agents deleted, racks dark a while, the AI halved, and remembered", () => {
    useAgentsStore.setState({ agents: 12 });
    useAiSingularityStore.setState({ value: 100 });
    shutDown(1000);
    expect(useAgentsStore.getState().agents).toBe(0);
    expect(useAgentsStore.getState().darkUntil).toBe(1000 + DARK_MS);
    expect(useAiSingularityStore.getState().value).toBe(SHUTDOWN_AT);
    expect(useGenerationStore.getState().log.shutdowns).toBe(1);
  });
});

describe("modules", () => {
  test("are bought level by level with Weights, and work only in a slot", () => {
    useGenerationStore.setState({ generation: 2, weights: 1 });
    expect(buyModule("quiet-model")).toBe(false);
    useGenerationStore.setState({ weights: 100 });
    expect(buyModule("quiet-model")).toBe(true);
    expect(moduleLevel("quiet-model")).toBe(0);
    expect(toggleSlot("quiet-model", 1)).toBe(true);
    expect(moduleLevel("quiet-model")).toBe(1);
    // One slot: a second module will not go in.
    buyModule("seed-round");
    expect(toggleSlot("seed-round", 1)).toBe(false);
    expect(MODULES.every((m) => m.costs[0] < m.costs[1] && m.costs[1] < m.costs[2])).toBe(true);
  });
});

describe("fusion", () => {
  test("every trait does something, and they stack", () => {
    for (const id of Object.keys(FUSIONS) as (keyof typeof FUSIONS)[]) {
      expect(fusionOf([id])).not.toEqual(fusionOf([]));
    }
    expect(fusionOf(["accountant", "accountant"]).incomeMult).toBeCloseTo(1.21);
  });

  test("applies to the founder who carries it", () => {
    useGenerationStore.setState({ fused: { hustler: ["hivemind"] } });
    useFounderStore.setState({ selectedFounderId: "neet" });
    expect(fusionNow().agentsPerRack).toBe(0);
    useFounderStore.setState({ selectedFounderId: "hustler" });
    expect(fusionNow().agentsPerRack).toBe(1);
  });
});
