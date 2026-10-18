import { ClassNameValue, twMerge } from "tailwind-merge";

import { useTicking } from "../hooks/use-ticking";
import { runningAgents, useAgentsStore } from "../state/agents.store";
import { singularityMult, singularityRate, stageOf, useAiSingularityStore } from "../state/ai-singularity.store";

/**
 * THE SINGULARITY, top left: its stage and how far through, and which way it
 * is going. Shown once there is anything to show — an agent spun up, or the
 * meter carried over from the last company. @see useAiSingularityStore
 */
export const AiSingularityReadout = ({ className }: { className?: ClassNameValue }) => {
  useTicking(1000);
  const value = useAiSingularityStore((s) => s.value);
  const agents = useAgentsStore((s) => s.agents);
  const pct = Math.min(100, Math.max(0, value));
  if (pct <= 0 && agents <= 0) return null;
  const rate = singularityRate(runningAgents(), singularityMult(), agents);
  const stage = stageOf(pct);

  return (
    <div
      className={twMerge(
        "pointer-events-none w-40 border border-violet-600/50 bg-primary-900/85 px-2 py-1 dark:border-violet-400/40 dark:bg-primary-950/90",
        className
      )}
    >
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <p className="text-[9px] font-bold uppercase tracking-wider text-violet-400 dark:text-violet-300">
          AI · {stage.name}
        </p>
        <p className="responsive-text-xs tabular-nums text-primary-200">
          {pct.toFixed(1)}% <span className={rate > 0 ? "text-violet-300" : "text-primary-400"}>{rate > 0 ? "▲" : pct > 0 ? "▼" : ""}</span>
        </p>
      </div>
      <div className="h-1.5 w-full overflow-hidden bg-primary-700 dark:bg-primary-800">
        <div
          className="h-full bg-violet-500/90 transition-[width] duration-300 dark:bg-violet-400/90"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};
