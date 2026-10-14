/**
 * World v2 — WHAT EACH STREET EARNS, NOW: the workplaces' people's income
 * (as their "+$X" floaters share it out) and the seaports' calls, by the
 * street each opens onto. For the Earnings overlay and the acquirer's offer.
 * @see streetEarnings, payday
 */
import { getExports, getNetwork, useWorldStore } from "../../state/world.store";
import { placesOf } from "../agents/roads";
import { perMinute } from "../boats/exports";
import { idx, type Grid } from "../grid";
import { streetEarnings, streetsOf, type StreetEarning, type Streets } from "../roads/streets";
import { structureDef } from "../structures/def";
import { payday } from "./payday";

let memo: { g: Grid | null; rev: number; streets: Streets | null; doors: Map<number, number> } = {
  g: null, rev: -1, streets: null, doors: new Map(),
};

/** The map's streets and every building's door tile, worked out again when the map changes. */
export function liveStreets(): { g: Grid; streets: Streets; doors: Map<number, number> } | null {
  const g = useWorldStore.getState().grid, net = getNetwork();
  if (!net) return null;
  if (memo.g !== g || memo.rev !== g.rev || !memo.streets) {
    const doors = new Map<number, number>();
    for (const p of placesOf(g, net)) if (p.kind === "door" && p.structure !== undefined) doors.set(p.structure, idx(g, p.x, p.y));
    memo = { g, rev: g.rev, streets: streetsOf(g), doors };
  }
  return { g, streets: memo.streets!, doors: memo.doors };
}

/** Each street's earnings a second, best first. */
export function liveStreetEarnings(): StreetEarning[] {
  const live = liveStreets();
  if (!live) return [];
  const earning = new Map<number, number>();
  for (const p of payday(1000)) earning.set(p.structure, p.amount);
  const ex = getExports(), now = performance.now();
  for (const id of ex.recent.keys()) earning.set(id, (earning.get(id) ?? 0) + perMinute(ex, id, now) / 60);
  return streetEarnings(live.g, live.streets, live.doors, earning);
}

/** A street as the player knows it: by its biggest earner. */
export function streetName(e: StreetEarning): string {
  const s = useWorldStore.getState().grid.structures.get(e.best);
  const name = s ? structureDef(s.def)?.name ?? s.def : "nowhere";
  return `the street by the ${name.replace(/^seaport/, "Seaport")}`;
}
