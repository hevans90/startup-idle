import { ClassNameValue, twMerge } from "tailwind-merge";
import {
  dev10xSatisfactionExponentDelta,
  internSatisfactionIpsMultiplier,
  internSatisfactionManagerAccrualMultiplier,
  internSatisfactionValuationMultiplier,
  SATISFACTION_MAX,
  SATISFACTION_REVENUE_MULT_AT_MAX,
  SATISFACTION_REVENUE_MULT_AT_MIN,
  satisfactionRevenueMultiplier,
  type SatisfactionScores,
  vibeSingularityAccrualRatePerSecond,
} from "../game/satisfaction";
import { useAiSingularityStore } from "../state/ai-singularity.store";
import { useGeneratorStore } from "../state/generators.store";
import { useInnovationStore } from "../state/innovation.store";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/Popover";

const ROW_LABELS = {
  intern: "Intern",
  vibe_coder: "Vibe",
  "10x_dev": "10x",
} as const;

type RowId = keyof typeof ROW_LABELS;

function SatisfactionBar({ label, score }: { label: string; score: number }) {
  const halfWidthPct = (Math.abs(score) / SATISFACTION_MAX) * 50;
  const negLeftPct = score < 0 ? 50 - halfWidthPct : 50;

  return (
    <div className="flex w-36 flex-col gap-0.5">
      <div className="flex justify-between text-[10px] text-primary-600 dark:text-primary-400">
        <span>{label}</span>
        <span className="tabular-nums">{Math.round(score)}</span>
      </div>
      <div className="relative h-2 w-full overflow-hidden bg-primary-300 dark:bg-primary-700">
        <div
          className="absolute bottom-0 top-0 z-[1] w-px bg-primary-600 dark:bg-primary-400"
          style={{ left: "50%" }}
          aria-hidden
        />
        {score !== 0 && (
          <div
            className={twMerge(
              "absolute bottom-0 top-0",
              score > 0
                ? "bg-emerald-600/90 dark:bg-emerald-500/90"
                : "bg-rose-600/90 dark:bg-rose-500/90",
            )}
            style={
              score > 0
                ? { left: "50%", width: `${halfWidthPct}%` }
                : { left: `${negLeftPct}%`, width: `${halfWidthPct}%` }
            }
          />
        )}
      </div>
    </div>
  );
}

function formatMult(n: number): string {
  return `×${n.toFixed(3)}`;
}

function SatisfactionCurrentEffects({
  scores,
  singularityPct,
}: {
  scores: SatisfactionScores;
  singularityPct: number;
}) {
  const ips = internSatisfactionIpsMultiplier(scores.intern);
  const val = internSatisfactionValuationMultiplier(scores.intern);
  const mgr = internSatisfactionManagerAccrualMultiplier(scores.intern);
  const revIntern = satisfactionRevenueMultiplier(scores.intern);
  const revVibe = satisfactionRevenueMultiplier(scores.vibe_coder);
  const rev10x = satisfactionRevenueMultiplier(scores["10x_dev"]);
  const expDelta = dev10xSatisfactionExponentDelta(scores["10x_dev"]);
  const singularityRate = vibeSingularityAccrualRatePerSecond(
    scores.vibe_coder,
  );

  return (
    <div className="mb-3 border-b border-primary-300 pb-3 text-left dark:border-primary-600">
      <div className="space-y-2 text-[11px] leading-snug text-primary-800 dark:text-primary-100">
        <div>
          <p className="mb-0.5 font-semibold text-primary-900 dark:text-primary-50">
            Intern
          </p>
          <p className="text-primary-700 dark:text-primary-300">
            $ {formatMult(revIntern)} · Global IPS {formatMult(ips)} · Valuation
            gain {formatMult(val)} · Manager tiers {formatMult(mgr)}
          </p>
        </div>
        <div>
          <p className="mb-0.5 font-semibold text-primary-900 dark:text-primary-50">
            Vibe
          </p>
          <p className="text-primary-700 dark:text-primary-300">
            $ {formatMult(revVibe)}
            {scores.vibe_coder >= 0 ? (
              <>
                {" "}
                · No singularity accrual (score ≥ 0). Meter stays at{" "}
                {singularityPct.toFixed(1)}%.
              </>
            ) : (
              <>
                {" "}
                · Singularity +{singularityRate.toFixed(4)} %/s · meter{" "}
                {singularityPct.toFixed(1)}%
              </>
            )}
          </p>
        </div>
        <div>
          <p className="mb-0.5 font-semibold text-primary-900 dark:text-primary-50">
            10x
          </p>
          <p className="text-primary-700 dark:text-primary-300">
            $ {formatMult(rev10x)} · Hire cost exponent{" "}
            {expDelta === 0
              ? "unchanged"
              : expDelta > 0
                ? `+${expDelta.toFixed(3)} (pricier)`
                : `${expDelta.toFixed(3)} (cheaper)`}
          </p>
        </div>
      </div>
    </div>
  );
}

function SatisfactionEffectsHelp() {
  return (
    <div className="max-w-xs space-y-3 text-left text-xs leading-snug text-primary-800 dark:text-primary-100">
      <p className="text-primary-600 dark:text-primary-300">
        Each bar is <span className="font-medium">−100 (miserable)</span> to{" "}
        <span className="font-medium">+100 (happy)</span>. Center is neutral.
      </p>
      <p className="text-primary-600 dark:text-primary-300">
        <span className="font-medium">Cash per role:</span> that row’s score
        scales <span className="font-medium">only that employee type’s</span>{" "}
        money output, linearly from{" "}
        <span className="font-medium">
          ×{SATISFACTION_REVENUE_MULT_AT_MIN} at −100
        </span>{" "}
        to{" "}
        <span className="font-medium">
          ×{SATISFACTION_REVENUE_MULT_AT_MAX} at +100
        </span>{" "}
        (score 0 is ×
        {(SATISFACTION_REVENUE_MULT_AT_MIN + SATISFACTION_REVENUE_MULT_AT_MAX) /
          2}
        ).
      </p>
      <div className="border border-primary-300 bg-primary-200/40 p-2 dark:border-primary-600 dark:bg-primary-900/50">
        <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-primary-600 dark:text-primary-400">
          How to raise satisfaction
        </p>
        <ul className="list-disc space-y-1 pl-3.5 text-[11px] text-primary-800 dark:text-primary-200">
          <li>
            Scores <span className="font-medium">drift toward a target</span>{" "}
            every tick — changing perks or headcount shifts that target; the bar
            catches up over time.
          </li>
          <li>
            In <span className="font-medium">Employee Management</span>, buy{" "}
            <span className="font-medium">+Innovation</span> on that row — it
            pulls the target up.
          </li>
          <li>
            Go lighter on <span className="font-medium">+Money</span>,{" "}
            <span className="font-medium">−Cost</span>, and{" "}
            <span className="font-medium">AutoBuy</span> (each level drags the
            target down). Use <span className="font-medium">Refund</span> on
            that role in Employee Management to return points and reset its
            perks.
          </li>
          <li>
            <span className="font-medium">Fewer employees</span> of that type
            raises the target (big stacks strain morale). 10x devs are extra
            sensitive to count.
          </li>
        </ul>
      </div>
      <div>
        <p className="mb-1 font-semibold text-primary-900 dark:text-primary-50">
          Intern
        </p>
        <ul className="list-disc space-y-0.5 pl-4 text-primary-700 dark:text-primary-300">
          <li>
            <span className="font-medium text-emerald-700 dark:text-emerald-400">
              High:
            </span>{" "}
            more cash from interns (up to ×{SATISFACTION_REVENUE_MULT_AT_MAX});
            bonus global innovation (IPS) from all generators; managers tier up
            a bit faster.
          </li>
          <li>
            <span className="font-medium text-rose-700 dark:text-rose-400">
              Low:
            </span>{" "}
            less cash from interns (down to ×{SATISFACTION_REVENUE_MULT_AT_MIN}
            ); much less passive valuation; manager tier progress slows sharply.
          </li>
        </ul>
      </div>
      <div>
        <p className="mb-1 font-semibold text-primary-900 dark:text-primary-50">
          Vibe coder
        </p>
        <ul className="list-disc space-y-0.5 pl-4 text-primary-700 dark:text-primary-300">
          <li>
            <span className="font-medium text-emerald-700 dark:text-emerald-400">
              High:
            </span>{" "}
            more cash from vibe coders (up to ×
            {SATISFACTION_REVENUE_MULT_AT_MAX}). Otherwise: nothing. Fuck you.
            Be sad.
          </li>
          <li>
            <span className="font-medium text-rose-700 dark:text-rose-400">
              Low:
            </span>{" "}
            less cash from vibe coders; Skynet approaches.
          </li>
        </ul>
      </div>
      <div>
        <p className="mb-1 font-semibold text-primary-900 dark:text-primary-50">
          10x dev
        </p>
        <ul className="list-disc space-y-0.5 pl-4 text-primary-700 dark:text-primary-300">
          <li>
            <span className="font-medium text-emerald-700 dark:text-emerald-400">
              High:
            </span>{" "}
            more cash from 10x devs (up to ×{SATISFACTION_REVENUE_MULT_AT_MAX});
            cheaper 10x hires (lower effective cost curve).
          </li>
          <li>
            <span className="font-medium text-rose-700 dark:text-rose-400">
              Low:
            </span>{" "}
            less cash from 10x devs; pricier 10x hires (steeper exponent).
          </li>
        </ul>
      </div>
    </div>
  );
}

export const EmployeeSatisfactionOverlay = ({
  className,
}: {
  className?: ClassNameValue;
}) => {
  const employeeMgmtUnlocked = useInnovationStore(
    (s) => s.unlocks.employeeManagement?.unlocked ?? false,
  );
  const scores = useGeneratorStore((s) => s.satisfactionScores);
  const singularityPct = useAiSingularityStore((s) => s.value);

  if (!employeeMgmtUnlocked) return null;

  return (
    <Popover
      openOnHover={true}
      persistOnHoverContent={true}
      placement="left-start"
      floatOffset={8}
    >
      <PopoverTrigger asChild>
        <div
          className={twMerge(
            "cursor-help border border-primary-400/60 bg-primary-100/90 p-2 outline-none dark:border-primary-600/60 dark:bg-primary-900/90",
            className,
          )}
        >
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-primary-500 dark:text-primary-400">
            Satisfaction
          </p>
          <div className="flex flex-col gap-2">
            {(Object.keys(ROW_LABELS) as RowId[]).map((id) => (
              <SatisfactionBar
                key={id}
                label={ROW_LABELS[id]}
                score={scores[id]}
              />
            ))}
          </div>
        </div>
      </PopoverTrigger>

      <PopoverContent className="z-50 max-h-[min(92vh,52rem)] max-w-sm border border-primary-500 bg-primary-100 p-3 text-primary-900 shadow-lg outline-none focus:ring-0 dark:border-primary-500 dark:bg-primary-800 dark:text-primary-100">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-primary-500 dark:text-primary-400">
          Satisfaction effects
        </p>
        <SatisfactionCurrentEffects
          scores={scores}
          singularityPct={singularityPct}
        />
        <SatisfactionEffectsHelp />
      </PopoverContent>
    </Popover>
  );
};
