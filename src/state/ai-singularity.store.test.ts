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

describe("the agents and the singularity", () => {
  test("every agent running brings it on faster", async () => {
    const { useAgentsStore } = await import("./agents.store");
    const { SINGULARITY_PER_AGENT } = await import("./ai-singularity.store");
    useAiSingularityStore.setState({ value: 0 });
    useAgentsStore.setState({ agents: 0 });
    useAiSingularityStore.getState().tick(10, -50, true);
    const alone = useAiSingularityStore.getState().value;
    expect(alone).toBeGreaterThan(0);
    useAiSingularityStore.setState({ value: 0 });
    useAgentsStore.setState({ agents: 10 });
    useAiSingularityStore.getState().tick(10, -50, true);
    expect(useAiSingularityStore.getState().value).toBeCloseTo(alone * (1 + 10 * SINGULARITY_PER_AGENT));
    useAgentsStore.setState({ agents: 0 });
    useAiSingularityStore.setState({ value: 0 });
  });
});
