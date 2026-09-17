import type { ModifierBreakdown } from "./types";
import { managerEntry } from "./factories";

export const entries: Record<string, () => ModifierBreakdown> = {
  managerMoney: managerEntry("corpo", "Corpo manager — $"),
  managerInnovation: managerEntry("agile", "Agile manager — innovation"),
  managerSalesValuation: managerEntry("sales", "Sales manager — valuation"),
};
