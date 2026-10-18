/**
 * World v2 — WHAT ON THE MAP CAN BE CLICKED: a finished building that opens
 * something — the HQ the innovation tab, the studio the employees, the Data
 * Centre its control room. Hovered in the game, it lights up and takes the
 * click from whatever tool is in hand (but the demolish tool, which is for
 * buildings). @see company-map's lookedAt handler, the scene's picking
 */
import { projectForStructure } from "../../game/projects";
import type { ToolId } from "../edit/tools";

/** Whether a structure, as it stands, opens something when clicked. */
export function opensSomething(def: string, build: unknown): boolean {
  if (build) return false;
  const p = projectForStructure(def);
  return !!p && (p.id === "datacentre" || !!p.opens);
}

/** Whether, with this tool in hand, a building that opens something takes the click. */
export const clickTakesOver = (tool: ToolId) => tool !== "demolish";
