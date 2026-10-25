import { ClassNameValue } from "tailwind-merge";
import { useGeneratorStore } from "../state/generators.store";
import { useGlobalSettingsStore } from "../state/global-settings.store";
import { useValuationStore } from "../state/valuation.store";
import { ResourceCounter } from "../ui/ResourceCounter";
import { formatCurrency } from "../utils/money-utils";
import { formatRate } from "../utils/rate-utils";
import { ValuationSummary } from "./valuation-summary";

export const ToolbarValuationCounter = ({
  className,
  rateClassName,
}: {
  className?: ClassNameValue;
  rateClassName?: ClassNameValue;
}) => {
  const valuation = useValuationStore((s) => s.valuation);
  const vps = useGeneratorStore((s) => s.getValuationPerSecond());
  const { setSidebarTab } = useGlobalSettingsStore();

  return (
    <ResourceCounter
      label="Valuation"
      value={formatCurrency(valuation, { showDollarSign: false, steady: true })}
      rate={formatRate(vps).formatted}
      role="valuation"
      onClick={() => setSidebarTab("valuation")}
      popover={<ValuationSummary />}
      className={className}
      rateClassName={rateClassName}
    />
  );
};
