/**
 * THE PILOT TAB, under AI mode: everything the pilot has in mind, a desk at a
 * time, each job with its state and (on hover) its reason; and its log, the
 * newest first. `JobState` is the same state as one line, for the other tabs:
 * where a buy button was, what the pilot means to do about it.
 * @see usePilotView, plans/ai-mode-rebuild.md phase 7
 */
import { twMerge } from "tailwind-merge";

import { jobIn, usePilotView, type JobView, type PilotDesk, type PilotState } from "../state/pilot-view.store";
import { Empty, Panel } from "../ui/console";
import { showMe } from "../world/play/map-focus";

const DESKS: readonly (readonly [PilotDesk, string])[] = [
  ["events", "Events"], ["people", "People"], ["town", "Town"], ["landmarks", "Landmarks"],
  ["water", "Water and slop"], ["harbour", "Harbour"], ["culture", "Culture"], ["machine", "The machine"],
];

export const STATE_TONE: Record<PilotState, string> = {
  ready: "text-console", saving: "text-warn", waiting: "text-fg-muted", blocked: "text-bad", cancelled: "text-fg-faint",
};

const KIND_TONE: Record<string, string> = { did: "text-fg", refused: "text-warn", fault: "text-bad" };

/** A clock for the log: minutes and seconds since the pilot began. */
const at = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** What the pilot means to do about one thing, as a line: its state, its reason on hover. Nothing when it has no such job. */
export function JobState({ id, prefix, className }: { id: string; prefix?: boolean; className?: string }) {
  const job = usePilotView((s) => jobIn(s.queue, id, prefix));
  if (!job) return null;
  return <span title={`${job.says}: ${job.why}`} className={twMerge("truncate text-[11px]", STATE_TONE[job.state], className)}>{job.shown}</span>;
}

function Row({ job, now }: { job: JobView; now: boolean }) {
  const where = job.at;
  return (
    <li title={job.why} className="flex items-baseline justify-between gap-2 text-xs">
      {where
        ? <button type="button" onClick={() => showMe(where)} className={twMerge("min-w-0 cursor-pointer truncate text-left hover:underline", now && "font-bold")}>{job.says}</button>
        : <span className={twMerge("min-w-0 truncate", now && "font-bold")}>{job.says}</span>}
      <span className={twMerge("shrink-0 text-[11px] tabular-nums", STATE_TONE[job.state])}>{job.shown}</span>
    </li>
  );
}

export function PilotTab() {
  const { says, kind, job, queue, log } = usePilotView();
  return (
    <div className="flex flex-col gap-4 p-2">
      <Panel tone="ai" title="Now">
        <p className={twMerge("text-xs", kind === "blocked" || kind === "stuck" ? "text-bad" : kind === "saving" ? "text-warn" : "text-fg")}>{says}</p>
      </Panel>
      {DESKS.map(([desk, name]) => {
        const jobs = queue.filter((j) => j.desk === desk);
        if (!jobs.length) return null;
        return (
          <Panel key={desk} title={name}>
            <ul className="flex flex-col gap-1">{jobs.map((j) => <Row key={j.id} job={j} now={j.id === job} />)}</ul>
          </Panel>
        );
      })}
      <Panel title="Log">
        {log.length ? (
          <ol className="flex flex-col gap-0.5 text-[11px]">
            {log.slice(0, 60).map((l, k) => (
              <li key={`${l.at}:${k}`} className={twMerge("flex gap-2", KIND_TONE[l.kind])}>
                <span className="shrink-0 tabular-nums text-fg-faint">{at(l.at)}</span>
                <span>{l.text}</span>
              </li>
            ))}
          </ol>
        ) : <Empty>Nothing done yet.</Empty>}
      </Panel>
    </div>
  );
}
