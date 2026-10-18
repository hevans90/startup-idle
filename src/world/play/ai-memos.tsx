/**
 * World v2 — THE AI'S MEMOS, on the map: the last few things it said, each
 * gone after a while. @see world/ai/memos
 */
import { twMerge } from "tailwind-merge";

import { useTicking } from "../../hooks/use-ticking";
import { useWorldStore } from "../../state/world.store";

/** How long a memo stays up, ms. */
const SHOWN = 25_000;

export function AiMemos({ className }: { className?: string }) {
  useTicking(1000);
  const memos = useWorldStore((s) => s.aiMemos).filter((m) => Date.now() - m.at < SHOWN);
  const dismiss = useWorldStore((s) => s.dismissAiMemos);
  if (!memos.length) return null;
  return (
    <div role="status" className={twMerge(
      "w-[min(24rem,calc(100vw-1rem))] border-l-4 border-violet-500 bg-primary-50/95 px-3 py-2 text-xs text-primary-900 shadow-md",
      "dark:border-violet-400 dark:bg-primary-900/95 dark:text-primary-100",
      className,
    )}>
      <div className="mb-1 flex items-baseline justify-between">
        <b className="text-[10px] uppercase tracking-wide text-violet-700 dark:text-violet-300">Memo from the AI</b>
        <button type="button" onClick={dismiss} aria-label="Close"
          className="cursor-pointer px-1 text-primary-500 hover:text-primary-900 dark:hover:text-primary-100">✕</button>
      </div>
      {memos.map((m) => <p key={m.at} className="italic">“{m.text}”</p>)}
    </div>
  );
}
