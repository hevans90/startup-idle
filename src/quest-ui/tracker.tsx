/**
 * QUEST UI — THE OBJECTIVE, TRACKED: a card on the map in the AI's violet —
 * what is asked in a line, how far it has come, and the time left of its
 * window. @see Running
 */
import { twMerge } from "tailwind-merge";

import { clock } from "../game/quests/describe";

export function Tracker({ says, progress, left, action, needs, className }: {
  says: string;
  /** What it waits on, each met or not: the Lattice's agents and water. */
  needs?: readonly { label: string; ok: boolean }[];
  /** What the player does for it, on the map: a pick. While `busy`, clicking stops it. */
  action?: { label: string; onClick: () => void; busy?: boolean };
  /** 0–1. */
  progress: number;
  /** Seconds of play left. */
  left: number;
  className?: string;
}) {
  return (
    <div className={twMerge("w-fit border border-line border-l-2 border-l-ai bg-surface-2/95 shadow-lg backdrop-blur-sm", className)}>
      <div className="flex w-64 flex-col gap-1 px-2.5 py-2 text-xs" role="status" aria-label={`Objective: ${says}`}>
        <p className="flex justify-between gap-2">
          <span className="text-[10px] uppercase tracking-widest text-ai">Objective</span>
          <span className="tabular-nums text-fg-muted">{clock(left)}</span>
        </p>
        <p>{says}</p>
        {needs && (
          <p className="flex flex-wrap gap-x-2 text-[11px]">
            {needs.map((n) => <span key={n.label} className={n.ok ? "text-good" : "text-warn"}>{n.ok ? "✓" : "·"} {n.label}</span>)}
          </p>
        )}
        {action && (
          <button type="button" onClick={action.onClick} title={action.busy ? "Stop picking" : undefined}
            className={`w-fit cursor-pointer border px-2 py-0.5 ${action.busy ? "animate-pulse border-ai text-ai" : "border-line hover:bg-surface-2"}`}>
            {action.label}
          </button>
        )}
        <div className="h-1 w-full bg-surface-2">
          <div className="h-full bg-ai transition-[width] duration-500" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      </div>
    </div>
  );
}
