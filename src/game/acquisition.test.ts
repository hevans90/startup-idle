import { beforeEach, describe, expect, test } from "bun:test";
import Decimal from "break_infinity.js";
import {
  resetAllGameStores,
  resetRunStores,
} from "../simulation/reset-game-stores";
import { useFounderStore } from "../state/founder.store";
import { useMoneyStore } from "../state/money.store";
import { usePrestigeStore } from "../state/prestige.store";
import { useValuationStore } from "../state/valuation.store";
import {
  ACQUISITION_THRESHOLD,
  canAcquire,
  equityForAccrued,
  performAcquisition,
} from "./acquisition";

describe("equityForAccrued", () => {
  test("zero below the threshold", () => {
    expect(equityForAccrued(new Decimal(0)).toNumber()).toBe(0);
    expect(
      equityForAccrued(new Decimal(ACQUISITION_THRESHOLD - 1)).toNumber(),
    ).toBe(0);
  });

  test("pays the base exactly at the threshold", () => {
    expect(
      equityForAccrued(new Decimal(ACQUISITION_THRESHOLD)).toNumber(),
    ).toBe(3);
  });

  test("diminishing returns: 100x accrued is not 100x Equity", () => {
    const at1x = equityForAccrued(new Decimal(ACQUISITION_THRESHOLD)).toNumber();
    const at100x = equityForAccrued(
      new Decimal(ACQUISITION_THRESHOLD * 100),
    ).toNumber();
    expect(at100x).toBe(at1x * 10); // sqrt(100) = 10
  });

  test("monotonic in accrued valuation", () => {
    let prev = -1;
    for (const mult of [0, 1, 2, 5, 10, 50, 100, 1000]) {
      const e = equityForAccrued(
        new Decimal(ACQUISITION_THRESHOLD * mult),
      ).toNumber();
      expect(e).toBeGreaterThanOrEqual(prev);
      prev = e;
    }
  });
});

describe("performAcquisition", () => {
  beforeEach(() => {
    localStorage.clear();
    resetAllGameStores();
    useFounderStore.getState().chooseFounder("bootstrapper");
  });

  test("not eligible below the threshold → no-op", () => {
    useValuationStore.getState().increaseValuation(ACQUISITION_THRESHOLD - 1);
    expect(canAcquire()).toBe(false);
    const banked = performAcquisition();
    expect(banked.toNumber()).toBe(0);
    expect(usePrestigeStore.getState().exits).toBe(0);
    expect(useFounderStore.getState().selectedFounderId).not.toBeNull();
  });

  test("banks Equity, increments exits, and soft-resets the run", () => {
    // Spend some Equity first so we can prove the rest is preserved.
    usePrestigeStore.getState().grantEquity(5);
    usePrestigeStore.getState().allocate("core"); // cost 1 → 4 left
    const equityBefore = usePrestigeStore.getState().equity.toNumber();

    useValuationStore.getState().increaseValuation(ACQUISITION_THRESHOLD * 4);
    useMoneyStore.getState().increaseMoney(9999);
    const offer = equityForAccrued(
      useValuationStore.getState().accruedThisRun,
    ).toNumber();
    expect(offer).toBeGreaterThan(0);

    const banked = performAcquisition().toNumber();
    expect(banked).toBe(offer);

    const p = usePrestigeStore.getState();
    expect(p.equity.toNumber()).toBe(equityBefore + offer); // prestige preserved + banked
    expect(p.exits).toBe(1);
    expect(p.allocated).toEqual(["core"]); // skill tree preserved

    // Run is reset.
    expect(useValuationStore.getState().accruedThisRun.toNumber()).toBe(0);
    expect(useMoneyStore.getState().money.toNumber()).toBe(0);
    expect(useFounderStore.getState().selectedFounderId).toBeNull(); // re-pick
  });
});

describe("reset scopes", () => {
  beforeEach(() => {
    localStorage.clear();
    resetAllGameStores();
  });

  test("resetRunStores preserves prestige; resetAllGameStores wipes it", () => {
    usePrestigeStore.getState().grantEquity(7);
    usePrestigeStore.getState().allocate("core");

    resetRunStores();
    expect(usePrestigeStore.getState().equity.toNumber()).toBe(6); // kept
    expect(usePrestigeStore.getState().allocated).toEqual(["core"]); // kept

    resetAllGameStores();
    expect(usePrestigeStore.getState().equity.toNumber()).toBe(0); // wiped
    expect(usePrestigeStore.getState().allocated).toEqual([]);
  });
});
