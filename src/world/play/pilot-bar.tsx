/**
 * World v2 — THE PILOT BAR: what the build bar's tools give way to while AI
 * mode drives. One line: what the pilot is doing NOW and what is NEXT, each a
 * click that flies the camera there; the goal it is steered toward; and a
 * pause. @see usePilotView, useAiDriving
 */
import { IconPlayerPauseFilled, IconPlayerPlayFilled } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { usePilotView, type JobView, type PilotView } from "../../state/pilot-view.store";
import { useSessionStore } from "../../state/session.store";
import { Choice, DockButton, Rule, Run, toned } from "./dock";
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

export function PilotBar({ className }: { className?: string }) {
  const { kind, says, job, queue, act } = usePilotView();
  const goal = useSessionStore((s) => s.aiGoal) ?? "grow";
  const steer = useSessionStore((s) => s.steerAi);
  const paused = kind === "paused";
  const now = queue.find((j) => j.id === job);
  // NEXT: the best of the queue that is not what it is on now.
  const next = queue.find((j) => j.id !== job && j.state !== "cancelled");
  return (
    <div style={toned("var(--ui-ai)")} className={twMerge("flex h-9 min-w-0 items-center gap-2 pl-1 text-xs", className)}>
      <span className="relative flex h-7 shrink-0 items-center gap-1.5 bg-tone-soft px-2 font-display text-[10px] tracking-[0.2em] text-ai uppercase">
        <span aria-hidden className={twMerge("size-1.5 rounded-full bg-ai", !paused && "animate-pulse")} />AI
      </span>
      <div className="flex min-w-0 flex-1 flex-col px-1 leading-tight">
        <Where job={now} title={now?.why ?? says} className={twMerge("max-w-[28rem] font-semibold", TONE[kind])}>{says}</Where>
        {next && (
          <Where job={next} title={next.why} className="max-w-[28rem] text-[10px] text-fg-muted @max-4xl:hidden">
            Next: {next.says}{next.state !== "ready" && <> · {next.shown.toLowerCase()}</>}
          </Where>
        )}
      </div>
      <Run>
        {GOALS.map((g) => <Choice key={g.value} name={g.label} hint={g.title} on={goal === g.value} onClick={() => steer({ aiGoal: g.value })}>{g.label}</Choice>)}
      </Run>
      <Rule />
      <DockButton name={paused ? "Resume" : "Pause"} hint={paused ? "Let the AI carry on" : "Stop the AI where it is"} tone="var(--ui-ai)" on={paused} onClick={() => act({ pause: !paused })}>
        {paused ? <IconPlayerPlayFilled size={15} /> : <IconPlayerPauseFilled size={15} />}
      </DockButton>
    </div>
  );
}
