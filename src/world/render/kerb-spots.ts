/**
 * World v2 — WHERE A JOB'S MACHINES PULL OVER while their trade is not at work: on the verge of the open road the
 * job comes from, nose along the road, one to a tile — and NEVER TWO IN ONE PLACE, whichever job or drawing each is
 * for. A spot is a free tile beside a road tile near the job's head (not paved, not built on, not standing water,
 * not a deck, not a job still to be done), nearest by road first. Each machine is given one and keeps it while it is
 * drawn; one not drawn for a few frames gives it up. @see plant-kit follow, road-plant, line-works
 */
import { idx, inBounds, type Grid } from "../grid";

export type Spot = { x: number; y: number; heading: number };
type Cand = Spot & { cell: number };

/** How far onto the verge a machine's middle stands from its road tile's middle, tiles; and how far along the roads, tiles, it looks for one. */
const OUT = 0.68, REACH = 10;
/** Frames a spot is kept for a machine not drawn: then it is free. */
const KEEP = 3;

const near = new Map<string, Cand[]>();
let seenRev = -1, seenJobs = "", seenGrid: Grid | null = null;
const held = new Map<string, { cell: number; seen: number }>();
let frame = 0;

/** The cells no machine stands on: a road or a line still to be built. */
function blockedCells(g: Grid): Set<number> {
  const out = new Set<number>();
  for (const j of g.roadJobs) for (let k = j.opened; k < j.cells.length; k++) out.add(idx(g, j.cells[k].x, j.cells[k].y));
  for (const j of g.lineJobs) for (const c of j.cells) if (inBounds(g, c.x, c.y)) out.add(idx(g, c.x, c.y));
  return out;
}

/** Every spot near a road tile, nearest by road first. */
function spotsNear(g: Grid, head: { x: number; y: number }): Cand[] {
  const jobs = `${g.roadJobs.map((j) => `${j.id}.${j.opened}`).join(",")}|${g.lineJobs.map((j) => j.id).join(",")}`;
  if (g !== seenGrid || g.rev !== seenRev || jobs !== seenJobs) { near.clear(); seenGrid = g; seenRev = g.rev; seenJobs = jobs; }
  const key = `${head.x},${head.y}`, had = near.get(key);
  if (had) return had;
  const out: Cand[] = [];
  const hx = Math.round(head.x), hy = Math.round(head.y);
  if (inBounds(g, hx, hy) && g.paved[idx(g, hx, hy)] !== 0) {
    const blocked = blockedCells(g), used = new Set<number>(), seen = new Set<number>([idx(g, hx, hy)]);
    let ring = [{ x: hx, y: hy }];
    const D = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
    for (let step = 0; step <= REACH && ring.length; step++) {
      const next: { x: number; y: number }[] = [], here: Cand[] = [];
      for (const t of ring) for (const [dx, dy] of D) {
        const x = t.x + dx, y = t.y + dy;
        if (!inBounds(g, x, y)) continue;
        const i = idx(g, x, y);
        if (g.paved[i] !== 0) { if (!seen.has(i)) { seen.add(i); next.push({ x, y }); } continue; }
        if (used.has(i) || blocked.has(i) || g.structureAt[i] >= 0 || g.pool[i] > 0 || g.deck[i] !== 0) continue;
        used.add(i);
        // (Nose along the road: square to the way off it.)
        here.push({ x: t.x + dx * OUT, y: t.y + dy * OUT, heading: Math.atan2(dx, -dy), cell: i });
      }
      // (Of those as near by road, the nearest as the crow flies first.)
      here.sort((a, b) => Math.hypot(a.x - head.x, a.y - head.y) - Math.hypot(b.x - head.x, b.y - head.y));
      out.push(...here);
      ring = next;
    }
  }
  near.set(key, out);
  return out;
}

/** A frame gone: spots of machines not drawn for a while are free again. Once a frame, before anything asks. */
export function kerbFrame(): void {
  frame++;
  for (const [k, h] of held) if (frame - h.seen > KEEP) held.delete(k);
}

/**
 * THE SPOT `owner` — a machine, named for its drawing, its job and itself — pulls over at, by the road tile `head`:
 * the one it has, while that is still a spot; else the nearest nobody has. Null with none free.
 */
export function kerbSpot(g: Grid, owner: string, head: { x: number; y: number }): Spot | null {
  const list = spotsNear(g, head), mine = held.get(owner);
  if (mine) {
    const still = list.find((s) => s.cell === mine.cell);
    if (still) { mine.seen = frame; return still; }
    held.delete(owner);
  }
  const taken = new Set<number>();
  for (const h of held.values()) taken.add(h.cell);
  const free = list.find((s) => !taken.has(s.cell));
  if (!free) return null;
  held.set(owner, { cell: free.cell, seen: frame });
  return free;
}

/** Every spot held now, for tests: by its owner. */
export const kerbHeld = (): ReadonlyMap<string, { cell: number }> => held;
/** Forget every spot: a new map. */
export function kerbReset(): void { held.clear(); near.clear(); seenGrid = null; }
