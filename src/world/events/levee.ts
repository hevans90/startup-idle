/**
 * World v2 — A LEVEE, raised against a flood: a row of flood walls along the
 * bank near the river's head, wherever the risen river would come over it.
 * The walls are the ones the player can drag along a bank themselves, and
 * they stay: the next flood finds them there. @see LEVEE, world/events/flood
 */
import { idx, inBounds, structureAt, type Grid } from "../grid";
import { isPaved } from "../roads/mask";
import type { WaterField } from "../water/field";
import { fluidIndexOf } from "../water/materials";
import { floodPeak, riverHead } from "./flood";
import { fluidAt } from "./sludge";

/** How far from the river's head a levee is raised, in tiles. */
export const LEVEE_REACH = 14;
/** The most walls one levee is. */
export const LEVEE_MAX = 48;
/** What a levee costs over the walls dragged out by hand: a rush job, before the water comes. */
export const LEVEE_RUSH = 2;

type Cell = { x: number; y: number };
const SIDES: readonly Cell[] = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];

/**
 * WHERE THE LEVEE GOES: the empty, dry, unpaved tiles beside the river near
 * its head that stand lower than the river's surface beside them plus the
 * flood's rise — the ones it would come over — nearest the head first.
 * Empty once they are walled: a wall is a structure, and a tile with one is
 * not empty.
 */
export function leveeCells(g: Grid, field: WaterField, max = LEVEE_MAX): Cell[] {
  const head = riverHead(g);
  if (!head) return [];
  const peak = floodPeak(g);
  const water = fluidIndexOf("water");
  const wet = (x: number, y: number) => inBounds(g, x, y) && fluidAt(field, x, y, water) > 0;
  const out: { c: Cell; d: number }[] = [];
  for (let y = head.y - LEVEE_REACH; y <= head.y + LEVEE_REACH; y++) {
    for (let x = head.x - LEVEE_REACH; x <= head.x + LEVEE_REACH; x++) {
      if (!inBounds(g, x, y) || wet(x, y) || structureAt(g, x, y) >= 0 || isPaved(g, x, y)) continue;
      let surface = -Infinity;
      for (const s of SIDES) {
        const nx = x + s.x, ny = y + s.y;
        if (wet(nx, ny)) surface = Math.max(surface, g.height[idx(g, nx, ny)] + fluidAt(field, nx, ny, water));
      }
      if (surface === -Infinity || g.height[idx(g, x, y)] >= surface + peak) continue;
      out.push({ c: { x, y }, d: Math.abs(x - head.x) + Math.abs(y - head.y) });
    }
  }
  return out.sort((a, b) => a.d - b.d).slice(0, max).map((o) => o.c);
}
