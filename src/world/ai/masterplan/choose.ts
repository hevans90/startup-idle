/**
 * World v2 — THE NEXT BLOCK: what the planning worker works out, here so the
 * main thread can work it out too, where there is no worker. @see chooseBlock,
 * masterplan.worker
 */
import type { GeneratorId } from "../../../state/generators.store";
import type { Grid } from "../../grid";
import { chooseBlock, type Chosen, type Prices } from "./lookahead";
import type { Style } from "./style";

export type PlanRequest = {
  id: number; file: unknown; kinds: GeneratorId[]; offices: boolean; style: Style;
  /** Where the town is; street tiles of blocks that came to nothing; what things cost. */
  centre: { x: number; y: number }; tried: number[]; prices: Prices;
};
export type PlanReply = { id: number; chosen: Chosen | null };

/** The block chosen, planned. */
export function chooseNext(
  g: Grid, centre: { x: number; y: number }, tried: number[], kinds: GeneratorId[], offices: boolean, style: Style, prices: Prices,
): Chosen | null {
  // The whole map is the company's to build on.
  return chooseBlock(g, () => true, centre, new Set(tried), { kinds, offices, style }, prices);
}
