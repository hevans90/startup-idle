import { describe, expect, test } from "bun:test";

import { POLICIES, policiesFor, policyEffects, policySlots, validPolicies } from "./policies";

describe("work policies", () => {
  test("slots come with manager tiers in all: none, then one at 1, two at 5, three at 12, four at 25", () => {
    expect([0, 1, 4, 5, 12, 24, 25, 100].map(policySlots)).toEqual([0, 1, 1, 2, 3, 3, 4, 4]);
  });

  test("every kind has its shared six and one of its own", () => {
    for (const kind of ["intern", "vibe_coder", "10x_dev"] as const) {
      const own = policiesFor(kind).filter((p) => p.only);
      expect(own.map((p) => p.only)).toEqual([kind]);
      expect(policiesFor(kind).length).toBe(7);
    }
    expect(new Set(POLICIES.map((p) => p.id)).size).toBe(POLICIES.length);
  });

  test("effects combine: morale adds, the rest multiply, hires a second add", () => {
    const e = policyEffects(["crunch", "freeze", "pipeline"]);
    expect(e.morale).toBe(-16);
    expect(e.output).toBeCloseTo(1.25);
    expect(e.hireCost).toBeCloseTo(0.7);
    expect(e.autoBuy).toBeCloseTo(0.5);
    expect(policyEffects([])).toEqual({ morale: 0, output: 1, innovation: 1, hireCost: 1, autoBuy: 0, slop: 1 });
  });

  test("a save or a press is trusted for nothing: unknown, another kind's, repeats and the overflow go", () => {
    expect(validPolicies("intern", ["crunch", "hackathon", "nope", "crunch", "lunch", "remote"], 2)).toEqual(["crunch", "lunch"]);
  });
});
