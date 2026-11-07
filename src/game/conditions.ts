/**
 * CONDITIONS: what an event leaves on the company, for a while or for the
 * run — a lean on a kind's morale, or culture-deck effects held under the
 * cards — kept with the company, so a reload does not wipe them. Timed ones
 * run down on the clock, away or not.
 *
 * The truth is here; the session store keeps a copy to save, through the
 * sink it registers. @see setConditionsSink, cultureNow, moraleOffsets
 */
import type { GeneratorId } from "../state/generators.store";
import type { CardEffects, Rules } from "./culture";

export type Condition = {
  /** What made it: an event's kind, a memo. */
  source: string;
  /** For one kind only; every kind without. */
  only?: GeneratorId;
  /** Culture-deck effects — and rules — held under the slotted cards. @see cultureNow */
  effects?: CardEffects & Rules;
  /** A lean on satisfaction's target, in points. @see moraleOffsets */
  lean?: number;
  /** When it wears off, ms since the epoch; null, it lasts the run. */
  until: number | null;
};

let list: readonly Condition[] = [];
let version = 0;
/** The soonest a timed one wears off: past that, the list is looked over again. */
let nextExpiry = Infinity;
let sink: (l: readonly Condition[]) => void = () => {};

function set(l: readonly Condition[]): void {
  list = l;
  version++;
  nextExpiry = Math.min(Infinity, ...l.map((c) => c.until ?? Infinity));
  sink(list);
}

/** Those worn off, gone. */
function prune(now: number): void {
  if (now < nextExpiry) return;
  set(list.filter((c) => c.until === null || c.until > now));
}

/** The conditions in force now. */
export function conditionsNow(now = Date.now()): readonly Condition[] {
  prune(now);
  return list;
}

/** A number that changes whenever the conditions in force do. */
export function conditionsVersion(now = Date.now()): number {
  prune(now);
  return version;
}

export function addCondition(c: Condition): void {
  set([...list, c]);
}

/** Those `drop` picks out, gone. */
export function removeConditions(drop: (c: Condition) => boolean): void {
  if (list.some(drop)) set(list.filter((c) => !drop(c)));
}

/** A saved list put back, as the company is loaded. Not passed to the sink: it came from there. */
export function loadConditions(saved: readonly Condition[] | null | undefined): void {
  list = saved ?? [];
  version++;
  nextExpiry = Math.min(Infinity, ...list.map((c) => c.until ?? Infinity));
}

/** Where every change is kept. Returns the undo. */
export function setConditionsSink(s: (l: readonly Condition[]) => void): () => void {
  const before = sink;
  sink = s;
  return () => { sink = before; };
}

/** The culture effects in force on a kind, or with none, on the whole company. @see cultureNow */
export function conditionEffects(kind?: GeneratorId, now = Date.now()): (CardEffects & Rules)[] {
  return conditionsNow(now).flatMap((c) => (c.effects && (!c.only || c.only === kind) ? [c.effects] : []));
}
