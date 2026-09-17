import { ClassNameValue, twMerge } from "tailwind-merge";
import { getManagerEconomyMultipliers } from "../../game/modifiers";
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
  const { unlocks } = useInnovationStore();
  // SUBSCRIBED AND NOT READ, on purpose. The breakdown below is pulled
  // imperatively out of `getState()`, which does not subscribe to anything, so
  // without a hook watching a primitive that moves with it this panel would
  // render once and then show whatever was true at the time. Bound to a name
  // it looks like a value nobody uses; it is the subscription that is wanted.
  useGeneratorStore((state) => state.getInnovationPerSecond());
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
      {managersActive && (
        <div className="w-full text-left">
          <div className="mt-1 border-t border-primary-300/70 dark:border-primary-600/60 pt-2" />
          <p className="responsive-text-xs text-primary-500 dark:text-primary-400">
            Manager Bonuses
          </p>
          <InfoRow
            label="Innovation rate"
            value={`x${mgr.innovationIncome.toFixed(2)}`}
            size="small"
            modKey="managerInnovation"
          />
          <InfoRow
            label="Money Output"
            value={`x${mgr.employeeMoney.toFixed(2)}`}
            size="small"
            modKey="managerMoney"
          />
          <InfoRow
            label="Valuation"
            value={`x${mgr.salesValuation.toFixed(2)}`}
            size="small"
            modKey="managerSalesValuation"
          />
        </div>
      )}
    </div>
  );
};
