/**
 * World v2 — THE PILOT'S CHOICE: of everything the desks propose, the one to
 * do now — or what it is waiting for, in words. One rule for every desk
 * alike: THE BEST PAYBACK IT CAN AFFORD WITHOUT STARVING A BETTER ONE.
 *
 *  - WORTH is income a second for a dollar. A job that others wait on is
 *    worth the best chain it begins: an upgrade that earns nothing itself and
 *    gates the Studio is worth the Studio.
 *  - SAVING: the best job costing more than there is, it works out how long
 *    till it can pay. A cheaper job that pays for itself before then is done
 *    meanwhile — it brings the better one nearer, not further. Otherwise it
 *    saves, and says for how long.
 *  - THE RESERVE is money it will not go below.
 *  - URGENT jobs go first; a PINNED one is the best whatever it is worth.
 *
 * Pure: jobs and a purse in, a decision and every job's state out.
 * @see Job, Pilot, plans/ai-mode-rebuild.md §3
 */
import type { Job, Need, Queued, Shown } from "./job";

/** What there is to spend, and how fast it comes in. */
export type Purse = {
  money: number;
  /** Money a second. */
  income: number;
  /** Money it keeps back. */
  reserve: number;
  innovation: number;
  /** Innovation a second. */
  innovationRate: number;
};

/** A refusal remembered: why, and when the job may be tried again — a time, or a change to the map from the `rev` it was refused at. */
export type Refusal = { because: string; until: number; rev: number | null };

/** What the pilot remembers between choices. Times are seconds on its own clock. */
export type Memory = {
  refused: Map<string, Refusal>;
  /** Jobs the player called off, and till when. */
  cancelled: Map<string, number>;
  /** The job the player said to do next. */
  pinned: string | null;
};

export const newMemory = (): Memory => ({ refused: new Map(), cancelled: new Map(), pinned: null });

export type Decision =
  | { kind: "do"; job: Job }
  | { kind: "saving"; job: Job; short: number; seconds: number }
  | { kind: "waiting"; job: Job; on: Need }
  | { kind: "blocked"; job: Job; because: string }
  | { kind: "idle" };

export type Choice = {
  decision: Decision;
  /** Every job with its state and worth, the best first. */
  queue: Queued[];
};

/** What a job has to spend from, and how fast that fills. */
const fund = (j: Job, p: Purse) => j.costs === "innovation"
  ? { have: Math.max(0, p.innovation), rate: p.innovationRate }
  : { have: Math.max(0, p.money - p.reserve), rate: p.income };

const ratio = (gain: number, cost: number) => (cost > 0 ? gain / cost : gain > 0 ? Infinity : 0);

/**
 * Choose. `now` is the pilot's clock and `rev` the map's revision, for what
 * was refused; `tilt` is the goal's weight on a job's worth, one unless said.
 */
export function choose(jobs: readonly Job[], purse: Purse, memory: Memory, now: number, rev: number, tilt: (j: Job) => number = () => 1): Choice {
  // WHO WAITS ON WHOM, for the worth of a job that unblocks others.
  const waiting = new Map<string, Job[]>();
  for (const j of jobs) for (const n of j.needs ?? []) waiting.set(n.id, [...(waiting.get(n.id) ?? []), j]);
  /** The best chain a job begins: itself, or itself and what waits on it, whichever earns more a dollar. */
  const chain = (j: Job, seen: Set<string>): { gain: number; cost: number } => {
    let best = { gain: j.gain * tilt(j), cost: j.cost };
    if (seen.has(j.id)) return best;
    seen.add(j.id);
    for (const k of waiting.get(j.id) ?? []) {
      // Only chains in one coin: innovation spent is not money saved.
      if ((k.costs ?? "money") !== (j.costs ?? "money")) continue;
      const c = chain(k, seen);
      const with_ = { gain: j.gain * tilt(j) + c.gain, cost: j.cost + c.cost };
      if (ratio(with_.gain, with_.cost) > ratio(best.gain, best.cost)) best = with_;
    }
    seen.delete(j.id);
    return best;
  };

  const queue: Queued[] = jobs.map((job) => {
    const c = chain(job, new Set());
    return { job, shown: shownOf(job, purse, memory, now, rev), worth: ratio(c.gain, c.cost) };
  });
  const pinned = memory.pinned;
  const first = (q: Queued) => (q.job.id === pinned ? 2 : q.job.urgent ? 1 : 0);
  queue.sort((a, b) => first(b) - first(a) || b.worth - a.worth || a.job.cost - b.job.cost || (a.job.id < b.job.id ? -1 : 1));

  const open = queue.filter((q) => q.shown.state === "ready" || q.shown.state === "saving");
  const best = open[0];
  if (!best) {
    // NOTHING IT COULD DO: what it is waiting for, or what refused it — the best of them, named.
    const held = queue.find((q) => q.shown.state === "waiting") ?? queue.find((q) => q.shown.state === "blocked");
    if (held?.shown.state === "waiting") return { decision: { kind: "waiting", job: held.job, on: held.shown.on }, queue };
    if (held?.shown.state === "blocked") return { decision: { kind: "blocked", job: held.job, because: held.shown.because }, queue };
    return { decision: { kind: "idle" }, queue };
  }
  if (best.shown.state === "ready") return { decision: { kind: "do", job: best.job }, queue };
  if (best.shown.state !== "saving") return { decision: { kind: "idle" }, queue };
  // SAVING FOR THE BEST. Meanwhile, the best of what can be paid for now and
  // pays for itself before the best can be afforded: it brings that nearer.
  // (Buying c first reaches the best sooner exactly when c.cost / c.gain is
  // no more than the time to save for it.) What is paid in another coin
  // delays nothing, and goes.
  const coin = best.job.costs ?? "money", wait = best.shown.seconds;
  for (const q of open) {
    if (q === best || q.shown.state !== "ready") continue;
    if ((q.job.costs ?? "money") !== coin) return { decision: { kind: "do", job: q.job }, queue };
    if (q.job.cost <= 0 || (q.job.gain > 0 && q.job.cost / q.job.gain <= wait)) return { decision: { kind: "do", job: q.job }, queue };
  }
  return { decision: { kind: "saving", job: best.job, short: best.shown.short, seconds: wait }, queue };
}

/** The one state a job is in. */
function shownOf(job: Job, purse: Purse, memory: Memory, now: number, rev: number): Shown {
  const off = memory.cancelled.get(job.id);
  if (off !== undefined && off > now) return { state: "cancelled" };
  const no = memory.refused.get(job.id);
  if (no && (no.rev === null ? no.until > now : no.rev === rev && no.until > now)) return { state: "blocked", because: no.because };
  if (job.needs?.length) return { state: "waiting", on: job.needs[0] };
  const { have, rate } = fund(job, purse);
  if (job.cost <= have) return { state: "ready" };
  const short = job.cost - have;
  return { state: "saving", short, seconds: rate > 0 ? short / rate : Infinity };
}
