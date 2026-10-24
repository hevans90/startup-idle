/**
 * World v2 — THE AI KEEPS ITS DATA CENTRE COOL: which building that drinks
 * is short of water and not yet piped, the route to water for it, and laying
 * it as a main — a pump at its intake where one is needed — through the player's own
 * actions. AI mode and the company's AI both. @see routePipe, game/cooling
 */
import { buildCost, pipeCost } from "../../game/build-cost";
import { isDrinker } from "../../game/cooling";
import { mainWet, useWorldStore } from "../../state/world.store";
import { MAIN_END, idx, inBounds, type Grid, type Structure } from "../grid";
import { tankFor } from "../projects/cooling";
import { depthAt } from "../water/field";
import { layPipePath } from "../play/build-actions";
import { routePipe, type PipeRoute } from "./pipe-route";
import { outletBuilding, planMain, previewMain } from "../water/mains";
import { skillOf } from "../../state/training.store";

/** Below this share cooled, a drinker is short; and the most pipe ends the AI gives one. */
export const SHORT = 0.9;
export const MAX_INTAKES = 2;

/** Mains already feeding a building: their outlets beside it. @see outletBuilding */
export function intakesInto(g: Grid, s: Structure): number {
  let n = 0;
  for (let y = s.y - 1; y <= s.y + s.h; y++) {
    for (let x = s.x - 1; x <= s.x + s.w; x++) {
      if (!inBounds(g, x, y)) continue;
      const i = idx(g, x, y);
      if (g.mainEnd[i] === MAIN_END.outlet && outletBuilding(g, i) === s.id) n++;
    }
  }
  return n;
}

/** Water standing on a tile, and its top: from the live water where the map runs it. */
function waterReader(g: Grid) {
  const field = useWorldStore.getState().getWaterField();
  const depth = (x: number, y: number) => Math.max(g.pool[idx(g, x, y)], field ? depthAt(field, x, y) : 0);
  return {
    wet: (x: number, y: number) => depth(x, y) >= 1,
    surface: (x: number, y: number) => g.height[idx(g, x, y)] + depth(x, y),
  };
}

/** The building most in need of a pipe, and its route; null if none is short, or none can be reached. */
export function neededPipe(g: Grid): { s: Structure; route: PipeRoute; price: number } | null {
  const { wet, surface } = waterReader(g);
  const short = [...g.structures.values()]
    .filter((s) => !s.build && isDrinker(s.def))
    .map((s) => ({ s, t: tankFor(s.id) }))
    .filter(({ s, t }) => t && t.demand > 0 && t.share < SHORT && intakesInto(g, s) < MAX_INTAKES)
    .sort((a, b) => a.t!.share - b.t!.share);
  for (const { s } of short) {
    const owned = () => true;
    // TRAINED ON THE RIVER, it looks for a gravity run before settling for a pump. @see game/training
    const route = (skillOf("river") >= 1 ? routePipe(g, s, owned, wet, surface, undefined, false) : null)
      ?? routePipe(g, s, owned, wet, surface);
    if (!route) continue;
    // WHAT IT WOULD CARRY, by the same sum the tool shows: a route that would carry nothing is not laid.
    const field = useWorldStore.getState().getWaterField();
    const cells = route.pump ? [route.pump, ...route.pipe] : route.pipe;
    const plan = planMain(g, cells, mainWet(g), !!route.pump);
    if (field && !("refused" in plan) && previewMain(g, field, plan.cells, !!route.pump).flow <= 0) continue;
    const price = pipeCost(route.pipe.length).toNumber() + (route.pump ? buildCost("pump")?.toNumber() ?? Infinity : 0);
    return { s, route, price };
  }
  return null;
}

/** Lay a route as a main: from its pump — a pump intake at the water — or the water, to the building. Whether it went down. */
export function layRoute(route: PipeRoute): boolean {
  return layPipePath(route.pump ? [route.pump, ...route.pipe] : route.pipe, !!route.pump);
}
