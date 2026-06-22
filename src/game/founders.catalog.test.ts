import { describe, expect, test } from "bun:test";
import { GENERATOR_TYPES } from "../state/generators.store";
import { FOUNDERS } from "./founders.catalog";

const GEN_IDS = new Set(GENERATOR_TYPES.map((g) => g.id));

describe("FOUNDERS catalog", () => {
  test("6 founders with unique ids", () => {
    expect(FOUNDERS.length).toBe(6);
    expect(new Set(FOUNDERS.map((f) => f.id)).size).toBe(FOUNDERS.length);
  });

  test("each founder has name, tagline, icon, perks and a bounded starting cash", () => {
    for (const f of FOUNDERS) {
      expect(f.name.length).toBeGreaterThan(0);
      expect(f.tagline.length).toBeGreaterThan(0);
      expect(f.icon).toBeDefined();
      expect(f.perks.length).toBeGreaterThan(0);
      expect(f.startingCash).toBeGreaterThan(0);
      expect(f.startingCash).toBeLessThanOrEqual(500);
    }
  });

  test("modifier values stay within sane bounds and reference real generators", () => {
    for (const f of FOUNDERS) {
      const m = f.modifiers;
      if (m.costExponentReduction != null) {
        expect(m.costExponentReduction).toBeGreaterThan(0);
        expect(m.costExponentReduction).toBeLessThan(0.05);
      }
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
      if (m.onlyGenerator) expect(GEN_IDS.has(m.onlyGenerator)).toBe(true);
      for (const map of [m.generatorMoneyMult, m.generatorInnovationMult]) {
        for (const [id, v] of Object.entries(map ?? {})) {
          expect(GEN_IDS.has(id as never)).toBe(true);
          expect(v).toBeGreaterThan(0);
        }
      }
    }
  });

  test("each curve-bending dimension is used by at least one founder", () => {
    const used = (key: string) =>
      FOUNDERS.some(
        (f) => (f.modifiers as Record<string, unknown>)[key] != null,
      );
    for (const dim of [
      "costExponentReduction",
      "innovationLogMult",
      "managerProgressMult",
      "valuationAccrualMult",
      "mandateCostGrowthReduction",
      "headcountMoneyPerEmployee",
      "autoBuyMult",
      "onlyGenerator",
      "generatorMoneyMult",
      "generatorInnovationMult",
    ]) {
      expect(used(dim)).toBe(true);
    }
  });
});
