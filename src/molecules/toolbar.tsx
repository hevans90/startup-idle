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

/** A counter's cell: as wide as it likes up to a point, and giving way when the bar is short. */
const COUNTER = "min-w-0 shrink basis-[9.5rem] px-1 @lg:px-2";
/** The rate beneath it, gone when the bar is very short. */
const RATE = "@max-md:hidden";

export const Toolbar = ({ className }: { className?: ClassNameValue }) => {
  const money = useMoneyStore((state) => state.money);
  const mps = useGeneratorStore((state) => state.getMoneyPerSecond());
  // Valuation accrues (and its counter appears) once Managers are unlocked.
  const valuationUnlocked = useInnovationStore(
    (state) => state.unlocks.managers?.unlocked ?? false,
  );

  // SIZED TO ITSELF, not the window: it is two thirds of one beside the
  // sidebar, so it asks its own width what fits. The counters give way first,
  // then their rates, the company's clock, and the founder's name — never
  // spilling over the sidebar.
  return (
    <div
      className={twMerge(
        "@container w-full h-13 min-w-0 overflow-hidden bg-primary-200 dark:bg-primary-900 flex items-center gap-1 @lg:gap-3 @3xl:gap-5",
        className,
      )}
    >
      <SettingsPopover className="border-none w-10 @lg:w-14 h-full shrink-0" />

      <ResourceCounter
        value={formatCurrency(money)}
        rate={`${formatCurrency(mps)}/s`}
        popover={<MoneySummary />}
        className={COUNTER}
        rateClassName={RATE}
      />

      <ToolbarInnovationCounter className={COUNTER} rateClassName={RATE} />

      {valuationUnlocked && (
        <ToolbarValuationCounter className={COUNTER} rateClassName={RATE} />
      )}

      <CompanyTimer className="ml-auto shrink-0 hidden @3xl:flex" />
      <FounderBadge className="ml-auto mr-1 shrink-0 @lg:mr-2 @3xl:ml-3" />
    </div>
  );
};
