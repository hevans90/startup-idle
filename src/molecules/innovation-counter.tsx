import { ClassNameValue } from "tailwind-merge";
import { useGeneratorStore } from "../state/generators.store";
import { useGlobalSettingsStore } from "../state/global-settings.store";
import { useInnovationStore } from "../state/innovation.store";
import { ResourceCounter } from "../ui/ResourceCounter";
import { formatCurrency } from "../utils/money-utils";
import { formatRate } from "../utils/rate-utils";
import { InnovationSummary } from "./innovation/innovation-summary";

export const ToolbarInnovationCounter = ({
  className,
  rateClassName,
}: {
  className?: ClassNameValue;
  rateClassName?: ClassNameValue;
}) => {
  const { innovation } = useInnovationStore();

  const ips = useGeneratorStore((state) => state.getInnovationPerSecond());

  const { setSidebarTab } = useGlobalSettingsStore();

  return (
    <ResourceCounter
      label="Innovation"
      value={formatCurrency(innovation, { showDollarSign: false })}
      rate={formatRate(ips).formatted}
      role="innovation"
      onClick={() => setSidebarTab("innovation")}
      popover={<InnovationSummary />}
      className={className}
      rateClassName={rateClassName}
    />
  );
};
