import { beforeEach, describe, expect, test } from "bun:test";
import { useFounderStore } from "../state/founder.store";
import { useGeneratorStore } from "../state/generators.store";
import { useAgentsStore } from "../state/agents.store";
import { LATTICE_AT, RATE_PER_AGENT, meterCap, nextQuestStep, useAiSingularityStore } from "../state/ai-singularity.store";
import { useGenerationStore } from "../state/generation.store";
import { useQuestStore } from "../state/quest.store";
import { useSessionStore } from "../state/session.store";
import { useTrainingStore } from "../state/training.store";
import { resetAllGameStores } from "../simulation/reset-game-stores";
import {
  chapterWaiting,
  computeOfflineProgress,
  MIN_OFFLINE_MS,
  OFFLINE_CAP_MS,
} from "./offline-progress";

const HOUR = 60 * 60 * 1000;

/** Put the game in a running state: a founder + some earning interns. */
function startRunningGame(interns: number) {
  resetAllGameStores();
  useFounderStore.getState().chooseFounder("bootstrapper");
  useGeneratorStore.setState({
    generators: useGeneratorStore
      .getState()
      .generators.map((g) =>
        g.id === "intern" ? { ...g, amount: interns } : g,
      ),
  });
}

describe("computeOfflineProgress", () => {
  beforeEach(() => {
    localStorage.clear();
    resetAllGameStores();
  });

  test("no founder chosen → null (game not started)", () => {
    useFounderStore.getState().reset();
    const seen = Date.now() - 5 * HOUR;
    useSessionStore.setState({ lastSeenAt: seen });
    expect(computeOfflineProgress()).toBeNull();
  });

  test("absence below the minimum → null", () => {
    startRunningGame(50);
    const now = Date.now();
    useSessionStore.setState({ lastSeenAt: now - (MIN_OFFLINE_MS - 1000) });
    expect(computeOfflineProgress(now)).toBeNull();
  });

  test("clock skew (lastSeen in the future) → null", () => {
    startRunningGame(50);
    const now = Date.now();
    useSessionStore.setState({ lastSeenAt: now + HOUR });
    expect(computeOfflineProgress(now)).toBeNull();
  });

  test("credits positive money over a real absence with earners", () => {
    startRunningGame(50);
    const now = Date.now();
    useSessionStore.setState({ lastSeenAt: now - 2 * HOUR });
    const summary = computeOfflineProgress(now);
    expect(summary).not.toBeNull();
    expect(summary!.money.gt(0)).toBe(true);
    expect(summary!.wasCapped).toBe(false);
    // Real elapsed is reported (uncapped), in ms.
    expect(summary!.elapsedMs).toBe(2 * HOUR);
  });

  test("credits the seaports at the rate they were earning when the map last ran", () => {
    startRunningGame(50);
    const now = Date.now();
    useSessionStore.setState({ lastSeenAt: now - 2 * HOUR, portIncomePerSecond: 0 });
    const without = computeOfflineProgress(now)!.money.toNumber();
    startRunningGame(50);
    useSessionStore.setState({ lastSeenAt: now - 2 * HOUR, portIncomePerSecond: 10 });
    const withPorts = computeOfflineProgress(now)!.money.toNumber();
    // Ten a second for two hours, on top of the same employees' earnings.
    expect(withPorts - without).toBeCloseTo(10 * 2 * 3600, -1);
  });

  test("caps credited time at OFFLINE_CAP_MS and flags it", () => {
    startRunningGame(50);
    const now = Date.now();
    useSessionStore.setState({ lastSeenAt: now - 30 * 24 * HOUR }); // 30 days
    const summary = computeOfflineProgress(now);
    expect(summary).not.toBeNull();
    expect(summary!.wasCapped).toBe(true);
    // elapsedMs is the REAL time away (for display); crediting was capped.
    expect(summary!.elapsedMs).toBe(30 * 24 * HOUR);
  });

  test("resets globalLastTick to ~now so the live loop won't double-count", () => {
    startRunningGame(50);
    const now = Date.now();
    useSessionStore.setState({ lastSeenAt: now - 2 * HOUR });
    computeOfflineProgress(now);
    const gap = Date.now() - useGeneratorStore.getState().globalLastTick;
    expect(gap).toBeLessThan(1000);
  });

  test("OFFLINE_CAP_MS is 2 days", () => {
    expect(OFFLINE_CAP_MS).toBe(2 * 24 * 60 * 60 * 1000);
  });

  describe("the AI, while you were away", () => {
    test("gets as far as the next quest step and waits there", () => {
      startRunningGame(50);
      useAgentsStore.setState({ agents: 40, running: null });
      useAiSingularityStore.setState({ value: 25 });
      const now = Date.now();
      // Two days of forty agents would carry it from the Assistant to the end.
      useSessionStore.setState({ lastSeenAt: now - 48 * HOUR });
      computeOfflineProgress(now);
      expect(useAiSingularityStore.getState().value).toBe(40);
    });

    test("short of the next step, it goes as far as it would have", () => {
      startRunningGame(50);
      useAgentsStore.setState({ agents: 4, running: null });
      useAiSingularityStore.setState({ value: 41 });
      const now = Date.now();
      useSessionStore.setState({ lastSeenAt: now - HOUR });
      computeOfflineProgress(now);
      expect(useAiSingularityStore.getState().value).toBeCloseTo(41 + 4 * RATE_PER_AGENT * 3600, 1);
    });

    test("a training run finished meanwhile is held to the step too", () => {
      startRunningGame(50);
      useAgentsStore.setState({ agents: 0, running: null });
      useAiSingularityStore.setState({ value: 59.5 });
      const now = Date.now();
      // A jump of two from 59.5 would carry it past the Manager (60).
      useTrainingStore.setState({ current: { dataset: "town", endsAt: now - HOUR } });
      useSessionStore.setState({ lastSeenAt: now - 2 * HOUR });
      computeOfflineProgress(now);
      expect(useAiSingularityStore.getState().value).toBe(60);
      expect(useTrainingStore.getState().current).toBeNull();
    });

    test("and the summary says which chapter it is waiting at", () => {
      startRunningGame(50);
      useGenerationStore.setState({ generation: 1 });
      // The first chapter answered before you left; the second is where it stops.
      useQuestStore.setState({ chapters: { ledger: 0 }, offer: null });
      useAgentsStore.setState({ agents: 40, running: null });
      useAiSingularityStore.setState({ value: 25 });
      const now = Date.now();
      useSessionStore.setState({ lastSeenAt: now - 48 * HOUR });
      expect(computeOfflineProgress(now)!.chapter).toEqual({ number: 2, title: "The Commute Problem" });
    });

    test("no chapter waiting, short of one, or after the first generation", () => {
      startRunningGame(50);
      useGenerationStore.setState({ generation: 1 });
      useQuestStore.setState({ chapters: { ledger: 0 }, offer: null });
      useAgentsStore.setState({ agents: 4, running: null });
      useAiSingularityStore.setState({ value: 25 });
      const now = Date.now();
      useSessionStore.setState({ lastSeenAt: now - HOUR });
      expect(computeOfflineProgress(now)!.chapter).toBeNull();
      useGenerationStore.setState({ generation: 2 });
      useQuestStore.setState({ chapters: {}, offer: null });
      expect(chapterWaiting(40)).toBeNull();
    });

    test("the hold is let go once you are back", () => {
      startRunningGame(50);
      useSessionStore.setState({ lastSeenAt: Date.now() - HOUR });
      computeOfflineProgress();
      expect(meterCap(10)).toBe(100);
    });

    test("the steps: each stage's start, the Lattice's hold, the end", () => {
      expect([0, 19, 20, 59, 80, 94, 95, 99].map(nextQuestStep)).toEqual([20, 20, 40, 60, 95, 95, 100, 100]);
      expect(LATTICE_AT).toBe(95);
    });
  });
});
