/**
 * World v2 — THE MASTERPLAN, planned off the main thread: a whole town's
 * layout is a few hundred milliseconds of searching, and a frame is sixteen.
 * A saved map and what the company can build in, in; the plan, out.
 * @see planTown, requestPlan
 */
import { deserializeWorld } from "../../io/serialize";
import { ownsTile } from "../../land";
import type { GeneratorId } from "../../../state/generators.store";
import { planTown } from "./plan";
import type { Style } from "./style";

export type PlanRequest = { id: number; file: unknown; land: number[] | null; kinds: GeneratorId[]; services: boolean; offices: boolean; style: Style };

self.onmessage = (e: MessageEvent<PlanRequest>) => {
  const { id, file, land, kinds, services, offices, style } = e.data;
  const { grid } = deserializeWorld(file);
  const plan = planTown(grid, { owned: (x, y) => ownsTile(grid, land, x, y), kinds, services, offices, style });
  (self as unknown as Worker).postMessage({ id, plan });
};
