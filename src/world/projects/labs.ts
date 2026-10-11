/**
 * World v2 — R&D LABS: innovation on the map, the way housing put beds there.
 * Each lab standing adds a share to every kind's innovation, twice as much
 * near the campus or the Data Centre, where the 10x devs are. @see labBonus
 */
import type { Grid, Structure } from "../grid";

/** What a lab adds to innovation, and twice that within LAB_REACH tiles of the campus or Data Centre. */
export const LAB_SHARE = 0.1;
export const LAB_REACH = 10;
const HUBS = new Set(["campus", "datacentre"]);

/** Tiles between two footprints, edge to edge. */
const gap = (a: Structure, b: Structure) =>
  Math.max(
    Math.max(0, b.x - (a.x + a.w - 1), a.x - (b.x + b.w - 1)),
    Math.max(0, b.y - (a.y + a.h - 1), a.y - (b.y + b.h - 1)),
  );

/** Whether a lab stands near a hub. */
export const nearHub = (g: Grid, lab: Structure) =>
  [...g.structures.values()].some((h) => HUBS.has(h.def) && !h.build && gap(lab, h) <= LAB_REACH);

/** The labs standing, and what they multiply innovation by. */
export function labReading(g: Grid): { count: number; mult: number } {
  let count = 0, share = 0;
  for (const s of g.structures.values()) {
    if (s.def !== "lab" || s.build) continue;
    count++;
    share += nearHub(g, s) ? 2 * LAB_SHARE : LAB_SHARE;
  }
  return { count, mult: 1 + share };
}
