import type { ModifierBreakdown } from "./types";
import { mandateEntry } from "./factories";

export const entries: Record<string, () => ModifierBreakdown> = {
  mandateMoney: mandateEntry("Board mandates — $", "money", "moneyMultPerLevel"),
  mandateInnovation: mandateEntry("Board mandates — innovation", "innovation", "innovationMultPerLevel"),
};
