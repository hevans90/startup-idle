import type { ModifierBreakdown } from "./types";
import { mandateEntry } from "./factories";
import { titled } from "./utils";

export const entries: Record<string, () => ModifierBreakdown> = {
  mandateMoney: mandateEntry(titled("Money", "board mandates"), "money", "moneyMultPerLevel"),
  mandateInnovation: mandateEntry(titled("Innovation", "board mandates"), "innovation", "innovationMultPerLevel"),
};
