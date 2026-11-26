/**
 * A ROAD FROM HERE TO THE NETWORK: the cheapest way over the ground, tile by
 * tile, from a set of starts to the nearest tile that is paved (or that a test
 * accepts). Water, buildings, sewers and the map's edge are walls; climbing
 * costs by the step, and a turn costs too, so the road comes out in long
 * straight runs — what `runsOf` cuts it into, for the paving tool. Pure.
 * @see layoutDistrict, findDistrictSite, roads/grade
 */
import { idx, inBounds, structureAt, VOID, type Grid } from "../grid";
import { hasSewer } from "../sewers/solve";

export type Cell = { x: number; y: number };

export type RouteOptions = {
  /** Where the route may end: by default a paved tile. */
  goal?: (x: number, y: number) => boolean;
  /** Tiles it may not cross, beyond water, buildings and sewers: a district's own lots. */
  blocked?: (x: number, y: number) => boolean;
  /** How far it will look, in tiles walked. */
  maxLength?: number;
  /** A step up or down in half steps the road cannot take between two tiles. */
  maxStep?: number;
};

const DX = [1, -1, 0, 0], DY = [0, 0, 1, -1];
/** What a turn costs, in tiles: enough to prefer one long run to a staircase. */
const TURN = 3;
/** What a half step of climb costs, in tiles. */
const CLIMB = 2;

/** Whether a road can be laid on a tile at all. */
export function roadable(g: Grid, x: number, y: number): boolean {
  if (!inBounds(g, x, y)) return false;
  const i = idx(g, x, y);
  if (g.terrain[i] === VOID || g.pool[i] > 0 || g.deckPool[i] > 0) return false;
  if (structureAt(g, x, y) >= 0) return false;
  return !hasSewer(g, i);
}

/**
 * The cheapest road from any of `starts` to a goal tile, starts first and the
 * goal tile last; null when none is in reach. Dijkstra over (tile, heading),
 * small enough for a map's worth of tiles.
 */
export function routeRoad(g: Grid, starts: readonly Cell[], opts: RouteOptions = {}): Cell[] | null {
  const goal = opts.goal ?? ((x: number, y: number) => g.paved[idx(g, x, y)] !== 0);
  const blocked = opts.blocked ?? (() => false);
  const maxLength = opts.maxLength ?? g.w + g.h;
  const maxStep = opts.maxStep ?? 4;
  const n = g.w * g.h;
  // State: tile × the heading it was entered by (4), so a turn can be priced.
  const cost = new Float64Array(n * 4).fill(Infinity);
  const steps = new Int32Array(n * 4);
  const from = new Int32Array(n * 4).fill(-1);
  const closed = new Uint8Array(n * 4);
  const heap: number[] = [];
  const keys: number[] = [];
  const push = (s: number, c: number) => {
    heap.push(s); keys.push(c);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (keys[p] <= keys[k]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]]; [keys[p], keys[k]] = [keys[k], keys[p]];
      k = p;
    }
  };
  const pop = (): number => {
    const top = heap[0];
    const lastS = heap.pop()!, lastK = keys.pop()!;
    if (heap.length) {
      heap[0] = lastS; keys[0] = lastK;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heap.length && keys[l] < keys[m]) m = l;
        if (r < heap.length && keys[r] < keys[m]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]]; [keys[m], keys[k]] = [keys[k], keys[m]];
        k = m;
      }
    }
    return top;
  };
  for (const s of starts) {
    if (!inBounds(g, s.x, s.y)) continue;
    const i = idx(g, s.x, s.y);
    if (goal(s.x, s.y)) return [s];
    for (let d = 0; d < 4; d++) { const st = i * 4 + d; cost[st] = 0; push(st, 0); }
  }
  while (heap.length) {
    const st = pop();
    if (closed[st]) continue;
    closed[st] = 1;
    const i = st >> 2, d = st & 3, c = cost[st];
    const x = i % g.w, y = (i / g.w) | 0;
    if (steps[st] >= maxLength) continue;
    for (let nd = 0; nd < 4; nd++) {
      const nx = x + DX[nd], ny = y + DY[nd];
      if (!inBounds(g, nx, ny)) continue;
      const ni = idx(g, nx, ny);
      const dh = Math.abs(g.height[ni] - g.height[i]);
      if (dh > maxStep) continue;
      const done = goal(nx, ny);
      if (!done && (blocked(nx, ny) || !roadable(g, nx, ny))) continue;
      const nc = c + 1 + dh * CLIMB + (nd !== d && from[st] >= 0 ? TURN : 0);
      const ns = ni * 4 + nd;
      if (nc >= cost[ns]) continue;
      cost[ns] = nc; from[ns] = st; steps[ns] = steps[st] + 1;
      if (done) {
        const path: Cell[] = [];
        for (let k = ns; k >= 0; k = from[k]) { const t = k >> 2; path.push({ x: t % g.w, y: (t / g.w) | 0 }); }
        return path.reverse();
      }
      push(ns, nc);
    }
  }
  return null;
}

/** A path cut into its straight runs, each a stroke for the paving tool: from, to. */
export function runsOf(path: readonly Cell[]): { from: Cell; to: Cell }[] {
  if (!path.length) return [];
  if (path.length === 1) return [{ from: path[0], to: path[0] }];
  const out: { from: Cell; to: Cell }[] = [];
  let start = path[0];
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1], b = path[k], next = path[k + 1];
    const turns = next && (next.x - b.x !== b.x - a.x || next.y - b.y !== b.y - a.y);
    if (!next || turns) { out.push({ from: start, to: b }); start = b; }
  }
  return out;
}
