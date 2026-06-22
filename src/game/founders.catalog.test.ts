import { describe, expect, test } from "bun:test";
import { FOUNDERS } from "./founders.catalog";

describe("FOUNDERS catalog", () => {
  test("exactly 5 founders with unique ids", () => {
    expect(FOUNDERS.length).toBe(5);
    expect(new Set(FOUNDERS.map((f) => f.id)).size).toBe(5);
  });

  test("each founder has a name, tagline, icon, perks and a small starting cash", () => {
    for (const f of FOUNDERS) {
      expect(f.name.length).toBeGreaterThan(0);
      expect(f.tagline.length).toBeGreaterThan(0);
      expect(f.icon).toBeDefined(); // tabler icon component (forwardRef object)
      expect(f.perks.length).toBeGreaterThan(0);
      expect(f.startingCash).toBeGreaterThan(0);
      expect(f.startingCash).toBeLessThanOrEqual(500); // bootstrap, not a windfall
    }
  });

  test("modifier values stay within sane bounds", () => {
    for (const f of FOUNDERS) {
      const m = f.modifiers;
      if (m.costExponentReduction != null)
        expect(m.costExponentReduction).toBeGreaterThan(0);
      if (m.costExponentReduction != null)
        expect(m.costExponentReduction).toBeLessThan(0.05);
      if (m.innovationLogMult != null)
        expect(m.innovationLogMult).toBeGreaterThanOrEqual(1);
      if (m.managerProgressMult != null)
        expect(m.managerProgressMult).toBeGreaterThanOrEqual(1);
      if (m.valuationAccrualMult != null)
        expect(m.valuationAccrualMult).toBeGreaterThanOrEqual(1);
      if (m.mandateCostGrowthReduction != null)
        expect(m.mandateCostGrowthReduction).toBeLessThan(0.1);
      if (m.headcountMoneyPerEmployee != null)
        expect(m.headcountMoneyPerEmployee).toBeLessThan(0.02);
      if (m.autoBuyMult != null) expect(m.autoBuyMult).toBeGreaterThanOrEqual(1);
    }
  });

  test("at least one founder uses each curve-bending dimension", () => {
    const used = (key: string) =>
      FOUNDERS.some((f) => (f.modifiers as Record<string, unknown>)[key] != null);
    for (const dim of [
      "costExponentReduction",
      "innovationLogMult",
      "managerProgressMult",
      "valuationAccrualMult",
      "mandateCostGrowthReduction",
      "headcountMoneyPerEmployee",
      "autoBuyMult",
    ]) {
      expect(used(dim)).toBe(true);
    }
  });
});
