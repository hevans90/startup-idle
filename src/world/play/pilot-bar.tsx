/**
 * World v2 — THE PILOT BAR: what the build bar's tools give way to while AI
 * mode drives. One line: what the pilot is doing NOW and what is NEXT, each a
 * click that flies the camera there; the goal it is steered toward; and a
 * pause. @see usePilotView, useAiDriving
 */
import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { usePilotView, type JobView, type PilotView } from "../../state/pilot-view.store";
import { useSessionStore } from "../../state/session.store";
import { showMe } from "./map-focus";

const TONE: Record<PilotView["kind"], string> = {
  did: "text-fg", next: "text-fg", saving: "text-warn", waiting: "text-fg-muted", idle: "text-fg-muted", paused: "text-fg-muted", blocked: "text-bad", stuck: "text-bad",
};

/** The goals, as they are named everywhere. @see Goal */
export const GOALS = [
  { value: "grow", label: "Grow", title: "Whatever pays back soonest" },
  { value: "landmark", label: "Next landmark", title: "Leans to the landmarks, and what they wait on" },
] as const;

/** A job's words, a button to where it is when it has a place. */
function Where({ job, title, className, children }: { job?: JobView; title: string; className?: string; children: ReactNode }) {
  const at = job?.at;
  if (!at) return <span title={title} className={twMerge("min-w-0 truncate", className)}>{children}</span>;
  return (
    <button type="button" title={`${title} · show me`} onClick={() => showMe(at)}
      className={twMerge("min-w-0 cursor-pointer truncate text-left hover:underline", className)}>
      {children}
    </button>
  );
}

export function PilotBar({ tool, className }: { tool: string; className?: string }) {
  const { kind, says, job, queue, act } = usePilotView();
  const goal = useSessionStore((s) => s.aiGoal) ?? "grow";
  const steer = useSessionStore((s) => s.steerAi);
  const paused = kind === "paused";
  const now = queue.find((j) => j.id === job);
  // NEXT: the best of the queue that is not what it is on now.
  const next = queue.find((j) => j.id !== job && j.state !== "cancelled");
  return (
    <div className={twMerge("flex min-w-0 items-center gap-3 px-2 text-xs", className)}>
      <span className="flex shrink-0 items-center gap-1.5 font-display uppercase tracking-widest text-ai">
        <span aria-hidden className={twMerge("h-1.5 w-1.5 rounded-full bg-ai", !paused && "animate-pulse")} />AI
      </span>
      <Where job={now} title={now?.why ?? says} className={twMerge("max-w-[28rem] font-bold", TONE[kind])}>{says}</Where>
      {next && (
        <Where job={next} title={next.why} className="max-w-[22rem] text-fg-muted @max-4xl:hidden">
          Next: {next.says}{next.state !== "ready" && <> · {next.shown.toLowerCase()}</>}
        </Where>
      )}
      <select aria-label="The AI's goal" title={GOALS.find((g) => g.value === goal)?.title} value={goal}
        onChange={(e) => steer({ aiGoal: e.target.value as typeof goal })}
        className="ml-auto shrink-0 cursor-pointer border border-line-quiet bg-surface-2 px-1 py-0.5 text-xs text-fg dark:bg-surface-2 dark:text-fg">
        {GOALS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
      </select>
      <button type="button" aria-pressed={paused} title={paused ? "Let the AI carry on" : "Stop the AI where it is"}
        onClick={() => act({ pause: !paused })} className={twMerge(tool, "shrink-0")}>
        {paused ? "Resume" : "Pause"}
      </button>
    </div>
  );
}
