/**
 * World v2 — THE MODEL'S STYLE: the town it plans leans the way the
 * generations before it ended. Pure: traits in, a style out. Each family
 * pulls once, however many of it there are:
 *  - PLANNER and SHEPHERD traits want services sooner — one for every
 *    `SERVE_KIND` lots unserved, not `SERVE_PLAIN`; shepherds keep more desks
 *    spare, so nobody waits for one;
 *  - OPTIMISER traits want them later, `SERVE_LEAN`: lots first;
 *  - PARANOID keeps `DRY_MARGIN` tiles off the water, roads and all;
 *    HYDROPHILE puts its lots by it, `WET_PULL` desirability the better;
 *  - RECURSIVE traits build outward from the Data Centre.
 * Where they pull both ways, the services meet in the middle.
 * @see planTown, nextStep, fusedInto
 */
import { trait, type TraitId } from "../../../game/traits";

export type Style = {
  /** Unserved lots a kind of service waits for. */
  serve: number;
  /** Desks kept spare before another office. */
  spareDesks: number;
  /** Tiles kept off the water; desirability added to a lot by it. */
  dryMargin: number;
  wetPull: number;
  /** Where the town grows out from. */
  centre: "workplaces" | "datacentre";
  /** The traits it came from, to say so. */
  from: TraitId[];
};

export const SERVE_PLAIN = 6;
export const SERVE_KIND = 4;
export const SERVE_LEAN = 9;
export const SPARE_PLAIN = 10;
export const SPARE_KIND = 25;
export const DRY_MARGIN = 2;
export const WET_PULL = 6;

export const PLAIN: Style = { serve: SERVE_PLAIN, spareDesks: SPARE_PLAIN, dryMargin: 0, wetPull: 0, centre: "workplaces", from: [] };

export function styleOf(traits: readonly TraitId[]): Style {
  const families = new Set(traits.map((t) => trait(t).family));
  const kind = families.has("planner") || families.has("shepherd"), lean = families.has("optimiser");
  return {
    serve: kind && lean ? SERVE_PLAIN : kind ? SERVE_KIND : lean ? SERVE_LEAN : SERVE_PLAIN,
    spareDesks: families.has("shepherd") ? SPARE_KIND : SPARE_PLAIN,
    dryMargin: traits.includes("paranoid") ? DRY_MARGIN : 0,
    wetPull: traits.includes("hydrophile") ? WET_PULL : 0,
    centre: families.has("recursive") ? "datacentre" : "workplaces",
    from: [...new Set(traits)],
  };
}

/** Whether there is water within `r` tiles of a tile. */
export function nearWater(g: { w: number; h: number; pool: ArrayLike<number> }, x: number, y: number, r: number): boolean {
  for (let v = Math.max(0, y - r); v <= Math.min(g.h - 1, y + r); v++)
    for (let u = Math.max(0, x - r); u <= Math.min(g.w - 1, x + r); u++) if (g.pool[v * g.w + u]) return true;
  return false;
}
