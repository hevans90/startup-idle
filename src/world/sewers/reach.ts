/**
 * World v2 — WHERE A SEWER CONNECTION CAN REACH A MANHOLE: every tile's
 * distance to the nearest live manhole BY THE ROUTE a connection would take.
 *
 * A connection (a lateral) is laid above ground on empty plots only — no
 * building, no road, no water, no other pipe on any of its tiles — so a
 * manhole across a street is not in reach however near it is, and one set in
 * a road can take no connection at all. Counted in tiles from the manhole
 * outward, to `LATERAL_REACH`; kept till the map changes.
 * @see planLateral, plans/pipe-network.md §7
 */
import { NEIGHBOUR } from "../../iso/dir";
import { VOID, idx, inBounds, type Grid } from "../grid";
import { LATERAL_REACH, solveSewers } from "./solve";

/** Whether a connection may lie on a tile: open ground, with nothing built, paved, wet or piped on it. */
export const lateralGround = (g: Grid, i: number) =>
  g.paved[i] === VOID && g.structureAt[i] < 0 && !(g.pool[i] > 0) && g.main[i] === 0 && g.mainEnd[i] === 0;

const kept = new WeakMap<Grid, { rev: number; steps: Int8Array }>();

/** Tiles to the nearest live manhole a connection could be laid to from each tile, −1 where none is in reach. */
export function lateralReach(g: Grid): Int8Array {
  const seen = kept.get(g);
  if (seen && seen.rev === g.rev) return seen.steps;
  const steps = new Int8Array(g.w * g.h).fill(-1);
  const s = solveSewers(g), queue: number[] = [];
  for (const net of s.nets) {
    if (!net.exits.length) continue;
    // A manhole in a road takes no connection: only its trunk passes under.
    for (const n of net.nodes) if (g.paved[n] === VOID && g.structureAt[n] < 0 && steps[n] < 0) { steps[n] = 0; queue.push(n); }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    if (steps[i] >= LATERAL_REACH) continue;
    const x = i % g.w, y = (i / g.w) | 0;
    for (const [dx, dy] of Object.values(NEIGHBOUR)) {
      if (!inBounds(g, x + dx, y + dy)) continue;
      const j = idx(g, x + dx, y + dy);
      if (steps[j] >= 0 || !lateralGround(g, j)) continue;
      steps[j] = steps[i] + 1;
      queue.push(j);
    }
  }
  kept.set(g, { rev: g.rev, steps });
  return steps;
}
