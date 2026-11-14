/**
 * World v2 — THE PILOT: AI mode's brain, running. Its desks propose jobs, the
 * chooser picks one, and it is done through the player's own actions — or
 * the pilot says, in words, what it is waiting for.
 *
 * FOUR RULES make "stuck" impossible to hide:
 *  1. EVERY LOOK ENDS IN A JOB DONE OR A NAMED WAIT. There is no bare false:
 *     `status` always says what it is doing or what it is waiting for.
 *  2. DONE IS READ OFF THE WORLD. A job that says it went and whose `done`
 *     says otherwise is a refusal, with a reason.
 *  3. A REFUSAL IS REMEMBERED with its reason, and the job not offered again
 *     till the map changes or a time passes. Never the same failing job
 *     twice running.
 *  4. A WATCHDOG: a job ready and nothing done for two minutes is a FAULT —
 *     logged, shown, the job dropped for a while and the next taken; and
 *     thrown where the pilot is run strictly, so a simulation fails loudly.
 *
 * It holds no stores and draws nothing: a grid's revision and a purse in, a
 * status out. @see choose, Job, plans/ai-mode-rebuild.md §4
 */
import { choose, newMemory, type Decision, type Memory, type Purse } from "./chooser";
import { clock, shortOf, type DeskId, type Job, type Queued } from "./job";

/** One part of the company, proposing what could be done there. It neither chooses nor acts. */
export type Desk = { id: DeskId; propose: (purse: Purse) => Job[] };

/** Seconds between its looks at the company; between jobs done, for the look of it; and with a job ready and nothing done, to a fault. */
export const LOOK_EVERY = 0.5;
export const PACE = 2;
export const WATCHDOG = 120;
/** Seconds a job that faulted, or that the player cancelled, is left alone. */
export const FAULT_REST = 600;
export const CANCEL_REST = 600;
/** Lines of log kept. */
const LOG_KEPT = 200;

export type Status = {
  kind: "did" | "next" | "saving" | "waiting" | "blocked" | "idle" | "paused" | "stuck";
  /** What it is doing, or waiting for, in words. Never empty. */
  says: string;
  job?: Job;
};

/**
 * WHAT IT IS STEERED TOWARD: the weight a goal puts on a desk's jobs. Grow is
 * the plain rule; Next landmark leans it, and a job a landmark waits on is
 * worth the leaned chain. (A "fine town" lean was tried and dropped: houses
 * and offices are already built as they are wanted, so leaning to them only
 * put off the upgrades that pay for more, and the town came out smaller.)
 * @see choose `tilt`, plans/ai-mode-rebuild.md phase 8
 */
export type Goal = "grow" | "landmark";
export const GOAL_LEAN = 4;
const LEANS: Record<Goal, readonly DeskId[]> = { grow: [], landmark: ["landmarks"] };
export const tiltOf = (goal: Goal) => (j: Job): number => (LEANS[goal].includes(j.desk) ? GOAL_LEAN : 1);

export type LogLine = { at: number; kind: "did" | "refused" | "fault"; text: string };

export type PilotOptions = {
  /** Throw on a fault: for a simulation, which must fail loudly. */
  strict?: boolean;
  pace?: number;
};

export type Pilot = {
  /** A frame: `rev` is the map's revision, for what was refused till it changes. What it is doing now. */
  /** The purse may be given as how to read it: it is read only when the pilot looks, not every frame — the company's income is a sum over every upgrade. */
  tick: (dt: number, purse: Purse | (() => Purse), rev: number) => Status;
  status: () => Status;
  /** Every job proposed at the last look, with its state, the best first. */
  queue: () => readonly Queued[];
  log: () => readonly LogLine[];
  /** Jobs done so far, and what the last was. */
  done: () => number;
  last: () => string | null;
  /** Times the watchdog has had to step in. */
  faults: () => number;
  /** Seconds on its own clock. */
  now: () => number;
  /** The player's hand: call a job off for a while, say which is next, stop and start, switch a desk off. */
  cancel: (id: string) => void;
  restore: (id: string) => void;
  doNext: (id: string | null) => void;
  pinned: () => string | null;
  setGoal: (goal: Goal) => void;
  goal: () => Goal;
  pause: (on: boolean) => void;
  setDesk: (id: DeskId, on: boolean) => void;
  desksOff: () => ReadonlySet<DeskId>;
  reset: () => void;
};

/** A decision, in words. */
function saysOf(d: Decision): Status {
  switch (d.kind) {
    case "do": return { kind: "next", says: d.job.says, job: d.job };
    case "saving": return { kind: "saving", says: `${d.job.says} · saving, ${shortOf(d.short, d.job.costs)} short${Number.isFinite(d.seconds) ? ` · ${clock(d.seconds)}` : ""}`, job: d.job };
    case "waiting": return { kind: "waiting", says: `${d.job.says} · after ${d.on.says}`, job: d.job };
    case "blocked": return { kind: "blocked", says: `${d.job.says} · can't: ${d.because}`, job: d.job };
    case "idle": return { kind: "idle", says: "Nothing to do" };
  }
}

export function createPilot(desks: readonly Desk[], options: PilotOptions = {}): Pilot {
  const pace = options.pace ?? PACE;
  let memory: Memory = newMemory();
  let t = 0, sinceLook = Infinity, sinceJob = Infinity, done = 0, faults = 0;
  let last: string | null = null;
  let status: Status = { kind: "idle", says: "Starting" };
  let queue: Queued[] = [];
  let log: LogLine[] = [];
  let paused = false;
  let goal: Goal = "grow";
  /** Since when a job has been ready with none done: for the watchdog. */
  let readySince: number | null = null;
  const off = new Set<DeskId>();
  const note = (kind: LogLine["kind"], text: string) => { log.push({ at: t, kind, text }); if (log.length > LOG_KEPT) log = log.slice(-LOG_KEPT); };

  const look = (purse: Purse, rev: number): Status => {
    const jobs: Job[] = [];
    for (const d of desks) {
      if (off.has(d.id)) continue;
      for (const j of d.propose(purse)) if (!j.done?.()) jobs.push(j);
    }
    // What was refused and may be tried again is forgotten, so the map need not be asked twice.
    for (const [id, r] of memory.refused) if (r.rev === null ? r.until <= t : r.rev !== rev || r.until <= t) memory.refused.delete(id);
    for (const [id, until] of memory.cancelled) if (until <= t) memory.cancelled.delete(id);
    if (memory.pinned && !jobs.some((j) => j.id === memory.pinned)) memory.pinned = null;
    const choice = choose(jobs, purse, memory, t, rev, tiltOf(goal));
    queue = choice.queue;
    const d = choice.decision;
    if (d.kind !== "do") { readySince = null; return saysOf(d); }
    readySince ??= t;
    // THE WATCHDOG: something to do, the means to do it, and nothing done.
    if (t - readySince > WATCHDOG) {
      faults++;
      readySince = t;
      memory.refused.set(d.job.id, { because: "it kept failing", until: t + FAULT_REST, rev: null });
      const text = `Stuck on "${d.job.says}": ready for ${clock(WATCHDOG)} and never done. Left for ${clock(FAULT_REST)}.`;
      note("fault", text);
      if (options.strict) throw new Error(`pilot fault: ${text} Queue: ${queue.slice(0, 6).map((q) => `${q.job.id}=${q.shown.state}`).join(", ")}`);
      return { kind: "stuck", says: text, job: d.job };
    }
    // AT ITS PACE, but for what cannot wait.
    if (!d.job.urgent && sinceJob < pace) return saysOf(d);
    const job = d.job;
    let out = job.run();
    // DONE IS READ OFF THE WORLD.
    if (out.ok && job.done && !job.done()) out = { ok: false, because: "it changed nothing", retry: "on-change" };
    if (!out.ok) {
      memory.refused.set(job.id, {
        because: out.because,
        until: typeof out.retry === "number" ? t + out.retry : Infinity,
        rev: out.retry === "on-change" ? rev : null,
      });
      note("refused", `${job.says}: ${out.because}`);
      return { kind: "blocked", says: `${job.says} · can't: ${out.because}`, job };
    }
    done++; sinceJob = 0; readySince = null;
    last = job.says;
    if (memory.pinned === job.id) memory.pinned = null;
    note("did", `${job.says}. ${job.why.charAt(0).toUpperCase()}${job.why.slice(1)}.`);
    return { kind: "did", says: job.says, job };
  };

  return {
    tick: (dt, purse, rev) => {
      t += dt; sinceLook += dt; sinceJob += dt;
      if (paused) { status = { kind: "paused", says: "Paused" }; readySince = null; return status; }
      if (sinceLook < LOOK_EVERY) return status;
      sinceLook = 0;
      status = look(typeof purse === "function" ? purse() : purse, rev);
      return status;
    },
    status: () => status,
    queue: () => queue,
    log: () => log,
    done: () => done,
    last: () => last,
    faults: () => faults,
    now: () => t,
    cancel: (id) => { memory.cancelled.set(id, t + CANCEL_REST); if (memory.pinned === id) memory.pinned = null; },
    restore: (id) => { memory.cancelled.delete(id); },
    doNext: (id) => { memory.pinned = id; if (id) memory.cancelled.delete(id); },
    pinned: () => memory.pinned,
    setGoal: (to) => { goal = to; },
    goal: () => goal,
    pause: (on) => { paused = on; },
    setDesk: (id, on) => { if (on) off.delete(id); else off.add(id); },
    desksOff: () => off,
    reset: () => {
      memory = newMemory(); t = 0; sinceLook = Infinity; sinceJob = Infinity; done = 0; faults = 0; last = null;
      status = { kind: "idle", says: "Starting" }; queue = []; log = []; paused = false; readySince = null; off.clear();
    },
  };
}
