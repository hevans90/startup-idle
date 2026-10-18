import { beforeEach, describe, expect, test } from "bun:test";
import { useAiSingularityStore } from "./ai-singularity.store";

describe("ai-singularity persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    useAiSingularityStore.setState({ value: 0 });
  });

  test("rehydrates a persisted value (not reset to 0)", async () => {
    localStorage.setItem(
      "ai-singularity",
      JSON.stringify({ state: { value: 42.5 }, version: 0 }),
    );
    await useAiSingularityStore.persist.rehydrate();
    expect(useAiSingularityStore.getState().value).toBe(42.5);
  });

  test("clamps a persisted value into [0, 100]", async () => {
    localStorage.setItem(
      "ai-singularity",
      JSON.stringify({ state: { value: 999 }, version: 0 }),
    );
    await useAiSingularityStore.persist.rehydrate();
    expect(useAiSingularityStore.getState().value).toBe(100);
  });

  test("falls back gracefully when nothing is persisted", async () => {
    await useAiSingularityStore.persist.rehydrate();
    expect(useAiSingularityStore.getState().value).toBe(0);
  });
});

describe("the singularity", () => {
  test("rises with every agent RUNNING, so the throttle slows it, and sinks with none", async () => {
    const { useAgentsStore } = await import("./agents.store");
    const { RATE_PER_AGENT, DECAY } = await import("./ai-singularity.store");
    useAgentsStore.setState({ agents: 10, running: null });
    useAiSingularityStore.setState({ value: 50 });
    useAiSingularityStore.getState().tick(100);
    expect(useAiSingularityStore.getState().value).toBeCloseTo(50 + 10 * RATE_PER_AGENT * 100);
    useAgentsStore.getState().setRunning(4);
    useAiSingularityStore.setState({ value: 50 });
    useAiSingularityStore.getState().tick(100);
    expect(useAiSingularityStore.getState().value).toBeCloseTo(50 + 4 * RATE_PER_AGENT * 100);
    useAgentsStore.getState().setRunning(0);
    useAiSingularityStore.getState().tick(100);
    expect(useAiSingularityStore.getState().value).toBeCloseTo(50 + 4 * RATE_PER_AGENT * 100 - DECAY * 100);
    // Running all of them again is no throttle at all.
    useAgentsStore.getState().setRunning(10);
    expect(useAgentsStore.getState().running).toBeNull();
    useAgentsStore.setState({ agents: 0, running: null });
    useAiSingularityStore.setState({ value: 0 });
  });

  test("keeps part of itself through a sale, never under the floor this generation's sales have built", async () => {
    const { afterSale, CARRY, FLOOR_PER_SALE, FLOOR_CAP } = await import("./ai-singularity.store");
    expect(afterSale(80, 0)).toBeCloseTo(80 * CARRY);
    expect(afterSale(10, 4)).toBe(4 * FLOOR_PER_SALE);
    expect(afterSale(10, 100)).toBe(FLOOR_CAP);
  });

  test("names its stage", async () => {
    const { stageOf } = await import("./ai-singularity.store");
    expect([0, 19.9, 20, 45, 60, 85, 100].map((v) => stageOf(v).stage))
      .toEqual(["tool", "tool", "assistant", "colleague", "manager", "overseer", "ascension"]);
  });
});
