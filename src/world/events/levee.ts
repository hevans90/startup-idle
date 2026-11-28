/**
 * World v2 — A LEVEE, raised against a flood: a row of flood walls along the
 * river's bank wherever the flood would come over it on its way to a home.
 * The walls are the ones the player can drag along a bank themselves, and
 * they stay: the next flood finds them there. @see LEVEE, world/events/flood
 *
 * Read off the flood line, not the water: the bank is the first dry ground
 * the flood comes onto, a side at a time, and a wall on each of those tiles
 * keeps the river in its bed. @see floodReach
 */
import { VOID, idx, inBounds, type Grid } from "../grid";
import { atRiskKind, floodReachOf, type FloodReach } from "./flood-reach";
import { riverHead } from "./flood";

/** The most walls one levee is, on a small map; more on a big one. @see leveeMax */
export const LEVEE_MAX = 48;
/** What a levee costs over the walls dragged out by hand: a rush job, before the water comes. */
export const LEVEE_RUSH = 2;
/** How many walls a levee on this map can be. */
export const leveeMax = (g: Grid) => Math.max(LEVEE_MAX, Math.round((g.w + g.h) * 0.75));

type Cell = { x: number; y: number };
const SIDES: readonly Cell[] = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];

/** Whether a wall could go on a tile: open, dry ground, nothing built on it, no road. */
const wallable = (g: Grid, i: number) => g.structureAt[i] < 0 && g.paved[i] === VOID && g.terrain[i] !== VOID && g.pool[i] === 0;

/**
 * THE BANK the flood comes over: every dry tile beside the river that it
 * would reach. Each a side away from the water — so walled, all of them,
 * the river stays in its bed.
 */
export function floodBank(g: Grid, r: FloodReach): number[] {
  const out: number[] = [];
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const i = idx(g, x, y);
    if (r.river[i] || r.depth[i] <= 0) continue;
    if (SIDES.some((s) => inBounds(g, x + s.x, y + s.y) && r.river[idx(g, x + s.x, y + s.y)])) out.push(i);
  }
  return out;
}

/**
 * WHERE THE LEVEE GOES: the open bank the flood would come over on its way
 * to a home or a port — found by walking back from what it would reach,
 * through what it would cover — nearest the river's head first. With nothing
 * at risk, the bank nearest the head. Empty once it is walled: a wall is a
 * structure, and a tile with one is not open.
 */
export function leveeCells(g: Grid, max = leveeMax(g)): Cell[] {
  const { reach, risk } = floodReachOf(g);
  if (!reach.peak) return [];
  const bank = floodBank(g, reach).filter((i) => wallable(g, i));
  if (!bank.length) return [];
  // BACK FROM WHAT IS AT RISK, through the tiles the flood would cover, to the bank it came over.
  let keep = bank;
  if (risk.size) {
    const seen = new Uint8Array(g.w * g.h), queue: number[] = [];
    for (const id of risk) {
      const s = g.structures.get(id);
      if (!s || !atRiskKind(s)) continue;
      for (let y = s.y - 1; y <= s.y + s.h; y++) for (let x = s.x - 1; x <= s.x + s.w; x++) {
        if (!inBounds(g, x, y)) continue;
        const i = idx(g, x, y);
        if (reach.depth[i] > 0 && !seen[i]) { seen[i] = 1; queue.push(i); }
      }
    }
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q], x = i % g.w, y = (i / g.w) | 0;
      for (const s of SIDES) {
        if (!inBounds(g, x + s.x, y + s.y)) continue;
        const j = idx(g, x + s.x, y + s.y);
        if (!seen[j] && !reach.river[j] && reach.depth[j] > 0) { seen[j] = 1; queue.push(j); }
      }
    }
    const near = bank.filter((i) => seen[i]);
    if (near.length) keep = near;
  }
  const head = riverHead(g) ?? { x: 0, y: 0 };
  return keep
    .map((i) => ({ x: i % g.w, y: (i / g.w) | 0 }))
    .sort((a, b) => Math.abs(a.x - head.x) + Math.abs(a.y - head.y) - (Math.abs(b.x - head.x) + Math.abs(b.y - head.y)))
    .slice(0, max);
}
