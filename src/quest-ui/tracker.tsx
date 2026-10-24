/**
 * QUEST UI — THE OBJECTIVE, TRACKED: a compact underlined frame on the map —
 * what is asked in a line, how far it has come, and the time left of its
 * window. @see Running
 */
import { twMerge } from "tailwind-merge";

import { clock } from "../game/quests/describe";
import { QuestFrame } from "./quest-frame";

export function Tracker({ says, progress, left, className }: {
  says: string;
  /** 0–1. */
  progress: number;
  /** Seconds of play left. */
  left: number;
  className?: string;
}) {
  return (
    <QuestFrame kind="underline" className={twMerge("w-fit", className)}>
      <div className="flex w-64 flex-col gap-1 px-2 pb-2 pt-1 text-xs" role="status" aria-label={`Objective: ${says}`}>
        <p className="flex justify-between gap-2">
          <span className="text-[10px] uppercase tracking-widest text-violet-700 dark:text-violet-300">Objective</span>
          <span className="tabular-nums text-primary-600 dark:text-primary-400">{clock(left)}</span>
        </p>
        <p>{says}</p>
        <div className="h-1 w-full bg-primary-300 dark:bg-primary-700">
          <div className="h-full bg-violet-600 transition-[width] duration-500 dark:bg-violet-400" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      </div>
    </QuestFrame>
  );
}
