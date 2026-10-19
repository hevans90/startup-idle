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
import { AUTOPILOT_EVERY, SECTION, currentPlan, lastStep, planInline, resetAutopilot, stepAutopilot, stepsTaken } from "./autopilot";
import { inBox, sectionOf } from "./masterplan/plan";

planInline();

/** Flat ground, a street across the middle and a garage on it, loaded into the game. */
function town(size = 32) {
  const g = createGrid(size, size);
  fillTerrain(g, 1);
  for (let x = 4; x < size - 4; x++) g.paved[idx(g, x, 16)] = 1;
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

  test("plans a section round the town, not the whole map", () => {
    const g = town(64);
    useMoneyStore.setState({ money: new Decimal(1e9) });
    useSessionStore.getState().setAiMode({ aiMode: true });
    run(g, 1);
    const box = sectionOf(g, SECTION);
    const plan = currentPlan()!;
    expect(plan.steps.length).toBeGreaterThan(0);
    for (const s of plan.steps) {
      const c = s.kind === "road" || s.kind === "level" ? s.to : s.at;
      expect(inBox(box, c.x, c.y)).toBe(true);
    }
    expect(box.x1 - box.x0).toBeLessThan(g.w - 1);
  });
});

describe("a section", () => {
  test("is the town's buildings boxed, a margin round them, inside the map", () => {
    const g = createGrid(40, 40);
    fillTerrain(g, 1);
    commit(g, createHistory(), placeCommand(g, structureDef("garage")!, 10, 12)!);
    const s = structureDef("garage")!.footprint;
    expect(sectionOf(g, 4)).toEqual({ x0: 6, y0: 8, x1: 10 + s.w - 1 + 4, y1: 12 + s.h - 1 + 4 });
    expect(sectionOf(g, 30)).toEqual({ x0: 0, y0: 0, x1: 39, y1: 39 });
  });
});
