import { describe, expect, jest, test } from "bun:test";
import type { GeneratorId } from "../state/generators.store";
import { useGeneratorStore } from "../state/generators.store";
import { useMoneyStore } from "../state/money.store";
import {
  syncAvailableUpgrades,
  UPGRADES,
  UPGRADES_CORE,
  useUpgradeStore,
} from "../state/upgrades.store";
import { advanceGameplayOneSecond } from "./run-sim";
import { resetAllGameStores } from "./reset-game-stores";
import { maxUnlockCounts, simulateCoreUpgradeRun } from "./simulate-core-run";
import { makeOwnedGenerator } from "./store-fixtures";
import { secondsToAffordAtConstantMps } from "./pure-estimates";

describe("progression simulation (store + fake timers)", () => {
  test("first intern upgrade takes ~27s at 15 interns (not instant)", () => {
    resetAllGameStores();
    useGeneratorStore.setState({
      generators: [makeOwnedGenerator("intern", 15)],
    });
    syncAvailableUpgrades();

    const target = UPGRADES.find((u) => u.id === "intern_upgrade_1")!;
    expect(target.cost).toBe(400);

    let seconds = 0;
    const maxSeconds = 120;
    while (seconds < maxSeconds) {
      const money = useMoneyStore.getState().money.toNumber();
      const available = useUpgradeStore
        .getState()
        .availableUpgrades.some((u) => u.id === "intern_upgrade_1");
      if (available && money >= target.cost) break;
      advanceGameplayOneSecond(jest.advanceTimersByTime.bind(jest));
      seconds++;
    }

    expect(seconds).toBeLessThan(maxSeconds);
    expect(seconds).toBeGreaterThanOrEqual(26);
    expect(seconds).toBeLessThanOrEqual(28);
  });

  test("full core run (intern + vibe + 10x base catalogs) buys every upgrade with bounded sim time", () => {
    expect(UPGRADES_CORE.length).toBe(17);

    const { purchases, totalSeconds, employeePurchases } = simulateCoreUpgradeRun(
      jest.advanceTimersByTime.bind(jest),
      { maxSimulatedSeconds: 86400 * 7 }
    );

    expect(purchases.length).toBe(UPGRADES_CORE.length);
    expect(new Set(purchases.map((p) => p.id)).size).toBe(UPGRADES_CORE.length);
    expect(totalSeconds).toBeLessThan(86400 * 7);
    expect(employeePurchases.length).toBeGreaterThan(0);

    const coreIds = new Set(UPGRADES_CORE.map((u) => u.id));
    for (const p of purchases) {
      expect(coreIds.has(p.id)).toBe(true);
    }

    for (let i = 1; i < purchases.length; i++) {
      expect(purchases[i]!.secondsAtPurchase).toBeGreaterThanOrEqual(
        purchases[i - 1]!.secondsAtPurchase
      );
    }

    const need = maxUnlockCounts(UPGRADES_CORE);
    const finalAmount = (id: GeneratorId) =>
      useGeneratorStore.getState().generators.find((g) => g.id === id)!.amount;
    expect(finalAmount("intern")).toBeGreaterThanOrEqual(need.intern);
    expect(finalAmount("vibe_coder")).toBeGreaterThanOrEqual(need.vibe_coder);
    expect(finalAmount("10x_dev")).toBeGreaterThanOrEqual(need["10x_dev"]);
  });
});

describe("upgrade catalog pacing (pure)", () => {
  test("early intern-only upgrades do not spike cost more than 80x between consecutive price tiers", () => {
    const earlyInternOnly = UPGRADES.filter(
      (u) =>
        u.unlockConditions.length === 1 &&
        u.unlockConditions[0].requiredId === "intern" &&
        u.unlockConditions[0].requiredAmount <= 200
    ).sort((a, b) => a.cost - b.cost);

    expect(earlyInternOnly.length).toBeGreaterThan(3);

    for (let i = 1; i < earlyInternOnly.length; i++) {
      const prev = earlyInternOnly[i - 1]!.cost;
      const next = earlyInternOnly[i]!.cost;
      expect(next / prev).toBeLessThanOrEqual(80);
    }
  });

  test("secondsToAffordAtConstantMps matches closed form for reference economy", () => {
    const mps = 15;
    const t = secondsToAffordAtConstantMps(400, 0, mps);
    expect(t).toBeCloseTo(400 / 15, 5);
  });
});
