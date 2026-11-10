/**
 * World v2 — A WALKER'S WAY over the pavements: along the kerbs, over the
 * road only where it is crossed, from a door or the map's edge to another.
 *
 * Cheapest by length, each crossing costing a little more, so a walker keeps
 * to their own side until they have to cross. @see graph pavements
 *
 * Pure: from the lane graph and two places to a line, and where along it each
 * crossing is.
 */
import { NEIGHBOUR } from "../../../iso/dir";
import { structureAt, type Grid } from "../../grid";
import type { Place } from "../roads";
import { PAVE_AT, type LaneGraph } from "./graph";
import type { Pt } from "./geometry";

/** What a crossing costs a walker over its length, tiles: enough not to cross and cross back for nothing. */
export const CROSS_COST = 1;

/** Where a walk begins or ends: a point on the pavement, and the kerb points it is reached from, each with its distance. */
type End = { at: Pt; nodes: { n: number; d: number }[] };

const DIRS = ["N", "E", "S", "W"] as const;

/**
 * A place's end on the pavements. A door: the middle of the kerb its building
 * stands behind. A gateway: the kerb corners at the map's edge, either side of
 * the road.
 */
function endOf(G: LaneGraph, g: Grid, p: Place): End | null {
  const at = G.walk.at, nodes = G.walk.nodes;
  const corner = (sx: number, sy: number) => at.get(`${p.x},${p.y},${sx},${sy}`);
  if (p.kind === "door") {
    const d = DIRS.find((d) => structureAt(g, p.x + NEIGHBOUR[d][0], p.y + NEIGHBOUR[d][1]) === p.structure);
    if (!d) return null;
    const [dx, dy] = NEIGHBOUR[d];
    const door = { x: p.x + dx * PAVE_AT, y: p.y + dy * PAVE_AT };
    const ns: number[] = [];
    const m = at.get(`${p.x},${p.y},m,${d}`);
    if (m !== undefined) ns.push(m);
    for (const e of [-1, 1]) {
      const n = corner(dx || e, dy || e);
      if (n !== undefined) ns.push(n);
    }
    if (!ns.length) return null;
    return { at: door, nodes: ns.map((n) => ({ n, d: Math.hypot(nodes[n].x - door.x, nodes[n].y - door.y) })) };
  }
  const ox = p.x === 0 ? -1 : p.x === g.w - 1 ? 1 : 0, oy = p.y === 0 ? -1 : p.y === g.h - 1 ? 1 : 0;
  const ns: number[] = [];
  for (const e of [-1, 1]) {
    const n = corner(ox || e, oy || e);
    if (n !== undefined) ns.push(n);
  }
  if (!ns.length) return null;
  return { at: nodes[ns[0]], nodes: ns.map((n) => ({ n, d: 0 })) };
}

export type Walk = {
  pts: Pt[];
  /** Each crossing on the way: which, and where along the line it starts and ends. */
  crossings: { c: number; s0: number; s1: number }[];
};

/** The way on foot from one place to another, or null if the pavements do not join them. */
export function walkBetween(G: LaneGraph, g: Grid, from: Place, to: Place): Walk | null {
  const a = endOf(G, g, from), b = endOf(G, g, to);
  if (!a || !b) return null;
  const { nodes, edges, adj } = G.walk;
  const cost = new Float64Array(nodes.length).fill(Infinity);
  const via = new Int32Array(nodes.length).fill(-1);
  const heap: [number, number][] = [];
  const push = (c: number, n: number) => {
    heap.push([c, n]);
    for (let k = heap.length - 1; k > 0;) { const q = (k - 1) >> 1; if (heap[q][0] <= heap[k][0]) break; [heap[q], heap[k]] = [heap[k], heap[q]]; k = q; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let k = 0; ;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
      }
    }
    return top;
  };
  for (const { n, d } of a.nodes) if (d < cost[n]) { cost[n] = d; push(d, n); }
  const goal = new Map(b.nodes.map(({ n, d }) => [n, d]));
  let best = Infinity, end = -1;
  while (heap.length) {
    const [c, n] = pop();
    if (c > cost[n]) continue;
    if (c >= best) break;
    const gd = goal.get(n);
    if (gd !== undefined && c + gd < best) { best = c + gd; end = n; }
    for (const k of adj[n]) {
      const e = edges[k], m = e.a === n ? e.b : e.a;
      const nc = c + e.len + (e.crossing !== undefined ? CROSS_COST : 0);
      if (nc < cost[m]) { cost[m] = nc; via[m] = k; push(nc, m); }
    }
  }
  if (end < 0) return null;
  // Back from the end, the points and the crossings on the way.
  const order: number[] = [end], steps: number[] = [];
  for (let n = end; via[n] >= 0;) { const e = edges[via[n]]; steps.push(via[n]); n = e.a === n ? e.b : e.a; order.push(n); }
  order.reverse(); steps.reverse();
  const pts: Pt[] = [a.at, ...order.map((n) => nodes[n]), b.at];
  const at = [0];
  for (let k = 1; k < pts.length; k++) at.push(at[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y));
  const crossings: Walk["crossings"] = [];
  steps.forEach((k, i) => {
    const c = edges[k].crossing;
    // Step i runs from order[i] to order[i + 1]: points i + 1 and i + 2 of the line.
    if (c !== undefined) crossings.push({ c, s0: at[i + 1], s1: at[i + 2] });
  });
  return { pts, crossings };
}
