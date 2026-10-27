import { describe, expect, test } from "bun:test";
import {
  defaultSatisfactionScores,
  dev10xSatisfactionExponentDelta,
  internSatisfactionIpsMultiplier,
  satisfactionRevenueMultiplier,
  satisfactionTargetForRole,
  stepSatisfactionScores,
  vibeSlopMultiplier,
} from "./satisfaction";

const zeroPerks = {
  moneyLevel: 0,
  innovationLevel: 0,
  costLevel: 0,
  autoBuyLevel: 0,
};

describe("morale's effects, on its −40…+40 scale", () => {
  test("output: ×0.5 at −40, ×1 at 0, ×2 at +40, linear each side, clamped", () => {
    expect(satisfactionRevenueMultiplier(-40)).toBeCloseTo(0.5, 6);
    expect(satisfactionRevenueMultiplier(0)).toBeCloseTo(1, 6);
    expect(satisfactionRevenueMultiplier(40)).toBeCloseTo(2, 6);
    expect(satisfactionRevenueMultiplier(-20)).toBeCloseTo(0.75, 6);
    expect(satisfactionRevenueMultiplier(20)).toBeCloseTo(1.5, 6);
    expect(satisfactionRevenueMultiplier(-100)).toBeCloseTo(0.5, 6);
    expect(satisfactionRevenueMultiplier(100)).toBeCloseTo(2, 6);
  });

  test("interns: the company's innovation, ×0.8 to ×1.2", () => {
    expect(internSatisfactionIpsMultiplier(-40)).toBeCloseTo(0.8, 6);
    expect(internSatisfactionIpsMultiplier(0)).toBe(1);
    expect(internSatisfactionIpsMultiplier(40)).toBeCloseTo(1.2, 6);
  });

  test("vibe coders: the slop pit, twice as fast at −40, half at +40", () => {
    expect(vibeSlopMultiplier(-40)).toBeCloseTo(2, 6);
    expect(vibeSlopMultiplier(0)).toBe(1);
    expect(vibeSlopMultiplier(40)).toBeCloseTo(0.5, 6);
  });

  test("10x devs: their cost exponent, opposite in sign, ±0.35 at the ends", () => {
    expect(dev10xSatisfactionExponentDelta(40)).toBeCloseTo(-0.35, 5);
    expect(dev10xSatisfactionExponentDelta(-40)).toBeCloseTo(0.35, 5);
    expect(dev10xSatisfactionExponentDelta(0)).toBe(0);
  });
});

describe("stepSatisfactionScores", () => {
  test("moves toward a lower target when perks cost morale", () => {
    const prev = defaultSatisfactionScores();
    const perks = {
      intern: { ...zeroPerks, moneyLevel: 2 },
      vibe_coder: { ...zeroPerks },
      "10x_dev": { ...zeroPerks },
    };
    const amounts = { intern: 80, vibe_coder: 0, "10x_dev": 0 };
    const next = stepSatisfactionScores(prev, perks, amounts, 5);
    expect(next.intern).toBeLessThan(prev.intern);
    expect(next.vibe_coder).toBe(prev.vibe_coder);
  });
});

describe("satisfactionTargetForRole", () => {
  test("more money perks lowers target", () => {
    const low = satisfactionTargetForRole("intern", 5, {
      ...zeroPerks,
      moneyLevel: 0,
    });
    const high = satisfactionTargetForRole("intern", 5, {
      ...zeroPerks,
      moneyLevel: 10,
    });
    expect(high).toBeLessThan(low);
  });
});

describe("work: the perks, on the new scale", () => {
  test("headcount alone moves nothing: crowding is the town's", () => {
    expect(satisfactionTargetForRole("intern", 1e9, zeroPerks)).toBe(0);
    expect(satisfactionTargetForRole("10x_dev", 500, zeroPerks)).toBe(0);
  });
});
