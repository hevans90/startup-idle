/**
 * World v2 — the roads as somebody using them sees them: where a trip can
 * start and end, the way between, and where on the road to be.
 *
 * PLACES. A building's DOOR is the paved cell beside its footprint nearest its
 * middle; a GATEWAY is a road cell on the rim of the map, where the world
 * beyond comes and goes. Trips run between places on one road network.
 *
 * ROUTES. Over the cells the road graph links — {@link connects}, the same rule
 * the autotiler draws with, so a car takes the road you can see and never a
 * step a road cannot climb. Dijkstra rather than breadth first, because a step
 * is not always the same price: on a road two cells wide, travelling with more
 * road on your right costs more, so traffic keeps to the right-hand lane and
 * only crosses over to turn. @see WRONG_SIDE
 *
 * LANES. A route is cells; a car is somewhere in each. On a road one cell wide
 * it keeps right of the middle, so two cars passing do not meet. On a wider
 * road the cell it is in is its lane, and it keeps to the middle of it. At a
 * corner it is right of the way in and of the way out at once, which puts it
 * on the inside of a right turn and swings it wide of a left one. People walk
 * the KERB instead: the side of each cell that has no road beside it.
 */
import { NEIGHBOUR } from "../../iso/dir";
import { idx, structureAt, surfaceSampler, type Grid } from "../grid";
import { surfaceHeight } from "../iso";
import { connects, isPaved } from "../roads/mask";
import { find, type Network } from "../roads/network";

export type Cell = { x: number; y: number };
export type Place = Cell & {
  kind: "door" | "gateway";
  net: number;
  structure?: number;
  /** A door of a building still going up, or an empty lot: not somewhere to make a trip to. */
  building?: boolean;
};

const DIRS = ["N", "E", "S", "W"] as const;
type Dir = (typeof DIRS)[number];
const stepOf = (d: Dir) => NEIGHBOUR[d];

/** To the right of travelling (dx, dy), in tile coordinates as the camera shows them. */
export const rightOf = (dx: number, dy: number) => ({ x: -dy, y: dx });

/**
 * Every place a trip can start or end, on a road network.
 *
 * A door per structure, not per cell it fronts: one way in, nearest its middle,
 * so a long building does not get a crowd of doors. A gateway per rim cell.
 */
export function placesOf(g: Grid, net: Network): Place[] {
  const out: Place[] = [];
  for (const s of g.structures.values()) {
    const cx = s.x + (s.w - 1) / 2, cy = s.y + (s.h - 1) / 2;
    let best: Place | null = null, bestD = Infinity;
    for (let k = 0; k < s.w; k++) {
      for (let j = 0; j < s.h; j++) {
        for (const d of DIRS) {
          const [dx, dy] = stepOf(d);
          const x = s.x + k + dx, y = s.y + j + dy;
          if (!isPaved(g, x, y) || structureAt(g, x, y) === s.id) continue;
          const dist = Math.hypot(x - cx, y - cy);
          if (dist >= bestD) continue;
          bestD = dist;
          best = {
            x, y, kind: "door", net: find(net, idx(g, x, y)), structure: s.id,
            // A site, or a lot nobody lives on yet: nobody's trip starts or
            // ends there. @see Structure.residents
            ...(s.build || s.residents === 0 ? { building: true } : {}),
          };
        }
      }
    }
    if (best && best.net >= 0) out.push(best);
  }
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (x !== 0 && y !== 0 && x !== g.w - 1 && y !== g.h - 1) continue;
      if (!isPaved(g, x, y)) continue;
      const net0 = find(net, idx(g, x, y));
      if (net0 >= 0) out.push({ x, y, kind: "gateway", net: net0 });
    }
  }
  return out;
}

/**
 * What a step into a cell costs on top of the step itself, when there is
 * more road to the right of it than it: keep right, cross over to turn.
 */
const WRONG_SIDE = 2;

/**
 * The cheapest way along the roads from one cell to another, both ends
 * included, or null if there is none. `keepRight` prices the wrong lane of a
 * wide road; people walking do not care which side they are on.
 */
export function routeBetween(g: Grid, from: Cell, to: Cell, keepRight = true): Cell[] | null {
  if (!isPaved(g, from.x, from.y) || !isPaved(g, to.x, to.y)) return null;
  const n = g.w * g.h;
  const cost = new Float32Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const start = idx(g, from.x, from.y), goal = idx(g, to.x, to.y);
  cost[start] = 0;
  // A binary heap of [cost, cell].
  const heap: number[] = [];
  const push = (c: number, i: number) => {
    heap.push(c, i);
    let k = heap.length / 2 - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p * 2] <= heap[k * 2]) break;
      [heap[p * 2], heap[k * 2]] = [heap[k * 2], heap[p * 2]];
      [heap[p * 2 + 1], heap[k * 2 + 1]] = [heap[k * 2 + 1], heap[p * 2 + 1]];
      k = p;
    }
  };
  const pop = () => {
    const c = heap[0], i = heap[1];
    // The last pair comes off index first, then cost.
    const lastIndex = heap.pop()!, lastCost = heap.pop()!;
    if (heap.length) {
      heap[0] = lastCost; heap[1] = lastIndex;
      let k = 0;
      const m = heap.length / 2;
      for (;;) {
        const a = k * 2 + 1, b = a + 1;
        let s = k;
        if (a < m && heap[a * 2] < heap[s * 2]) s = a;
        if (b < m && heap[b * 2] < heap[s * 2]) s = b;
        if (s === k) break;
        [heap[s * 2], heap[k * 2]] = [heap[k * 2], heap[s * 2]];
        [heap[s * 2 + 1], heap[k * 2 + 1]] = [heap[k * 2 + 1], heap[s * 2 + 1]];
        k = s;
      }
    }
    return [c, i] as const;
  };
  push(0, start);
  while (heap.length) {
    const [c, i] = pop();
    if (c > cost[i]) continue;
    if (i === goal) break;
    const x = i % g.w, y = (i / g.w) | 0;
    for (const d of DIRS) {
      if (!connects(g, x, y, d)) continue;
      const [dx, dy] = stepOf(d);
      const nx = x + dx, ny = y + dy, j = ny * g.w + nx;
      const r = rightOf(dx, dy);
      const extra = keepRight && isPaved(g, nx + r.x, ny + r.y) ? WRONG_SIDE : 0;
      const nc = c + 1 + extra;
      if (nc < cost[j]) { cost[j] = nc; prev[j] = i; push(nc, j); }
    }
  }
  if (!Number.isFinite(cost[goal])) return null;
  const out: Cell[] = [];
  for (let i = goal; i >= 0; i = prev[i]) {
    out.push({ x: i % g.w, y: (i / g.w) | 0 });
    if (i === start) break;
  }
  return out.reverse();
}

/** How far right of a lone lane's middle a car keeps, tiles. */
export const CAR_KEEP_RIGHT = 0.22;
/** How far from a cell's middle the kerb a person walks is, tiles. */
export const KERB = 0.38;

/** The way a route goes into and out of each of its cells. */
function legs(path: readonly Cell[]) {
  return path.map((c, k) => {
    const a = path[Math.max(0, k - 1)], b = path[Math.min(path.length - 1, k + 1)];
    const into = k > 0 ? { x: c.x - a.x, y: c.y - a.y } : { x: b.x - c.x, y: b.y - c.y };
    const out = k < path.length - 1 ? { x: b.x - c.x, y: b.y - c.y } : into;
    return { into, out };
  });
}

/**
 * Where a CAR is in each cell of its route. Right of the middle on a lone
 * lane — right of the way in and the way out together at a corner, so it cuts
 * the inside of a right turn and swings round a left — and the middle of the
 * cell on a wider road, where the cell is the lane.
 */
export function carLine(g: Grid, path: readonly Cell[]): Cell[] {
  return legs(path).map(({ into, out }, k) => {
    const c = path[k];
    const ri = rightOf(into.x, into.y), ro = rightOf(out.x, out.y);
    const wide = isPaved(g, c.x + ri.x, c.y + ri.y) || isPaved(g, c.x - ri.x, c.y - ri.y)
      || isPaved(g, c.x + ro.x, c.y + ro.y) || isPaved(g, c.x - ro.x, c.y - ro.y);
    if (wide) return { x: c.x, y: c.y };
    const sx = ri.x + ro.x, sy = ri.y + ro.y;
    const m = Math.hypot(sx, sy) || 1;
    // Straight: right by the keep. At a corner: out along the diagonal, by as
    // much on each axis as a straight would be.
    const along = into.x === out.x && into.y === out.y ? 1 : Math.SQRT2;
    return { x: c.x + (sx / m) * CAR_KEEP_RIGHT * along, y: c.y + (sy / m) * CAR_KEEP_RIGHT * along };
  });
}

/**
 * Where a PERSON is in each cell of their route: at the kerb, the side of the
 * cell with no road beside it — the right if both or neither, as a car keeps.
 * `lean` moves them in or out a little, so a crowd is not single file.
 */
export function walkLine(g: Grid, path: readonly Cell[], lean = 0): Cell[] {
  return legs(path).map(({ into, out }, k) => {
    const c = path[k];
    const d = into.x === out.x && into.y === out.y ? into : { x: into.x + out.x, y: into.y + out.y };
    const r = rightOf(Math.sign(d.x), Math.sign(d.y));
    const rightOpen = !isPaved(g, c.x + Math.sign(r.x), c.y + Math.sign(r.y));
    const leftOpen = !isPaved(g, c.x - Math.sign(r.x), c.y - Math.sign(r.y));
    const side = rightOpen || !leftOpen ? 1 : -1;
    const m = Math.hypot(r.x, r.y) || 1;
    const by = KERB + lean;
    return { x: c.x + (r.x / m) * by * side, y: c.y + (r.y / m) * by * side };
  });
}

/** The height of the road surface at a point, ramps and decks and all. */
export function roadHeightAt(g: Grid, x: number, y: number): number {
  const cx = Math.max(0, Math.min(g.w - 1, Math.round(x)));
  const cy = Math.max(0, Math.min(g.h - 1, Math.round(y)));
  const surf = surfaceSampler(g)(cx, cy);
  if (!surf) return 0;
  return surfaceHeight(surf, Math.min(1, Math.max(0, x - cx + 0.5)), Math.min(1, Math.max(0, y - cy + 0.5)));
}

/** A gateway's way off the map: the rim direction it faces. */
export function outward(g: Grid, c: Cell): Cell {
  return {
    x: c.x === 0 ? -1 : c.x === g.w - 1 ? 1 : 0,
    y: c.y === 0 ? -1 : c.y === g.h - 1 ? 1 : 0,
  };
}
