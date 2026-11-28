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
import { serviceOpen } from "./unlocks";
import { OAT_BOOST, OAT_REACH, cafeStock, dairy } from "../farms/oat-milk";

/** What coffee within `CAFE_REACH` tiles adds to a workplace's desks. One counts, however many. */
export const CAFE_BOOST = 0.1;
export const CAFE_REACH = 3;

/** Tiles between two footprints, edge to edge. */
const gap = (a: Structure, b: Structure) =>
  Math.max(Math.max(0, b.x - (a.x + a.w - 1), a.x - (b.x + b.w - 1)), Math.max(0, b.y - (a.y + a.h - 1), a.y - (b.y + b.h - 1)));

/**
 * Whether coffee is served near enough a workplace: "oat" from a café with oat milk in, which reaches further;
 * "plain"; or null. @see world/farms/oat-milk
 */
export function cafeNear(g: Grid, at: Structure): "oat" | "plain" | null {
  let near: "plain" | null = null;
  for (const s of g.structures.values()) {
    const d = gap(s, at);
    if (s.build || d > Math.max(CAFE_REACH, OAT_REACH)) continue;
    const sv = serviceIn(s);
    if (!sv || !serviceOpen(g, sv) || serviceDef(sv)!.need !== "coffee") continue;
    if (d <= OAT_REACH && cafeStock(dairy, s.id) > 0) return "oat";
    if (d <= CAFE_REACH) near = "plain";
  }
  return near;
}

/** What a workplace's desks get: the share more work, and why. */
export function deskPerks(g: Grid, lead: Leadership, work: Structure): { share: number; why: string[] } {
  const why: string[] = [];
  let share = 0;
  const names = lead.leads.get(work.id);
  if (names?.length) why.push(`Led by ${names.join(" & ")}`);
  const coffee = cafeNear(g, work);
  if (coffee === "oat") {
    share += OAT_BOOST;
    why.push(`Oat flat whites · +${Math.round(OAT_BOOST * 100)}%`);
  } else if (coffee) {
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
