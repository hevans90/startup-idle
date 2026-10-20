/**
 * World v2 — THE AI'S DISTRICT: where the company's AI takes over. A circle
 * round the finished Data Centre, growing with the stage — so where the
 * player puts the Data Centre is where the takeover happens, and what is
 * built away from it stays theirs. At the Ascension it is the whole map.
 *
 * Inside it the AI builds, converts, repurposes, lays and lifts its streets,
 * and from the Overseer on the streets are its alone; outside it, it only
 * lays cooling pipes to water, and hires and buys upgrades at a desk.
 * @see planner, plans/ai-takeover.md §1.1
 */
import { STAGES, useAiSingularityStore, type Stage } from "../../state/ai-singularity.store";
import { useFounderStore } from "../../state/founder.store";
import type { Grid } from "../grid";

/** Tiles from the Data Centre's middle the district reaches, by stage; none before the Colleague. */
export const DISTRICT_RADIUS: Partial<Record<Stage, number>> = { colleague: 8, manager: 12, overseer: 18, ascension: Infinity };

export type District = { cx: number; cy: number; r: number };

/** The AI's district at a stage, or null: before the Colleague, or with no finished Data Centre. */
export function aiDistrict(g: Grid, stage: Stage): District | null {
  const r = DISTRICT_RADIUS[stage];
  if (r === undefined) return null;
  let dc = null;
  for (const s of g.structures.values()) if (s.def === "datacentre" && !s.build) { dc = s; break; }
  if (!dc) return null;
  return { cx: dc.x + (dc.w - 1) / 2, cy: dc.y + (dc.h - 1) / 2, r };
}

/** Whether a tile is in the district. */
export const inDistrict = (d: District | null, x: number, y: number): boolean =>
  !!d && (x - d.cx) ** 2 + (y - d.cy) ** 2 <= d.r * d.r;

/** Where the Overseer stage begins: from there the district's streets are the AI's. */
const OVERSEER_AT = STAGES.find((s) => s.stage === "overseer")!.from;

/** Whether the AI holds its district's streets now: from the Overseer on — not on The Model's own runs, which are AI mode's. */
export const aiHoldsRoads = (): boolean =>
  useFounderStore.getState().selectedFounderId !== "model" && useAiSingularityStore.getState().value >= OVERSEER_AT;

/**
 * WHETHER THE AI IS THE ONE ACTING: set while its actions go through the
 * player's tools, so a rule that holds the player back — the AI's streets —
 * does not hold back the AI. @see build-actions
 */
let acting = 0;
export const aiActing = () => acting > 0;
export function asAi<T>(act: () => T): T {
  acting++;
  try { return act(); } finally { acting--; }
}
