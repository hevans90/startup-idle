/**
 * World v2 — THE NEXT BLOCK, AND ANY REBUILD ABOUT IT: what the planning
 * worker works out, here so the main thread can work it out too, where there
 * is no worker. @see chooseBlock, replacementFor, masterplan.worker
 */
import type { GeneratorId } from "../../../state/generators.store";
import type { Grid } from "../../grid";
import { ownsTile } from "../../land";
import { chooseBlock, type Chosen, type Prices } from "./lookahead";
import { replacementFor } from "./replace";
import type { Style } from "./style";

export type PlanRequest = {
  id: number; file: unknown; land: number[] | null; kinds: GeneratorId[]; services: boolean; offices: boolean; style: Style;
  /** Where the town is; street tiles of blocks that came to nothing; what things cost; money a second. */
  centre: { x: number; y: number }; tried: number[]; prices: Prices; income: number;
};
export type PlanReply = { id: number; chosen: Chosen | null };

/** The block chosen, with the rebuild about it that pays best, if one does, ahead of its steps. */
export function chooseWithRebuild(
  g: Grid, land: number[] | null, centre: { x: number; y: number }, tried: number[], kinds: GeneratorId[],
  services: boolean, offices: boolean, style: Style, prices: Prices, income: number,
): Chosen | null {
  const owned = (x: number, y: number) => ownsTile(g, land, x, y);
  const chosen = chooseBlock(g, owned, centre, new Set(tried), { kinds, services, offices, style }, prices);
  if (!chosen) return null;
  const r = replacementFor(g, chosen.box, owned, { kinds, services, style }, income, prices);
  return r ? { ...chosen, plan: { ...chosen.plan, steps: [r, ...chosen.plan.steps] } } : chosen;
}
