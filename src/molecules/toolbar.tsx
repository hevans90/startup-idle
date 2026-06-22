import { ClassNameValue, twMerge } from "tailwind-merge";
import { useGeneratorStore } from "../state/generators.store";
import { useMoneyStore } from "../state/money.store";
import { ResourceCounter } from "../ui/ResourceCounter";
import { formatCurrency } from "../utils/money-utils";
import { ToolbarInnovationCounter } from "./innovation-counter";
import { MoneySummary } from "./money-summary";
import { SettingsPopover } from "./settings-popover";

export const Toolbar = ({ className }: { className?: ClassNameValue }) => {
  const money = useMoneyStore((state) => state.money);
  const mps = useGeneratorStore((state) => state.getMoneyPerSecond());

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
    </div>
  );
};
