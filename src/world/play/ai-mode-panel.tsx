/**
 * World v2 — AI MODE's controls, on The Model's runs: the switch, the budget
 * — the most of the money it may spend on a step — whether to show its plan
 * for the block it is building, and how it is getting on: its steps, its
 * last; its STYLE, wide to tall, and the traits pulling it each way; and WHY
 * it took the block it is on, of those it looked at.
 * @see stepAutopilot, styleOf, chooseBlock
 */
import { twMerge } from "tailwind-merge";
import { Slider, Toggle } from "../../ui/console";

import { useTicking } from "../../hooks/use-ticking";
import { useFounderStore } from "../../state/founder.store";
import { useSessionStore } from "../../state/session.store";
import { currentChoice, currentPlan, lastStep, modelStyle, stepsTaken } from "../ai/autopilot";
import { TALL_PULL } from "../ai/masterplan/style";
import { trait } from "../../game/traits";
import { formatCurrency } from "../../utils/money-utils";

const PANEL = "border border-line-quiet bg-surface-1/95 shadow-lg backdrop-blur-sm";

export function AiModePanel({ className }: { className?: string }) {
  useTicking(1000);
  const model = useFounderStore((s) => s.selectedFounderId) === "model";
  const on = useSessionStore((s) => s.aiMode);
  const budget = useSessionStore((s) => s.aiBudget);
  const showPlan = useSessionStore((s) => s.showPlan);
  const set = useSessionStore((s) => s.setAiMode);
  // Its switch is a view in the build bar; here, its settings, while it is on. @see BuildBar
  if (!model || !on) return null;
  const plan = on ? currentPlan() : null;
  const last = lastStep();
  const style = modelStyle();
  const tall = style.tall >= 0.5;
  const pulls = (sign: 1 | -1) => style.from.filter((t) => Math.sign(TALL_PULL[t]) === sign).map((t) => trait(t).name);
  const pullsWide = pulls(-1), pullsTall = pulls(1);
  const choice = on ? currentChoice() : null;
  return (
    <div className={twMerge(PANEL, "flex max-w-[calc(100vw-1rem)] flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1 text-xs text-fg", className)}>
      <span className="flex items-center gap-2 font-display text-xs uppercase tracking-widest text-ai">
        <span aria-hidden className="h-3 w-0.5 bg-ai" />AI mode
      </span>
      {on && (
        <>
          <span className="flex items-center gap-2 tabular-nums" title="The most of the money it may spend on one step">
            <span className="text-fg-muted">Budget</span>
            <Slider label="AI mode's budget a step" min={0.1} max={1} step={0.05} value={budget} onChange={(v) => set({ aiBudget: v })} />
            <b>{Math.round(budget * 100)}%</b>
          </span>
          <span className="flex items-center gap-2">
            <Toggle label="Show plans" on={showPlan} onChange={(on) => set({ showPlan: on })} />
            Show plans
          </span>
          <span className="tabular-nums text-fg-muted">
            {plan
              ? <>{plan.steps.length ? "Building a block" : "Looking for room"} · {stepsTaken()} steps{last && <> · last: {last}</>}</>
              : "Planning the next block…"}
          </span>
          <span className="flex items-center gap-1 text-ai" title="How it lays out a town, from the traits past generations ended with">
            <b>{tall ? "Tall: towers round parks" : "Wide: streets of starter lots"}</b>
            <span aria-label={`${Math.round(style.tall * 100)}% tall`} className="relative inline-block h-1.5 w-10 rounded-full bg-ai-soft">
              <span className="absolute inset-y-0 left-0 rounded-full bg-ai" style={{ width: `${Math.round(style.tall * 100)}%` }} />
            </span>
            {(pullsWide.length > 0 || pullsTall.length > 0) && (
              <span className="text-fg-muted">
                {[pullsWide.length && `${pullsWide.join(", ")} pull${pullsWide.length === 1 ? "s" : ""} wide`, pullsTall.length && `${pullsTall.join(", ")} pull${pullsTall.length === 1 ? "s" : ""} tall`].filter(Boolean).join("; ")}
              </span>
            )}
          </span>
          {plan && choice && plan.steps.length > 0 && (
            <span className="tabular-nums text-fg-muted" title="Of the blocks it looked at, the one that adds the most for what it costs">
              Chosen of {choice.of}: {plan.now > 0 ? `+${Math.round((choice.gain / plan.now) * 100)}% settled income` : `${choice.beds} beds`} for {formatCurrency(choice.cost, { decimals: 1 })}{choice.towers > 0 && ` (${choice.towers} to grow to III)`}
            </span>
          )}
        </>
      )}
    </div>
  );
}
