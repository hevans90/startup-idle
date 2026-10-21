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
import { refundRetired } from "./modules";
import { INHERITANCE } from "./machine";
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

  test("wipes the company but keeps the generation, the achievements, Equity and the skill tree, and fuses the trait into the founder played", () => {
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
    expect(usePrestigeStore.getState().equity.toNumber()).toBe(500);
    expect(usePrestigeStore.getState().allocated).toEqual(["x"]);
    expect(useExitsStore.getState().exits).toEqual({});
    expect(useFounderStore.getState().selectedFounderId).toBeNull();
    // Inheritance, granted: the AI starts the next company at the Assistant.
    expect(useAiSingularityStore.getState().value).toBe(20);
    expect(useMoneyStore.getState().money.toNumber()).toBe(0);
    expect(useVapeAchievementsStore.getState().juiceMpsMultBonus).toBe(0.5);
  });

  test("modules bought the old way come back as Weights, and the slots empty", () => {
    useGenerationStore.setState({ weights: 1, modules: { "warm-start": 2, "quiet-model": 1 } as never, slotted: ["warm-start", "quiet-model"] as never });
    refundRetired();
    const g = useGenerationStore.getState();
    expect(g.weights).toBe(1 + 4 + 10 + 3);
    expect(g.modules).toEqual({});
    expect(g.slotted).toEqual([]);
  });

  test("the first grants Inheritance, and with it the next company's AI starts at the Assistant", () => {
    useFounderStore.getState().chooseFounder("neet");
    useAiSingularityStore.setState({ value: 100 });
    ascend(seq(0, 0.99));
    expect(useGenerationStore.getState().machine).toContain(INHERITANCE);
    expect(useAiSingularityStore.getState().value).toBe(20);
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
