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

// Note: advanceGameplayOneSecond ticks generators and managers but NOT team
// leaders or satisfaction. Generators run at their base output with no TL
// multipliers, so sim times are longer than real gameplay — a conservative
// baseline, not an exact match.

describe("progression simulation (store + fake timers)", () => {
  test("first intern upgrade is affordable within 2 minutes at 15 interns", () => {
    // Tests intent: not instant (needs some time to earn), not a brick wall.
    // Wide window so minor balance changes don't break it.
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

    expect(seconds).toBeLessThan(maxSeconds); // reachable
    expect(seconds).toBeGreaterThan(5);       // not instant
  });

  test("full core run buys every core upgrade within 7 simulated days", () => {
    const { purchases, totalSeconds, employeePurchases } = simulateCoreUpgradeRun(
      jest.advanceTimersByTime.bind(jest),
      { maxSimulatedSeconds: 86400 * 7 }
    );

    // Every core upgrade was purchased — count comes from the catalog, not hardcoded.
    expect(purchases.length).toBe(UPGRADES_CORE.length);
    expect(new Set(purchases.map((p) => p.id)).size).toBe(UPGRADES_CORE.length);

    // Completed within the time budget.
    expect(totalSeconds).toBeLessThan(86400 * 7);

    // At least one employee was hired during the run.
    expect(employeePurchases.length).toBeGreaterThan(0);

    // All purchased upgrades belong to the core catalog.
    const coreIds = new Set(UPGRADES_CORE.map((u) => u.id));
    for (const p of purchases) {
      expect(coreIds.has(p.id)).toBe(true);
    }

    // Purchases are time-ordered.
    for (let i = 1; i < purchases.length; i++) {
      expect(purchases[i]!.secondsAtPurchase).toBeGreaterThanOrEqual(
        purchases[i - 1]!.secondsAtPurchase
      );
    }

    // Final employee counts meet the requirements of every core upgrade.
    const need = maxUnlockCounts(UPGRADES_CORE);
    const finalAmount = (id: GeneratorId) =>
      useGeneratorStore.getState().generators.find((g) => g.id === id)!.amount;
    expect(finalAmount("intern")).toBeGreaterThanOrEqual(need.intern);
    expect(finalAmount("vibe_coder")).toBeGreaterThanOrEqual(need.vibe_coder);
    expect(finalAmount("10x_dev")).toBeGreaterThanOrEqual(need["10x_dev"]);
  });
});

// ─── Upgrade catalog pacing (pure, no store) ────────────────────────────────
//
// These tests catch pathological cost gaps in the upgrade curve before they
// reach players. Only checks single-condition upgrades in the core catalog —
// multi-condition and late-game upgrades intentionally spike costs.

const coreIds = new Set(UPGRADES_CORE.map((u) => u.id));

function coreUpgradesForRole(role: GeneratorId) {
  return UPGRADES.filter(
    (u) =>
      coreIds.has(u.id) &&
      u.unlockConditions.length === 1 &&
      u.unlockConditions[0]!.requiredId === role,
  ).sort((a, b) => a.cost - b.cost);
}

function maxCostRatio(upgrades: ReturnType<typeof coreUpgradesForRole>): number {
  let max = 0;
  for (let i = 1; i < upgrades.length; i++) {
    max = Math.max(max, upgrades[i]!.cost / upgrades[i - 1]!.cost);
  }
  return max;
}

describe("upgrade catalog pacing (pure)", () => {
  test("intern core upgrades: no consecutive gap exceeds 80x", () => {
    const upgrades = coreUpgradesForRole("intern");
    expect(upgrades.length).toBeGreaterThan(3);
    expect(maxCostRatio(upgrades)).toBeLessThanOrEqual(80);
  });

  test("vibe coder core upgrades: no consecutive gap exceeds 20x", () => {
    const upgrades = coreUpgradesForRole("vibe_coder");
    expect(upgrades.length).toBeGreaterThan(2);
    expect(maxCostRatio(upgrades)).toBeLessThanOrEqual(20);
  });

  test("10x dev core upgrades: no consecutive gap exceeds 20x", () => {
    const upgrades = coreUpgradesForRole("10x_dev");
    expect(upgrades.length).toBeGreaterThan(1);
    expect(maxCostRatio(upgrades)).toBeLessThanOrEqual(20);
  });

  test("secondsToAffordAtConstantMps matches closed form for reference economy", () => {
    const mps = 15;
    const t = secondsToAffordAtConstantMps(400, 0, mps);
    expect(t).toBeCloseTo(400 / 15, 5);
  });
});
