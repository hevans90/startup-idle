import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";

import { aiDriving as aiDrivingOf } from "../../../hooks/use-ai-driving";
import { playCompany } from "../../../simulation/pilot-run";
import { resetAllGameStores } from "../../../simulation/reset-game-stores";
import { usePilotView } from "../../../state/pilot-view.store";
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

  test("a desk switched off does nothing: no hires with People off, no lots with Town off", () => {
    const plain = play(8);
    expect(plain.staff.intern).toBeGreaterThan(0);
    expect(plain.lots).toBeGreaterThan(0);
    const nobody = play(8, () => session().steerAi({ aiDesksOff: ["people"] }));
    expect(nobody.staff.intern ?? 0).toBe(0);
    const nowhere = play(8, () => session().steerAi({ aiDesksOff: ["town"] }));
    expect(nowhere.lots).toBe(0);
    // And its controls are the player's again, the rest still the pilot's.
    session().setAiMode({ aiMode: true });
    expect(aiDrivingOf("town")).toBe(false);
    expect(aiDrivingOf("people")).toBe(true);
  }, 120_000);

  test("a reserve is kept back: more in hand, less spent", () => {
    const plain = play(12);
    const kept = play(12, () => session().steerAi({ aiReserve: 300 }));
    expect(kept.money / Math.max(kept.income, 1)).toBeGreaterThan(plain.money / Math.max(plain.income, 1));
    expect(kept.money).toBeGreaterThanOrEqual(150 * kept.income);
    expect(kept.steps).toBeLessThan(plain.steps);
  }, 120_000);

  test("a job cancelled is left alone, and done once restored", () => {
    const off = play(3, () => gamePilot().cancel("project:garage"));
    expect(off.opened.garage).toBeUndefined();
    expect(usePilotView.getState().queue.find((j) => j.id === "project:garage")?.state).toBe("cancelled");
    let t = 0;
    const back = playCompany(jest.advanceTimersByTime.bind(jest), {
      seed: 2, size: 64, minutes: 4, begin: () => usePilotView.getState().act({ cancel: "project:garage" }),
      drive: (g, dt) => { t += dt; if (t > 60 && t < 60.2) usePilotView.getState().act({ restore: "project:garage" }); stepGamePilot(g, dt); },
      steps: gamePilot().done, said: gamePilot().last,
    });
    expect(back.opened.garage).toBeGreaterThan(60);
  }, 120_000);
});
