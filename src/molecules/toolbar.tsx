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
import { Frame, OverseerBackdrop } from "../ui/console";

/** A counter's cell: as wide as it likes up to a point, and giving way when the bar is short. */
const COUNTER = "shrink-0 px-1 @lg:px-2";
/** The rate beneath it, gone when the bar is very short. */
const RATE = "@max-md:hidden";

export const Toolbar = ({ className }: { className?: ClassNameValue }) => {
  const money = useMoneyStore((state) => state.money);
  const mps = useGeneratorStore((state) => state.getMoneyPerSecond());
  // Valuation accrues (and its counter appears) once Managers are unlocked.
  const valuationUnlocked = useInnovationStore(
    (state) => state.unlocks.managers?.unlocked ?? false,
  );

  // THE HUD (plans/ui-overhaul.md §3.1): settings and the company on the left,
  // the resources in the middle, the AI on the right, an underline frame under
  // it all. SIZED TO ITSELF, not the window: it is two thirds of one beside
  // the sidebar, so it asks its own width what fits. The counters give way
  // first, then their rates, the company's clock, and the founder's name —
  // never spilling over the sidebar.
  return (
    <div className={twMerge("@container relative h-13 w-full min-w-0 bg-surface-1 text-fg", className)}>
      <OverseerBackdrop />
      <Frame kind="underline" assemble="auto" className="pointer-events-none absolute inset-x-0 bottom-0 h-3" />
      <div className="relative flex h-full min-w-0 items-center gap-1 overflow-hidden @lg:gap-3 @3xl:gap-5">
        <SettingsPopover className="h-full w-10 shrink-0 border-none @lg:w-14" />
        <FounderBadge className="shrink-0" />
        <CompanyTimer className="hidden shrink-0 @3xl:flex" />

        <div className="mx-auto flex min-w-0 items-center gap-1 @lg:gap-3">
          <ResourceCounter
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

        <AiSingularityReadout className="mr-2 hidden @2xl:block" />
      </div>
    </div>
  );
};
