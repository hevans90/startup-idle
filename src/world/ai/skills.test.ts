import { afterEach, describe, expect, test } from "bun:test";
import Decimal from "break_infinity.js";

import { AGENTS_A_RACK, agentsARack } from "../../game/agents";
import { setHousingReader } from "../../game/housing";
import { WALLET_DEEPER, WALLET_FASTER, type DatasetId } from "../../game/training";
import { resetAllGameStores } from "../../simulation/reset-game-stores";
import { useGeneratorStore } from "../../state/generators.store";
import { useMoneyStore } from "../../state/money.store";
import { useSessionStore } from "../../state/session.store";
import { useTrainingStore } from "../../state/training.store";
import { useWorldStore } from "../../state/world.store";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx, structureAt } from "../grid";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { drainAt } from "../water/field";
import { chooseAction, type AiAction } from "./planner";
import { DEPTH, RESERVOIR, digReservoir } from "./reservoir";
import { creditWallet, walletCap } from "./wallet";

/** A road along row 12, a Data Centre north of it, and `more`. */
function town(more: [string, number, number][] = []) {
  const g = createGrid(30, 24);
  fillTerrain(g, 1);
  for (let x = 2; x < 28; x++) g.paved[idx(g, x, 12)] = 1;
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
let seed = 5;
const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
const learn = (id: DatasetId, level: number) => useTrainingStore.setState((s) => ({ skills: { ...s.skills, [id]: level } }));

afterEach(() => {
  unhouse();
  useWorldStore.setState({ playing: false });
  resetAllGameStores();
});

describe("what training teaches the AI", () => {
  test("the town: its houses a tier up, then two", () => {
    const g = town();
    const lot = (x: AiAction) => x.kind === "place" && x.def.startsWith("kit:");
    const tier = () => { const a = chooseAction(g, "manager", rand, lot); return a?.kind === "place" ? a.def.split(".").pop() : null; };
    expect(tier()).toBe("t0");
    learn("town", 2);
    expect(tier()).toBe("t1");
    learn("town", 3);
    expect(tier()).toBe("t2");
  });

  test("the people: no house anyone lives in is taken", () => {
    const g = town([["kit:intern.t0", 10, 13]]);
    g.structures.get(structureAt(g, 10, 13))!.residents = 1;
    useSessionStore.getState().setAiFocus("machine");
    const convert = (x: AiAction) => x.kind === "convert" && x.into === "ai-node";
    expect(chooseAction(g, "manager", rand, convert)).not.toBeNull();
    learn("people", 1);
    expect(chooseAction(g, "manager", rand, convert)).toBeNull();
  });

  test("the money: its allowance faster, and deeper", () => {
    useGeneratorStore.setState({ getMoneyPerSecond: () => 100 } as never);
    useSessionStore.getState().setAiWallet({ aiShare: 0.2, aiWallet: 0 });
    const cap = walletCap();
    creditWallet(1);
    expect(useSessionStore.getState().aiWallet).toBeCloseTo(20);
    learn("money", 3);
    useSessionStore.getState().setAiWallet({ aiWallet: 0 });
    creditWallet(1);
    expect(useSessionStore.getState().aiWallet).toBeCloseTo(20 * WALLET_FASTER);
    expect(walletCap()).toBeCloseTo(cap * WALLET_DEEPER);
  });

  test("the river: a reservoir run low is topped up", () => {
    const g = town();
    expect(digReservoir({ x: 4, y: 16 })).toBe(true);
    const field = useWorldStore.getState().getWaterField()!;
    for (let dy = 0; dy < RESERVOIR; dy++) for (let dx = 0; dx < RESERVOIR; dx++) drainAt(field, 4 + dx, 16 + dy, Infinity);
    expect(chooseAction(g, "manager", rand)?.kind).not.toBe("refill");
    learn("river", 2);
    const a = chooseAction(g, "manager", rand);
    expect(a?.kind).toBe("refill");
    expect(DEPTH).toBeGreaterThan(0);
  });

  test("itself: a rack runs one more", () => {
    expect(agentsARack()).toBe(AGENTS_A_RACK);
    learn("itself", 1);
    expect(agentsARack()).toBe(AGENTS_A_RACK + 1);
  });
});
