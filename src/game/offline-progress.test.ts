import { beforeEach, describe, expect, test } from "bun:test";
import { useFounderStore } from "../state/founder.store";
import { useGeneratorStore } from "../state/generators.store";
import { useSessionStore } from "../state/session.store";
import { resetAllGameStores } from "../simulation/reset-game-stores";
import {
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
});
