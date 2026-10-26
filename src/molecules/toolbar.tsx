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
import { AiSingularityReadout } from "./ai-singularity-readout";
import { OverseerBackdrop } from "../ui/console";

/** A counter's cell: as wide as it likes up to a point, and giving way when the bar is short. */
const COUNTER = "shrink-0";
/** The rate beneath it, gone when the bar is very short. */
const RATE = "@max-4xl:hidden";

export const Toolbar = ({ className }: { className?: ClassNameValue }) => {
  const money = useMoneyStore((state) => state.money);
  const mps = useGeneratorStore((state) => state.getMoneyPerSecond());
  // Valuation accrues (and its counter appears) once Managers are unlocked.
  const valuationUnlocked = useInnovationStore(
    (state) => state.unlocks.managers?.unlocked ?? false,
  );

  // THE HUD (plans/ui-overhaul.md §3.1): one strip, its parts between
  // hairlines — settings and the company on the left, the resources in the
  // middle, the AI on the right — and a hairline under it all. SIZED TO
  // ITSELF, not the window: it is two thirds of one beside the sidebar, so it
  // asks its own width what fits. The rates give way first, then the
  // company's clock and the founder's name — never spilling over the sidebar.
  return (
    <div className={twMerge("@container relative h-12 w-full min-w-0 border-b border-line-quiet bg-surface-1 text-fg", className)}>
      <OverseerBackdrop />
      <div className="relative flex h-full min-w-0 items-stretch overflow-hidden">
        <SettingsPopover className="h-full w-12 shrink-0 border-0 border-r border-line-quiet" />
        <FounderBadge className="shrink-0 border-r border-line-quiet px-3" />
        <CompanyTimer className="hidden shrink-0 justify-center border-r border-line-quiet px-3 @3xl:flex" />

        <div className="mx-auto flex min-w-0 items-stretch divide-x divide-line-quiet border-x border-line-quiet">
          <ResourceCounter
            label="Money"
            value={formatCurrency(money, { steady: true })}
            rate={`${formatCurrency(mps, { steady: true })}/s`}
            role="money"
            popover={<MoneySummary />}
            className={COUNTER}
            rateClassName={RATE}
          />
          <ToolbarInnovationCounter className={COUNTER} rateClassName={RATE} />
          {valuationUnlocked && (
            <ToolbarValuationCounter className={COUNTER} rateClassName={RATE} />
          )}
        </div>

        <AiSingularityReadout className="hidden w-48 shrink-0 border-l border-line-quiet px-3 @2xl:flex" />
      </div>
    </div>
  );
};
