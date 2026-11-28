/**
 * World v2 — THE LATE LAND, as each of its landmarks opens: the Agritech Lab
 * takes the open ground round it for fields, like a farm; the Climate Lab
 * walls the worst of the bank. @see plans/farms-and-flood-walls.md §1
 */
import type { ProjectId } from "../../game/projects";
import type { Grid } from "../grid";
import { groundMode } from "../render/ground-mode";
import { AGRITECH, claimFields } from "../vegetation/tend";
import { leveeCells } from "../events/levee";

/** The most walls the Climate Lab puts up as it opens: the worst of the bank. */
export const STARTER_WALLS = 24;

type Palette = readonly (string | null)[];

/** What the map does as these projects open. */
export function landOpened(g: Grid, palette: Palette, ids: readonly ProjectId[], raise?: (cells: { x: number; y: number }[]) => void): void {
  if (ids.includes("agritech") && groundMode() === "smooth") {
    for (const s of g.structures.values()) if (s.def === AGRITECH && !s.build) claimFields(g, palette, s);
  }
  if (ids.includes("climatelab") && raise) {
    const cells = leveeCells(g, STARTER_WALLS);
    if (cells.length) raise(cells);
  }
}
