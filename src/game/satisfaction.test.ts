import { describe, expect, test } from "bun:test";
import {
  defaultSatisfactionScores,
  dev10xSatisfactionExponentDelta,
  internSatisfactionIpsMultiplier,
  internSatisfactionManagerAccrualMultiplier,
  internSatisfactionValuationMultiplier,
  satisfactionTargetForRole,
  stepSatisfactionScores,
  vibeSingularityAccrualRatePerSecond,
} from "./satisfaction";

const zeroPerks = {
  moneyLevel: 0,
  innovationLevel: 0,
  costLevel: 0,
  autoBuyLevel: 0,
};

describe("satisfaction curves", () => {
  test("intern IPS mult: no bonus at or below 0", () => {
    expect(internSatisfactionIpsMultiplier(-50)).toBe(1);
    expect(internSatisfactionIpsMultiplier(0)).toBe(1);
    expect(internSatisfactionIpsMultiplier(100)).toBeCloseTo(1.12, 5);
  });

  test("intern valuation mult: penalty when negative", () => {
    expect(internSatisfactionValuationMultiplier(0)).toBe(1);
    expect(internSatisfactionValuationMultiplier(50)).toBe(1);
    expect(internSatisfactionValuationMultiplier(-100)).toBeCloseTo(0.25, 5);
  });

  test("intern manager mult: floor when very low", () => {
    expect(internSatisfactionManagerAccrualMultiplier(0)).toBe(1);
    expect(internSatisfactionManagerAccrualMultiplier(100)).toBeGreaterThan(1);
    expect(internSatisfactionManagerAccrualMultiplier(-100)).toBe(0.12);
  });

  test("10x exponent delta: sign opposes score", () => {
    expect(dev10xSatisfactionExponentDelta(100)).toBeCloseTo(-0.35, 5);
    expect(dev10xSatisfactionExponentDelta(-100)).toBeCloseTo(0.35, 5);
    expect(dev10xSatisfactionExponentDelta(0)).toBe(0);
  });

  test("vibe singularity: no accrual unless negative; slow %/s scale", () => {
    expect(vibeSingularityAccrualRatePerSecond(0)).toBe(0);
    expect(vibeSingularityAccrualRatePerSecond(10)).toBe(0);
    expect(vibeSingularityAccrualRatePerSecond(-100)).toBeCloseTo(0.012, 6);
    expect(vibeSingularityAccrualRatePerSecond(-50)).toBeCloseTo(0.006, 6);
  });
});

describe("stepSatisfactionScores", () => {
  test("moves toward lower target when many interns", () => {
    const prev = defaultSatisfactionScores();
    const perks = {
      intern: { ...zeroPerks },
      vibe_coder: { ...zeroPerks },
      "10x_dev": { ...zeroPerks },
    };
    const amounts = { intern: 80, vibe_coder: 0, "10x_dev": 0 };
    const next = stepSatisfactionScores(prev, perks, amounts, 5);
    expect(next.intern).toBeLessThan(prev.intern);
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
