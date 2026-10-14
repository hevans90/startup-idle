/**
 * World v2 — WHAT A WORKPLACE'S DESKS GET FROM WHERE IT IS: a team leader
 * leading it, and a café next door. Each a share more work from the people at
 * its desks, shown on its label and on the café's ghost before it goes down.
 * @see deskShare, deskBonus
 */
import type { GeneratorId } from "../../state/generators.store";
import type { Grid, Structure } from "../grid";
import { workplaceKind } from "./commute";
import { LEAD_BOOST, LEADS_A_WORKPLACE, type Leadership } from "./leaders";

/** What a café within `CAFE_REACH` tiles adds to a workplace's desks. One café counts, however many. */
export const CAFE_BOOST = 0.1;
export const CAFE_REACH = 3;

/** Tiles between two footprints, edge to edge. */
const gap = (a: Structure, b: Structure) =>
  Math.max(Math.max(0, b.x - (a.x + a.w - 1), a.x - (b.x + b.w - 1)), Math.max(0, b.y - (a.y + a.h - 1), a.y - (b.y + b.h - 1)));

/** Whether a café stands near enough a workplace — or near enough where one would go. */
export function cafeNear(g: Grid, at: Structure): boolean {
  for (const s of g.structures.values()) if (s.def === "cafe" && !s.build && gap(s, at) <= CAFE_REACH) return true;
  return false;
}

/** The standing workplaces a café at `at` would serve. */
export function servedByCafe(g: Grid, at: Structure): Structure[] {
  return [...g.structures.values()].filter((s) => !s.build && workplaceKind(s.def) && gap(s, at) <= CAFE_REACH);
}

/** What a workplace's desks get: the share more work, and why. */
export function deskPerks(g: Grid, lead: Leadership, work: Structure): { share: number; why: string[] } {
  const why: string[] = [];
  let share = 0;
  const names = lead.leads.get(work.id);
  if (names?.length) {
    const k = LEAD_BOOST * Math.min(LEADS_A_WORKPLACE, names.length);
    share += k;
    why.push(`Led by ${names.join(" & ")} · +${Math.round(k * 100)}%`);
  }
  if (cafeNear(g, work)) {
    share += CAFE_BOOST;
    why.push(`Café next door · +${Math.round(CAFE_BOOST * 100)}%`);
  }
  return { share, why };
}

/**
 * Each kind's share of extra work from its desks' perks: the people at each
 * workplace's desks, times what that workplace gets, over everyone of the
 * kind. 0.1 is +10% to the kind. @see deskBonus
 */
export function deskShare(
  g: Grid, lead: Leadership, desks: ReadonlyMap<number, { used: number }>, owned: Partial<Record<GeneratorId, number>>,
): Partial<Record<GeneratorId, number>> {
  const out: Partial<Record<GeneratorId, number>> = {};
  for (const [id, d] of desks) {
    const s = g.structures.get(id), who = s && workplaceKind(s.def);
    if (!s || !who || !d.used || !(owned[who] ?? 0)) continue;
    const { share } = deskPerks(g, lead, s);
    if (share) out[who] = (out[who] ?? 0) + (d.used * share) / owned[who]!;
  }
  return out;
}
