import { describe as group, expect, test } from "bun:test";
import Decimal from "break_infinity.js";

import { audit, CATALOGUES, type CatalogueId } from "./wording-audit";
import { change, describe, effectProblems, formatMoneyScale, formatScale } from "./wording";

group("an effect line, from numbers", () => {
  test("the stat first, gains before costs, joined by ·", () => {
    expect(describe({ morale: -8, output: 1.25 })).toBe("Output +25% · morale −8");
    expect(describe({ money: 1.08 })).toBe("Money +8%");
  });

  test("a scope opens the line", () => {
    expect(describe({ output: 1.15, morale: -4 }, "Team")).toBe("Team output +15% · morale −4");
  });

  test("cheaper is a minus on a cost, and counts as a gain", () => {
    expect(describe({ hires: 0.9, output: 0.95 })).toBe("Hires −10% · output −5%");
  });

  test("twice and more, or half and less, is a multiple", () => {
    expect(describe({ money: 3, valuation: 0.2 })).toBe("Money ×3 · valuation ×0.2");
    expect(change("innovation", 2.5)).toBe("×2.5");
    expect(change("money", 0.5)).toBe("×0.5");
    expect(change("money", 1.35)).toBe("+35%");
  });

  test("percentages whole, but for small ones with a fraction", () => {
    expect(change("money", 1.025)).toBe("+2.5%");
    expect(change("money", 1.124)).toBe("+12%");
    expect(change("morale", 6)).toBe("+6");
  });

  test("a stat that does nothing is left out", () => {
    expect(describe({ money: 1, morale: 0, innovation: 1.2 })).toBe("Innovation +20%");
  });

  test("an acronym keeps its capitals mid-line", () => {
    expect(describe({ money: 1.1, aiMeter: 0.8 })).toBe("Money +10% · AI meter −20%");
  });

  test("what describe writes, the rules pass", () => {
    for (const e of [{ output: 1.25, morale: -8 }, { hires: 0.7, morale: -5 }, { innovation: 2.5, autoBuy: 2, money: 0.5 }]) {
      expect(effectProblems(describe(e))).toEqual([]);
    }
  });
});

group("an effect line, by hand", () => {
  test("each rule it breaks is named", () => {
    expect(effectProblems("+8% employee money output.")).toEqual([
      "ends with a full stop",
      "the change before the stat — say the stat first",
      'says "employee money output" — say money',
    ]);
    expect(effectProblems("Innovation 2.5x & money -50%")).toEqual([
      "joins parts with and, but or & — use ·",
      "a hyphen for a minus — use −",
      "an x for times — use ×",
    ]);
    expect(effectProblems("−10% hire cost on all generators")).toContain('says "generators" — say interns, vibe coders, 10x devs');
  });

  test("cheaper is a minus, and an aside is flavour", () => {
    expect(effectProblems("Hiring 10% cheaper")).toEqual(['says "cheaper" — say a minus on the price: Hires −10%']);
    expect(effectProblems("Morale +6 · output −5% (the lunch)")).toEqual(["an aside in brackets — it belongs in the flavour line"]);
  });

  test("money itself may carry its sign", () => {
    expect(effectProblems("$600 now · 20% stake")).toEqual([]);
    expect(effectProblems("Founder — global $")).toContain('says "$" — say money');
  });
});

group("a big number, by name", () => {
  test("three figures, a name a thousand apart", () => {
    expect(formatScale(605)).toBe("605");
    expect(formatScale(12.345)).toBe("12.3");
    expect(formatScale(12_400)).toBe("12.4K");
    expect(formatScale(3_100_000)).toBe("3.10M");
    expect(formatScale(1e12)).toBe("1.00T");
    expect(formatScale(2.5e15)).toBe("2.50Qa");
  });

  test("rounding up to a thousand of one is one of the next", () => {
    expect(formatScale(999_960)).toBe("1.00M");
  });

  test("past decillions, e-notation — far past what a number can hold", () => {
    expect(formatScale(1e33)).toBe("1.00Dc");
    expect(formatScale(1e36)).toBe("1.00e+36");
    expect(formatScale(new Decimal("3.57e828"))).toBe("3.57e+828");
  });

  test("money carries its sign before the dollar", () => {
    expect(formatMoneyScale(12_400)).toBe("$12.4K");
    expect(formatMoneyScale(-3_100_000)).toBe("−$3.10M");
  });
});

/**
 * THE CATALOGUES PUT RIGHT, held to the rules from here on. One joins this as
 * phase 2 rewrites it; the rest wait as todos — `bun run wording` lists what
 * is wrong with each. @see plans/polish.md
 */
const CLEARED = new Set<CatalogueId>([]);

group("every modifier's effect line keeps the rules", () => {
  for (const id of Object.keys(CATALOGUES) as CatalogueId[]) {
    const run = CLEARED.has(id) ? test : test.todo;
    run(id, () => expect(audit(id)).toEqual([]));
  }
});
