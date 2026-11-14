/**
 * THE PILOT TAB, under AI mode: everything the pilot has in mind, a desk at a
 * time, each job with its state and (on hover) its reason; and its log, the
 * newest first. `JobState` is the same state as one line, for the other tabs:
 * where a buy button was, what the pilot means to do about it.
 * @see usePilotView, plans/ai-mode-rebuild.md phase 7
 */
import { twMerge } from "tailwind-merge";

import { jobIn, usePilotView, type JobView, type PilotDesk, type PilotState } from "../state/pilot-view.store";
import { useSessionStore } from "../state/session.store";
import { Button, Empty, Label, Panel, Segmented, Toggle } from "../ui/console";
import { GOALS } from "../world/play/pilot-bar";
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

/** THE PLAYER'S HAND ON A JOB: call it off for ten minutes (or take that back), or have it done next. @see Pilot.cancel, Pilot.doNext */
export function JobHand({ job, className }: { job: JobView; className?: string }) {
  const act = usePilotView((s) => s.act);
  const pinned = usePilotView((s) => s.pinned) === job.id;
  const off = job.state === "cancelled";
  return (
    <span className={twMerge("flex shrink-0 gap-1", className)}>
      {!off && (
        <Button size="sm" variant={pinned ? "primary" : "quiet"} aria-pressed={pinned} title={pinned ? "It is next: press to let the pilot choose again" : "Do this before anything else, saving for it if it must"}
          onClick={() => act({ doNext: pinned ? null : job.id })}>Do next</Button>
      )}
      <Button size="sm" variant="quiet" title={off ? "Let the pilot propose it again" : "Not for ten minutes"}
        onClick={() => act(off ? { restore: job.id } : { cancel: job.id })}>{off ? "Restore" : "Cancel"}</Button>
    </span>
  );
}

/** The reserve it may be told to keep: so much of its income, in seconds. */
const RESERVES = [{ value: "0", label: "None" }, { value: "60", label: "1 min" }, { value: "300", label: "5 min" }, { value: "900", label: "15 min" }];

/** STEERING: the goal, the reserve, and a switch a desk. A desk off proposes nothing, and its controls are the player's again. */
function Steering() {
  const goal = useSessionStore((s) => s.aiGoal) ?? "grow";
  const reserve = useSessionStore((s) => s.aiReserve) ?? 0;
  const off = useSessionStore((s) => s.aiDesksOff) ?? [];
  const steer = useSessionStore((s) => s.steerAi);
  return (
    <Panel tone="ai" title="Steering">
      <div className="flex flex-col gap-2 text-xs">
        <div className="flex items-center justify-between gap-2">
          <Label>Goal</Label>
          <Segmented label="The AI's goal" value={goal} onChange={(v) => steer({ aiGoal: v })} options={GOALS.map((g) => ({ ...g }))} />
        </div>
        <div className="flex items-center justify-between gap-2" title="Income it keeps back and will not spend">
          <Label>Reserve</Label>
          <Segmented label="Income the AI keeps back" value={String(reserve)} onChange={(v) => steer({ aiReserve: Number(v) })} options={RESERVES} />
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1" title="A desk switched off does nothing, and its controls are yours again">
          {DESKS.map(([desk, name]) => (
            <span key={desk} className="flex items-center justify-between gap-2">
              {name}
              <Toggle label={`The AI's ${name} desk`} on={!off.includes(desk)} onChange={(on) => steer({ aiDesksOff: on ? off.filter((d) => d !== desk) : [...off, desk] })} />
            </span>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function Row({ job, now }: { job: JobView; now: boolean }) {
  const where = job.at;
  return (
    <li title={job.why} className="flex items-center gap-2 text-xs">
      {where
        ? <button type="button" onClick={() => showMe(where)} className={twMerge("min-w-0 cursor-pointer truncate text-left hover:underline", now && "font-bold")}>{job.says}</button>
        : <span className={twMerge("min-w-0 truncate", now && "font-bold")}>{job.says}</span>}
      <span className={twMerge("ml-auto shrink-0 text-[11px] tabular-nums", STATE_TONE[job.state])}>{job.shown}</span>
      <JobHand job={job} />
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
      <Steering />
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
