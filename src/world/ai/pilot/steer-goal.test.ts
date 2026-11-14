import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";

import { playCompany } from "../../../simulation/pilot-run";
import { resetAllGameStores } from "../../../simulation/reset-game-stores";
import { useSessionStore } from "../../../state/session.store";
import { gamePilot, stepGamePilot } from "./game";

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { resetAllGameStores(); jest.useRealTimers(); });

describe("steering: each control moves the run the way it says", () => {
  const play = (minutes: number, steer: () => void = () => {}) => playCompany(jest.advanceTimersByTime.bind(jest), {
    seed: 2, size: 64, minutes, begin: steer,
    drive: (g, dt) => stepGamePilot(g, dt),
    steps: gamePilot().done, said: gamePilot().last,
  });
  const session = () => useSessionStore.getState();

  test("the goal Next landmark brings the landmarks sooner", () => {
    const plain = play(28);
    const leaned = play(28, () => session().steerAi({ aiGoal: "landmark" }));
    expect(leaned.opened.boardroom).toBeDefined();
    expect(leaned.opened.boardroom!).toBeLessThan(plain.opened.boardroom ?? Infinity);
  }, 300_000);
});
