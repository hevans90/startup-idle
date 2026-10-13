/**
 * World v2 — AI RACKS on the map: how many agents they can run, and how many
 * of those at full power — within reach of the Data Centre. @see game/agents
 */
import { AGENTS_A_RACK, RACK_RANGE } from "../../game/agents";
import type { Grid, Structure } from "../grid";

/** Tiles between two footprints, edge to edge. */
const gap = (a: Structure, b: Structure) =>
  Math.max(
    Math.max(0, b.x - (a.x + a.w - 1), a.x - (b.x + b.w - 1)),
    Math.max(0, b.y - (a.y + a.h - 1), a.y - (b.y + b.h - 1)),
  );

/** Whether a rack is powered: a finished Data Centre within reach. */
export const powered = (g: Grid, rack: Structure) =>
  [...g.structures.values()].some((d) => d.def === "datacentre" && !d.build && gap(rack, d) <= RACK_RANGE);

/** The agents the racks standing can run, at full power and at half. */
export function rackReading(g: Grid): { powered: number; unpowered: number } {
  let on = 0, off = 0;
  for (const s of g.structures.values()) {
    if (s.def !== "rack" || s.build) continue;
    if (powered(g, s)) on += AGENTS_A_RACK;
    else off += AGENTS_A_RACK;
  }
  return { powered: on, unpowered: off };
}
