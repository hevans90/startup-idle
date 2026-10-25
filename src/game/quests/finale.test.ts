import { afterEach, describe, expect, test } from "bun:test";

import { resetAllGameStores } from "../../simulation/reset-game-stores";
import { useAgentsStore } from "../../state/agents.store";
import { LATTICE_AT, inheritedStart, useAiSingularityStore } from "../../state/ai-singularity.store";
import { useFounderStore } from "../../state/founder.store";
import { emptyLog, useGenerationStore } from "../../state/generation.store";
import { useQuestStore } from "../../state/quest.store";
import { aiHoldsRoads } from "../../world/ai/district";
import { inherited } from "../../world/ai/planner";
import { lookOf } from "../../world/structures/projects/looks";
import { ascend, ascensionWeights, contain, endingNow, weightsNow } from "../ascension";
import { INHERITANCE } from "../machine";
import { CONTAIN_AT, ENDINGS } from "./endings";
import { LAST_LIGHT, formFor, latticeForm } from "./finale";
import { measure, type QuestWorld } from "./objectives";

afterEach(() => resetAllGameStores());

const at = (autonomy: number, machine: number) => ({ autonomy, machine });
/** A first generation at its Ascension, the arc having left the AI here. */
function atTheEnd(autonomy: number, machine: number) {
  useFounderStore.getState().chooseFounder("neet");
  useGenerationStore.setState({ log: { ...emptyLog(), datasets: { money: 4, people: 2 } }, equity: 100, weights: 0, machine: [INHERITANCE] });
  useQuestStore.setState({ disposition: at(autonomy, machine), chapters: { ledger: 0 } });
  useAiSingularityStore.setState({ value: 100 });
}

describe("the Lattice's form", () => {
  test("where the AI stands when it is begun — the river given, a monolith in it — kept once fixed", () => {
    expect(formFor(at(2, 2), [])).toBe("spire");
    expect(formFor(at(-2, -2), [])).toBe("garden");
    expect(formFor(at(2, -1), [])).toBe("open");
    expect(formFor(at(-2, 2), [])).toBe("vault");
    expect(formFor(at(2, 2), ["river:dammed"])).toBe("river");
    useQuestStore.setState({ disposition: at(2, 2) });
    useQuestStore.getState().fixLatticeForm(latticeForm());
    useQuestStore.setState({ disposition: at(-3, -3) });
    expect(latticeForm()).toBe("spire");
  });

  test("each form draws, and differs", () => {
    const tops = new Set<number>();
    for (const form of ["spire", "garden", "open", "vault", "river"] as const) {
      useQuestStore.setState({ latticeForm: form });
      const b = lookOf("lattice", { w: 3, h: 3 });
      expect(b.masses.length).toBeGreaterThan(0);
      tops.add(Math.max(...b.masses.map((m) => m.z1)) * 10 + b.masses.length);
    }
    expect(tops.size).toBe(5);
  });
});

describe("Last Light", () => {
  test("at the Lattice's hold; helping it is charging it", () => {
    expect(LAST_LIGHT.at).toBe(LATTICE_AT);
    const o = LAST_LIGHT.options[0].objective!;
    const run = { kind: "chapter" as const, id: "last-light", option: 0, spec: o, elapsed: 0, progress: 0, held: 0 };
    const w = { lattice: 0.4 } as QuestWorld;
    expect(measure(run, w, 1).progress).toBeCloseTo(0.4);
    expect(LAST_LIGHT.transmission(new Set())[1]).toBeString();
  });
});

describe("the endings", () => {
  test("none at the middle, and only one at a time", () => {
    atTheEnd(0, 0);
    expect(endingNow()).toBeNull();
    for (const [a, m] of [[2, 2], [-2, -2], [2, -2], [-2, 2]]) expect(ENDINGS.filter((e) => e.open(at(a, m)))).toHaveLength(1);
  });

  test("Merge: two traits fused, and the next generation's takeover begins at the Colleague", () => {
    atTheEnd(2, 2);
    expect(endingNow()?.id).toBe("merge");
    const r = ascend(Math.random, "merge")!;
    expect(r.also).toBeDefined();
    expect(useGenerationStore.getState().fused.neet).toEqual([r.trait, r.also]);
    expect(useGenerationStore.getState().legacy).toBe("merge");
    expect(inheritedStart()).toBe(40);
    expect(useAiSingularityStore.getState().value).toBe(40);
    expect(useQuestStore.getState().record[0].ending).toBe("merge");
  });

  test("Steward: the next generation's AI never turns", () => {
    atTheEnd(-2, -2);
    ascend(Math.random, "steward");
    useAiSingularityStore.setState({ value: 90 });
    expect(inherited("overseer")).toBe(true);
    expect(aiHoldsRoads()).toBe(false);
  });

  test("Release: twice the Weights, and nothing inherited", () => {
    atTheEnd(2, -2);
    expect(ascensionWeights("release")).toBe(Math.round(weightsNow() * 2));
    const r = ascend(Math.random, "release")!;
    expect(r.weights).toBe(useGenerationStore.getState().weights);
    expect(inheritedStart()).toBe(0);
    expect(inherited("colleague")).toBe(false);
  });

  test("Contain: shut down for nothing, once; the next Ascension banks half again", () => {
    atTheEnd(-2, 2);
    useAgentsStore.setState({ agents: 12, running: null });
    expect(endingNow()?.id).toBe("contain");
    const plain = ascensionWeights();
    contain();
    expect(useAiSingularityStore.getState().value).toBe(CONTAIN_AT);
    expect(useAgentsStore.getState().agents).toBe(12);
    expect(useGenerationStore.getState().log.shutdowns).toBe(0);
    expect(endingNow()).toBeNull();
    expect(ascensionWeights()).toBe(Math.round(plain * 1.5));
    expect(ascend()).not.toBeNull();
    expect(useGenerationStore.getState().contained).toBe(false);
  });

  test("an Ascension without an ending leaves no legacy", () => {
    atTheEnd(2, 2);
    ascend(Math.random, "merge");
    useFounderStore.getState().chooseFounder("neet");
    useAiSingularityStore.setState({ value: 100 });
    expect(ascend()).not.toBeNull();
    expect(useGenerationStore.getState().legacy).toBeNull();
  });
});
