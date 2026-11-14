import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";

import { aiDriving } from "../../../hooks/use-ai-driving";
import { playCompany } from "../../../simulation/pilot-run";
import { resetAllGameStores } from "../../../simulation/reset-game-stores";
import { useFounderStore } from "../../../state/founder.store";
import { useSessionStore } from "../../../state/session.store";
import { jobIn, usePilotView } from "../../../state/pilot-view.store";
import { needsYou } from "../../play/needs-you";
import { pinned } from "../../play/pilot-pins";
import { getAiRunner } from "../ai-runner";
import { gamePilot, resetGamePilot, stepGamePilot } from "./game";

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { resetAllGameStores(); jest.useRealTimers(); });

describe("AI mode driving", () => {
  test("only when it is on, and on a run that has it", () => {
    resetAllGameStores();
    useFounderStore.getState().chooseFounder("model");
    expect(aiDriving()).toBe(false);
    useSessionStore.getState().setAiMode({ aiMode: true });
    expect(aiDriving()).toBe(true);
    useFounderStore.getState().chooseFounder("hustler");
    expect(aiDriving()).toBe(false);
  });

  test("the game's pilot plays a company, flies a drone to what it does, and forgets with the company", () => {
    let flown = 0;
    const r = playCompany(jest.advanceTimersByTime.bind(jest), {
      seed: 2, size: 64, minutes: 4,
      drive: (g, dt) => { stepGamePilot(g, dt); flown = Math.max(flown, getAiRunner().jobs.length); },
      steps: gamePilot().done, said: gamePilot().last,
    });
    expect(r.steps).toBeGreaterThan(3);
    expect(gamePilot().status().says).toBeTruthy();
    expect(flown).toBeGreaterThan(0);
    expect(r.opened.garage).toBeDefined();
    resetGamePilot();
    expect(gamePilot().done()).toBe(0);
    expect(gamePilot().log()).toHaveLength(0);
  }, 60_000);

  test("paused, it does nothing and says so", () => {
    const r = playCompany(jest.advanceTimersByTime.bind(jest), {
      seed: 2, size: 64, minutes: 1,
      begin: () => gamePilot().pause(true),
      drive: (g, dt) => stepGamePilot(g, dt),
      steps: gamePilot().done, said: gamePilot().last,
    });
    expect(r.steps).toBe(0);
    expect(gamePilot().status().kind).toBe("paused");
  }, 60_000);
});

describe("the pilot as the interface reads it", () => {
  test("every job in the queue is published with its state in words and its reason, and the log newest first", () => {
    playCompany(jest.advanceTimersByTime.bind(jest), {
      seed: 2, size: 64, minutes: 4,
      drive: (g, dt) => stepGamePilot(g, dt),
      steps: gamePilot().done, said: gamePilot().last,
    });
    const v = usePilotView.getState();
    expect(v.says).toBeTruthy();
    expect(v.queue.length).toBe(gamePilot().queue().length);
    expect(v.queue.length).toBeGreaterThan(0);
    for (const j of v.queue) { expect(j.says).toBeTruthy(); expect(j.why).toBeTruthy(); expect(j.shown).toBeTruthy(); }
    // What it builds is said where it has a place, for its hologram.
    for (const j of v.queue) if (j.puts) expect(j.at).toBeDefined();
    expect(v.log.length).toBeGreaterThan(1);
    expect(v.log[0].at).toBeGreaterThanOrEqual(v.log[v.log.length - 1].at);
    expect(jobIn(v.queue, "hire:intern")?.desk).toBe("people");
    resetGamePilot();
    expect(usePilotView.getState().queue).toHaveLength(0);
  }, 60_000);

  test("a pin a tile, for the jobs with a place", () => {
    const job = (id: string, at?: { x: number; y: number }, state: "ready" | "cancelled" = "ready") =>
      ({ id, desk: "town" as const, says: id, why: "w", at, cost: 0, costs: "money" as const, state, shown: "Next" });
    const pins = pinned([job("a", { x: 1, y: 1 }), job("b"), job("c", { x: 1, y: 1 }), job("d", { x: 2, y: 1 }), job("e", { x: 3, y: 3 }, "cancelled")]);
    expect(pins.map((p) => p.id)).toEqual(["a", "d"]);
  });
});

describe("what the AI leaves to the player", () => {
  test("the sale, the Ascension and a story choice, in that order; nothing when none waits", () => {
    expect(needsYou({ sale: false, ascension: false, choice: false })).toEqual([]);
    expect(needsYou({ sale: true, ascension: true, choice: true })).toEqual(["sale", "ascension", "choice"]);
    expect(needsYou({ sale: false, ascension: false, choice: true })).toEqual(["choice"]);
  });
});
