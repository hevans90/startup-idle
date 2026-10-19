/**
 * World v2 — THE MODEL'S STYLE: the town it plans leans the way the
 * generations before it ended. Pure: traits in, a style out.
 *
 * WIDE OR TALL, first: a dial from 0 (wide — long streets of cheap lots, few
 * services, beds now) to 1 (tall — compact blocks round a park, services
 * first, lots only where they will grow, towers). Every lineage starts
 * leaning tall, since a tower is fifteen starter lots on one tile and happy
 * people earn more; each trait pulls it — Hivemind hard the other way.
 * @see tallness, plans/ai-planning.md
 *
 * Then the old pulls, on top: shepherds keep more desks spare; PARANOID keeps
 * `DRY_MARGIN` tiles off the water; HYDROPHILE puts its lots by it, `WET_PULL`
 * desirability the better; recursive traits build out from the Data Centre.
 * @see planTown, nextStep, fusedInto
 */
import { trait, type TraitId } from "../../../game/traits";
import type { Tier } from "../../agents/services";

export type Style = {
  /** Wide (0) to tall (1). @see tallness */
  tall: number;
  /** Services before lots, a park at each block's heart. */
  parkFirst: boolean;
  /** Lots only where they can reach `targetTier`: on frontage a park and a café or gym reach. */
  reachOnly: boolean;
  /** The tier its houses are planned to grow to. */
  targetTier: Tier;
  /** The longest walk to a desk it plans for, or null for no limit. */
  commuteCap: number | null;
  /** Whether it pulls down low houses where something else there pays better. */
  rebuild: boolean;
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

/** Where every lineage starts on the dial, before its traits: leaning tall. */
export const TALL_BASE = 1;
/** How far each trait pulls it: quality, monuments and a short leash tall; Hivemind, packing people in, wide. */
export const TALL_PULL: Record<TraitId, number> = {
  aesthete: 1, zoner: 1, nanny: 1, patient: 1, ego: 1,
  hr: 0.5, accountant: 0.5, ruthless: 0.5, paranoid: 0.5, hydrophile: 0.5,
  mirror: 0, restless: 0, resentful: 0,
  hivemind: -3,
};
/** Unserved lots a service waits for, fully tall and fully wide. */
export const SERVE_TALL = 2;
export const SERVE_WIDE = 9;
export const SPARE_PLAIN = 10;
export const SPARE_KIND = 25;
export const DRY_MARGIN = 2;
export const WET_PULL = 6;
/** The walk to a desk tall planning keeps under: the free walk. @see FREE */
export const TALL_COMMUTE = 8;

/** Where traits put the dial, 0 (wide) to 1 (tall): the base and every trait's pull, summed, over −2 to +2. */
export function tallness(traits: readonly TraitId[]): number {
  const sum = traits.reduce((n, t) => n + TALL_PULL[t], TALL_BASE);
  return (Math.max(-2, Math.min(2, sum)) + 2) / 4;
}

export function styleOf(traits: readonly TraitId[]): Style {
  const families = new Set(traits.map((t) => trait(t).family));
  const tall = tallness(traits);
  const leans = tall >= 0.5;
  return {
    tall,
    parkFirst: leans,
    reachOnly: leans,
    targetTier: tall > 0.75 ? "landmark" : tall > 0.4 ? "t2" : "t1",
    commuteCap: leans ? TALL_COMMUTE : null,
    rebuild: leans,
    serve: Math.round(SERVE_WIDE - (SERVE_WIDE - SERVE_TALL) * tall),
    spareDesks: families.has("shepherd") ? SPARE_KIND : SPARE_PLAIN,
    dryMargin: traits.includes("paranoid") ? DRY_MARGIN : 0,
    wetPull: traits.includes("hydrophile") ? WET_PULL : 0,
    centre: families.has("recursive") ? "datacentre" : "workplaces",
    from: [...new Set(traits)],
  };
}

/** No traits at all: the base alone, leaning tall. */
export const PLAIN: Style = styleOf([]);

/** Whether there is water within `r` tiles of a tile. */
export function nearWater(g: { w: number; h: number; pool: ArrayLike<number> }, x: number, y: number, r: number): boolean {
  for (let v = Math.max(0, y - r); v <= Math.min(g.h - 1, y + r); v++)
    for (let u = Math.max(0, x - r); u <= Math.min(g.w - 1, x + r); u++) if (g.pool[v * g.w + u]) return true;
  return false;
}
