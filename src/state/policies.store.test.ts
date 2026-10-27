import { beforeEach, describe, expect, test } from "bun:test";
import Decimal from "break_infinity.js";

import { resetAllGameStores } from "../simulation/reset-game-stores";
import { useGeneratorStore } from "./generators.store";
import { useInnovationStore } from "./innovation.store";

/** Employee management open, and the managers at so many tiers in all. */
function managersAt(tiers: number) {
  useInnovationStore.getState().grantFeatures("managers");
  useInnovationStore.setState((s) => ({ managers: { ...s.managers, agile: { ...s.managers.agile, tier: new Decimal(tiers) } } }));
}

describe("work policies, set", () => {
  beforeEach(() => {
    localStorage.clear();
    resetAllGameStores();
  });

  test("none before the HQ; then as many as the tiers give, a full row taking nothing new", () => {
    const g = () => useGeneratorStore.getState();
    expect(g().getPolicySlots()).toBe(0);
    g().togglePolicy("intern", "crunch");
    expect(g().getPolicies("intern")).toEqual([]);
    managersAt(5);
    expect(g().getPolicySlots()).toBe(2);
    g().togglePolicy("intern", "crunch");
    g().togglePolicy("intern", "lunch");
    g().togglePolicy("intern", "remote");
    expect(g().getPolicies("intern")).toEqual(["crunch", "lunch"]);
    // Off again, and the slot is free.
    g().togglePolicy("intern", "crunch");
    g().togglePolicy("intern", "remote");
    expect(g().getPolicies("intern")).toEqual(["lunch", "remote"]);
  });

  test("they reach the economy: output, hire price and auto-buy", () => {
    managersAt(25);
    const g = () => useGeneratorStore.getState();
    g().increaseGenerator("intern", 1);
    const out = g().getEmployeeOutputMults("intern").money, price = g().getEmployeeCostMult("intern");
    g().togglePolicy("intern", "crunch");
    g().togglePolicy("intern", "freeze");
    g().togglePolicy("intern", "pipeline");
    expect(g().getEmployeeOutputMults("intern").money).toBeCloseTo(out * 1.25);
    expect(g().getEmployeeCostMult("intern")).toBeCloseTo(price * 0.7);
    expect(g().getAutoBuyRate("intern")).toBeGreaterThan(0);
  });

  test("a save's policies are read and checked; an old save's perks go", async () => {
    localStorage.setItem("generators", JSON.stringify({
      state: {
        generators: [],
        employeeManagement: {
          spentManagementPoints: 12, perks: { intern: { moneyLevel: 3, innovationLevel: 0, costLevel: 0, autoBuyLevel: 1 } },
          policies: { vibe_coder: ["hackathon", "sabbatical", "nope"] }, autoBuyAcc: {},
        },
      },
      version: 0,
    }));
    await useGeneratorStore.persist.rehydrate();
    // Hackathon Culture is the vibe coders'; Research Sabbaticals is not, and "nope" is nothing.
    expect(useGeneratorStore.getState().employeeManagement.policies).toEqual({ intern: [], vibe_coder: ["hackathon"], "10x_dev": [] });
  });
});
