import type { ModifierBreakdown } from "./types";
import { managerEntry } from "./factories";
import { titled } from "./utils";

export const entries: Record<string, () => ModifierBreakdown> = {
  managerMoney: managerEntry("corpo", titled("Money", "Corpo manager")),
  managerInnovation: managerEntry("agile", titled("Innovation", "Agile manager")),
  managerSalesValuation: managerEntry("sales", titled("Valuation", "Sales manager")),
};
