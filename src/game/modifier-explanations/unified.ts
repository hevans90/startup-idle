import { usePrestigeStore } from "../../state/prestige.store";
import { MANDATES, useValuationStore } from "../../state/valuation.store";
import { useVapeAchievementsStore } from "../../state/vape-achievements.store";
import type { BreakdownRow, ModifierBreakdown } from "./types";
import { orNone } from "./utils";
import { times } from "../wording";

// These entries are used in the founder panel — one popover key regardless of which
// section renders the tag. They aggregate across skill tree + vape + mandates.

function mandateBonus(perLevelKey: "moneyMultPerLevel" | "innovationMultPerLevel"): number {
  const { mandateLevels } = useValuationStore.getState();
  return MANDATES.filter((m) => m[perLevelKey] > 0).reduce(
    (acc, m) => acc + mandateLevels[m.id] * m[perLevelKey],
    0,
  );
}

export const entries: Record<string, () => ModifierBreakdown> = {
  moneyOutput: () => {
    const m = usePrestigeStore.getState().modifiers;
    const vapeBonus = useVapeAchievementsStore.getState().juiceMpsMultBonus;
    const mandate = mandateBonus("moneyMultPerLevel");
    const rows: BreakdownRow[] = [];
    if (m.moneyMult !== 1)
      rows.push({ source: "Skill tree: money", value: times(m.moneyMult), tone: m.moneyMult > 1 ? "good" : "bad" });
    if (m.employeeOutputMult !== 1)
      rows.push({ source: "Skill tree: output", value: times(m.employeeOutputMult), tone: m.employeeOutputMult > 1 ? "good" : "bad" });
    if (vapeBonus > 0)
      rows.push({ source: "Vape juice", value: times(1 + vapeBonus), tone: "good" });
    if (mandate > 0)
      rows.push({ source: "Board mandates", value: times(1 + mandate), tone: "good" });
    return {
      label: "Money",
      rows: orNone(rows),
      total: times(m.moneyMult * m.employeeOutputMult * (1 + vapeBonus) * (1 + mandate)),
    };
  },

  innovationRate: () => {
    const m = usePrestigeStore.getState().modifiers;
    const vapeBonus = useVapeAchievementsStore.getState().juiceInnovationMultBonus;
    const mandate = mandateBonus("innovationMultPerLevel");
    const rows: BreakdownRow[] = [];
    if (m.innovationMult !== 1)
      rows.push({ source: "Skill tree: innovation", value: times(m.innovationMult), tone: m.innovationMult > 1 ? "good" : "bad" });
    if (m.employeeOutputMult !== 1)
      rows.push({ source: "Skill tree: output", value: times(m.employeeOutputMult), tone: m.employeeOutputMult > 1 ? "good" : "bad" });
    if (vapeBonus > 0)
      rows.push({ source: "Vape juice", value: times(1 + vapeBonus), tone: "good" });
    if (mandate > 0)
      rows.push({ source: "Board mandates", value: times(1 + mandate), tone: "good" });
    return {
      label: "Innovation",
      rows: orNone(rows),
      total: times(m.innovationMult * m.employeeOutputMult * (1 + vapeBonus) * (1 + mandate)),
    };
  },

  valuationRate: () => {
    const m = usePrestigeStore.getState().modifiers;
    const vapeBonus = useVapeAchievementsStore.getState().juiceValuationMultBonus;
    const rows: BreakdownRow[] = [];
    if (m.valuationMult !== 1)
      rows.push({ source: "Skill tree", value: times(m.valuationMult), tone: m.valuationMult > 1 ? "good" : "bad" });
    if (vapeBonus > 0)
      rows.push({ source: "Vape juice", value: times(1 + vapeBonus), tone: "good" });
    return {
      label: "Valuation",
      rows: orNone(rows),
      total: times(m.valuationMult * (1 + vapeBonus)),
    };
  },

  equityPayout: () => {
    const m = usePrestigeStore.getState().modifiers;
    const vapeBonus = useVapeAchievementsStore.getState().juiceEquityMultBonus;
    const rows: BreakdownRow[] = [];
    if (m.equityMult !== 1)
      rows.push({ source: "Skill tree", value: times(m.equityMult), tone: m.equityMult > 1 ? "good" : "bad" });
    if (vapeBonus > 0)
      rows.push({ source: "Vape juice", value: times(1 + vapeBonus), tone: "good" });
    return {
      label: "Equity",
      rows: orNone(rows),
      total: times(m.equityMult * (1 + vapeBonus)),
    };
  },
};
