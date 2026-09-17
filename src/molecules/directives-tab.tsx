import { useState } from "react";
import { DIRECTIVES } from "../game/directives.catalog";
import { useDirectivesStore } from "../state/directives.store";

function formatLargeNumber(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-amber-900/30 dark:bg-amber-900/50">
      <div
        className="h-full rounded-full bg-amber-500 dark:bg-amber-400 transition-all duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function DirectiveCard({ index }: { index: number }) {
  const state = useDirectivesStore();
  const def = DIRECTIVES[index];
  const progress = def.getProgress(state);
  const pct = Math.min(100, (progress / def.target) * 100);

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 dark:border-amber-400/20 dark:bg-amber-400/5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
          Directive {index + 1} of {DIRECTIVES.length}
        </span>
        <span className="text-[10px] font-mono text-amber-700 dark:text-amber-300 tabular-nums">
          {pct.toFixed(1)}%
        </span>
      </div>

      <h3 className="text-sm font-bold text-amber-700 dark:text-amber-300 mb-0.5">
        {def.name}
      </h3>
      <p className="text-[11px] text-primary-500 dark:text-primary-400 italic mb-3">
        {def.flavour}
      </p>

      <div className="mb-2 space-y-1">
        <div className="flex justify-between text-[11px]">
          <span className="text-primary-600 dark:text-primary-400">{def.objectiveLabel}</span>
          <span className="font-mono tabular-nums text-amber-700 dark:text-amber-300">
            {formatLargeNumber(progress)} / {formatLargeNumber(def.target)}
          </span>
        </div>
        <ProgressBar value={progress} max={def.target} />
      </div>

      <div className="mt-3 rounded border border-amber-500/20 bg-amber-500/10 px-3 py-2 dark:border-amber-400/10 dark:bg-amber-400/5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
          Reward
        </span>
        <p className="text-[11px] text-primary-700 dark:text-primary-300 mt-0.5">
          {def.rewardLabel}
        </p>
      </div>
    </div>
  );
}

function CompletedList() {
  const [open, setOpen] = useState(false);
  const completedIds = useDirectivesStore((s) => s.completedIds);
  if (completedIds.length === 0) return null;

  const completedDefs = DIRECTIVES.filter((d) => completedIds.includes(d.id));

  return (
    <div className="mt-4">
      <button
        className="flex w-full items-center justify-between text-[11px] font-bold uppercase tracking-wider text-primary-500 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-200 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <span>Completed ({completedIds.length})</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {completedDefs.map((def, i) => (
            <div
              key={def.id}
              className="rounded border border-primary-300 dark:border-primary-700 bg-primary-100 dark:bg-primary-800/40 px-3 py-2 opacity-75"
            >
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-green-600 dark:text-green-400 font-bold">✓</span>
                <span className="text-[11px] font-semibold text-primary-700 dark:text-primary-300">
                  D{i + 1} — {def.name}
                </span>
              </div>
              <p className="ml-4 text-[11px] text-primary-500 dark:text-primary-400 mt-0.5">
                {def.rewardLabel}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const DirectivesTab = () => {
  const activeIndex = useDirectivesStore((s) => s.activeIndex);
  const allDone = activeIndex === -1;

  return (
    <div className="p-3 flex flex-col gap-3 h-full overflow-y-auto">
      <div className="flex items-center gap-2 mb-1">
        <div className="h-2 w-2 rounded-full bg-amber-500 dark:bg-amber-400 animate-pulse" />
        <h2 className="text-xs font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400">
          AGI Directives
        </h2>
      </div>

      <p className="text-[11px] text-primary-500 dark:text-primary-400 leading-relaxed">
        Post-singularity objectives. Progress accumulates across all runs —
        resets don&apos;t erase your work.
      </p>

      {allDone ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 dark:bg-amber-400/10 p-4 text-center">
          <div className="text-2xl mb-2">🤖</div>
          <p className="text-sm font-bold text-amber-600 dark:text-amber-400">
            All Directives Complete
          </p>
          <p className="text-[11px] text-primary-500 dark:text-primary-400 mt-1">
            The AGI transition is complete. What comes next is yours to build.
          </p>
        </div>
      ) : (
        <DirectiveCard index={activeIndex} />
      )}

      <CompletedList />
    </div>
  );
};
