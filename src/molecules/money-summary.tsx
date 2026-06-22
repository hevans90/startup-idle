import { useGeneratorStore } from "../state/generators.store";
import { formatCurrency } from "../utils/money-utils";
import { ResourceBreakdownView } from "./resource-breakdown";

const money = (n: number) =>
  `${formatCurrency(n, { exponentBreakpoint: 1e9 })}/s`;

/** Full $/sec breakdown for the toolbar money popover. */
export const MoneySummary = () => {
  // Subscribe to a PRIMITIVE so the popover refreshes when earnings change, then
  // read the (fresh-object) breakdown imperatively — selecting the object
  // directly returns a new reference each render and trips React's
  // "getSnapshot should be cached" infinite loop.
  useGeneratorStore((s) => s.getMoneyPerSecond());
  const breakdown = useGeneratorStore.getState().getMoneyBreakdown();
  return (
    <ResourceBreakdownView header="Money" breakdown={breakdown} format={money} />
  );
};
