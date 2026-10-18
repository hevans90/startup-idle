import { afterEach, describe, expect, test } from "bun:test";
import Decimal from "break_infinity.js";

import { resetAllGameStores } from "../../simulation/reset-game-stores";
import { useMoneyStore } from "../../state/money.store";
import { useSessionStore } from "../../state/session.store";
import { useWorldStore } from "../../state/world.store";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx } from "../grid";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { AUTOPILOT_EVERY, currentPlan, lastStep, planInline, resetAutopilot, stepAutopilot, stepsTaken } from "./autopilot";

planInline();

/** Flat ground, a street across the middle and a garage on it, loaded into the game. */
function town() {
  const g = createGrid(32, 32);
  fillTerrain(g, 1);
  for (let x = 4; x < 28; x++) g.paved[idx(g, x, 16)] = 1;
  commit(g, createHistory(), placeCommand(g, structureDef("garage")!, 14, 13)!);
  useWorldStore.getState().loadGrid(g, [null]);
  useWorldStore.setState({ playing: true });
  return useWorldStore.getState().grid;
}
const run = (g: ReturnType<typeof town>, steps: number) => {
  for (let k = 0; k < steps; k++) stepAutopilot(g, AUTOPILOT_EVERY, Date.now());
};

afterEach(() => {
  useWorldStore.setState({ playing: false });
  resetAllGameStores();
});

describe("AI mode", () => {
  test("does nothing switched off", () => {
    const g = town();
    useMoneyStore.setState({ money: new Decimal(1e9) });
    const before = g.structures.size;
    run(g, 5);
    expect(g.structures.size).toBe(before);
    expect(stepsTaken()).toBe(0);
  });

  test("switched on, plans and builds the town through the player's own actions, paying for it", () => {
    const g = town();
    useMoneyStore.setState({ money: new Decimal(1e9) });
    useSessionStore.getState().setAiMode({ aiMode: true, aiBudget: 0.8 });
    const before = g.structures.size;
    run(g, 12);
    expect(currentPlan()).not.toBeNull();
    expect(stepsTaken()).toBeGreaterThan(0);
    expect(lastStep()).not.toBeNull();
    expect(g.structures.size).toBeGreaterThan(before);
    expect(useMoneyStore.getState().money.lt(1e9)).toBe(true);
  });

  test("spends no more than its budget allows (a project's site, free to a player too, aside)", () => {
    const g = town();
    useMoneyStore.setState({ money: new Decimal(1) });
    useSessionStore.getState().setAiMode({ aiMode: true, aiBudget: 0.5 });
    run(g, 6);
    expect([...g.structures.values()].some((s) => s.def.startsWith("kit:"))).toBe(false);
    expect(useMoneyStore.getState().money.toNumber()).toBe(1);
  });

  test("forgets its plan for a new company", () => {
    const g = town();
    useSessionStore.getState().setAiMode({ aiMode: true });
    run(g, 1);
    expect(currentPlan()).not.toBeNull();
    resetAutopilot();
    expect(currentPlan()).toBeNull();
    expect(stepsTaken()).toBe(0);
  });
});
