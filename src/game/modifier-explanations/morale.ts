import { useGeneratorStore } from "../../state/generators.store";
import { usePrestigeStore } from "../../state/prestige.store";
import { INTERN_INNOVATION_SWING, internSatisfactionIpsMultiplier } from "../satisfaction";
import type { BreakdownRow, ModifierBreakdown } from "./types";
import { SAT_REV_BASE, satisfactionRevenueEntry } from "./factories";
import { fmt2, satRows } from "./utils";

/** Interns' morale on something other than their own output. */
function internSatEntry(
  label: string,
  getMult: (effScore: number) => number,
  tone: (mult: number) => BreakdownRow["tone"],
  description?: string,
): () => ModifierBreakdown {
  return () => {
    const score = useGeneratorStore.getState().satisfactionScores.intern;
    const effScore = useGeneratorStore.getState().getEffectiveSatisfaction("intern");
    const prestige = usePrestigeStore.getState().modifiers;
    const mult = getMult(effScore);
    return { label, description, rows: satRows(score, effScore, mult, tone(mult), prestige), total: fmt2(mult) };
  };
}

export const entries: Record<string, () => ModifierBreakdown> = {
  internIpsMult: internSatEntry(
    "Intern morale — innovation",
    internSatisfactionIpsMultiplier,
    (mult) => (mult >= 1 ? "good" : "bad"),
    `Interns' morale moves the company's innovation: ×${1 - INTERN_INNOVATION_SWING} at its lowest, ×${1 + INTERN_INNOVATION_SWING} at its highest.`,
  ),

  "satisfactionRevenue.intern": satisfactionRevenueEntry(
    "Intern morale — $",
    "intern",
    `Scales intern money output.\n${SAT_REV_BASE}`,
  ),

  "satisfactionRevenue.vibe_coder": satisfactionRevenueEntry(
    "Vibe coder morale — $",
    "vibe_coder",
    `Scales vibe coder money output.\n${SAT_REV_BASE}\nHappy vibe coders also fill the slop pit slower: half as fast at the highest, twice as fast at the lowest.`,
  ),

  "satisfactionRevenue.10x_dev": satisfactionRevenueEntry(
    "10x dev morale — $",
    "10x_dev",
    `Scales 10x dev money output.\n${SAT_REV_BASE}\nHigh morale also lowers their hire cost curve.`,
  ),
};
