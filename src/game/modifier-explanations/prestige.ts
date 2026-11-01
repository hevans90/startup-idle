import { usePrestigeStore } from "../../state/prestige.store";
import { useVapeAchievementsStore } from "../../state/vape-achievements.store";
import type { ModifierBreakdown } from "./types";
import { simplePrestigeEntry } from "./factories";
import { fmt2, orNone, pct1, prestigeRows, titled } from "./utils";

export const entries: Record<string, () => ModifierBreakdown> = {
  prestigeMoney: simplePrestigeEntry(titled("Money", "skill tree"), "money", (m) => m.moneyMult),
  prestigeInnovation: simplePrestigeEntry(titled("Innovation", "skill tree"), "innovation", (m) => m.innovationMult),
  prestigeValuation: simplePrestigeEntry(titled("Valuation", "skill tree"), "valuation", (m) => m.valuationMult),
  prestigeEmployeeOutput: simplePrestigeEntry(titled("Output", "skill tree"), "employeeOutput", (m) => m.employeeOutputMult),

  prestigeInternOutput: () => {
    const mult = usePrestigeStore.getState().modifiers.internOutputMult;
    return {
      label: titled("Interns", "skill tree"),
      rows: mult !== 1
        ? [{ source: "AGI-Pilled", value: fmt2(mult), tone: "bad" as const }]
        : [{ source: "Nothing yet", value: "—", tone: "neutral" as const }],
      total: fmt2(mult),
    };
  },

  prestigeHireCost: simplePrestigeEntry(titled("Hires", "skill tree"), "hireCost", (m) => m.hireCostMult, "down"),
  prestigeEquity: simplePrestigeEntry(titled("Equity", "skill tree"), "equity", (m) => m.equityMult),
  prestigeAutoBuy: simplePrestigeEntry(titled("Auto-buy", "skill tree"), "autoBuy", (m) => m.autoBuyMult),
  prestigeManagerSpeed: simplePrestigeEntry(titled("Manager speed", "skill tree"), "managerSpeed", (m) => m.managerSpeedMult),
  prestigeSatisfactionGain: simplePrestigeEntry(titled("Morale recovery", "skill tree"), "satisfactionGain", (m) => m.satisfactionGainMult),
  prestigeSingularity: simplePrestigeEntry(titled("AI meter", "skill tree"), "singularity", (m) => m.singularityMult),

  skillTreeMoney: () => {
    const m = usePrestigeStore.getState().modifiers;
    return {
      label: titled("Money", "skill tree"),
      rows: orNone([...prestigeRows("money"), ...prestigeRows("employeeOutput")]),
      total: fmt2(m.moneyMult * m.employeeOutputMult),
    };
  },

  skillTreeInnovation: () => {
    const m = usePrestigeStore.getState().modifiers;
    return {
      label: titled("Innovation", "skill tree"),
      rows: orNone([...prestigeRows("innovation"), ...prestigeRows("employeeOutput")]),
      total: fmt2(m.innovationMult * m.employeeOutputMult),
    };
  },

  hireCost: () => {
    const prestige = usePrestigeStore.getState().modifiers;
    const juiceReduction = Math.min(0.9, useVapeAchievementsStore.getState().juiceHireCostReduction);
    const total = prestige.hireCostMult * (1 - juiceReduction);
    const rows = [];
    if (prestige.hireCostMult !== 1)
      rows.push({
        source: "Skill tree",
        value: fmt2(prestige.hireCostMult),
        tone: prestige.hireCostMult < 1 ? "good" : "bad",
      } as const);
    if (juiceReduction > 0)
      rows.push({
        source: "Vape juice",
        value: pct1(-juiceReduction * 100),
        tone: "good",
      } as const);
    return {
      label: "Hires",
      rows: orNone(rows),
      total: fmt2(total),
    };
  },
};
