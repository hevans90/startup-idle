/**
 * World v2 — THE NEXT BLOCK, planned off the main thread: several blocks'
 * layouts, each settled by the town model, are a few hundred milliseconds of
 * searching, and a frame is sixteen. A saved map and what the company can
 * build in, in; the block chosen, out. @see chooseNext, requestPlan
 */
import { deserializeWorld } from "../../io/serialize";
import { chooseNext, type PlanReply, type PlanRequest } from "./choose";

self.onmessage = (e: MessageEvent<PlanRequest>) => {
  const { id, file, kinds, offices, style, centre, tried, prices } = e.data;
  const { grid } = deserializeWorld(file);
  const chosen = chooseNext(grid, centre, tried, kinds, offices, style, prices);
  (self as unknown as Worker).postMessage({ id, chosen } satisfies PlanReply);
};
