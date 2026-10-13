import { afterEach, describe, expect, test } from "bun:test";
import Decimal from "break_infinity.js";

import { setHousingReader } from "../game/housing";
import { setProjectReader } from "../game/projects";
import { resetAllGameStores } from "../simulation/reset-game-stores";
import { syncUnlockedGenerators, useGeneratorStore } from "./generators.store";
import { useInnovationStore } from "./innovation.store";
import { PROMOTION_FLOOR, PROMOTION_STEP, promotionCost, setPromotionMoveOut, usePromotionStore } from "./promotion.store";

const amount = (id: string) => useGeneratorStore.getState().generators.find((g) => g.id === id)?.amount ?? 0;
const setAmount = (id: string, n: number) =>
  useGeneratorStore.setState((s) => ({ generators: s.generators.map((g) => (g.id === id ? { ...g, amount: n } : g)) }));

afterEach(() => resetAllGameStores());

describe("promotion", () => {
  test("makes an intern a vibe coder for innovation, each dearer than the last, and the map hears of it", () => {
    setAmount("intern", 10);
    syncUnlockedGenerators();
    useInnovationStore.setState({ innovation: new Decimal(1000) });
    let movedOut = 0;
    const stop = setPromotionMoveOut(() => { movedOut++; });
    const first = promotionCost(0);
    expect(first).toBeGreaterThanOrEqual(PROMOTION_FLOOR);
    expect(usePromotionStore.getState().promote()).toBe(true);
    expect([amount("intern"), amount("vibe_coder")]).toEqual([9, 1]);
    // Below the ten that opened them, the vibe coders stay.
    syncUnlockedGenerators();
    expect(amount("vibe_coder")).toBe(1);
    expect(useInnovationStore.getState().innovation.toNumber()).toBeCloseTo(1000 - first);
    expect(movedOut).toBe(1);
    expect(promotionCost(1)).toBeCloseTo(promotionCost(0) * PROMOTION_STEP);
    stop();
  });

  test("waits for the studio, for an intern, for a bed and for the innovation", () => {
    const stopMap = setProjectReader(() => ({ built: new Set(), away: {} }));
    expect(usePromotionStore.getState().blocked()).toBe("closed");
    stopMap();
    // Not yet on the roster: ten interns open them.
    expect(usePromotionStore.getState().blocked()).toBe("closed");
    setAmount("intern", 10);
    syncUnlockedGenerators();
    setAmount("intern", 0);
    expect(usePromotionStore.getState().blocked()).toBe("none");
    setAmount("intern", 3);
    const stopBeds = setHousingReader(() => ({ intern: 10, vibe_coder: 0, "10x_dev": 0 }));
    expect(usePromotionStore.getState().blocked()).toBe("no-room");
    stopBeds();
    useInnovationStore.setState({ innovation: new Decimal(0) });
    expect(usePromotionStore.getState().blocked()).toBe("innovation");
    expect(usePromotionStore.getState().promote()).toBe(false);
  });
});
