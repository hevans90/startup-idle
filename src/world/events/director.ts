/**
 * World v2 — THE EVENTS' DIRECTOR: when the next event comes, and which.
 *
 * Nothing at all until the company is 100 strong; the first a few minutes
 * after, then one every 15–25 minutes of play, drawn from those that can come
 * by their weights, and the last one less likely to come again straight
 * after. One at a time: none starts while another is under way, though the
 * clock runs on. Kept with the company. @see EventDef.weight
 */
import type { EventDef, EventKind, TownView } from "./events";

export type Director = {
  /** Seconds of play until the next is due; null until the company is big enough for any. */
  gap: number | null;
  /** The last that came. */
  last: EventKind | null;
};

/** People hired, every kind summed, before any event comes. */
export const EVENT_HEADCOUNT = 100;
/** Seconds from reaching it to the first. */
export const FIRST_GAP = 180;
/** Seconds between one starting and the next being due. */
export const GAP: readonly [number, number] = [15 * 60, 25 * 60];
/** What being the last one does to a kind's chance of coming next. */
const AGAIN = 0.25;

export function createDirector(saved?: Partial<Director> | null): Director {
  return { gap: typeof saved?.gap === "number" ? saved.gap : null, last: saved?.last ?? null };
}

/** `dt` seconds of play; the clock is started once there are `headcount` enough. */
export function tickDirector(d: Director, dt: number, headcount: number): void {
  if (d.gap === null) {
    if (headcount >= EVENT_HEADCOUNT) d.gap = FIRST_GAP;
    return;
  }
  d.gap -= dt;
}

/**
 * The event to start now, if one is due and none is under way: drawn by
 * weight from those that can come, `roll` in [0, 1). Null with none.
 */
export function pickEvent(d: Director, v: TownView, defs: readonly EventDef[], live: boolean, roll: number): EventDef | null {
  if (d.gap === null || d.gap > 0 || live) return null;
  const pool = defs.flatMap((def) => {
    const w = def.where(v) ? (def.weight?.(v) ?? 1) * (def.kind === d.last ? AGAIN : 1) : 0;
    return w > 0 ? [{ def, w }] : [];
  });
  const total = pool.reduce((s, p) => s + p.w, 0);
  let r = roll * total;
  for (const p of pool) if ((r -= p.w) < 0) return p.def;
  return pool.length ? pool[pool.length - 1].def : null;
}

/** One has started: the next put off, `roll` in [0, 1). */
export function eventStarted(d: Director, kind: EventKind, roll: number): void {
  d.gap = GAP[0] + roll * (GAP[1] - GAP[0]);
  d.last = kind;
}
