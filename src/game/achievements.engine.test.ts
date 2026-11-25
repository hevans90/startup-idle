import { describe, expect, test } from "bun:test";
import { useVapeAchievementsStore } from "../state/vape-achievements.store";
import { ACHIEVEMENT_CATALOG } from "./achievements.catalog";
import { JUICE_SHOP_UPGRADES } from "./achievements.juice-shop";
import { achievementsNewlyMet } from "./achievements.engine";

const zeroCtx = {
  internCount: 0,
  vibeCoderCount: 0,
  dev10xCount: 0,
  money: 0,
  mps: 0,
  innovation: 0,
  valuation: 0,
  managersUnlocked: false,
  employeeManagementUnlocked: false,
  purchasedUpgradeCount: 0,
  managerTierTotal: 0,
  aiSingularity: 0,
  exits: 0,
  allocatedNodes: 0,
  totalMandateLevels: 0,
  juiceUpgradeCount: 0,
  founderExitCounts: {} as Record<string, number>,
};

describe("achievementsNewlyMet", () => {
  test("first intern when count >= 1 and not unlocked", () => {
    const ctx = { ...zeroCtx, internCount: 1 };
    const met = achievementsNewlyMet(ctx, new Set());
    expect(met.some((a) => a.id === "first_intern")).toBe(true);
  });

  test("excludes already unlocked ids", () => {
    const ctx = { ...zeroCtx, internCount: 10 };
    const met = achievementsNewlyMet(
      ctx,
      new Set(["first_intern", "intern_squad"]),
    );
    expect(met.some((a) => a.id === "first_intern")).toBe(false);
    expect(met.some((a) => a.id === "intern_squad")).toBe(false);
  });

  test("cash_titan at money threshold", () => {
    const ctx = { ...zeroCtx, money: 1e12 };
    const met = achievementsNewlyMet(ctx, new Set());
    expect(met.some((a) => a.id === "cash_titan")).toBe(true);
  });
});

describe("ACHIEVEMENT_CATALOG", () => {
  test("unique ids", () => {
    const ids = ACHIEVEMENT_CATALOG.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("useVapeAchievementsStore", () => {
  test("recordAchievementUnlock is idempotent per id", () => {
    useVapeAchievementsStore.getState().reset();
    const a = useVapeAchievementsStore.getState().recordAchievementUnlock("x", 10);
    const b = useVapeAchievementsStore.getState().recordAchievementUnlock("x", 10);
    expect(a).toBe(true);
    expect(b).toBe(false);
    expect(useVapeAchievementsStore.getState().vapeJuice.toNumber()).toBe(10);
  });

  const full = (id: string) => useVapeAchievementsStore.getState().purchasedJuiceUpgradeIds.includes(id);
  const fresh = (juice: number) => { useVapeAchievementsStore.getState().clearAll(); useVapeAchievementsStore.getState().recordAchievementUnlock("seed", juice); return useVapeAchievementsStore.getState(); };

  test("a vessel part-filled gives nothing, full its bonus", () => {
    const s = fresh(500);
    expect(s.pourJuice("juice_coil_polish", 30)).toBe(30);
    expect(useVapeAchievementsStore.getState().juiceMpsMultBonus).toBe(0);
    expect(s.pourJuice("juice_coil_polish", 30)).toBe(10);
    expect(useVapeAchievementsStore.getState().juiceMpsMultBonus).toBeCloseTo(0.08, 5);
    expect(useVapeAchievementsStore.getState().vapeJuice.toNumber()).toBe(460);
    expect(full("juice_coil_polish")).toBe(true);
  });

  test("one is poured into only with the one above it full, and drained only with those below it empty", () => {
    const s = fresh(500);
    expect(s.pourJuice("juice_deep_steep", 10)).toBe(0);
    s.pourJuice("juice_coil_polish", 40);
    expect(s.pourJuice("juice_deep_steep", 10)).toBe(10);
    expect(s.drainJuice("juice_coil_polish", 40)).toBe(0);
    expect(s.drainJuice("juice_deep_steep", 99)).toBe(10);
    expect(s.drainJuice("juice_coil_polish", 40)).toBe(40);
    expect(useVapeAchievementsStore.getState().vapeJuice.toNumber()).toBe(500);
    expect(useVapeAchievementsStore.getState().juiceMpsMultBonus).toBe(0);
  });

  test("no more is poured than there is", () => {
    const s = fresh(25);
    expect(s.pourJuice("juice_coil_polish", 40)).toBe(25);
    expect(s.pourJuice("juice_coil_polish", 40)).toBe(0);
  });

  test("a save from before the still: what was bought is full, its bonuses as they were", () => {
    const merge = useVapeAchievementsStore.persist.getOptions().merge!;
    const s = merge({ purchasedJuiceUpgradeIds: ["juice_coil_polish", "juice_triple_coil"] }, useVapeAchievementsStore.getState()) as ReturnType<typeof useVapeAchievementsStore.getState>;
    expect(s.juiceFills).toEqual({ juice_coil_polish: 40, juice_triple_coil: 510 });
    expect(s.juiceMpsMultBonus).toBeCloseTo(0.38, 5);
  });

  test("the upgrades compete: all of them come to far more than every achievement pays", () => {
    const all = JUICE_SHOP_UPGRADES.reduce((n, u) => n + u.cost, 0), paid = ACHIEVEMENT_CATALOG.reduce((n, a) => n + a.juiceReward, 0);
    expect(all).toBeGreaterThan(paid * 1.7);
  });
});
