import { ClassNameValue, twMerge } from "tailwind-merge";
import { useAiSingularityStore } from "../state/ai-singularity.store";
import { useGeneratorStore } from "../state/generators.store";
import { useInnovationStore } from "../state/innovation.store";

export const AiSingularityReadout = ({
  className,
}: {
  className?: ClassNameValue;
}) => {
  const employeeMgmtUnlocked = useInnovationStore(
    (s) => s.unlocks.employeeManagement?.unlocked ?? false
  );
  const vibeScore = useGeneratorStore((s) => s.satisfactionScores.vibe_coder);
  const value = useAiSingularityStore((s) => s.value);
  const pct = Math.min(100, Math.max(0, value));

  if (!employeeMgmtUnlocked || vibeScore >= 0) return null;

  return (
    <div
      className={twMerge(
        "pointer-events-none w-36 border border-amber-600/50 bg-primary-900/85 px-2 py-1 dark:border-amber-500/40 dark:bg-primary-950/90",
        className
      )}
    >
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <p className="text-[9px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
          AI singularity
        </p>
        <p className="responsive-text-xs tabular-nums text-primary-200">
          {pct.toFixed(1)}%
        </p>
      </div>
      <div className="h-1.5 w-full overflow-hidden bg-primary-700 dark:bg-primary-800">
        <div
          className="h-full bg-amber-500/90 transition-[width] duration-300 dark:bg-amber-400/90"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};
