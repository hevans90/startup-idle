/**
 * World v2 — THE NEXT BLOCK, CHOSEN: several blocks planned, and the best one
 * taken. Candidates are the nearest few blocks (`blocksAt`), each planned
 * with its park at the best heart and at the next best. Each is scored on
 * what it buys for what it costs:
 *  - TALL: the settled income it adds (`predicted − now`, by the town model),
 *    for its price;
 *  - WIDE: the beds it puts down at once, starter lots ungrown, for its price;
 * each against the best of the candidates, and blended by how tall the style
 * is. Pure: a grid in, a plan out; run in the worker. @see planTown, AI mode
 */
import { housedBy } from "../../../game/housing";
import type { Grid } from "../../grid";
import { blocksAt, inBox, planTown, type Box, type Masterplan, type PlanOptions } from "./plan";
import { roadTiles } from "./schedule";
import { PLAIN } from "./style";

type Cell = { x: number; y: number };

/** What things cost: a building by its def, and road by the tile. */
export type Prices = { defs: Record<string, number>; road: number };

/**
 * Prices as the benchmark counts them, in build units: a lot 1, a service 3,
 * an office 4, a tile of road 0.2 — for tests and for the game when it has
 * none to hand. @see benchmark
 */
export const UNIT_PRICES: Prices = { defs: { cafe: 3, park: 3, gym: 3 }, road: 0.2 };
const unitPrice = (def: string) => (housedBy(def) ? 1 : def.startsWith("office") ? 4 : 3);

/** Blocks looked at, and the park's hearts tried in each. */
export const ANCHORS = 3;
export const HEARTS = 2;

/** Why a block was taken: of how many, what it adds and what it costs. */
export type Choice = { of: number; gain: number; beds: number; cost: number; towers: number; score: number };

export type Chosen = { plan: Masterplan; box: Box; choice: Choice };

/** A plan's price: its buildings and the road it lays, on the town as it stands. */
export function planCost(g: Grid, plan: Masterplan, prices: Prices = UNIT_PRICES): number {
  let cost = 0;
  for (const s of plan.steps) {
    if (s.kind === "road") cost += roadTiles(g, s) * prices.road;
    else if (s.kind === "build") cost += prices.defs[s.def] ?? unitPrice(s.def);
  }
  return cost;
}

/** The best block to build next, planned; null with nowhere to grow. */
export function chooseBlock(
  g: Grid, owned: (x: number, y: number) => boolean, centre: Cell, tried: ReadonlySet<number>,
  o: Omit<PlanOptions, "owned" | "heart">, prices: Prices = UNIT_PRICES,
): Chosen | null {
  const style = o.style ?? PLAIN;
  const boxes = blocksAt(g, owned, centre, tried, ANCHORS);
  if (!boxes.length) return null;
  // A park's heart is a choice only where there is a park to place.
  const hearts = style.parkFirst && o.services ? HEARTS : 1;
  const tried2: { plan: Masterplan; box: Box; gain: number; beds: number; cost: number; towers: number }[] = [];
  for (const box of boxes) {
    for (let heart = 0; heart < hearts; heart++) {
      const plan = planTown(g, { ...o, owned: (x, y) => owned(x, y) && inBox(box, x, y), heart });
      const lots = plan.steps.filter((s) => s.kind === "build" && housedBy(s.def));
      // The same plan again, its heart no better: not a candidate twice.
      if (heart > 0 && tried2.some((t) => t.box === box && same(t.plan, plan))) continue;
      tried2.push({
        plan, box,
        gain: plan.predicted - plan.now,
        beds: lots.length * STARTER_BEDS,
        cost: Math.max(1e-9, planCost(g, plan, prices)),
        towers: lots.filter((s) => s.kind === "build" && s.tier && s.tier !== "t0" && s.tier !== "t1").length,
      });
    }
  }
  // Each measure against the best there is, so tall and wide blend on one scale.
  const bestGain = Math.max(1e-9, ...tried2.map((t) => t.gain / t.cost));
  const bestBeds = Math.max(1e-9, ...tried2.map((t) => t.beds / t.cost));
  const scored = tried2.map((t) => ({ ...t, score: style.tall * (t.gain / t.cost / bestGain) + (1 - style.tall) * (t.beds / t.cost / bestBeds) }));
  // Ties to the nearest, as `blockAt` would have it.
  const best = scored.reduce((a, b) => (b.score > a.score + 1e-9 ? b : a));
  return { plan: best.plan, box: best.box, choice: { of: scored.length, gain: best.gain, beds: best.beds, cost: best.cost, towers: best.towers, score: best.score } };
}

/** Beds a starter lot has. */
const STARTER_BEDS = 2;

const same = (a: Masterplan, b: Masterplan) => JSON.stringify(a.steps) === JSON.stringify(b.steps);
