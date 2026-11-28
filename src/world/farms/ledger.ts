/**
 * World v2 — WHAT EACH FARM HAS DONE LATELY: its last harvest's pay, kept for
 * its label. Live state of the session, not saved. @see infoFor
 */
import type { Grid, Structure } from "../grid";
import { useCalendarStore } from "../../state/calendar.store";
import { YEAR_SECONDS } from "../calendar";
import { SEASON_NAMES, nextHarvest } from "../vegetation/crops";
import { fieldsBy } from "../vegetation/tend";
import { dairy, dairyOf } from "./oat-milk";
import { processorBusy } from "../slop/tanks";

/** A farm's last harvest, paid: how much, by its id. */
export const lastPay = new Map<number, number>();

let kept: { grid: Grid; rev: number; veg: number; by: Map<number, number> } | null = null;
/** Each farm's fields, by its id, kept till the map or the fields change. */
export function farmFields(g: Grid): Map<number, number> {
  if (!kept || kept.grid !== g || kept.rev !== g.rev || kept.veg !== g.veg.rev) kept = { grid: g, rev: g.rev, veg: g.veg.rev, by: fieldsBy(g) };
  return kept.by;
}

export type FarmInfo = {
  fields: number;
  /** The season cut next, and in how many seconds of play; null while Seasons is off. */
  next: { season: string; in: number | null };
  last: number | null;
  /** Its oat milk. @see dairyOf */
  dairy: ReturnType<typeof dairyOf>;
  /** How busy its compost heap is, 0–1: slop from a sewer. @see COMPOST_MOST */
  compost: number;
};

/** What a farm's label says. */
export function farmInfo(g: Grid, s: Structure, wall = Date.now()): FarmInfo {
  const cal = useCalendarStore.getState(), t = cal.now(wall);
  const n = nextHarvest(t);
  return {
    fields: farmFields(g).get(s.id) ?? 0,
    next: { season: SEASON_NAMES[n.season], in: cal.at === null ? null : (n.at - t) * YEAR_SECONDS },
    last: lastPay.get(s.id) ?? null,
    dairy: dairyOf(dairy, g, s.id),
    compost: processorBusy(s.id),
  };
}
