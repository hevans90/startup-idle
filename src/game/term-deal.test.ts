import { afterEach, describe, expect, test } from "bun:test";

import { useSessionStore } from "../state/session.store";
import { offerPremium, OFFER_PREMIUM } from "./acquisition";
import { computeHireCostMultipliers } from "./modifiers";
import {
  CLAUSES, NEGOTIATORS, NO_EFFECTS, appetite, dealEffects, openingDeal, reply, termEffects, termSaleMult, willSign,
  type Clauses,
} from "./term-deal";
import { TERM_SHEETS, setTermReader, termBonusNow, termStatus } from "./term-sheets";

afterEach(() => useSessionStore.getState().reset());

const sign = (investor: string, clauses: Clauses) => {
  useSessionStore.getState().setTermSheet(investor);
  useSessionStore.getState().setTermClauses(clauses);
};

describe("the term sheet, negotiated", () => {
  test("every investor has terms, and opens with a draft they would sign", () => {
    for (const t of TERM_SHEETS) {
      expect(NEGOTIATORS[t.id]).toBeDefined();
      const opening = openingDeal(t.id);
      for (const c of CLAUSES) expect(c.options.some((o) => o.id === opening[c.id])).toBe(true);
      expect(willSign(t.id, opening)).toBe(true);
    }
  });

  test("the clause they care about counts twice, and taking terms back costs their appetite", () => {
    const opening = openingDeal("quick");
    // Blitz cares about exclusivity: their no-shop is worth 4 to them, an open market nothing.
    expect(appetite("quick", opening)).toBe(4);
    const open = { ...opening, exclusivity: "open" };
    expect(appetite("quick", open)).toBe(0);
    expect(willSign("quick", open)).toBe(false);
    expect(reply("quick", open)).toBe(NEGOTIATORS.quick.says.no);
    // Give them a 2x preference instead, and they sign again.
    expect(willSign("quick", { ...open, preference: "two" })).toBe(true);
  });

  test("a deal's effects combine; no deal changes nothing", () => {
    expect(dealEffects(null)).toEqual(NO_EFFECTS);
    const e = dealEffects({ investment: "seed", preference: "two", board: "investor", pool: "twenty", milestone: "stretch", exclusivity: "noshop" });
    expect(e.cash).toBe(600);
    expect(e.dilution).toBeCloseTo(0.2);
    expect(e.saleMult).toBeCloseTo(0.85 * 0.9 * 0.9);
    expect(e.hireCostMult).toBeCloseTo(0.8);
    expect(e.mandateCostMult).toBeCloseTo(0.75);
    expect(e.goalScale).toBeCloseTo(1.5);
    expect(e.bonusMult).toBeCloseTo(1.6);
    expect(e.offers).toBe("none");
  });

  test("a run founded before clauses keeps the old terms exactly", () => {
    useSessionStore.getState().setTermSheet("town");
    expect(termEffects()).toEqual(NO_EFFECTS);
    expect(termSaleMult()).toBe(1);
    expect(termStatus()!.goal).toBe("40 lived-in houses when you sell");
  });

  test("the milestone scales the goal and its kicker", () => {
    sign("town", { ...openingDeal("town"), milestone: "moonshot" });
    const stop = setTermReader(() => ({ houses: 60, wonders: 0 }));
    const t = termStatus()!;
    expect(t.goal).toBe("80 lived-in houses when you sell");
    expect(t.progress.met).toBe(false);
    expect(t.bonus).toBeCloseTo(0.25 * 2.2);
    stop();
    sign("town", { ...openingDeal("town"), milestone: "comfortable" });
    const stop2 = setTermReader(() => ({ houses: 30, wonders: 0 }));
    expect(termStatus()!.progress.met).toBe(true);
    expect(termBonusNow()).toBeCloseTo(0.25 * 0.6);
    stop2();
  });

  test("the quick sale's deadline shortens as the milestone hardens", () => {
    sign("quick", { ...openingDeal("quick"), milestone: "moonshot" });
    expect(termStatus()!.goal).toBe("Sell within 1 h 15 min of founding");
  });

  test("the sale, hiring and the board read the deal", () => {
    const before = computeHireCostMultipliers(1, 1).prestige;
    sign("agents", openingDeal("agents"));
    // Seed: 20% stake; a 20% pool takes 10% more of the sale and makes hiring 20% cheaper.
    expect(termSaleMult()).toBeCloseTo(0.8 * 0.9);
    expect(computeHireCostMultipliers(1, 1).prestige).toBeCloseTo(before * 0.8);
  });

  test("first refusal halves an acquirer's premium; a no-shop keeps them away", () => {
    sign("quick", { ...openingDeal("quick"), exclusivity: "rofr" });
    expect(offerPremium()).toBeCloseTo(1 + (OFFER_PREMIUM - 1) / 2);
    sign("quick", openingDeal("quick"));
    expect(termEffects().offers).toBe("none");
  });
});
