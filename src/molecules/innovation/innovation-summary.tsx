import { ClassNameValue, twMerge } from "tailwind-merge";
import { getManagerEconomyMultipliers } from "../../game/economy-multipliers";
import { useGeneratorStore } from "../../state/generators.store";
import { useInnovationStore } from "../../state/innovation.store";
import { InfoRow } from "../../ui/InfoRow";
import { formatRate } from "../../utils/rate-utils";
import { ResourceBreakdownView } from "../resource-breakdown";

export const InnovationSummary = ({
  className,
  compact,
}: {
  compact?: boolean;
  className?: ClassNameValue;
}) => {
  const { innovation, getMultiplier, unlocks } = useInnovationStore();
  const globalMultiplier = getMultiplier().toFixed(4);
  // Subscribing to this primitive also refreshes the breakdown below.
  const ips = useGeneratorStore((state) => state.getInnovationPerSecond());
  const mgr = getManagerEconomyMultipliers();
  const managersActive = unlocks.managers?.unlocked;

  // Toolbar popover: full "where is innovation coming from" breakdown.
  if (!compact) {
    const breakdown = useGeneratorStore.getState().getInnovationBreakdown();
    return (
      <ResourceBreakdownView
        header="Innovation"
        breakdown={breakdown}
        format={(n) => formatRate(n).formatted}
      />
    );
  }

  // Compact variant (sidebar Innovation tab).
  return (
    <div
      className={twMerge(
        "flex flex-col gap-2 items-center justify-center text-center w-full",
        className,
      )}
    >
      <div className="w-64">
        <InfoRow label="Innovation" value={innovation.toFixed(2)} size="large" />
        <InfoRow label="Rate" value={formatRate(ips).formatted} size="large" />
        <InfoRow
          label="Global multi"
          value={`x${globalMultiplier}`}
          size="large"
        />
        {managersActive && (
          <div className="w-full text-left">
            <div className="mt-1 border-t border-primary-300/70 dark:border-primary-600/60 pt-2" />
            <p className="responsive-text-xs text-primary-500 dark:text-primary-400">
              Managers
            </p>
            <InfoRow
              label="IPS"
              value={`x${mgr.innovationIncome.toFixed(2)}`}
              size="small"
            />
            <InfoRow
              label="$"
              value={`x${mgr.employeeMoney.toFixed(2)}`}
              size="small"
            />
            <InfoRow
              label="Valuation"
              value={`x${mgr.salesValuation.toFixed(2)}`}
              size="small"
            />
          </div>
        )}
      </div>
    </div>
  );
};
