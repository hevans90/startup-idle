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
