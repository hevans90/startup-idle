/**
 * World v2 — THE PILOT BAR: what the build bar's tools give way to while AI
 * mode drives. One line: what the pilot is doing NOW and what is NEXT, each a
 * click that flies the camera there, and a pause. @see gamePilot, useAiDriving
 */
import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { useTicking } from "../../hooks/use-ticking";
import { gamePilot } from "../ai/pilot/game";
import { shownAs, type Job } from "../ai/pilot/job";
import type { Status } from "../ai/pilot/pilot";
import { showMe } from "./map-focus";

const TONE: Record<Status["kind"], string> = {
  did: "text-fg", next: "text-fg", saving: "text-warn", waiting: "text-fg-muted", idle: "text-fg-muted", paused: "text-fg-muted", blocked: "text-bad", stuck: "text-bad",
};

/** A job's words, a button to where it is when it has a place. */
function Where({ job, title, className, children }: { job?: Job; title: string; className?: string; children: ReactNode }) {
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
  useTicking(500);
  const pilot = gamePilot(), now = pilot.status();
  const paused = now.kind === "paused";
  // NEXT: the best of the queue that is not what it is on now.
  const next = pilot.queue().find((q) => q.job.id !== now.job?.id && q.shown.state !== "cancelled");
  return (
    <div className={twMerge("flex min-w-0 items-center gap-3 px-2 text-xs", className)}>
      <span className="flex shrink-0 items-center gap-1.5 font-display uppercase tracking-widest text-ai">
        <span aria-hidden className={twMerge("h-1.5 w-1.5 rounded-full bg-ai", !paused && "animate-pulse")} />AI
      </span>
      <Where job={now.job} title={now.job?.why ?? now.says} className={twMerge("max-w-[28rem] font-bold", TONE[now.kind])}>{now.says}</Where>
      {next && (
        <Where job={next.job} title={next.job.why} className="max-w-[22rem] text-fg-muted @max-4xl:hidden">
          Next: {next.job.says}{next.shown.state !== "ready" && <> · {shownAs(next.shown).toLowerCase()}</>}
        </Where>
      )}
      <button type="button" aria-pressed={paused} title={paused ? "Let the AI carry on" : "Stop the AI where it is"}
        onClick={() => pilot.pause(!paused)} className={twMerge(tool, "ml-auto shrink-0")}>
        {paused ? "Resume" : "Pause"}
      </button>
    </div>
  );
}
