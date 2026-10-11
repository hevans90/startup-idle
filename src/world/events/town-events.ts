/**
 * World v2 — the scene's side of the events: when each kind is next due, what
 * the town looks like to the director, and what an event leaves behind when
 * it ends. Plain functions and a little live state; the director itself stays
 * a function of what it is shown. @see stepEvents
 */
import { housedBy, residentsIn } from "../../game/housing";
import type { Grid } from "../grid";
import type { MoodParts } from "../agents/mood";
import { PACING, nextDueIn, type GameEvent, type PacedKind } from "./events";

/** Seconds of play until each kind of event is next due. Live state; not saved. */
export type Pacing = Record<PacedKind, number>;

export const createPacing = (): Pacing =>
  Object.fromEntries(Object.entries(PACING).map(([k, p]) => [k, p.first])) as Pacing;

/** The clocks run on only while nothing is under way, so events do not queue up behind each other. */
export function tickPacing(p: Pacing, events: readonly GameEvent[], dt: number): void {
  if (events.some((e) => e.phase !== "over")) return;
  for (const k of Object.keys(p) as PacedKind[]) p[k] -= dt;
}

export const isDue = (p: Pacing, k: PacedKind) => p[k] <= 0;

/** Events that are new since the last look put their kind's next one off again. */
export function repace(p: Pacing, before: readonly GameEvent[], after: readonly GameEvent[], roll = Math.random): void {
  const seen = new Set(before.map((e) => e.id));
  for (const e of after) {
    if (!seen.has(e.id) && e.kind in p) p[e.kind as PacedKind] = nextDueIn(e.kind as PacedKind, roll());
  }
}

/** Events that ended between one look and the next. */
export function endedBetween(before: readonly GameEvent[], after: readonly GameEvent[]): GameEvent[] {
  const was = new Map(before.map((e) => [e.id, e.phase]));
  return after.filter((e) => e.phase === "over" && was.has(e.id) && was.get(e.id) !== "over");
}

/** The town's mood: every house's, weighted by who lives there. Nought with nobody home. */
export function townMood(g: Grid, moods: ReadonlyMap<number, MoodParts>): number {
  let sum = 0, n = 0;
  for (const s of g.structures.values()) {
    if (!housedBy(s.def)) continue;
    const r = residentsIn(s), m = moods.get(s.id);
    if (!r || !m) continue;
    sum += m.total * r;
    n += r;
  }
  return n ? sum / n : 0;
}

/**
 * THE CONVOY'S TAKE: the calls made while it was in, and what they paid, for
 * the one convoy under way. Live state; not saved. @see tallyCall
 */
let tally = { id: -1, calls: 0, earned: 0 };
export const convoyTally = (id: number) => (tally.id === id ? tally : { id, calls: 0, earned: 0 });
export function tallyCall(id: number, fee: number): void {
  if (tally.id !== id) tally = { id, calls: 0, earned: 0 };
  tally.calls++;
  tally.earned += fee;
}

/** Vibe coders a studio needs before they ask for a hackathon. */
export const HACKATHON_CODERS = 10;
