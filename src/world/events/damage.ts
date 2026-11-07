/**
 * World v2 — DAMAGED BUILDINGS, whatever did it: each one producing nothing
 * (its people off work, its quays shut) until the repair crew has been round.
 * One crew, one building at a time, in the order they were damaged; none
 * while the cause is still at it. Floods damage what they reach; other
 * disasters will use the same queue, badge and line. Live state; not saved.
 * @see stepRepairs, problemOf
 */
import { housedBy, residentsIn } from "../../game/housing";
import type { GeneratorId } from "../../state/generators.store";
import type { Grid } from "../grid";

/** What damaged a building — or, "closed", shut by the health inspector for a set time. @see closeFor */
export type DamageCause = "flood" | "heat" | "closed";

/** What a building damaged by each cause is called, on its badge and its line. */
export const DAMAGE_NAME: Record<DamageCause, string> = { flood: "Flood damaged", heat: "Overheated", closed: "Closed by the inspector" };

/** Seconds the repair crew takes over each damaged building, one at a time. */
export const REPAIR_SECONDS = 40;

/** `timed`: shut for its time, the crew not needed — and not in its queue. */
const damaged = new Map<number, { left: number; cause: DamageCause; timed?: boolean }>();
/** The map the damage is on: another map has none. */
let damagedOn: Grid | null = null;

/** Buildings marked damaged, by `cause`; one already damaged keeps its place in the queue. */
export function damage(g: Grid, ids: Iterable<number>, cause: DamageCause = "flood") {
  if (damagedOn !== g) { damaged.clear(); damagedOn = g; }
  for (const id of ids) if (!damaged.has(id)) damaged.set(id, { left: REPAIR_SECONDS, cause });
}

/** A building shut for `seconds`, whatever else is going on: no crew needed. */
export function closeFor(g: Grid, id: number, seconds: number, cause: DamageCause = "closed") {
  if (damagedOn !== g) { damaged.clear(); damagedOn = g; }
  damaged.set(id, { left: seconds, cause, timed: true });
}

/**
 * The crew's work for `dt` seconds, on the first damaged building still
 * standing; none while `held` (the cause still at it). Returns the ids repaired.
 */
export function stepRepairs(g: Grid, dt: number, held: boolean): number[] {
  const done: number[] = [];
  if (damagedOn !== g) damaged.clear();
  for (const id of damaged.keys()) if (!g.structures.has(id)) damaged.delete(id);
  // THE CLOSED, on their own clocks.
  for (const [id, d] of damaged) {
    if (!d.timed) continue;
    d.left -= dt;
    if (d.left <= 0) { damaged.delete(id); done.push(id); }
  }
  if (held) return done;
  for (const [id, d] of damaged) {
    if (d.timed) continue;
    const t = d.left - dt;
    if (t > 0) { d.left = t; break; }
    damaged.delete(id);
    done.push(id);
    dt = -t;
  }
  return done;
}

/** Seconds until a building is repaired, its place in the queue counted; null when it is not damaged. */
export function repairedIn(id: number): number | null {
  const own = damaged.get(id);
  if (own?.timed) return own.left;
  let t = 0;
  for (const [d, { left, timed }] of damaged) {
    if (timed) continue;
    t += left;
    if (d === id) return t;
  }
  return null;
}

export const isDamaged = (id: number) => damaged.has(id);

/** What a damaged building is called, by what damaged it; null when it is not damaged. */
export const damagedAs = (id: number): string | null => {
  const d = damaged.get(id);
  return d ? DAMAGE_NAME[d.cause] : null;
};

/** People off work for their workplace being damaged or closed, by kind: those at its desks. */
export function damagedDesksAway(g: Grid, desks: ReadonlyMap<number, { used: number }>, kindOf: (def: string) => GeneratorId | null | undefined): Partial<Record<GeneratorId, number>> {
  const out: Partial<Record<GeneratorId, number>> = {};
  for (const id of damaged.keys()) {
    const s = g.structures.get(id), who = s && kindOf(s.def);
    if (who) out[who] = (out[who] ?? 0) + (desks.get(id)?.used ?? 0);
  }
  return out;
}

/** Residents off work for their homes being damaged, by kind. */
export function damagedAway(g: Grid): Partial<Record<GeneratorId, number>> {
  const out: Partial<Record<GeneratorId, number>> = {};
  for (const id of damaged.keys()) {
    const s = g.structures.get(id), h = s && housedBy(s.def);
    if (h) out[h.id] = (out[h.id] ?? 0) + residentsIn(s);
  }
  return out;
}
