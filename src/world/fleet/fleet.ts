/**
 * World v2 — THE COMPANY'S LORRIES. A fixed fleet, kept at the yard of the
 * company's own building: so many of them, more as the building grows. A
 * load for a site, a road or a line is a lorry of the fleet — drawn up under
 * the yard's crane and loaded, driven to the work, emptied there and driven
 * home; with every lorry out, the next load waits for one to come back. What
 * comes from elsewhere — off a ship, from the Data Centre, in over the map's
 * edge — is not the fleet's and is not counted. @see plans/built-not-bought.md
 *
 * NOTHING IS KEPT. How many are out is counted off the town as it stands —
 * the lorries on the road, those being loaded, those on a line's haul track
 * — so one lost with its road is a lorry home again, and a town made new
 * (a map loaded) has its whole fleet in the yard.
 */
import { siteTrucks } from "../../game/site-trucks";
import type { Place } from "../agents/roads";
import { sendOnJob, type Mover, type Town } from "../agents/town";
import type { Grid } from "../grid";
import { YARD_DEFS } from "../landmarks/yard";

/** Lorries a yard keeps, by what the building has grown to; and what each truck the equity tree adds, adds to it. */
export const FLEET_OF: Readonly<Record<string, number>> = { garage: 4, hq: 6, boardroom: 8, ipo: 10 };
/** Seconds the yard's crane takes over a lorry's load of pallets or stone: quicker than three lengths of pipe. @see YARD_LOADING */
export const YARD_PALLETS = 2.5;
export const FLEET_PER_TRUCK = 2;

/** A load being put on a lorry in a yard: seconds it has left, where it is going and as what, and the lorry's colour if it has one of its own. */
export type YardLoad = { left: number; yard: number; from: Place; to: Place; job: NonNullable<Mover["job"]>; colour?: number };

/** Whether a place is a yard's gate: the fleet's own, and not a ship's quay or the map's edge. */
export const isYard = (g: Grid, pl: Place | null | undefined): pl is Place =>
  !!pl && pl.structure !== undefined && YARD_DEFS.includes(g.structures.get(pl.structure)?.def ?? "") && !g.structures.get(pl.structure)?.build;

/** How many lorries the company has: its yards', and the equity tree's. Nought with no yard built. */
export function fleetSize(g: Grid): number {
  let n = 0;
  for (const s of g.structures.values()) if (!s.build && YARD_DEFS.includes(s.def)) n += FLEET_OF[s.def] ?? 0;
  return n ? n + Math.max(0, siteTrucks().trucks - 1) * FLEET_PER_TRUCK : 0;
}

/** How many of them are out: on the road, under the crane, or on a line's haul track. */
export function fleetBusy(g: Grid, town: Town): number {
  let n = town.yard.length;
  for (const m of town.movers) if (m.fleet && !town.arrived.includes(m)) n++;
  for (const j of g.lineJobs) if (j.head) n += (j.yard?.length ?? 0) + (j.drive?.length ?? 0) + (j.back?.length ?? 0) + Math.max(0, j.delivered - (j.gone ?? 0));
  return n;
}
/** How many stand in the yard, free to be sent. */
export const fleetFree = (g: Grid, town: Town) => Math.max(0, fleetSize(g) - fleetBusy(g, town));

/** Seconds until a yard's crane is free: after everything already waiting on it, a line's loads among them. */
export function craneFree(g: Grid, town: Town, yard: number): number {
  let t = 0;
  for (const q of town.yard) if (q.yard === yard) t = Math.max(t, q.left);
  for (const j of g.lineJobs) if (j.depot === yard) for (const left of j.yard ?? []) t = Math.max(t, left);
  return t;
}

/** Put a load under a yard's crane: a lorry drawn up, to set off when it is loaded. @see stepYard */
export function queueYardLoad(g: Grid, town: Town, from: Place, to: Place, job: NonNullable<Mover["job"]>, colour?: number): void {
  town.yard.push({ left: YARD_PALLETS + craneFree(g, town, from.structure!), yard: from.structure!, from, to, job, ...(colour !== undefined ? { colour } : {}) });
}
/** Loads under the cranes for each job of a kind, by the job. */
export function yardQueued(town: Town, role: NonNullable<Mover["job"]>["role"]): Map<number, number> {
  const out = new Map<number, number>();
  for (const q of town.yard) if (q.job.role === role) out.set(q.job.site, (out.get(q.job.site) ?? 0) + 1);
  return out;
}

/**
 * A FRAME OF THE YARDS: each load under a crane a little nearer loaded; loaded, its lorry sets off — one of the
 * fleet. One with no way to go (its road lifted while it stood) is counted as there: the load was paid for.
 */
export function stepYard(town: Town, g: Grid, dt: number): void {
  for (let k = town.yard.length - 1; k >= 0; k--) {
    const q = town.yard[k];
    q.left -= dt;
    if (q.left > 0) continue;
    town.yard.splice(k, 1);
    const m = sendOnJob(town, g, "truck", q.from, q.to, q.job);
    if (m) { m.fleet = true; if (q.colour !== undefined) m.colour = q.colour; }
    else town.arrived.push({ job: q.job, gone: true } as Mover);
  }
}
