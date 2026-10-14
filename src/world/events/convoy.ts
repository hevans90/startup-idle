/**
 * World v2 — WHAT A CONVOY'S CALLS PAY: double, and treble at a port within
 * `CONFERENCE_REACH` tiles of a standing Conference Centre — the deals are
 * done next door. Shown on the port's label and on the Conference Centre's
 * ghost. @see stepOpportunities "convoy"
 */
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
