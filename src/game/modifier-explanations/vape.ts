import { useVapeAchievementsStore } from "../../state/vape-achievements.store";
import type { ModifierBreakdown } from "./types";
import { NO_JUICE_ROW, juiceEntry } from "./factories";
import { pct1 } from "./utils";

export const entries: Record<string, () => ModifierBreakdown> = {
  juiceMoney: juiceEntry(
    "Vape juice — $",
    () => useVapeAchievementsStore.getState().juiceMpsMultBonus,
  ),
  juiceInnovation: juiceEntry(
    "Vape juice — innovation",
    () => useVapeAchievementsStore.getState().juiceInnovationMultBonus,
  ),
  juiceValuation: juiceEntry(
    "Vape juice — valuation",
    () => useVapeAchievementsStore.getState().juiceValuationMultBonus,
  ),

  juiceHireCostReduction: () => {
    const reduction = Math.min(0.9, useVapeAchievementsStore.getState().juiceHireCostReduction);
    const pctStr = `-${(reduction * 100).toFixed(1)}%`;
    return {
      label: "Vape juice — hire discount",
      rows: reduction > 0
        ? [{ source: "Vape achievements", value: pctStr, tone: "good" }]
        : [NO_JUICE_ROW],
      total: reduction > 0 ? pctStr : "none",
    };
  },

  juiceEquityBonus: () => {
    const bonus = useVapeAchievementsStore.getState().juiceEquityMultBonus;
    return {
      label: "Vape juice — equity",
      rows: bonus > 0
        ? [{ source: "Vape achievements", value: pct1(bonus * 100), tone: "good" }]
        : [NO_JUICE_ROW],
      total: bonus > 0 ? `+${(bonus * 100).toFixed(1)}%` : "none",
    };
  },
};
