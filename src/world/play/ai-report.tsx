/**
 * World v2 — WHILE YOU WERE OUT: what the company's AI did to the town while
 * nobody was watching, said once when the map comes up. @see catchUpAi
 */
import { twMerge } from "tailwind-merge";

import { useWorldStore } from "../../state/world.store";

export function AiReport({ className }: { className?: string }) {
  const report = useWorldStore((s) => s.aiReport);
  const setReport = useWorldStore((s) => s.setAiReport);
  if (!report?.length) return null;
  return (
    <div role="status" className={twMerge(
      "w-[min(24rem,calc(100vw-1rem))] border border-violet-500 bg-primary-50/95 px-3 py-2 text-xs text-primary-900 shadow-md",
      "dark:border-violet-400 dark:bg-primary-900/95 dark:text-primary-100",
      className,
    )}>
      <div className="mb-1 flex items-baseline justify-between">
        <b className="text-[10px] uppercase tracking-wide text-violet-700 dark:text-violet-300">While you were out, the AI</b>
        <button type="button" onClick={() => setReport(null)} aria-label="Close"
          className="cursor-pointer px-1 text-primary-500 hover:text-primary-900 dark:hover:text-primary-100">✕</button>
      </div>
      <ul className="flex flex-col gap-0.5">
        {report.map((t, k) => <li key={k} className="italic">“{t}”</li>)}
      </ul>
    </div>
  );
}
