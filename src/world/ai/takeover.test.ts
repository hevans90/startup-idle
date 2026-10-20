import { afterEach, describe, expect, test } from "bun:test";
import Decimal from "break_infinity.js";

import { setHousingReader } from "../../game/housing";
import { emptyLog } from "../../state/generation.store";
import { traitScores } from "../../game/traits";
import { resetAllGameStores } from "../../simulation/reset-game-stores";
import { useMoneyStore } from "../../state/money.store";
import { useWorldStore } from "../../state/world.store";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx, setHeight, structureAt } from "../grid";
import { resetCooling, stepCooling, tankFor } from "../projects/cooling";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { WARN_MS, createAiRunner, stepAi, vetoAt } from "./ai-runner";
import { FULL_ENOUGH, chooseAction, coolingState, type AiAction } from "./planner";

/** Water down column 1, a road along row 12, a Data Centre north of it; `more` placed too. */
function town(more: [string, number, number][] = []) {
  const g = createGrid(30, 16);
  fillTerrain(g, 1);
  for (let y = 0; y < 16; y++) { setHeight(g, 1, y, -2); g.pool[idx(g, 1, y)] = 5; }
  for (let x = 4; x < 28; x++) g.paved[idx(g, x, 12)] = 1;
  const h = createHistory();
  commit(g, h, placeCommand(g, { ...structureDef("datacentre")!, placement: undefined }, 12, 9)!);
  for (const [def, x, y] of more) commit(g, h, placeCommand(g, { ...structureDef(def)!, placement: undefined }, x, y)!);
  useWorldStore.getState().loadGrid(g, [null]);
  useWorldStore.setState({ playing: true });
  useMoneyStore.setState({ money: new Decimal(1e12) });
  unhouse = setHousingReader(() => ({ intern: 0, vibe_coder: 0, "10x_dev": 0 }));
  return useWorldStore.getState().grid;
}
let unhouse = () => {};
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
const at = (g: ReturnType<typeof town>, x: number, y: number) => g.structures.get(structureAt(g, x, y))!;

afterEach(() => {
  unhouse();
  resetCooling();
  useWorldStore.setState({ playing: false });
  resetAllGameStores();
});

describe("the AI cools before it builds", () => {
  test("short of water, its first job is a pipe; and no new drinker till every tank is nearly full", () => {
    const g = town([["rack", 16, 10]]);
    const dc = [...g.structures.values()].find((s) => s.def === "datacentre")!;
    stepCooling(g, 4, false, 1);
    const tank = tankFor(dc.id)!;
    Object.assign(tank, { level: 0, share: 0 });
    expect(coolingState(g)).toBe("short");
    expect(chooseAction(g, "manager", rand)?.kind).toBe("pipe");
    // Met, but its tank low: nothing that drinks.
    Object.assign(tank, { share: 1, level: 0 });
    expect(coolingState(g)).toBe("ok");
    const drinks = (a: AiAction | null) => a?.kind === "place" && ["ai-node", "gpu-farm", "compute-spire"].includes(a.def);
    for (let k = 0; k < 40; k++) expect(drinks(chooseAction(g, "manager", rand))).toBe(false);
    // Nearly full: water to spare.
    Object.assign(tank, { level: FULL_ENOUGH * tank.capacity });
    expect(coolingState(g)).toBe("full");
    expect(chooseAction(g, "manager", rand, drinks)).not.toBeNull();
  });
});

describe("what it takes over", () => {
  test("a house: an empty one before a lived-in one", () => {
    const g = town([["kit:intern.t0", 10, 13], ["kit:intern.t0", 14, 13]]);
    at(g, 10, 13).residents = 1;
    at(g, 14, 13).residents = 0;
    const a = chooseAction(g, "manager", rand, (x) => x.kind === "convert" && x.into === "ai-node");
    expect(a && a.kind === "convert" ? a.at : null).toEqual({ x: 14, y: 13 });
  });

  test("a service: the one fewest houses rely on", () => {
    const g = town([["kit:intern.t0", 6, 13], ["kit:intern.t0", 7, 13], ["cafe", 5, 11], ["cafe", 20, 11]]);
    const a = chooseAction(g, "manager", rand, (x) => x.kind === "convert" && x.into === "gpu-farm");
    expect(a && a.kind === "convert" ? a.at : null).toEqual({ x: 20, y: 11 });
  });

  test("announced a minute ahead, and done then — unless the building has changed", () => {
    const g = town([["kit:intern.t0", 14, 13], ["kit:intern.t0", 16, 13]]);
    const r = createAiRunner();
    const take = (x: number) => ({ action: { kind: "convert" as const, at: { x, y: 13 }, into: "ai-node", why: "" }, def: "kit:intern.t0", until: WARN_MS });
    r.pending.push(take(14), { ...take(16), def: "cafe" });
    const now = { stage: "tool" as const, running: 0, agents: 0 };
    stepAi(r, g, now, 0, WARN_MS - 1);
    expect(r.jobs.length).toBe(0);
    stepAi(r, g, now, 0, WARN_MS);
    expect(r.pending.length).toBe(0);
    expect(r.jobs.map((j) => j.to)).toEqual([{ x: 14, y: 13 }]);
  });
});

describe("a refusal", () => {
  test("calls off a drone's job where it lands or where it is, and a takeover announced, on any tile of it; never AI mode's", () => {
    const g = town([["cafe", 20, 11]]);
    const r = createAiRunner();
    const lot: AiAction = { kind: "place", def: "kit:intern.t0", at: { x: 6, y: 13 }, why: "" };
    r.jobs.push({ action: lot, from: { x: 13, y: 10 }, to: lot.at, t: 0, fly: 7 });
    r.jobs.push({ action: { kind: "deferred", at: { x: 8, y: 13 }, why: "", run: () => true }, from: { x: 13, y: 10 }, to: { x: 8, y: 13 }, t: 0, fly: 5 });
    r.pending.push({ action: { kind: "convert", at: { x: 20, y: 11 }, into: "gpu-farm", why: "" }, def: "cafe", until: WARN_MS });
    // Peeking changes nothing.
    expect(vetoAt(r, g, 21, 11, true)?.kind).toBe("convert");
    expect(r.pending.length).toBe(1);
    expect(vetoAt(r, g, 21, 11)?.kind).toBe("convert");
    expect(r.pending.length).toBe(0);
    expect(vetoAt(r, g, 8, 13)).toBeNull();
    // The drone, still at the Data Centre.
    expect(vetoAt(r, g, 13, 10)).toBe(lot);
    expect(r.jobs.map((j) => j.action.kind)).toEqual(["deferred"]);
  });

  test("leans the AI resentful, and a little patient", () => {
    const calm = traitScores(emptyLog()), refused = traitScores({ ...emptyLog(), vetoes: 4 });
    expect(refused.resentful - calm.resentful).toBeGreaterThan(refused.patient - calm.patient);
    expect(refused.patient).toBeGreaterThan(calm.patient);
  });
});
