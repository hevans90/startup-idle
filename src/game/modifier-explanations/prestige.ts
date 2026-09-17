import { usePrestigeStore } from "../../state/prestige.store";
import { useVapeAchievementsStore } from "../../state/vape-achievements.store";
import type { ModifierBreakdown } from "./types";
import { simplePrestigeEntry } from "./factories";
import { fmt2, orNone, prestigeRows } from "./utils";

export const entries: Record<string, () => ModifierBreakdown> = {
  prestigeMoney: simplePrestigeEntry("Skill tree — $", "money", (m) => m.moneyMult),
  prestigeInnovation: simplePrestigeEntry("Skill tree — innovation", "innovation", (m) => m.innovationMult),
  prestigeValuation: simplePrestigeEntry("Skill tree — valuation", "valuation", (m) => m.valuationMult),
  prestigeEmployeeOutput: simplePrestigeEntry("Skill tree — employee output", "employeeOutput", (m) => m.employeeOutputMult),

  prestigeInternOutput: () => {
    const mult = usePrestigeStore.getState().modifiers.internOutputMult;
    return {
      label: "Skill tree — intern output",
      rows: mult !== 1
        ? [{ source: "AGI-Pilled keystone", value: fmt2(mult), tone: "bad" as const }]
        : [{ source: "No active sources", value: "—", tone: "neutral" as const }],
      total: fmt2(mult),
    };
  },

  prestigeHireCost: simplePrestigeEntry("Skill tree — hire cost", "hireCost", (m) => m.hireCostMult, "down"),
  prestigeEquity: simplePrestigeEntry("Skill tree — equity", "equity", (m) => m.equityMult),
  prestigeAutoBuy: simplePrestigeEntry("Skill tree — auto-buy", "autoBuy", (m) => m.autoBuyMult),
  prestigeManagerSpeed: simplePrestigeEntry("Skill tree — manager speed", "managerSpeed", (m) => m.managerSpeedMult),
  prestigeSatisfactionGain: simplePrestigeEntry("Skill tree — satisfaction speed", "satisfactionGain", (m) => m.satisfactionGainMult),
  prestigeSingularity: simplePrestigeEntry("Skill tree — AI singularity", "singularity", (m) => m.singularityMult),

  skillTreeMoney: () => {
    const m = usePrestigeStore.getState().modifiers;
    return {
      label: "Skill tree — $ & output",
      rows: orNone([...prestigeRows("money"), ...prestigeRows("employeeOutput")]),
      total: fmt2(m.moneyMult * m.employeeOutputMult),
    };
  },

  skillTreeInnovation: () => {
    const m = usePrestigeStore.getState().modifiers;
    return {
      label: "Skill tree — innovation & output",
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
        source: "Skill tree nodes",
        value: fmt2(prestige.hireCostMult),
        tone: prestige.hireCostMult < 1 ? "good" : "bad",
      } as const);
    if (juiceReduction > 0)
      rows.push({
        source: "Vape juice discount",
        value: `-${(juiceReduction * 100).toFixed(1)}%`,
        tone: "good",
      } as const);
    return {
      label: "Hire cost multiplier",
      rows: orNone(rows),
      total: fmt2(total),
    };
  },
};
