import { useFounderStore } from "../../state/founder.store";
import { useGeneratorStore } from "../../state/generators.store";
import { usePrestigeStore } from "../../state/prestige.store";
import type { BreakdownRow, ModifierBreakdown } from "./types";
import { fmt2 } from "./utils";

export const entries: Record<string, () => ModifierBreakdown> = {
  founderGlobalMoney: () => {
    const mult = useFounderStore.getState().globalMoneyMult;
    return {
      label: "Founder — global $",
      rows: mult !== 1
        ? [{ source: "Founder bonus", value: fmt2(mult), tone: mult > 1 ? "good" : "bad" }]
        : [{ source: "This founder has no global money bonus", value: "—", tone: "neutral" }],
      total: fmt2(mult),
    };
  },

  founderValuation: () => {
    const mult = useFounderStore.getState().valuationAccrualMult;
    return {
      label: "Founder — valuation",
      rows: mult !== 1
        ? [{ source: "Founder bonus", value: fmt2(mult), tone: mult > 1 ? "good" : "bad" }]
        : [{ source: "This founder has no valuation bonus", value: "—", tone: "neutral" }],
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
        source: `Founder: +${(founder.headcountMoneyPerEmployee * 100).toFixed(3)}%/emp`,
        value: "",
        tone: "neutral",
      });
    if (prestige.headcountPerEmployee > 0)
      rows.push({
        source: `Skill tree: +${(prestige.headcountPerEmployee * 100).toFixed(3)}%/emp`,
        value: "",
        tone: "neutral",
      });
    rows.push({
      source: `${totalEmployees} total employees × ${(rate * 100).toFixed(3)}%/emp`,
      value: fmt2(total),
      tone: total > 1 ? "good" : "neutral",
    });
    return { label: "Headcount synergy", rows, total: fmt2(total) };
  },
};
