import { usePrestigeStore } from "../../state/prestige.store";
import { MANDATES, useValuationStore } from "../../state/valuation.store";
import { useVapeAchievementsStore } from "../../state/vape-achievements.store";
import type { BreakdownRow, ModifierBreakdown } from "./types";
import { fmt2, orNone } from "./utils";

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
      rows.push({ source: "Skill tree — money nodes", value: fmt2(m.moneyMult), tone: m.moneyMult > 1 ? "good" : "bad" });
    if (m.employeeOutputMult !== 1)
      rows.push({ source: "Skill tree — employee output", value: fmt2(m.employeeOutputMult), tone: m.employeeOutputMult > 1 ? "good" : "bad" });
    if (vapeBonus > 0)
      rows.push({ source: "Vape juice", value: fmt2(1 + vapeBonus), tone: "good" });
    if (mandate > 0)
      rows.push({ source: "Board mandates", value: fmt2(1 + mandate), tone: "good" });
    return {
      label: "Money output",
      rows: orNone(rows),
      total: fmt2(m.moneyMult * m.employeeOutputMult * (1 + vapeBonus) * (1 + mandate)),
    };
  },

  innovationRate: () => {
    const m = usePrestigeStore.getState().modifiers;
    const vapeBonus = useVapeAchievementsStore.getState().juiceInnovationMultBonus;
    const mandate = mandateBonus("innovationMultPerLevel");
    const rows: BreakdownRow[] = [];
    if (m.innovationMult !== 1)
      rows.push({ source: "Skill tree — innovation nodes", value: fmt2(m.innovationMult), tone: m.innovationMult > 1 ? "good" : "bad" });
    if (m.employeeOutputMult !== 1)
      rows.push({ source: "Skill tree — employee output", value: fmt2(m.employeeOutputMult), tone: m.employeeOutputMult > 1 ? "good" : "bad" });
    if (vapeBonus > 0)
      rows.push({ source: "Vape juice", value: fmt2(1 + vapeBonus), tone: "good" });
    if (mandate > 0)
      rows.push({ source: "Board mandates", value: fmt2(1 + mandate), tone: "good" });
    return {
      label: "Innovation rate",
      rows: orNone(rows),
      total: fmt2(m.innovationMult * m.employeeOutputMult * (1 + vapeBonus) * (1 + mandate)),
    };
  },

  valuationRate: () => {
    const m = usePrestigeStore.getState().modifiers;
    const vapeBonus = useVapeAchievementsStore.getState().juiceValuationMultBonus;
    const rows: BreakdownRow[] = [];
    if (m.valuationMult !== 1)
      rows.push({ source: "Skill tree", value: fmt2(m.valuationMult), tone: m.valuationMult > 1 ? "good" : "bad" });
    if (vapeBonus > 0)
      rows.push({ source: "Vape juice", value: fmt2(1 + vapeBonus), tone: "good" });
    return {
      label: "Valuation rate",
      rows: orNone(rows),
      total: fmt2(m.valuationMult * (1 + vapeBonus)),
    };
  },

  equityPayout: () => {
    const m = usePrestigeStore.getState().modifiers;
    const vapeBonus = useVapeAchievementsStore.getState().juiceEquityMultBonus;
    const rows: BreakdownRow[] = [];
    if (m.equityMult !== 1)
      rows.push({ source: "Skill tree", value: fmt2(m.equityMult), tone: m.equityMult > 1 ? "good" : "bad" });
    if (vapeBonus > 0)
      rows.push({ source: "Vape juice", value: fmt2(1 + vapeBonus), tone: "good" });
    return {
      label: "Equity payout",
      rows: orNone(rows),
      total: fmt2(m.equityMult * (1 + vapeBonus)),
    };
  },
};
