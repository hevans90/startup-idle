/**
 * World v2 — THE PILOT'S JOBS. Everything AI mode might do — a hire, a lot,
 * a sewer, a mandate — is one of these: what it is, in words; what it costs
 * and what it earns; what must be done first; how to do it, through the
 * player's own actions; and how to tell it is done, off the world.
 *
 * A job is always in exactly one STATE, and every state has words for the
 * player. That is the point of the shape: "cannot afford it yet", "waiting
 * on a sewer", "refused" and "nothing to do" were one bare `false` in the
 * autopilot this replaced, and a town that had stopped could not say why.
 * @see choose, Pilot, plans/ai-mode-rebuild.md
 */

export type DeskId = "people" | "town" | "landmarks" | "water" | "harbour" | "culture" | "machine" | "events";

/** What a job waits on: another job's id, and what that is in words — said even when no desk proposes it yet. */
export type Need = { id: string; says: string };

/** How a job that was tried went. A refusal carries its reason and when it may be tried again. */
export type Outcome =
  | { ok: true }
  | { ok: false; because: string; retry: "never" | "on-change" | number };

export type Job = {
  /** Stable while it is the same job: "hire:intern", "upgrade:intern_upgrade_1", "lot:intern@41,22". */
  id: string;
  desk: DeskId;
  /** What it is: "Hire 12 interns". */
  says: string;
  /** Why: "12 beds stand empty". */
  why: string;
  /** Where, for the map; and the building it puts there, for its hologram. */
  at?: { x: number; y: number };
  puts?: string;
  /** What it costs now, and in what. Nought for free. */
  cost: number;
  costs?: "money" | "innovation";
  /** Income a second it adds, as near as the desk can tell. Only its rank against other jobs matters. */
  gain: number;
  /** What must be done first. */
  needs?: Need[];
  /** Not to wait behind a purchase or the pace: an event's answer, people with no desk. */
  urgent?: boolean;
  /** Do it, through the player's own actions, and say how it went — having LOOKED: an action that changed nothing is a refusal. */
  run: () => Outcome;
  /** For a job done once: whether the world shows it done. A job that recurs (a hire) has none. */
  done?: () => boolean;
};

/** The state a job is in, and the words for it. */
export type Shown =
  | { state: "ready" }
  | { state: "saving"; short: number; seconds: number }
  | { state: "waiting"; on: Need }
  | { state: "blocked"; because: string }
  | { state: "cancelled" };

export type Queued = { job: Job; shown: Shown; worth: number };

/** A length of time, as the pilot says it: "0:40", "2:10", "1h 05m"; "—" for never. */
export function clock(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Money, as the pilot says it: "$361k". */
export function dollars(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e15) return `$${n.toExponential(1).replace("+", "")}`;
  for (const [at, unit] of [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "k"]] as const) {
    if (a >= at) return `$${(n / at).toFixed(a >= at * 100 ? 0 : 1).replace(/\.0$/, "")}${unit}`;
  }
  return `$${Math.round(n)}`;
}

/** What a job is short of, in its own coin: "$361k", "71 innovation". */
export const shortOf = (n: number, coin: Job["costs"] = "money"): string =>
  coin === "innovation" ? `${dollars(n).slice(1)} innovation` : dollars(n);

/** A job's state, in words; `coin` is what it is paid in. */
export function shownAs(s: Shown, coin: Job["costs"] = "money"): string {
  switch (s.state) {
    case "ready": return "Next";
    case "saving": return `Saving · ${shortOf(s.short, coin)} short · ${clock(s.seconds)}`;
    case "waiting": return `After: ${s.on.says}`;
    case "blocked": return `Can't: ${s.because}`;
    case "cancelled": return "Cancelled";
  }
}
