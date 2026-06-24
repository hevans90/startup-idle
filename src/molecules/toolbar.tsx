import { ClassNameValue, twMerge } from "tailwind-merge";
import { useGeneratorStore } from "../state/generators.store";
import { useInnovationStore } from "../state/innovation.store";
import { useMoneyStore } from "../state/money.store";
import { ResourceCounter } from "../ui/ResourceCounter";
import { formatCurrency } from "../utils/money-utils";
import { CompanyTimer } from "./company-timer";
import { FounderBadge } from "./founder-badge";
import { ToolbarInnovationCounter } from "./innovation-counter";
import { MoneySummary } from "./money-summary";
import { SettingsPopover } from "./settings-popover";
import { ToolbarValuationCounter } from "./valuation-counter";

export const Toolbar = ({ className }: { className?: ClassNameValue }) => {
  const money = useMoneyStore((state) => state.money);
  const mps = useGeneratorStore((state) => state.getMoneyPerSecond());
  // Valuation accrues (and its counter appears) once Managers are unlocked.
  const valuationUnlocked = useInnovationStore(
    (state) => state.unlocks.managers?.unlocked ?? false,
  );

  return (
    <div
      className={twMerge(
        "w-full h-13 bg-primary-200 dark:bg-primary-900 flex items-center gap-2 sm:gap-5",
        className,
      )}
    >
      <SettingsPopover className="border-none w-14 h-full shrink-0" />

      <ResourceCounter
        value={formatCurrency(money)}
        rate={`${formatCurrency(mps)}/sec`}
        popover={<MoneySummary />}
        className="min-w-[9.5rem] shrink-0"
      />

      <ToolbarInnovationCounter className="min-w-[9.5rem] shrink-0" />

      {valuationUnlocked && (
        <ToolbarValuationCounter className="min-w-[9.5rem] shrink-0" />
      )}

      <CompanyTimer className="ml-auto shrink-0 hidden md:flex" />
      <FounderBadge className="ml-auto mr-2 shrink-0 md:ml-3" />
    </div>
  );
};
