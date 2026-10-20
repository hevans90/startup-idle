import { afterEach, describe, expect, test } from "bun:test";
import Decimal from "break_infinity.js";

import { resetAllGameStores } from "../../simulation/reset-game-stores";
import { useMoneyStore } from "../../state/money.store";
import { useWorldStore } from "../../state/world.store";
import { buildCost } from "../../game/build-cost";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx } from "../grid";
import { rackReading } from "../projects/racks";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { demolishAt, paveRoad, placeStructure } from "../play/build-actions";
import { CATCH_UP, DRONE_SPEED, aiPace, createAiRunner, droneAt, stepAi } from "./ai-runner";
import { perform, targetOf } from "./planner";

/** A road along row 5 and a finished Data Centre north of it, loaded into the game. */
function town() {
  const g = createGrid(30, 14);
  fillTerrain(g, 1);
  for (let x = 0; x < g.w; x++) g.paved[idx(g, x, 5)] = 1;
  commit(g, createHistory(), placeCommand(g, structureDef("datacentre")!, 10, 2)!);
  useWorldStore.getState().loadGrid(g, [null]);
  useWorldStore.setState({ playing: true });
  return useWorldStore.getState().grid;
}

afterEach(() => {
  useWorldStore.setState({ playing: false });
  resetAllGameStores();
});

describe("the AI's pace", () => {
  test("is the share of agents running, faster with hangars, nothing with none", () => {
    const g = createGrid(8, 8);
    expect(aiPace(g, { stage: "manager", running: 0, agents: 10 }, 10)).toBe(0);
    expect(aiPace(g, { stage: "manager", running: 5, agents: 10 }, 10)).toBe(5);
    g.structures.set(1, { id: 1, def: "drone-hangar", x: 0, y: 0, w: 2, h: 2 });
    expect(aiPace(g, { stage: "manager", running: 10, agents: 10 }, 10)).toBe(12.5);
  });

  test("stands still before the Colleague stage, and sends drones out after", () => {
    const g = town();
    const r = createAiRunner();
    stepAi(r, g, { stage: "assistant", running: 10, agents: 10 }, 1000, 0);
    expect(r.jobs.length).toBe(0);
    useMoneyStore.setState({ money: new Decimal(1e9) });
    stepAi(r, g, { stage: "colleague", running: 10, agents: 10 }, 61, 0, () => 0.5);
    expect(r.jobs.length + r.log.length).toBeGreaterThan(0);
    expect(CATCH_UP).toBeGreaterThan(0);
  });
});

describe("a drone", () => {
  test("flies out at its speed, then scans", () => {
    const job = { action: { kind: "lift" as const, at: { x: 10, y: 0 }, why: "" }, from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, t: 0, fly: 10 / DRONE_SPEED };
    job.t = job.fly / 2;
    expect(droneAt(job)).toEqual({ x: 5, y: 0, scanning: false });
    job.t = job.fly + 0.1;
    expect(droneAt(job).scanning).toBe(true);
    expect(targetOf(job.action)).toEqual({ x: 10, y: 0 });
  });
});

describe("the AI builds as a player builds", () => {
  test("its own buildings are free and run agents; a lot is paid for; a refusal changes nothing", () => {
    const g = town();
    expect(buildCost("ai-node")!.toNumber()).toBe(0);
    useMoneyStore.setState({ money: new Decimal(0) });
    expect(placeStructure("ai-node", { x: 20, y: 4 })).toBe(true);
    expect(rackReading(g).powered + rackReading(g).unpowered).toBeGreaterThan(0);
    // No money: a lot is refused, and nothing changes.
    const rev = useWorldStore.getState().revision;
    expect(placeStructure("kit:intern.t0", { x: 22, y: 4 })).toBe(false);
    expect(useWorldStore.getState().revision).toBe(rev);
    // What the player had in hand is put back.
    useWorldStore.setState({ tool: "inspect" });
    demolishAt({ x: 20, y: 4 });
    expect(useWorldStore.getState().tool).toBe("inspect");
  });

  test("a house taken over becomes a node", () => {
    const g = town();
    useMoneyStore.setState({ money: new Decimal(1e9) });
    useWorldStore.getState().settleHousing?.({}, {});
    expect(placeStructure("kit:intern.t0", { x: 25, y: 4 })).toBe(true);
    expect(perform({ kind: "convert", at: { x: 25, y: 4 }, into: "ai-node", why: "" })).toBe(true);
    expect([...g.structures.values()].some((s) => s.def === "ai-node" && s.x === 25)).toBe(true);
  });

  test("it lays road, paying for each tile", () => {
    town();
    useMoneyStore.setState({ money: new Decimal(1e9) });
    const before = useMoneyStore.getState().money.toNumber();
    expect(paveRoad({ x: 3, y: 6 }, { x: 3, y: 9 })).toBe(true);
    expect(useMoneyStore.getState().money.toNumber()).toBeLessThan(before);
  });
});
