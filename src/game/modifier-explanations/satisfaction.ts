import { useGeneratorStore } from "../../state/generators.store";
import { useInnovationStore } from "../../state/innovation.store";
import { usePrestigeStore } from "../../state/prestige.store";
import {
  internSatisfactionIpsMultiplier,
  internSatisfactionValuationMultiplier,
} from "../satisfaction";
import type { BreakdownRow, ModifierBreakdown } from "./types";
import { SAT_REV_BASE, satisfactionRevenueEntry } from "./factories";
import { fmt2, satRows } from "./utils";

const EM_LOCKED_ROW: BreakdownRow = {
  source: "Unlock Employee Management to activate",
  value: "—",
  tone: "neutral",
};

function internSatEntry(
  label: string,
  getMult: (effScore: number) => number,
  tone: BreakdownRow["tone"] | ((mult: number) => BreakdownRow["tone"]),
  description?: string,
): () => ModifierBreakdown {
  return () => {
    const emUnlocked =
      useInnovationStore.getState().unlocks.employeeManagement?.unlocked ?? false;
    const score = useGeneratorStore.getState().satisfactionScores.intern;
    const effScore = useGeneratorStore.getState().getEffectiveSatisfaction("intern");
    const prestige = usePrestigeStore.getState().modifiers;
    const mult = emUnlocked ? getMult(effScore) : 1;
    const resolvedTone: BreakdownRow["tone"] = typeof tone === "function" ? tone(mult) : tone;
    const rows = emUnlocked
      ? satRows(score, effScore, mult, resolvedTone, prestige)
      : [EM_LOCKED_ROW];
    return { label, description, rows, total: fmt2(mult) };
  };
}

export const entries: Record<string, () => ModifierBreakdown> = {
  internIpsMult: internSatEntry(
    "Intern satisfaction — innovation",
    internSatisfactionIpsMultiplier,
    "good",
    "Positive intern satisfaction grants a global innovation bonus. Negative scores don't penalise innovation — this modifier only goes up.",
  ),

  internValuationMult: internSatEntry(
    "Intern satisfaction — valuation",
    internSatisfactionValuationMultiplier,
    (mult) => mult >= 1 ? "good" : "bad",
  ),

  "satisfactionRevenue.intern": satisfactionRevenueEntry(
    "Intern satisfaction — $",
    "intern",
    `Scales intern money output.\n${SAT_REV_BASE}\nRaise it with Innovation perks in Employee Management.`,
  ),

  "satisfactionRevenue.vibe_coder": satisfactionRevenueEntry(
    "Vibe coder satisfaction — $",
    "vibe_coder",
    `Scales vibe coder money output.\n${SAT_REV_BASE}\nLow scores also trigger AI singularity accrual.`,
  ),

  "satisfactionRevenue.10x_dev": satisfactionRevenueEntry(
    "10x dev satisfaction — $",
    "10x_dev",
    `Scales 10x dev money output.\n${SAT_REV_BASE}\nHigh scores also reduce their effective hire cost exponent.`,
  ),
};
