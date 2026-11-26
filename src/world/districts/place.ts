/**
 * A DISTRICT BUILT AT ONCE: its join to the town and its roads paved, every
 * building on its lots finished and lived in — the head start's, not the
 * pilot's, which orders and waits as a player does. Through the player's own
 * tools, so the ground is graded and bridged as theirs is; off their history.
 * Free only while the company is not yet playing: at its founding. @see layoutDistrict
 */
import { useWorldStore } from "../../state/world.store";
import { paveRoad } from "../play/build-actions";
import type { DistrictPlan } from "./layout";
import { runsOf, type Cell } from "./route";

export type Placed = { roads: number; ids: number[]; refused: string[] };

export function placeDistrictNow(plan: DistrictPlan, connector: readonly Cell[] | null = null): Placed {
  const st = useWorldStore.getState();
  let roads = 0;
  for (const r of [...(connector ? runsOf(connector) : []), ...plan.runs]) if (paveRoad(r.from, r.to)) roads++;
  const ids: number[] = [];
  const refused: string[] = [];
  for (const b of plan.buildings) {
    const id = st.townPlace(b.def, b.x, b.y);
    if (id === null) refused.push(`${b.def}@${b.x},${b.y}`);
    else ids.push(id);
  }
  useWorldStore.getState().forgetHistory();
  return { roads, ids, refused };
}
