import { useVapeAchievementsStore } from "../../state/vape-achievements.store";
import type { ModifierBreakdown } from "./types";
import { NO_JUICE_ROW, juiceEntry } from "./factories";
import { titled } from "./utils";
import { percent } from "../wording";

export const entries: Record<string, () => ModifierBreakdown> = {
  juiceMoney: juiceEntry(
    titled("Money", "vape juice"),
    () => useVapeAchievementsStore.getState().juiceMpsMultBonus,
  ),
  juiceInnovation: juiceEntry(
    titled("Innovation", "vape juice"),
    () => useVapeAchievementsStore.getState().juiceInnovationMultBonus,
  ),
  juiceValuation: juiceEntry(
    titled("Valuation", "vape juice"),
    () => useVapeAchievementsStore.getState().juiceValuationMultBonus,
  ),

  juiceHireCostReduction: () => {
    const reduction = Math.min(0.9, useVapeAchievementsStore.getState().juiceHireCostReduction);
    const pctStr = percent(-reduction * 100);
    return {
      label: titled("Hires", "vape juice"),
      rows: reduction > 0
        ? [{ source: "Vape achievements", value: pctStr, tone: "good" }]
        : [NO_JUICE_ROW],
      total: reduction > 0 ? pctStr : "none",
    };
  },

  juiceEquityBonus: () => {
    const bonus = useVapeAchievementsStore.getState().juiceEquityMultBonus;
    return {
      label: titled("Equity", "vape juice"),
      rows: bonus > 0
        ? [{ source: "Vape achievements", value: percent(bonus * 100), tone: "good" }]
        : [NO_JUICE_ROW],
      total: bonus > 0 ? percent(bonus * 100) : "none",
    };
  },
};
