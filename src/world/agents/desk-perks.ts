/**
 * World v2 — WHAT A WORKPLACE'S DESKS GET FROM WHERE IT IS: coffee next door
 * — a café or a kombucha bar, in a building or a ground floor — a share more
 * work from the people at its desks, shown on its label. Who leads it is said beside, and what
 * a leader does is game/leaders'.
 * @see deskShare, deskBonus
 */
import type { GeneratorId } from "../../state/generators.store";
import type { Grid, Structure } from "../grid";
import { workplaceKind } from "./commute";
import { serviceDef } from "./needs";
import { serviceIn } from "./services";
import type { Leadership } from "./leaders";

/** What coffee within `CAFE_REACH` tiles adds to a workplace's desks. One counts, however many. */
export const CAFE_BOOST = 0.1;
export const CAFE_REACH = 3;

/** Tiles between two footprints, edge to edge. */
const gap = (a: Structure, b: Structure) =>
  Math.max(Math.max(0, b.x - (a.x + a.w - 1), a.x - (b.x + b.w - 1)), Math.max(0, b.y - (a.y + a.h - 1), a.y - (b.y + b.h - 1)));

/** Whether coffee is served near enough a workplace. */
export function cafeNear(g: Grid, at: Structure): boolean {
  for (const s of g.structures.values()) {
    if (s.build || gap(s, at) > CAFE_REACH) continue;
    const sv = serviceIn(s);
    if (sv && serviceDef(sv)!.need === "coffee") return true;
  }
  return false;
}

/** What a workplace's desks get: the share more work, and why. */
export function deskPerks(g: Grid, lead: Leadership, work: Structure): { share: number; why: string[] } {
  const why: string[] = [];
  let share = 0;
  const names = lead.leads.get(work.id);
  if (names?.length) why.push(`Led by ${names.join(" & ")}`);
  if (cafeNear(g, work)) {
    share += CAFE_BOOST;
    why.push(`Coffee next door · +${Math.round(CAFE_BOOST * 100)}%`);
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
