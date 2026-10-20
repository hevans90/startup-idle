import { afterEach, describe, expect, test } from "bun:test";
import Decimal from "break_infinity.js";

import { resetAllGameStores } from "../../simulation/reset-game-stores";
import { useGeneratorStore } from "../../state/generators.store";
import { useMoneyStore } from "../../state/money.store";
import { useSessionStore } from "../../state/session.store";
import { useWorldStore } from "../../state/world.store";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx } from "../grid";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { createAiRunner, stepAi } from "./ai-runner";
import { WALLET_MINUTES, accrueWallet, creditWallet, priceOfAi, walletCap, walletCovers } from "./wallet";
import type { AiAction } from "./planner";

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
/** An income of `n` a second, as the economy reports it. */
const earning = (n: number) => useGeneratorStore.setState({ getMoneyPerSecond: () => n } as never);

afterEach(() => {
  useWorldStore.setState({ playing: false });
  resetAllGameStores();
});

describe("the AI's wallet", () => {
  test("fills with its share of income, a second at a time, up to its cap", () => {
    earning(100);
    useSessionStore.getState().setAiWallet({ aiShare: 0.2, aiWallet: 0 });
    accrueWallet(0.5);
    expect(useSessionStore.getState().aiWallet).toBe(0);
    accrueWallet(0.5);
    expect(useSessionStore.getState().aiWallet).toBeCloseTo(20);
    creditWallet(3600);
    expect(useSessionStore.getState().aiWallet).toBeCloseTo(walletCap());
    expect(walletCap()).toBeCloseTo(100 * 0.2 * WALLET_MINUTES * 60);
  });

  test("covers a job only as far as it holds, and the company has the money", () => {
    const g = town();
    useMoneyStore.setState({ money: new Decimal(1e9) });
    const lot: AiAction = { kind: "place", def: "kit:intern.t0", at: { x: 2, y: 6 }, why: "" };
    const price = priceOfAi(g, lot);
    expect(price).toBeGreaterThan(0);
    useSessionStore.getState().setAiWallet({ aiWallet: price - 1 });
    expect(walletCovers(g, lot)).toBe(false);
    useSessionStore.getState().setAiWallet({ aiWallet: price });
    expect(walletCovers(g, lot)).toBe(true);
    useMoneyStore.setState({ money: new Decimal(price - 1) });
    expect(walletCovers(g, lot)).toBe(false);
  });

  test("a job is paid for when its drone lands — and not done if the wallet was spent meanwhile", () => {
    const g = town();
    useMoneyStore.setState({ money: new Decimal(1e9) });
    const r = createAiRunner();
    const lot: AiAction = { kind: "place", def: "kit:intern.t0", at: { x: 2, y: 6 }, why: "" };
    const price = priceOfAi(g, lot);
    useSessionStore.getState().setAiWallet({ aiWallet: price * 1.5 });
    r.jobs.push({ action: lot, from: { x: 10, y: 3 }, to: lot.at, t: 0, fly: 0 });
    stepAi(r, g, { stage: "tool", running: 0, agents: 0 }, 60, 0);
    expect(useSessionStore.getState().aiWallet).toBeCloseTo(price * 0.5);
    // A second the same, with only half its price left: not done.
    const again: AiAction = { ...lot, at: { x: 4, y: 6 } };
    r.jobs.push({ action: again, from: { x: 10, y: 3 }, to: again.at, t: 0, fly: 0 });
    const before = g.structures.size;
    stepAi(r, g, { stage: "tool", running: 0, agents: 0 }, 60, 0);
    expect(useWorldStore.getState().grid.structures.size).toBe(before);
  });
});
