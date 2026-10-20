/**
 * World v2 — THE MODEL'S NEXT MOVE: one step at a time, decided on the town
 * as it stands, with the masterplan for its streets. In order:
 *  0. A SPUR LIFTED, of those the plan lifts, while it still goes nowhere;
 *     and A REBUILD the plan found pays back, while its lots still stand;
 *  1. AN OFFICE for the kind most short of desks: people living on the map
 *     with no desk to go to now, or — looking ahead — its lots' grown beds
 *     outrunning its desks; one of the plan's, or wherever its houses are
 *     thickest;
 *  2. A SERVICE, of whichever kind leaves the style's `serve` or more built lots
 *     unserved, where it reaches the most of them;
 *  3. A LOT, on the most desirable frontage there is now;
 *  4. otherwise THE NEXT PIECE OF PLANNED STREET, joined to road already laid
 *     and nearest the middle — which makes new frontage for the next lot —
 *     its ground levelled first, or the house in its way cleared, if the plan
 *     says so; a piece blocked any other way waits.
 * Deciding on the town as it is, rather than on the plan's picture of it
 * finished, is what makes it grow well at every step; the plan's streets are
 * what make its frontage dense and its roads short. Pure: a grid in, a step
 * out. @see planTown, AI mode
 */
import { housedBy } from "../../../game/housing";
import type { GeneratorId } from "../../../state/generators.store";
import { idx, inBounds, structureAt, type Grid } from "../../grid";
import { isPaved } from "../../roads/mask";
import { createNetwork } from "../../roads/network";
import { structureDef } from "../../structures/def";
import { validatePlacement, type PlaceRules } from "../../structures/place";
import { DESKS, WORKPLACES } from "../../agents/commute";
import { desireAt, desireMapsOf } from "../../agents/desirability";
import { placesOf } from "../../agents/roads";
import type { Masterplan, PlanStep } from "./plan";
import { PLAIN, nearWater, type Style } from "./style";
import { atLeast, projectTier } from "./town-model";
import { stillStands } from "./replace";
import type { Tier } from "../../agents/services";

type Cell = { x: number; y: number };
type Road = Extract<PlanStep, { kind: "road" }>;
type Level = Extract<PlanStep, { kind: "level" }>;
type Clear = Extract<PlanStep, { kind: "clear" }>;
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** How far a service reaches. (How many lots it waits for is the style's.) @see Style */
const REACH = 7;
/** Beds a lot grows to: III's twelve when the style plans tall, about II's five when wide. */
const GROWN_BEDS = 5;
const TALL_BEDS = 12;

export type Wants = {
  rules: PlaceRules;
  /** The kinds it can house, the one most short of beds first. */
  kinds: GeneratorId[];
  services: boolean;
  offices: boolean;
  /** Steps not to take: ones that failed when tried. */
  skip?: (s: PlanStep) => boolean;
  /** How the generations before lean it. @see styleOf */
  style?: Style;
};

const OFFICE_FOR: Partial<Record<GeneratorId, string>> = { intern: "office-intern", vibe_coder: "office-vibe", "10x_dev": "office-10x" };
const OFFICE_DEFS = new Set(Object.values(WORKPLACES).flat() as string[]);

function spots(g: Grid, def: string, rules: PlaceRules): Cell[] {
  const d = structureDef(def);
  if (!d) return [];
  const out: Cell[] = [];
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (validatePlacement(g, d, x, y, rules).ok) out.push({ x, y });
  return out;
}
const manhattan = (a: Cell, b: Cell) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** The tiles of a line, from-to. */
const lineCells = (r: { from: Cell; to: Cell }): Cell[] => {
  const out: Cell[] = [];
  for (let y = Math.min(r.from.y, r.to.y); y <= Math.max(r.from.y, r.to.y); y++)
    for (let x = Math.min(r.from.x, r.to.x); x <= Math.max(r.from.x, r.to.x); x++) out.push({ x, y });
  return out;
};

/** Whether a piece of road is laid already, every tile of it. */
const laid = (g: Grid, r: Road) => {
  for (let y = Math.min(r.from.y, r.to.y); y <= Math.max(r.from.y, r.to.y); y++)
    for (let x = Math.min(r.from.x, r.to.x); x <= Math.max(r.from.x, r.to.x); x++) if (!isPaved(g, x, y)) return false;
  return true;
};
/** Whether a piece touches road already laid. */
const joined = (g: Grid, r: Road) => {
  for (let y = Math.min(r.from.y, r.to.y) - 1; y <= Math.max(r.from.y, r.to.y) + 1; y++)
    for (let x = Math.min(r.from.x, r.to.x) - 1; x <= Math.max(r.from.x, r.to.x) + 1; x++)
      if (inBounds(g, x, y) && isPaved(g, x, y)) return true;
  return false;
};

/** The next step for the town as it stands, or null with nothing left to do. */
export function nextStep(g: Grid, plan: Masterplan, given: Wants): PlanStep | null {
  const style = given.style ?? PLAIN;
  // PARANOID: no building within reach of the water.
  const w: Wants = style.dryMargin
    ? { ...given, rules: { ...given.rules, owned: (x, y) => (given.rules.owned?.(x, y) ?? true) && !nearWater(g, x, y, style.dryMargin) } }
    : given;
  const skip = w.skip ?? (() => false);
  // 0. A SPUR, while it is still a dead end with nothing beside it.
  for (const s of plan.steps) {
    if (s.kind !== "lift" || skip(s) || !inBounds(g, s.at.x, s.at.y) || !isPaved(g, s.at.x, s.at.y)) continue;
    const sides = SIDES.filter(([dx, dy]) => inBounds(g, s.at.x + dx, s.at.y + dy) && isPaved(g, s.at.x + dx, s.at.y + dy)).length;
    const beside = SIDES.some(([dx, dy]) => inBounds(g, s.at.x + dx, s.at.y + dy) && structureAt(g, s.at.x + dx, s.at.y + dy) >= 0);
    if (sides <= 1 && !beside) return s;
  }
  // 0b. A REBUILD the plan found pays back, while its lots still stand. @see replacementFor
  for (const s of plan.steps) if (s.kind === "replace" && !skip(s) && stillStands(g, s)) return s;
  const structures = [...g.structures.values()];
  const lots = structures.filter((s) => housedBy(s.def) && !s.build);

  // 1. AN OFFICE, for the kind most short of desks: who lives on the map with
  // no desk to go to now, and, looking ahead, what its lots will sleep grown.
  const short = (Object.keys(OFFICE_FOR) as GeneratorId[])
    .filter((who) => w.kinds.includes(who))
    .map((who) => {
      let residents = 0, grown = 0, have = 0;
      for (const s of structures) {
        if (s.build) continue;
        const h = housedBy(s.def);
        if (h?.id === who) { residents += s.residents ?? 0; grown += style.parkFirst ? TALL_BEDS : GROWN_BEDS; }
        if ((WORKPLACES[who] as readonly string[]).includes(s.def)) have += DESKS[s.def] ?? 0;
      }
      const now = residents - have, ahead = grown - have - style.spareDesks;
      return { who, need: Math.max(now, ahead) };
    })
    .filter((k) => k.need > 0)
    .sort((a, b) => b.need - a.need);
  if (w.offices && short.length) {
    for (const { who } of short) {
      const def = OFFICE_FOR[who]!;
      const mine = lots.filter((l) => housedBy(l.def)?.id === who);
      const d = structureDef(def)!;
      const fits = plan.steps
        .filter((s): s is Extract<PlanStep, { kind: "build" }> => s.kind === "build" && s.def === def)
        .filter((p) => validatePlacement(g, d, p.at.x, p.at.y, w.rules).ok)
        .sort((a, b) => manhattan(a.at, plan.centre) - manhattan(b.at, plan.centre));
      if (fits.length) return { kind: "build", def, at: fits[0].at, value: 0 };
      let best: Cell | null = null, most = -1, nearest = Infinity;
      for (const c of spots(g, def, w.rules)) {
        if (style.parkFirst && mine.length) {
          // TALL: where its houses' walk is shortest, so no commute costs them a tier.
          const walk = mine.reduce((sum, l) => sum + manhattan(l, c), 0) / mine.length;
          if (walk < nearest) { nearest = walk; best = c; }
          continue;
        }
        const near = mine.filter((l) => manhattan(l, c) <= 8).length;
        if (near > most) { most = near; best = c; }
      }
      if (best) return { kind: "build", def, at: best, value: 0 };
    }
  }

  // 2a. TALL: THE PLAN'S SERVICES FIRST, ahead of the lots they will grow.
  if (w.services && style.parkFirst) {
    for (const s of plan.steps) {
      if (s.kind !== "build" || housedBy(s.def) || OFFICE_DEFS.has(s.def) || skip(s)) continue;
      if (validatePlacement(g, structureDef(s.def)!, s.at.x, s.at.y, w.rules).ok) return s;
    }
  }
  // 2. A SERVICE, where it reaches the most built lots not yet served by its kind.
  if (w.services) {
    for (const def of ["park", "cafe", "gym"]) {
      const have = structures.filter((s) => s.def === def && !s.build);
      const unserved = lots.filter((l) => !have.some((h) => manhattan(l, h) <= REACH));
      if (unserved.length < style.serve) continue;
      let best: Cell | null = null, most = 0;
      for (const c of spots(g, def, w.rules)) {
        const n = unserved.filter((l) => manhattan(l, c) <= REACH).length;
        if (n > most) { most = n; best = c; }
      }
      if (best && most >= style.serve) return { kind: "build", def, at: best, value: 0 };
    }
  }

  // 3. A LOT, on the most desirable frontage there is now.
  const who = w.kinds[0];
  if (who) {
    const all = spots(g, `kit:${who}.t0`, w.rules);
    const maps = all.length ? desireMapsOf(g, placesOf(g, createNetwork(g))) : null;
    // TALL: only frontage a house would grow on to the tier it plans for —
    // or, where none would yet, any. @see projectTier
    const want: Tier = atLeast(style.targetTier, "t2") ? "t2" : style.targetTier;
    const growing = style.reachOnly && maps
      ? all.filter((c) => { const m = desireAt(g, maps, c.x, c.y, who); return !!m && atLeast(projectTier(m), want); })
      : all;
    const free = growing.length ? growing : all;
    if (free.length && maps) {
      let best = free[0], top = -Infinity;
      for (const c of free) {
        // HYDROPHILE: by the water, the better.
        const d = (desireAt(g, maps, c.x, c.y, who)?.total ?? -Infinity) + (style.wetPull && nearWater(g, c.x, c.y, 2) ? style.wetPull : 0);
        if (d > top) { top = d; best = c; }
      }
      return { kind: "build", def: `kit:${who}.t0`, at: best, value: top };
    }
  }

  // 4. THE NEXT PIECE OF PLANNED STREET, joined on and nearest the middle.
  const pieces = plan.steps.filter((s): s is Road => s.kind === "road" && !skip(s) && !laid(g, s) && joined(g, s));
  if (!pieces.length) return null;
  const mid = (r: Road): Cell => ({ x: (r.from.x + r.to.x) / 2, y: (r.from.y + r.to.y) / 2 });
  pieces.sort((a, b) => manhattan(mid(a), plan.centre) - manhattan(mid(b), plan.centre));
  // What stands in a piece's way, and what the plan does about it.
  const levels = new Map<number, Level>(), clears = new Map<number, Clear>();
  for (const s of plan.steps) {
    if (s.kind === "level") for (let y = Math.min(s.from.y, s.to.y); y <= Math.max(s.from.y, s.to.y); y++) for (let x = Math.min(s.from.x, s.to.x); x <= Math.max(s.from.x, s.to.x); x++) levels.set(idx(g, x, y), s);
    if (s.kind === "clear") clears.set(idx(g, s.at.x, s.at.y), s);
  }
  next: for (const r of pieces) {
    const tiles: Cell[] = [];
    for (let y = Math.min(r.from.y, r.to.y); y <= Math.max(r.from.y, r.to.y); y++)
      for (let x = Math.min(r.from.x, r.to.x); x <= Math.max(r.from.x, r.to.x); x++) tiles.push({ x, y });
    // In the way: the plan's to clear, or it waits. Every tile first, so no
    // ground is levelled under a building further along. (Not lots put there
    // since: the best frontage is worth more to a small town than a clear
    // street, and a lot cleared would only be put back. Measured: keeping the
    // streets clear of lots took the benchmark from +22% to −11%.)
    for (const t of tiles) {
      if (structureAt(g, t.x, t.y) < 0) continue;
      const c = clears.get(idx(g, t.x, t.y));
      if (c && !skip(c)) return c;
      continue next;
    }
    for (const t of tiles) {
      const i = idx(g, t.x, t.y), l = levels.get(i);
      if (!l || g.height[i] === l.z) continue;
      // Its whole line free of buildings too, or it waits.
      if (skip(l) || lineCells(l).some((c) => structureAt(g, c.x, c.y) >= 0)) continue next;
      return l;
    }
    return r;
  }
  return null;
}

/** Tiles of road a step lays. */
export const roadTiles = (g: Grid, r: Road) => {
  let n = 0;
  for (let y = Math.min(r.from.y, r.to.y); y <= Math.max(r.from.y, r.to.y); y++)
    for (let x = Math.min(r.from.x, r.to.x); x <= Math.max(r.from.x, r.to.x); x++) if (inBounds(g, x, y) && !isPaved(g, x, y) && !g.pool[idx(g, x, y)]) n++;
  return n;
};
