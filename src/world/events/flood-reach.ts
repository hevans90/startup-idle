/**
 * World v2 — THE FLOOD LINE: where this map's river would come to in a
 * flood, worked out from the map alone — no water field — so the homes'
 * moods, the placement overlay and the levee can all ask it, headless or not.
 *
 * A fill from the river at its flood height: each river tile's surface (its
 * ground and the water standing on it) plus the flood's rise, spreading a side
 * at a time — four ways, as the water does — over any ground lower than it,
 * losing a little head with every tile it crosses, and stopped dead by
 * anything built. A flood wall is the thing built to stop it; a house is too,
 * but the water stands round it, and the house is AT RISK. @see floodPeak,
 * floodedNow, plans/farms-and-flood-walls.md §4
 */
import { idx, inBounds, type Grid, type Structure } from "../grid";
import { housedBy } from "../../game/housing";
import { mapRiver, poolDepthOf } from "../boats/river";
import { structureDef } from "../structures/def";
import { FLOODED, floodPeak } from "./flood";

/** Half steps of head the water loses for each tile it spreads over dry land. */
export const REACH_DECAY = 0.2;
/** Half steps over the nearest river's risen surface the water can still stand, carried along a valley. */
export const REACH_SLACK = 2;
/** The furthest from the river it is looked for, in tiles. */
export const REACH_MOST = 6;

export type FloodReach = {
  /** How deep the flood would stand on each tile, half steps over its ground; nought where it would not come. */
  depth: Float32Array;
  /** The river's own tiles: the water is there already. */
  river: Uint8Array;
  /** The flood's rise, half steps; nought on a map with no river. */
  peak: number;
};

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/**
 * Where the flood would come to, with the walls standing — and, if given, these
 * extra tiles walled too (a row being dragged). @see floodReachOf
 */
export function floodReach(g: Grid, walled?: ReadonlySet<number>, open?: ReadonlySet<number>, tune: { decay?: number; slack?: number; most?: number } = {}): FloodReach {
  const DECAY = tune.decay ?? REACH_DECAY, SLACK = tune.slack ?? REACH_SLACK, MOST = tune.most ?? REACH_MOST;
  const n = g.w * g.h, depth = new Float32Array(n), riverAt = new Uint8Array(n);
  const peak = floodPeak(g);
  if (peak <= 0) return { depth, river: riverAt, peak: 0 };
  const rm = mapRiver(g, poolDepthOf(g), 0);
  if (!rm.sources.length) return { depth, river: riverAt, peak: 0 };
  // THE LEVEL each tile is reached at, best first: a heap of tiles keyed by level.
  const level = new Float32Array(n).fill(-Infinity), dist = new Uint16Array(n);
  const heap: number[] = [];
  const push = (i: number) => {
    heap.push(i);
    for (let k = heap.length - 1; k > 0;) {
      const up = (k - 1) >> 1;
      if (level[heap[up]] >= level[heap[k]]) break;
      [heap[up], heap[k]] = [heap[k], heap[up]];
      k = up;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let k = 0; ;) {
        const a = 2 * k + 1, b = a + 1;
        let m = k;
        if (a < heap.length && level[heap[a]] > level[heap[m]]) m = a;
        if (b < heap.length && level[heap[b]] > level[heap[m]]) m = b;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  // THE RISE ALONG IT: all of it at the head, about half by the time it leaves — the open edge takes the rest.
  let far = 0;
  for (let i = 0; i < n; i++) if (rm.river[i] > 0 && Number.isFinite(rm.toExit[i])) far = Math.max(far, rm.toExit[i]);
  const riseAt = (i: number) => peak * (far > 0 && Number.isFinite(rm.toExit[i]) ? 0.5 + 0.5 * (rm.toExit[i] / far) : 1);
  // THE MOST each tile can be reached at: the risen surface of the river tile nearest it. Water spreading along a
  // valley falls with it; carried downhill from the head, the head's flood level would drown the whole valley.
  const cap = new Float32Array(n).fill(-Infinity), queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (rm.river[i] <= 0) continue;
    riverAt[i] = 1;
    level[i] = cap[i] = g.height[i] + g.pool[i] + riseAt(i);
    queue.push(i);
    push(i);
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q], x = i % g.w, y = (i / g.w) | 0;
    for (const [dx, dy] of SIDES) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(g, nx, ny)) continue;
      const j = idx(g, nx, ny);
      if (cap[j] !== -Infinity) continue;
      cap[j] = cap[i];
      queue.push(j);
    }
  }
  const done = new Uint8Array(n);
  while (heap.length) {
    const i = pop();
    if (done[i]) continue;
    done[i] = 1;
    const x = i % g.w, y = (i / g.w) | 0;
    if (!riverAt[i]) depth[i] = level[i] - g.height[i];
    if (dist[i] >= MOST) continue;
    for (const [dx, dy] of SIDES) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(g, nx, ny)) continue;
      const j = idx(g, nx, ny);
      if (done[j] || riverAt[j]) continue;
      // ANYTHING BUILT stops it: the water stands against it. A bridge's deck is over the water, not in it.
      if ((g.structureAt[j] >= 0 && !open?.has(j)) || walled?.has(j)) continue;
      const at = Math.min(level[i] - DECAY, cap[j] + SLACK - DECAY * (dist[i] + 1));
      if (g.height[j] >= at || at <= level[j]) continue;
      level[j] = at;
      dist[j] = dist[i] + 1;
      push(j);
    }
  }
  return { depth, river: riverAt, peak };
}

/** Whether a building is one the flood line is asked about: a home, or a port. */
export const atRiskKind = (s: Structure) => !!housedBy(s.def) || !!structureDef(s.def)?.port;

/** The tiles round a footprint, a side at a time: where the water would stand against it. */
function ringOf(g: Grid, s: Structure): number[] {
  const out: number[] = [];
  for (let x = s.x; x < s.x + s.w; x++) for (const y of [s.y - 1, s.y + s.h]) if (inBounds(g, x, y)) out.push(idx(g, x, y));
  for (let y = s.y; y < s.y + s.h; y++) for (const x of [s.x - 1, s.x + s.w]) if (inBounds(g, x, y)) out.push(idx(g, x, y));
  return out;
}

/** How deep the flood would stand against a building, half steps: the deepest round it. */
export function reachAgainst(g: Grid, r: FloodReach, s: Structure): number {
  let most = 0;
  for (const i of ringOf(g, s)) most = Math.max(most, r.depth[i]);
  return most;
}

/** Whether a flood would reach a building enough to flood it. @see FLOODED */
export const floodsAt = (g: Grid, r: FloodReach, s: Structure) => reachAgainst(g, r, s) > FLOODED;

/** The homes and ports a flood would reach, by id. */
export function atRisk(g: Grid, r: FloodReach): Set<number> {
  const out = new Set<number>();
  if (!r.peak) return out;
  for (const s of g.structures.values()) if (atRiskKind(s) && !s.build && floodsAt(g, r, s)) out.add(s.id);
  return out;
}

/**
 * THE MAP'S FLOOD LINE, kept till the map changes: what the moods, the
 * levee and the overlay all ask. Remade when anything is built or taken
 * down (a wall among them) or the ground is moved. @see Grid.rev
 */
let kept: { grid: Grid; rev: number; reach: FloodReach; risk: Set<number> } | null = null;
export function floodReachOf(g: Grid): { reach: FloodReach; risk: Set<number> } {
  if (!kept || kept.grid !== g || kept.rev !== g.rev) {
    const reach = floodReach(g);
    kept = { grid: g, rev: g.rev, reach, risk: atRisk(g, reach) };
  }
  return kept;
}

/** The homes a row of walls would keep dry: at risk now, and not with the row up. */
export function keptDryBy(g: Grid, cells: readonly { x: number; y: number }[]): number {
  if (!cells.length) return 0;
  const now = floodReachOf(g).risk;
  if (!now.size) return 0;
  const walled = new Set(cells.filter((c) => inBounds(g, c.x, c.y)).map((c) => idx(g, c.x, c.y)));
  const after = atRisk(g, floodReach(g, walled));
  let n = 0;
  for (const id of now) if (!after.has(id)) n++;
  return n;
}


/** A flood wall's run: every wall joined to it a side at a time, as tile indices. */
export function wallRun(g: Grid, from: Structure): number[] {
  const isWall = (i: number) => g.structureAt[i] >= 0 && g.structures.get(g.structureAt[i])?.def === "levee";
  const start = idx(g, from.x, from.y);
  if (!isWall(start)) return [];
  const seen = new Set([start]), out = [start];
  for (let q = 0; q < out.length; q++) {
    const i = out[q], x = i % g.w, y = (i / g.w) | 0;
    for (const [dx, dy] of SIDES) {
      if (!inBounds(g, x + dx, y + dy)) continue;
      const j = idx(g, x + dx, y + dy);
      if (!seen.has(j) && isWall(j)) { seen.add(j); out.push(j); }
    }
  }
  return out;
}

/**
 * WHAT A RUN OF WALLS DOES: how long it is, and the homes and ports that are
 * outside the flood line only because it stands. Kept till the map changes.
 */
let runKept: { grid: Grid; rev: number; at: number; value: { run: number[]; safe: number[] } } | null = null;
export function wallRunInfo(g: Grid, s: Structure): { run: number[]; safe: number[] } {
  const at = idx(g, s.x, s.y);
  if (runKept && runKept.grid === g && runKept.rev === g.rev && runKept.value.run.includes(at)) return runKept.value;
  const run = wallRun(g, s);
  const now = floodReachOf(g).risk;
  const without = atRisk(g, floodReach(g, undefined, new Set(run)));
  const safe = [...without].filter((id) => !now.has(id));
  runKept = { grid: g, rev: g.rev, at, value: { run, safe } };
  return runKept.value;
}
