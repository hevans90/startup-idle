/**
 * WHAT THE PLAYER DOES TO WHAT GROWS: fells it (stumps, and timber), plants it (a wood, a row of trees, a hedge, a
 * bed of flowers), and farms it (a farm's fields, each cut in its crop's season). Pure, on the fields (@see ./fields); what any
 * of it costs or earns is the game's. @see game/vegetation-cost
 */
import { idx, inBounds, type Grid, type Structure } from "../grid";
import { COVER, MATURE, covered, farmReach, growable, vegAt } from "./fields";
import { cropSeason, type Season } from "./crops";

type Palette = readonly (string | null)[];
type Cell = { x: number; y: number };

/** The structure that is a farm. */
export const FARM = "farm";
/** The Agritech Lab farms its own ground too. @see plans/farms-and-flood-walls.md §1 */
export const AGRITECH = "agritech";
/** Whether a structure is a farm: a farm, or the Agritech Lab. */
export const isFarm = (def: string) => def === FARM || def === AGRITECH;

/** The farms on the map. */
export const farmsOf = (g: Grid): Structure[] => [...g.structures.values()].filter((s) => isFarm(s.def) && !s.build);

/** How far a cell is from a farm's footprint: the furthest of x and y. */
const reachOf = (f: Structure, x: number, y: number) => Math.max(Math.max(f.x - x, 0, x - (f.x + f.w - 1)), Math.max(f.y - y, 0, y - (f.y + f.h - 1)));

/** Whether a cell is within reach of a farm. */
export const tended = (farms: readonly Structure[], x: number, y: number) => tenderOf(farms, x, y) !== null;

/** THE FARM that tends a cell: the nearest in reach, the first of those as near; null for none. */
export function tenderOf(farms: readonly Structure[], x: number, y: number): Structure | null {
  let best: Structure | null = null, d = farmReach() + 1;
  for (const f of farms) {
    const r = reachOf(f, x, y);
    if (r < d) { d = r; best = f; }
  }
  return best;
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

/**
 * CLEAR A CELL to bare earth: what grows on it, what spills onto it from the wood beside it, and what lies about on
 * it. `healed`: earth no longer, what was cleared grown over — grass. Whether that changed anything.
 */
export function clearCell(g: Grid, i: number, healed = false): boolean {
  const V = g.veg, to = healed ? COVER.grass : COVER.none;
  if (V.seen[i] === g.terrain[i] && (healed ? V.cover[i] !== COVER.none : V.cover[i] === COVER.none)) return false;
  V.seen[i] = g.terrain[i];
  V.cover[i] = to; V.density[i] = 0; V.age[i] = MATURE; V.health[i] = 255; V.wear[i] = 0;
  V.changed.add(i);
  V.rev++;
  return true;
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
 * THE GROUND A FARM WOULD TAKE for its fields: the open ground round it, within reach — not a wood, not built on,
 * not under water, not another's field — as cell indices. @see claimFields
 */
export function claimable(g: Grid, palette: Palette, farm: Pick<Structure, "x" | "y" | "w" | "h">): number[] {
  const V = g.veg, out: number[] = [];
  const R = farmReach();
  for (let y = farm.y - R; y < farm.y + farm.h + R; y++) for (let x = farm.x - R; x < farm.x + farm.w + R; x++) {
    if (!inBounds(g, x, y)) continue;
    // (Not its own footprint, before it stands there.)
    if (x >= farm.x && x < farm.x + farm.w && y >= farm.y && y < farm.y + farm.h) continue;
    const i = vegAt(g, palette, x, y), cv = V.cover[i];
    if (!growable(g, palette, i) || covered(g, x, y) || V.wet[i]) continue;
    if (cv !== COVER.grass && cv !== COVER.meadow && cv !== COVER.stumps && cv !== COVER.burnt) continue;
    out.push(i);
  }
  return out;
}

/** A FARM'S FIELDS, as it is put down, and as its ground comes open again. Returns the cells claimed. */
export function claimFields(g: Grid, palette: Palette, farm: Pick<Structure, "x" | "y" | "w" | "h">): number {
  const V = g.veg, cells = claimable(g, palette, farm);
  for (const i of cells) {
    V.cover[i] = COVER.field; V.density[i] = 0; V.age[i] = MATURE;
    V.changed.add(i);
  }
  if (cells.length) V.rev++;
  return cells.length;
}

/** The fields that are cut at harvest — tended, open, dry — all of them, or the ones cut in a season. */
export function harvestable(g: Grid, season?: Season): number {
  let n = 0;
  for (const v of fieldsBy(g, season).values()) n += v;
  return n;
}

/** THE FIELDS each farm cuts, by its id: all of them, or the ones cut in a season. */
export function fieldsBy(g: Grid, season?: Season): Map<number, number> {
  const farms = farmsOf(g), V = g.veg, out = new Map<number, number>();
  if (!farms.length) return out;
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const i = idx(g, x, y);
    if (V.cover[i] !== COVER.field || V.wet[i] || covered(g, x, y)) continue;
    if (season !== undefined && cropSeason(x, y) !== season) continue;
    const f = tenderOf(farms, x, y);
    if (f) out.set(f.id, (out.get(f.id) ?? 0) + 1);
  }
  return out;
}
