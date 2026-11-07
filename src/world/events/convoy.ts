/**
 * World v2 — WHAT A CONVOY'S CALLS PAY: double, and treble at a port within
 * `CONFERENCE_REACH` tiles of a standing Conference Centre — the deals are
 * done next door. Shown on the port's label and on the Conference Centre's
 * ghost. @see stepOpportunities "convoy"
 */
import { useSessionStore } from "../../state/session.store";
import type { Grid, Structure } from "../grid";

export const CONVOY_PAYS = 2;
export const NEAR_CONFERENCE_PAYS = 3;
export const CONFERENCE_REACH = 10;

/** Tiles between two footprints, edge to edge. */
const gap = (a: Structure, b: Structure) =>
  Math.max(Math.max(0, b.x - (a.x + a.w - 1), a.x - (b.x + b.w - 1)), Math.max(0, b.y - (a.y + a.h - 1), a.y - (b.y + b.h - 1)));

/** Whether a standing Conference Centre is near enough a port. */
export function conferenceNear(g: Grid, port: Structure): boolean {
  for (const s of g.structures.values()) if (s.def === "conference" && !s.build && gap(s, port) <= CONFERENCE_REACH) return true;
  return false;
}

/** What a convoy multiplies a call at this port by. */
export const convoyPays = (g: Grid, port: Structure) => (conferenceNear(g, port) ? NEAR_CONFERENCE_PAYS : CONVOY_PAYS);

/** The ports a Conference Centre at `at` would be near. */
export const portsNear = (g: Grid, at: Structure, isPort: (s: Structure) => boolean) =>
  [...g.structures.values()].filter((s) => isPort(s) && gap(s, at) <= CONFERENCE_REACH);

/**
 * A CONVOY BRINGS MATERIALS: while one is in, a building site's loads come
 * off it at the port, at half price; and every regular route it has left
 * takes a tenth off a load, for good. @see ROUTE_BONUS, depotFor
 */
export const CONVOY_LOADS = 0.5;
export const ROUTE_LOADS = 0.1;
let convoyIn = false;
/** Whether a convoy is in now: the scene's to say. */
export const setConvoyIn = (on: boolean) => { convoyIn = on; };
export const convoyIsIn = () => convoyIn;
/** What a load costs now, against its usual price: the convoy in, and the routes won. */
export const loadPriceMult = () => (convoyIn ? CONVOY_LOADS : 1) * Math.max(0, 1 - ROUTE_LOADS * (useSessionStore.getState().routes ?? 0));
