import { useFounderStore } from "../../state/founder.store";
import { useGeneratorStore } from "../../state/generators.store";
import { usePrestigeStore } from "../../state/prestige.store";
import type { BreakdownRow, ModifierBreakdown } from "./types";
import { fmt2, pct1, titled } from "./utils";

export const entries: Record<string, () => ModifierBreakdown> = {
  founderGlobalMoney: () => {
    const mult = useFounderStore.getState().globalMoneyMult;
    return {
      label: titled("Money", "founder"),
      rows: mult !== 1
        ? [{ source: "Founder", value: fmt2(mult), tone: mult > 1 ? "good" : "bad" }]
        : [{ source: "None from this founder", value: "—", tone: "neutral" }],
      total: fmt2(mult),
    };
  },

  founderValuation: () => {
    const mult = useFounderStore.getState().valuationAccrualMult;
    return {
      label: titled("Valuation", "founder"),
      rows: mult !== 1
        ? [{ source: "Founder", value: fmt2(mult), tone: mult > 1 ? "good" : "bad" }]
        : [{ source: "None from this founder", value: "—", tone: "neutral" }],
      total: fmt2(mult),
    };
  },

  headcountMoney: () => {
    const founder = useFounderStore.getState();
    const prestige = usePrestigeStore.getState().modifiers;
    const totalEmployees = useGeneratorStore
      .getState()
      .generators.reduce((n, g) => n + g.amount, 0);
    const rate = founder.headcountMoneyPerEmployee + prestige.headcountPerEmployee;
    const total = 1 + rate * totalEmployees;
    const rows: BreakdownRow[] = [];
    if (founder.headcountMoneyPerEmployee > 0)
      rows.push({
        source: `Founder: ${pct1(founder.headcountMoneyPerEmployee * 100)} an employee`,
        value: "",
        tone: "neutral",
      });
    if (prestige.headcountPerEmployee > 0)
      rows.push({
        source: `Skill tree: ${pct1(prestige.headcountPerEmployee * 100)} an employee`,
        value: "",
        tone: "neutral",
      });
    rows.push({
      source: `${totalEmployees} employees × ${pct1(rate * 100)}`,
      value: fmt2(total),
      tone: total > 1 ? "good" : "neutral",
    });
    return { label: "Money per employee", rows, total: fmt2(total) };
  },
};
