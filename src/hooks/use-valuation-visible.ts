import { useInnovationStore } from "../state/innovation.store";
import { usePrestigeStore } from "../state/prestige.store";

/**
 * WHETHER VALUATION IS SHOWN — its tab in the sidebar and its counter in the
 * top bar, together: with the HQ on a first run (Employee Management, or the
 * Managers it also opens); from the start once any Equity has ever been earned.
 */
export function useValuationVisible() {
  const employeeMgmt = useInnovationStore((s) => s.unlocks.employeeManagement?.unlocked ?? false);
  const managers = useInnovationStore((s) => s.unlocks.managers?.unlocked ?? false);
  const everEarnedEquity = usePrestigeStore((s) => s.everEarnedEquity);
  return employeeMgmt || managers || everEarnedEquity;
}
