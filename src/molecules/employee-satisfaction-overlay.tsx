import type { ReactNode } from "react";
import { ClassNameValue, twMerge } from "tailwind-merge";
import {
  dev10xSatisfactionExponentDelta,
  internSatisfactionIpsMultiplier,
  internSatisfactionManagerAccrualMultiplier,
  internSatisfactionValuationMultiplier,
  SATISFACTION_MAX,
  SATISFACTION_MIN,
  SATISFACTION_REVENUE_MULT_AT_MAX,
  SATISFACTION_REVENUE_MULT_AT_MIN,
  SATISFACTION_REVENUE_MULT_NEUTRAL,
  satisfactionRevenueMultiplier,
  type SatisfactionScores,
} from "../game/satisfaction";
import { useAiSingularityStore } from "../state/ai-singularity.store";
import { useGeneratorStore } from "../state/generators.store";
import { useInnovationStore } from "../state/innovation.store";
import { usePrestigeStore } from "../state/prestige.store";
import { FOCUS } from "../ui/console";
import { ModifierTag } from "../ui/ModifierTag";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/Popover";
import { TenXDevText } from "../utils/ten-x-utils";
import { RainbowText } from "../utils/vibe-utils";

const ROW_LABEL_STRINGS = {
  intern: "Intern",
  vibe_coder: "Vibe coder",
  "10x_dev": "10x dev",
} as const;

type RowId = keyof typeof ROW_LABEL_STRINGS;

function RowLabel({ id }: { id: RowId }) {
  if (id === "vibe_coder") return <RainbowText text={ROW_LABEL_STRINGS[id]} />;
  if (id === "10x_dev") return <TenXDevText text={ROW_LABEL_STRINGS[id]} />;
  return <>{ROW_LABEL_STRINGS[id]}</>;
}

function SatisfactionBar({ label, score }: { label: ReactNode; score: number }) {
  const halfWidthPct = (Math.abs(score) / SATISFACTION_MAX) * 50;
  const negLeftPct = score < 0 ? 50 - halfWidthPct : 50;

  return (
    <div className="flex w-36 flex-col gap-0.5">
      <div className="flex justify-between text-[10px] text-fg-muted">
        <span>{label}</span>
        <span className="tabular-nums">{Math.round(score)}</span>
      </div>
      <div className="relative h-2 w-full overflow-hidden bg-surface-3">
        <div
          className="absolute bottom-0 top-0 z-[1] w-px bg-surface-2"
          style={{ left: "50%" }}
          aria-hidden
        />
        {score !== 0 && (
          <div
            className={twMerge(
              "absolute bottom-0 top-0",
              score > 0
                ? "bg-good/90"
                : "bg-bad/90",
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

function SatisfactionHowToRaiseHelpContent() {
  return (
    <div className="max-w-sm space-y-2 text-left text-xs leading-snug text-fg">
      <p className="text-[10px] uppercase tracking-widest text-fg-muted">
        How to raise satisfaction
      </p>
      <ul className="list-disc space-y-1 pl-3.5 text-[11px] text-fg">
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
          target down). Use <span className="font-medium">Refund</span> on that
          role in Employee Management to return points and reset its perks.
        </li>
        <li>
          <span className="font-medium">Fewer employees</span> of that type
          raises the target (big stacks lower satisfaction). 10x devs are extra
          sensitive to count.
        </li>
      </ul>
    </div>
  );
}

function SatisfactionHowToRaiseHelpPopover() {
  return (
    <Popover
      openOnHover={true}
      persistOnHoverContent={true}
      placement="bottom-end"
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="h-6 shrink-0 inline-flex items-center cursor-help px-1.5 py-0 bg-surface-2 leading-none font-bold border border-line-strong text-[11px] text-fg outline-none hover:bg-surface-3"
          aria-label="How to raise satisfaction"
        >
          ?
        </button>
      </PopoverTrigger>
      <PopoverContent className="z-[60] max-w-sm border border-line-strong bg-surface-1 p-2 py-1.5 text-fg shadow-lg outline-none focus:ring-0">
        <SatisfactionHowToRaiseHelpContent />
      </PopoverContent>
    </Popover>
  );
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

  return (
    <div className="mb-3 border-b border-line pb-3 text-left">
      <div className="space-y-2 text-[11px] leading-snug text-fg">
        <div>
          <p className="mb-0.5 font-semibold text-fg">
            Intern
          </p>
          <p className="text-fg-muted">
            <ModifierTag modKey="satisfactionRevenue.intern">$</ModifierTag>{" "}
            {formatMult(revIntern)}
            {" · "}
            <ModifierTag modKey="internIpsMult">
              Global innovation rate
            </ModifierTag>{" "}
            {formatMult(ips)}
            {" · "}
            <ModifierTag modKey="internValuationMult">
              Valuation gain
            </ModifierTag>{" "}
            {formatMult(val)}
            {" · "}Manager tiers {formatMult(mgr)}
          </p>
        </div>
        <div>
          <p className="mb-0.5 font-semibold text-fg">
            <RainbowText text="Vibe coder" />
          </p>
          <p className="text-fg-muted">
            <ModifierTag modKey="satisfactionRevenue.vibe_coder">$</ModifierTag>{" "}
            {formatMult(revVibe)}
            {" "}· AI singularity {singularityPct.toFixed(1)}% (pushed by the AI agents running, not by mood)
          </p>
        </div>
        <div>
          <p className="mb-0.5 font-semibold text-fg">
            <TenXDevText text="10x dev" />
          </p>
          <p className="text-fg-muted">
            <ModifierTag modKey="satisfactionRevenue.10x_dev">$</ModifierTag>{" "}
            {formatMult(rev10x)} · Hire cost exponent{" "}
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
    <div className="max-w-xs space-y-3 text-left text-xs leading-snug text-fg">
      <p className="text-fg-muted">
        Bars run <span className="font-medium">{SATISFACTION_MIN}</span> to{" "}
        <span className="font-medium">+{SATISFACTION_MAX}</span>.{" "}
        <span className="font-medium">money per role:</span> that type’s money
        output uses score{" "}
        <span className="font-medium">{SATISFACTION_MIN}</span> → ×
        {SATISFACTION_REVENUE_MULT_AT_MIN},{" "}
        <span className="font-medium">0</span> → ×
        {SATISFACTION_REVENUE_MULT_NEUTRAL},{" "}
        <span className="font-medium">+{SATISFACTION_MAX}</span> → ×
        {SATISFACTION_REVENUE_MULT_AT_MAX} (linear each side of 0; unhappy is
        always under 1×).
      </p>

      <div>
        <p className="mb-1 font-semibold text-fg">
          Intern
        </p>
        <ul className="list-disc space-y-0.5 pl-4 text-fg-muted">
          <li>
            <span className="font-medium text-good">
              High:
            </span>{" "}
            more money from interns (up to ×{SATISFACTION_REVENUE_MULT_AT_MAX});
            bonus global innovation rate for all employees; managers tier up
            faster.
          </li>
          <li>
            <span className="font-medium text-bad">
              Low:
            </span>{" "}
            less money from interns (down to ×{SATISFACTION_REVENUE_MULT_AT_MIN}
            ); much less passive valuation; manager tier progress slows sharply.
          </li>
        </ul>
      </div>
      <div>
        <p className="mb-1 font-semibold text-fg">
          <RainbowText text="Vibe coder" />
        </p>
        <ul className="list-disc space-y-0.5 pl-4 text-fg-muted">
          <li>
            <span className="font-medium text-good">
              High:
            </span>{" "}
            more money from vibe coders (up to ×
            {SATISFACTION_REVENUE_MULT_AT_MAX}).
          </li>
          <li>
            <span className="font-medium text-bad">
              Low:
            </span>{" "}
            less money from vibe coders; Skynet approaches.
          </li>
        </ul>
      </div>
      <div>
        <p className="mb-1 font-semibold text-fg">
          <TenXDevText text="10x dev" />
        </p>
        <ul className="list-disc space-y-0.5 pl-4 text-fg-muted">
          <li>
            <span className="font-medium text-good">
              High:
            </span>{" "}
            more money from 10x devs (up to ×{SATISFACTION_REVENUE_MULT_AT_MAX}
            ); cheaper 10x hires (lower effective cost curve).
          </li>
          <li>
            <span className="font-medium text-bad">
              Low:
            </span>{" "}
            less money from 10x devs; pricier 10x hires (steeper exponent).
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
  const neutralized = usePrestigeStore(
    (s) => s.modifiers.satisfactionNeutralized,
  );
  const positiveMult = usePrestigeStore(
    (s) => s.modifiers.satisfactionPositiveMult,
  );
  const damped = !neutralized && positiveMult !== 1;

  if (!employeeMgmtUnlocked) return null;

  return (
    <Popover
      openOnHover={true}
      persistOnHoverContent={true}
      placement="left-start"
      floatOffset={8}
    >
      <PopoverTrigger asChild>
        <section
          aria-label="Satisfaction"
          tabIndex={0}
          className={twMerge(
            "relative cursor-help border border-line-quiet bg-surface-1 outline-none",
            FOCUS,
            className,
          )}
        >
          <header className="flex min-h-8 items-center justify-between gap-2 border-b border-line-quiet bg-surface-2/40 px-3 py-1">
            <h3 className="flex items-center gap-2 font-display text-xs uppercase tracking-widest">
              <span aria-hidden className="h-3 w-0.5 bg-console" />Satisfaction
            </h3>
            <SatisfactionHowToRaiseHelpPopover />
          </header>
          <div className="p-3">
          {neutralized && (
            <p className="mb-1.5 text-[10px] leading-snug text-bad">
              Disabled by keystone — all satisfaction effects are off.
            </p>
          )}
          {damped && (
            <p className="mb-1.5 text-[10px] leading-snug text-bad">
              Enshittified — positive satisfaction bonuses cut to{" "}
              {Math.round(positiveMult * 100)}%.
            </p>
          )}
          <div
            className={
              neutralized
                ? "flex flex-col gap-2 opacity-40"
                : "flex flex-col gap-2"
            }
          >
            {(Object.keys(ROW_LABEL_STRINGS) as RowId[]).map((id) => (
              <SatisfactionBar
                key={id}
                label={<RowLabel id={id} />}
                score={scores[id]}
              />
            ))}
          </div>
          </div>
        </section>
      </PopoverTrigger>

      <PopoverContent className="z-50 max-h-[min(92vh,52rem)] max-w-sm border border-line-strong bg-surface-3 p-3 text-fg shadow-lg outline-none focus:ring-0">
        <p className="mb-2 text-[10px] uppercase tracking-widest text-fg-muted">
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
