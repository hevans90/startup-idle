/**
 * WHAT THE PLAYER DOES TO WHAT GROWS: fells it (stumps, and timber), plants it (a wood, a row of trees, a hedge, a
 * bed of flowers), and farms it (a farm's fields, cut each summer). Pure, on the fields (@see ./fields); what any
 * of it costs or earns is the game's. @see game/vegetation-cost
 */
import { idx, inBounds, type Grid, type Structure } from "../grid";
import { COVER, FARM_REACH, MATURE, covered, growable, vegAt } from "./fields";

type Palette = readonly (string | null)[];
type Cell = { x: number; y: number };

/** The structure that is a farm. */
export const FARM = "farm";

/** The farms on the map. */
export const farmsOf = (g: Grid): Structure[] => [...g.structures.values()].filter((s) => s.def === FARM && !s.build);

/** Whether a cell is within reach of a farm: the furthest of x and y from its footprint. */
export function tended(farms: readonly Structure[], x: number, y: number): boolean {
  for (const f of farms) {
    const dx = Math.max(f.x - x, 0, x - (f.x + f.w - 1)), dy = Math.max(f.y - y, 0, y - (f.y + f.h - 1));
    if (Math.max(dx, dy) <= FARM_REACH) return true;
  }
  return false;
}

/** HOW MANY TREES stand on a cell, as felling counts them: a wood's, scrub's one, a row's tree, a hedge's shrubs; and how grown, 0–1. */
export function treesOn(g: Grid, palette: Palette, x: number, y: number): { trees: number; grown: number } {
  if (!inBounds(g, x, y)) return { trees: 0, grown: 0 };
  const i = vegAt(g, palette, x, y), V = g.veg, c = V.cover[i];
  const trees = c === COVER.wood ? V.density[i] : c === COVER.scrub || c === COVER.row || c === COVER.hedge ? 1 : 0;
  return { trees, grown: V.age[i] / MATURE };
}

/** What felling these cells would take: trees, and their timber in mature trees' worth. */
export function fellingOf(g: Grid, palette: Palette, cells: readonly Cell[]): { trees: number; timber: number } {
  let trees = 0, timber = 0;
  for (const c of cells) {
    const t = treesOn(g, palette, c.x, c.y);
    // (Scrub and a hedge are brush: felled, not sold.)
    const cv = inBounds(g, c.x, c.y) ? g.veg.cover[idx(g, c.x, c.y)] : COVER.none;
    trees += t.trees;
    if (cv === COVER.wood || cv === COVER.row) timber += t.trees * t.grown;
  }
  return { trees, timber };
}

/**
 * FELL the trees on these cells. Left `stumps` where the ground stays open, for a year or so; bare grass where it
 * is built on (`under`), so nothing grows back under a building or a road. The fields change, not the map.
 */
export function fell(g: Grid, palette: Palette, cells: readonly Cell[], under = false) {
  const V = g.veg;
  for (const c of cells) {
    if (!inBounds(g, c.x, c.y)) continue;
    const { trees } = treesOn(g, palette, c.x, c.y), i = idx(g, c.x, c.y);
    if (!trees && !(under && V.cover[i] !== COVER.grass && V.cover[i] !== COVER.none)) continue;
    const was = V.cover[i];
    V.cover[i] = under ? (growable(g, palette, i) ? COVER.grass : COVER.none) : COVER.stumps;
    V.density[i] = under ? 0 : Math.min(15, trees + (was === COVER.hedge ? 2 : 0));
    V.age[i] = MATURE;
    V.changed.add(i);
  }
  V.rev++;
}

/** WHAT CAN BE PLANTED: a wood of saplings, a row of trees (one a cell), a hedge, a bed of flowers. */
export type Planting = "woods" | "row" | "hedge" | "bed";
export const PLANTINGS: readonly Planting[] = ["woods", "row", "hedge", "bed"];
const COVER_OF: Record<Planting, number> = { woods: COVER.wood, row: COVER.row, hedge: COVER.hedge, bed: COVER.bed };

/** The cells of these that can take this planting: open ground things grow on, not already so, and nothing on it. */
export function plantable(g: Grid, palette: Palette, cells: readonly Cell[], what: Planting): Cell[] {
  return cells.filter((c) => {
    if (!inBounds(g, c.x, c.y)) return false;
    const i = vegAt(g, palette, c.x, c.y), cv = g.veg.cover[i];
    if (!growable(g, palette, i) || covered(g, c.x, c.y) || g.veg.wet[i]) return false;
    // (Not over trees — fell them first — nor over a field, nor what is there already.)
    return cv !== COVER_OF[what] && cv !== COVER.wood && cv !== COVER.field && cv !== COVER.row && cv !== COVER.hedge;
  });
}

/** PLANT: saplings, young, to grow up as the years go (@see ./step). */
export function plant(g: Grid, palette: Palette, cells: readonly Cell[], what: Planting) {
  const V = g.veg;
  for (const c of cells) {
    const i = vegAt(g, palette, c.x, c.y);
    V.cover[i] = COVER_OF[what];
    V.density[i] = what === "woods" || what === "row" ? 1 : 0;
    // (A bed is in flower from the first year; trees and a hedge grow.)
    V.age[i] = what === "bed" ? MATURE : 0;
    V.changed.add(i);
  }
  V.rev++;
}

/**
 * A FARM'S FIELDS, as it is put down: the open ground round it, within reach — not a wood, not built on, not
 * under water, not another's field. Returns the cells claimed.
 */
export function claimFields(g: Grid, palette: Palette, farm: Pick<Structure, "x" | "y" | "w" | "h">): number {
  const V = g.veg;
  let n = 0;
  for (let y = farm.y - FARM_REACH; y < farm.y + farm.h + FARM_REACH; y++) for (let x = farm.x - FARM_REACH; x < farm.x + farm.w + FARM_REACH; x++) {
    if (!inBounds(g, x, y)) continue;
    const i = vegAt(g, palette, x, y), cv = V.cover[i];
    if (!growable(g, palette, i) || covered(g, x, y) || V.wet[i]) continue;
    if (cv !== COVER.grass && cv !== COVER.meadow && cv !== COVER.stumps && cv !== COVER.burnt) continue;
    V.cover[i] = COVER.field; V.density[i] = 0; V.age[i] = MATURE;
    V.changed.add(i); n++;
  }
  if (n) V.rev++;
  return n;
}

/** The fields that are cut at harvest: tended, open, dry. */
export function harvestable(g: Grid): number {
  const farms = farmsOf(g), V = g.veg;
  if (!farms.length) return 0;
  let n = 0;
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const i = idx(g, x, y);
    if (V.cover[i] === COVER.field && !V.wet[i] && !covered(g, x, y) && tended(farms, x, y)) n++;
  }
  return n;
}
