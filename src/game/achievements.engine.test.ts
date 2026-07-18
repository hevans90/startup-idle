import { describe, expect, test } from "bun:test";
import Decimal from "break_infinity.js";
import { useExitsStore } from "../state/exits.store";
import { usePrestigeStore } from "../state/prestige.store";
import { useVapeAchievementsStore } from "../state/vape-achievements.store";
import { ACHIEVEMENT_CATALOG } from "./achievements.catalog";
import { achievementsNewlyMet, buildAchievementContext } from "./achievements.engine";
import { vapeTankFillRatio } from "./vape-display-utils";

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

describe("exit-count achievements are respec-safe (lifetime, not spendable)", () => {
  test("serial_founder still fires after exits are spent on respecs", () => {
    useExitsStore.getState().clearAll();
    usePrestigeStore.getState().reset();

    // Three real acquisitions (monotonic lifetime record in exits.store).
    useExitsStore.getState().recordExit("neet", 1000);
    useExitsStore.getState().recordExit("neet", 1500);
    useExitsStore.getState().recordExit("hacker", 2000);

    // Bank each exit then immediately spend it on respecs, so the *spendable*
    // prestige.exits currency drains back to 0 — the exact sequence that used to
    // make serial_founder (which read prestige.exits) never unlock.
    for (let i = 0; i < 3; i++) {
      usePrestigeStore.getState().bankAcquisition(new Decimal(100));
      usePrestigeStore.getState().buyRespecs();
    }
    expect(usePrestigeStore.getState().exits).toBe(0);

    const ctx = buildAchievementContext();
    expect(ctx.exits).toBe(3); // lifetime count, not the drained currency

    const met = achievementsNewlyMet(ctx, new Set());
    expect(met.some((a) => a.id === "first_exit")).toBe(true);
    expect(met.some((a) => a.id === "serial_founder")).toBe(true);
  });
});

describe("vapeTankFillRatio", () => {
  test("empty juice gives 0 fill", () => {
    expect(vapeTankFillRatio(new Decimal(0), new Decimal(0), [])).toBe(0);
  });

  test("juice at cap gives 1", () => {
    const cap = 100;
    expect(vapeTankFillRatio(new Decimal(cap), new Decimal(0), [])).toBe(1);
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

  test("tryPurchaseJuiceUpgrade spends juice and applies bonus", () => {
    useVapeAchievementsStore.getState().reset();
    useVapeAchievementsStore.getState().recordAchievementUnlock("seed", 500);
    const ok = useVapeAchievementsStore
      .getState()
      .tryPurchaseJuiceUpgrade("juice_coil_polish");
    expect(ok).toBe(true);
    expect(useVapeAchievementsStore.getState().juiceMpsMultBonus).toBeCloseTo(0.08, 5);
    expect(
      useVapeAchievementsStore.getState().purchasedJuiceUpgradeIds,
    ).toContain("juice_coil_polish");
  });
});
