/**
 * World v2 — THE TOWN MODEL: what a town would earn once it has settled, from
 * the game's own rules, without running it. Every house grown to the tier its
 * desirability earns and full; everyone seated at the nearest free desk, the
 * walk counted, climbs and all; the rest working without one. What comes out
 * is the day's work it would do — beds times what the walk to work leaves —
 * which is what income follows. The masterplanner's measure of a layout.
 * @see planTown, plans/singularity.md §4b
 *
 * IT CHANGES THE GRID IT IS GIVEN (houses grown, people moved in): hand it a
 * copy. @see cloneGrid
 */
import { housedBy } from "../../../game/housing";
import { serializeWorld, deserializeWorld } from "../../io/serialize";
import type { Grid } from "../../grid";
import { createNetwork } from "../../roads/network";
import { placesOf } from "../../agents/roads";
import { desireAt, desireMapsOf } from "../../agents/desirability";
import { GROW_AT } from "../../agents/mood-rules";
import { seat } from "../../agents/commute";
import { withTier } from "../../agents/services";

/** A copy of a grid, to plan on. */
export const cloneGrid = (g: Grid): Grid =>
  deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(g, { terrain: [], paved: [null] })))).grid;

/** The tier a desirability grows a house to. */
const tierFor = (total: number) =>
  total >= GROW_AT.landmark ? "landmark" : total >= GROW_AT.t2 ? "t2" : total >= GROW_AT.t1 ? "t1" : "t0";

/** What a settled town comes to: its beds, and the day's work its people would do. */
export function settledTown(g: Grid): { beds: number; work: number } {
  const net = createNetwork(g);
  const maps = desireMapsOf(g, placesOf(g, net));
  let beds = 0;
  for (const s of g.structures.values()) {
    const h = housedBy(s.def);
    if (!h || s.build) continue;
    const d = desireAt(g, maps, s.x, s.y, h.id)?.total ?? 0;
    s.def = withTier(s.def, tierFor(d));
    const grown = housedBy(s.def)!;
    s.residents = grown.slots;
    beds += grown.slots;
  }
  const { commutes } = seat(g, placesOf(g, createNetwork(g)));
  let work = 0;
  for (const s of g.structures.values()) {
    if (!housedBy(s.def)) continue;
    work += (s.residents ?? 0) * (commutes.get(s.id)?.eff ?? 1);
  }
  return { beds, work };
}
