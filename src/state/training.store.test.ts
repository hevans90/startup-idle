import { afterEach, describe, expect, test } from "bun:test";

import { MAX_SKILL, TRAINING_SECONDS, dataset } from "../game/training";
import { resetAllGameStores } from "../simulation/reset-game-stores";
import { useAiSingularityStore } from "./ai-singularity.store";
import { useGenerationStore } from "./generation.store";
import { skillOf, training, useTrainingStore } from "./training.store";

afterEach(() => {
  resetAllGameStores();
});

const run = (id: "money" | "itself", from: number) => {
  expect(useTrainingStore.getState().start(id, from)).toBe(true);
  useTrainingStore.getState().tick(from + TRAINING_SECONDS * 1000);
};

describe("a training run", () => {
  test("costs nothing to start, runs one at a time, then teaches a skill, jumps the AI and goes in the log", () => {
    useAiSingularityStore.setState({ value: 10 });
    expect(useTrainingStore.getState().start("money", 0)).toBe(true);
    expect(useTrainingStore.getState().start("town", 0)).toBe(false);
    expect(training(1000)).toBe("money");
    useTrainingStore.getState().tick(TRAINING_SECONDS * 1000 - 1);
    expect(useAiSingularityStore.getState().value).toBe(10);
    expect(skillOf("money")).toBe(0);
    useTrainingStore.getState().tick(TRAINING_SECONDS * 1000);
    expect(useAiSingularityStore.getState().value).toBe(10 + dataset("money")!.jump);
    expect(skillOf("money")).toBe(1);
    expect(useGenerationStore.getState().log.datasets.money).toBe(1);
    expect(training(TRAINING_SECONDS * 1000)).toBeNull();
  });

  test("teaches three levels at most, and Itself jumps furthest", () => {
    for (let k = 0; k < 5; k++) run("itself", k * 1e6);
    expect(skillOf("itself")).toBe(MAX_SKILL);
    expect(useGenerationStore.getState().log.datasets.itself).toBe(5);
    expect(dataset("itself")!.jump).toBeGreaterThan(dataset("money")!.jump);
  });

  test("a new company forgets its skills", () => {
    run("money", 0);
    useTrainingStore.getState().reset();
    expect(skillOf("money")).toBe(0);
  });
});
