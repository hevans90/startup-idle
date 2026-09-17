import { useGeneratorStore } from "../../state/generators.store";
import { useInnovationStore } from "../../state/innovation.store";
import { usePrestigeStore } from "../../state/prestige.store";
import { MANDATES, useValuationStore } from "../../state/valuation.store";
import {
  SATISFACTION_MAX,
  SATISFACTION_MIN,
  SATISFACTION_REVENUE_MULT_AT_MAX,
  SATISFACTION_REVENUE_MULT_AT_MIN,
  satisfactionRevenueMultiplier,
} from "../satisfaction";
import type { BonusStat } from "../skill-tree";
import type { BreakdownRow, ModifierBreakdown } from "./types";
import { fmt2, orNone, pct1, PrestigeMods, prestigeRows, satRows } from "./utils";

export const NO_JUICE_ROW: BreakdownRow = {
  source: "No juice yet — hit score milestones in the vape minigame",
  value: "—",
  tone: "neutral",
};

export const SAT_REV_BASE =
  `Score 0 = ×1; +${SATISFACTION_MAX} = ×${SATISFACTION_REVENUE_MULT_AT_MAX}; ` +
  `${SATISFACTION_MIN} = ×${SATISFACTION_REVENUE_MULT_AT_MIN}.`;

export function simplePrestigeEntry(
  label: string,
  stat: BonusStat,
  getMult: (m: PrestigeMods) => number,
  goodDir: "up" | "down" = "up",
): () => ModifierBreakdown {
  return () => ({
    label,
    rows: orNone(prestigeRows(stat, goodDir)),
    total: fmt2(getMult(usePrestigeStore.getState().modifiers)),
  });
}

export function managerEntry(
  managerKey: "corpo" | "agile" | "sales",
  label: string,
): () => ModifierBreakdown {
  return () => {
    const { managers, unlocks } = useInnovationStore.getState();
    const prestige = usePrestigeStore.getState().modifiers;
    const active = !prestige.disableManagers && (unlocks.managers?.unlocked ?? false);
    const tier = managers[managerKey].tier.toNumber();
    const mult = managers[managerKey].bonusMultiplier.toNumber();
    return {
      label,
      rows: active
        ? [{ source: `Tier ${tier}`, value: fmt2(mult), tone: "good" }]
        : [{
            source: prestige.disableManagers
              ? "Disabled by Bootstrapped keystone"
              : "Not yet unlocked",
            value: "—",
            tone: "neutral",
          }],
      total: fmt2(active ? mult : 1),
    };
  };
}

export function juiceEntry(
  label: string,
  getBonus: () => number,
): () => ModifierBreakdown {
  return () => {
    const bonus = getBonus();
    return {
      label,
      rows: bonus > 0
        ? [{ source: "Vape achievements", value: pct1(bonus * 100), tone: "good" }]
        : [NO_JUICE_ROW],
      total: fmt2(1 + bonus),
    };
  };
}

export function mandateEntry(
  label: string,
  multiplierKey: "money" | "innovation",
  perLevelKey: "moneyMultPerLevel" | "innovationMultPerLevel",
): () => ModifierBreakdown {
  return () => {
    const { mandateLevels } = useValuationStore.getState();
    const total = useValuationStore.getState().getEconomyMultipliers()[multiplierKey];
    const rows = MANDATES.filter(
      (m) => m[perLevelKey] > 0 && mandateLevels[m.id] > 0,
    ).map((m) => ({
      source: `${m.name} (Lv ${mandateLevels[m.id]})`,
      value: pct1(m[perLevelKey] * mandateLevels[m.id] * 100),
      tone: "good" as const,
    }));
    return { label, rows: orNone(rows), total: fmt2(total) };
  };
}

export function satisfactionRevenueEntry(
  label: string,
  genKey: "intern" | "vibe_coder" | "10x_dev",
  description: string,
): () => ModifierBreakdown {
  return () => {
    const emUnlocked =
      useInnovationStore.getState().unlocks.employeeManagement?.unlocked ?? false;
    const score = useGeneratorStore.getState().satisfactionScores[genKey];
    const effScore = useGeneratorStore.getState().getEffectiveSatisfaction(genKey);
    const prestige = usePrestigeStore.getState().modifiers;
    const mult = emUnlocked ? satisfactionRevenueMultiplier(effScore) : 1;
    const tone: BreakdownRow["tone"] = mult >= 1 ? "good" : "bad";
    const rows = emUnlocked
      ? satRows(score, effScore, mult, tone, prestige)
      : [{ source: "Unlock Employee Management to activate", value: "—", tone: "neutral" as const }];
    return { label, description, rows, total: fmt2(mult) };
  };
}
