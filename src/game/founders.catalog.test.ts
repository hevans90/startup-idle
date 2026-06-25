import { describe, expect, test } from "bun:test";
import { GENERATOR_TYPES } from "../state/generators.store";
import { FOUNDERS } from "./founders.catalog";

const GEN_IDS = new Set(GENERATOR_TYPES.map((g) => g.id));

describe("FOUNDERS catalog", () => {
  test("6 founders with unique ids", () => {
    expect(FOUNDERS.length).toBe(6);
    expect(new Set(FOUNDERS.map((f) => f.id)).size).toBe(FOUNDERS.length);
  });

  test("each founder has name, tagline, icon, startingCash, scalingModifier, and perks function", () => {
    for (const f of FOUNDERS) {
      expect(f.name.length).toBeGreaterThan(0);
      expect(f.tagline.length).toBeGreaterThan(0);
      expect(f.icon).toBeDefined();
      expect(typeof f.perks).toBe("function");
      expect(f.startingCash).toBeGreaterThan(0);
      expect(f.startingCash).toBeLessThanOrEqual(500);
      expect(f.scalingModifier.label.length).toBeGreaterThan(0);
      expect(f.scalingModifier.perExitDescription.length).toBeGreaterThan(0);
    }
  });

  test("perks(0) returns non-empty array for every founder", () => {
    for (const f of FOUNDERS) {
      const perks = f.perks(0);
      expect(Array.isArray(perks)).toBe(true);
      expect(perks.length).toBeGreaterThan(0);
    }
  });

  test("perks(n) returns strings for every founder", () => {
    for (const exits of [0, 1, 5]) {
      for (const f of FOUNDERS) {
        const perks = f.perks(exits);
        for (const p of perks) expect(typeof p).toBe("string");
      }
    }
  });

  test("scalingModifier.compute(0) returns valid FounderModifiers for every founder", () => {
    for (const f of FOUNDERS) {
      const mods = f.scalingModifier.compute(0, 0);
      expect(typeof mods).toBe("object");

      if (mods.costExponentReduction != null) {
        expect(mods.costExponentReduction).toBeGreaterThan(0);
        expect(mods.costExponentReduction).toBeLessThan(0.1);
      }
      if (mods.innovationLogMult != null)
        expect(mods.innovationLogMult).toBeGreaterThanOrEqual(1);
      if (mods.valuationAccrualMult != null)
        expect(mods.valuationAccrualMult).toBeGreaterThanOrEqual(1);
      if (mods.autoBuyMult != null)
        expect(mods.autoBuyMult).toBeGreaterThanOrEqual(1);
      if (mods.onlyGenerator)
        expect(GEN_IDS.has(mods.onlyGenerator)).toBe(true);

      for (const map of [mods.generatorMoneyMult, mods.generatorInnovationMult]) {
        for (const [id, v] of Object.entries(map ?? {})) {
          expect(GEN_IDS.has(id as never)).toBe(true);
          expect(v).toBeGreaterThan(0);
        }
      }
    }
  });

  test("scaling is strictly stronger at exits=3 than exits=0 for each founder", () => {
    for (const f of FOUNDERS) {
      const m0 = f.scalingModifier.compute(0, 0);
      const m3 = f.scalingModifier.compute(3, 0);

      // At least one numeric modifier must be strictly larger (or globalMoneyMult larger).
      const keys: (keyof typeof m0)[] = [
        "innovationLogMult",
        "costExponentReduction",
        "valuationAccrualMult",
        "headcountMoneyPerEmployee",
        "globalMoneyMult",
      ];
      const generatorMultKeys: ("generatorMoneyMult" | "generatorInnovationMult")[] = [
        "generatorMoneyMult",
        "generatorInnovationMult",
      ];

      let stronger = false;
      for (const k of keys) {
        const v0 = m0[k] as number | undefined;
        const v3 = m3[k] as number | undefined;
        if (v0 != null && v3 != null && v3 > v0) { stronger = true; break; }
        if (v0 == null && v3 != null && v3 > 0) { stronger = true; break; }
      }
      if (!stronger) {
        for (const k of generatorMultKeys) {
          const map0 = m0[k] ?? {};
          const map3 = m3[k] ?? {};
          for (const id of Object.keys(map3)) {
            if ((map3[id as never] as number) > ((map0[id as never] as number) ?? 0)) {
              stronger = true; break;
            }
          }
          if (stronger) break;
        }
      }

      expect(stronger).toBe(true);
    }
  });

  test("NEET: compute(0) globalMoneyMult=1, compute(3)=8", () => {
    const neet = FOUNDERS.find((f) => f.id === "neet")!;
    expect(neet.scalingModifier.compute(0, 0).globalMoneyMult).toBe(1);
    expect(neet.scalingModifier.compute(3, 0).globalMoneyMult).toBe(8);
  });

  test("each curve-bending dimension is covered by at least one founder at exits=0", () => {
    const allMods = FOUNDERS.map((f) => f.scalingModifier.compute(0, 0));

    const covered = (key: string) =>
      allMods.some((m) => (m as Record<string, unknown>)[key] != null);

    for (const dim of [
      "costExponentReduction",
      "innovationLogMult",
      "valuationAccrualMult",
      "mandateCostGrowthReduction",
      "headcountMoneyPerEmployee",
      "autoBuyMult",
      "onlyGenerator",
      "generatorMoneyMult",
      "generatorInnovationMult",
      "globalMoneyMult",
    ]) {
      expect(covered(dim)).toBe(true);
    }
  });
});
