import { afterEach, describe, expect, test } from "bun:test";
import Decimal from "break_infinity.js";

import { TRAINING_SECONDS, TRAINING_STEP, dataset, trainingCost } from "../game/training";
import { resetAllGameStores } from "../simulation/reset-game-stores";
import { useAiSingularityStore } from "./ai-singularity.store";
import { useGenerationStore } from "./generation.store";
import { useInnovationStore } from "./innovation.store";
import { training, useTrainingStore } from "./training.store";

afterEach(() => {
  resetAllGameStores();
  useGenerationStore.setState({ sales: 0, log: { datasets: {}, full: 0, throttled: 0, founders: {}, shutdowns: 0 } });
});

describe("a training run", () => {
  test("costs innovation, runs one at a time, then jumps the AI and goes in the log", () => {
    useInnovationStore.setState({ innovation: new Decimal(1e6) });
    useAiSingularityStore.setState({ value: 10 });
    const cost = useTrainingStore.getState().cost();
    expect(useTrainingStore.getState().start("money", 0)).toBe(true);
    expect(useInnovationStore.getState().innovation.toNumber()).toBeCloseTo(1e6 - cost);
    expect(useTrainingStore.getState().start("town", 0)).toBe(false);
    expect(training(1000)).toBe("money");
    useTrainingStore.getState().tick(TRAINING_SECONDS * 1000 - 1);
    expect(useAiSingularityStore.getState().value).toBe(10);
    useTrainingStore.getState().tick(TRAINING_SECONDS * 1000);
    expect(useAiSingularityStore.getState().value).toBe(10 + dataset("money")!.jump);
    expect(useGenerationStore.getState().log.datasets.money).toBe(1);
    expect(training(TRAINING_SECONDS * 1000)).toBeNull();
    // The next is dearer.
    expect(useTrainingStore.getState().cost()).toBeCloseTo(cost * TRAINING_STEP);
  });

  test("is priced off the innovation rate, never under a floor", () => {
    expect(trainingCost(0, 0)).toBeGreaterThan(0);
    expect(trainingCost(10, 0)).toBe(600);
    expect(trainingCost(10, 2)).toBeCloseTo(600 * TRAINING_STEP ** 2);
  });

  test("waits for the innovation", () => {
    useInnovationStore.setState({ innovation: new Decimal(0) });
    expect(useTrainingStore.getState().blocked()).toBe("innovation");
    expect(useTrainingStore.getState().start("town")).toBe(false);
  });
});
