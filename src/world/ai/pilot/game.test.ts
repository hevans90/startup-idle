import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";

import { aiDriving } from "../../../hooks/use-ai-driving";
import { playCompany } from "../../../simulation/pilot-run";
import { resetAllGameStores } from "../../../simulation/reset-game-stores";
import { useFounderStore } from "../../../state/founder.store";
import { useSessionStore } from "../../../state/session.store";
import { needsYou } from "../../play/needs-you";
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
  });

  test("paused, it does nothing and says so", () => {
    const r = playCompany(jest.advanceTimersByTime.bind(jest), {
      seed: 2, size: 64, minutes: 1,
      begin: () => gamePilot().pause(true),
      drive: (g, dt) => stepGamePilot(g, dt),
      steps: gamePilot().done, said: gamePilot().last,
    });
    expect(r.steps).toBe(0);
    expect(gamePilot().status().kind).toBe("paused");
  });
});

describe("what the AI leaves to the player", () => {
  test("the sale, the Ascension and a story choice, in that order; nothing when none waits", () => {
    expect(needsYou({ sale: false, ascension: false, choice: false })).toEqual([]);
    expect(needsYou({ sale: true, ascension: true, choice: true })).toEqual(["sale", "ascension", "choice"]);
    expect(needsYou({ sale: false, ascension: false, choice: true })).toEqual(["choice"]);
  });
});
