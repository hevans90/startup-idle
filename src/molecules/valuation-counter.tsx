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
}: {
  className?: ClassNameValue;
}) => {
  const valuation = useValuationStore((s) => s.valuation);
  const vps = useGeneratorStore((s) => s.getValuationPerSecond());
  const { setSidebarTab } = useGlobalSettingsStore();

  return (
    <ResourceCounter
      value={
        <>
          <span className="opacity-60">V</span>{" "}
          {formatCurrency(valuation, { showDollarSign: false })}
        </>
      }
      rate={formatRate(vps).formatted}
      onClick={() => setSidebarTab("valuation")}
      popover={<ValuationSummary />}
      className={className}
    />
  );
};
