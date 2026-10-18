/**
 * World v2 — AI MODE's controls, on The Model's runs: the switch, the budget
 * — the most of the money it may spend on a step — whether to show the
 * masterplan, and how it is getting on: the town it is building toward
 * against the town now, its steps, and its last. @see stepAutopilot
 */
import { twMerge } from "tailwind-merge";

import { useTicking } from "../../hooks/use-ticking";
import { useFounderStore } from "../../state/founder.store";
import { useSessionStore } from "../../state/session.store";
import { currentPlan, lastStep, stepsTaken } from "../ai/autopilot";

const PANEL = "border border-primary-300 bg-primary-50/95 shadow-md dark:border-primary-700 dark:bg-primary-900/95";

export function AiModePanel({ className }: { className?: string }) {
  useTicking(1000);
  const model = useFounderStore((s) => s.selectedFounderId) === "model";
  const on = useSessionStore((s) => s.aiMode);
  const budget = useSessionStore((s) => s.aiBudget);
  const showPlan = useSessionStore((s) => s.showPlan);
  const set = useSessionStore((s) => s.setAiMode);
  if (!model) return null;
  const plan = on ? currentPlan() : null;
  const gain = plan && plan.now > 0 ? Math.round((plan.predicted / plan.now - 1) * 100) : null;
  const last = lastStep();
  return (
    <div className={twMerge(PANEL, "flex max-w-[calc(100vw-1rem)] flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1 text-xs text-primary-900 dark:text-primary-100", className)}>
      <label className="flex cursor-pointer items-center gap-1 font-bold text-violet-700 dark:text-violet-300">
        <input type="checkbox" checked={on} onChange={(e) => set({ aiMode: e.target.checked })} className="accent-violet-600 dark:accent-violet-400" />
        AI mode
      </label>
      {on && (
        <>
          <label className="flex items-center gap-1 tabular-nums" title="The most of the money it may spend on one step">
            Budget
            <input type="range" min={0.1} max={1} step={0.05} value={budget}
              onChange={(e) => set({ aiBudget: Number(e.target.value) })} className="w-20 accent-violet-600 dark:accent-violet-400" />
            <b>{Math.round(budget * 100)}%</b>
          </label>
          <label className="flex cursor-pointer items-center gap-1">
            <input type="checkbox" checked={showPlan} onChange={(e) => set({ showPlan: e.target.checked })} className="accent-violet-600 dark:accent-violet-400" />
            Masterplan
          </label>
          <span className="tabular-nums text-primary-600 dark:text-primary-400">
            {plan
              ? <>Plan {gain !== null ? `${gain >= 0 ? "+" : "−"}${Math.abs(gain)}% on now` : "ready"} · {stepsTaken()} steps{last && <> · last: {last}</>}</>
              : "Planning…"}
          </span>
        </>
      )}
    </div>
  );
}
