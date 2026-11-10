/**
 * World v2 — DRIVING ON THE LANES: where a car's trip starts and ends on the
 * lane graph, the lanes between, and the rules at a junction that let one
 * car through at a time where their ways cross. @see graph, plans/traffic-overhaul.md
 *
 * A ROUTE is lanes end to end, from a point on the first to a point on the
 * last, cheapest by length, a turn costing a little and a U-turn a lot. The
 * car follows the lanes' lines joined into one, so everything that moves a
 * mover along a line moves it.
 *
 * THROUGH A JUNCTION, a car waits at the end of its lane until it may take
 * the curve ahead:
 *  - every CONFLICT ZONE on that curve is free — none held by a car on a
 *    curve that crosses it — and it holds them, each until it is past;
 *  - there is ROOM on the far side, so nobody stops in the junction and
 *    blocks it for everyone else;
 *  - and the junction's rule lets it go: LIGHTS green, or amber too near to
 *    stop; at a GIVE WAY, nobody with the right of way coming on a curve
 *    that crosses its own — the main road over a side street, oncoming
 *    traffic over a car turning across it, the ring of a ROUNDABOUT over a
 *    car coming on. One kept waiting long enough goes anyway when it can:
 *    held zones still keep it out of anyone's way.
 * Cars on the same curve share its zones: one behind another, they follow.
 */
import type { Grid } from "../../grid";
import { idx } from "../../grid";
import { isPaved } from "../../roads/mask";
import { buildLaneGraph, LANE_CLEAR, type Lane, type LaneGraph } from "./graph";
import { dot, pointAt, sub, type Pt } from "./geometry";

export type Spot = { lane: number; s: number };
export type Route = { lanes: number[]; s0: number; s1: number };

/** Lights: green, amber, and the all-red between, seconds. */
export const GREEN = 9, AMBER = 2, CLEARANCE = 1.5;
export const CYCLE = 2 * (GREEN + AMBER + CLEARANCE);

export type Traffic = {
  G: LaneGraph;
  /** What the roads were when it was built. @see roadKey */
  key: string;
  /** The street lanes passing through each cell. */
  byCell: Map<number, number[]>;
  /** Each held zone: the curve whose cars hold it, and which cars. */
  claims: Map<number, { lane: number; cars: Set<number> }>;
  /** Each lights junction's offset into the cycle, so no two change together. */
  offset: Map<number, number>;
  /** The lanes leading into each lane. */
  into: Map<number, number[]>;
};

/** What the roads are, cheaply: their cells, heights and ramps. Equal keys, equal graphs. */
export function roadKey(g: Grid): string {
  let h = 0x811c9dc5, n = 0;
  for (let i = 0; i < g.w * g.h; i++) {
    if (!isPaved(g, i % g.w, (i / g.w) | 0)) continue;
    n++;
    h = Math.imul(h ^ i, 0x01000193);
    h = Math.imul(h ^ (g.height[i] + 97 * g.ramp[i]), 0x01000193);
    h = Math.imul(h ^ (g.deck[i] * 1000 + g.deckZ[i]), 0x01000193);
  }
  return `${g.w}x${g.h}:${n}:${h >>> 0}`;
}

export function buildTraffic(g: Grid, key = roadKey(g)): Traffic {
  const G = buildLaneGraph(g);
  const byCell = new Map<number, number[]>();
  for (const l of G.lanes) {
    if (l.kind !== "street") continue;
    for (let s = 0; s <= l.len; s += 0.25) {
      const { p } = pointAt(l.pts, l.at, s);
      const x = Math.round(p.x), y = Math.round(p.y);
      if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
      const k = idx(g, x, y), list = byCell.get(k);
      if (!list) byCell.set(k, [l.id]);
      else if (!list.includes(l.id)) list.push(l.id);
    }
  }
  const offset = new Map<number, number>();
  for (const J of G.junctions) if (J.kind === "signals") offset.set(J.id, ((J.id * 7.31) % 1) * CYCLE);
  const into = new Map<number, number[]>();
  for (const l of G.lanes) for (const n of l.next) { const p = into.get(n); if (p) p.push(l.id); else into.set(n, [l.id]); }
  return { G, key, byCell, claims: new Map(), offset, into };
}

/** The nearest point of a lane to a point, as a distance along it. */
export function nearestOn(l: Lane, p: Pt): { s: number; d: number } {
  let best = { s: 0, d: Infinity };
  for (let k = 1; k < l.pts.length; k++) {
    const a = l.pts[k - 1], b = l.pts[k], ab = sub(b, a);
    const l2 = dot(ab, ab);
    const t = l2 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
    const d = Math.hypot(a.x + ab.x * t - p.x, a.y + ab.y * t - p.y);
    if (d < best.d) best = { s: l.at[k - 1] + t * (l.at[k] - l.at[k - 1]), d };
  }
  return best;
}

/**
 * WHERE ON THE LANES a trip at a cell starts or ends: the nearest point of
 * each street lane through it or beside it, both ways. At the edge of the
 * map, the lane coming on there (a start) or going off (an end).
 */
export function spotsAt(T: Traffic, g: Grid, c: Pt, rim: "start" | "end" | null): Spot[] {
  const { G } = T;
  if (rim) {
    const ok = (l: Lane) => (rim === "start" ? l.source : l.sink);
    const end = (l: Lane) => (rim === "start" ? l.pts[0] : l.pts[l.pts.length - 1]);
    const near = G.lanes.filter((l) => ok(l) && Math.hypot(end(l).x - c.x, end(l).y - c.y) < 1.2);
    if (near.length) return near.map((l) => ({ lane: l.id, s: rim === "start" ? 0 : l.len }));
  }
  const seen = new Set<number>();
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = Math.round(c.x) + dx, y = Math.round(c.y) + dy;
    if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
    for (const id of T.byCell.get(idx(g, x, y)) ?? []) seen.add(id);
  }
  let found = [...seen].map((id) => ({ lane: id, ...nearestOn(G.lanes[id], c) })).filter((o) => o.d < 1.2);
  if (!found.length) {
    // In a junction or a square: the nearest street lanes anywhere.
    const all = G.lanes.filter((l) => l.kind === "street").map((l) => ({ lane: l.id, ...nearestOn(l, c) }));
    const d = Math.min(...all.map((o) => o.d));
    found = all.filter((o) => o.d < d + 0.6);
  }
  return found.map(({ lane, s }) => ({ lane, s }));
}

/** What taking a lane costs on top of its length. */
const costOf = (l: Lane) => (l.turn === "uturn" ? 6 : l.turn === "left" || l.turn === "right" ? 0.3 : 0);

/**
 * The cheapest way along the lanes from any of `starts` to any of `goals`, or
 * null if there is none. Ends nearer than `min` along one lane do not count:
 * a trip is somewhere to get to.
 */
export function routeLanes(G: LaneGraph, starts: readonly Spot[], goals: readonly Spot[], min = 0.5): Route | null {
  const goalOn = new Map<number, number[]>();
  for (const g of goals) { const l = goalOn.get(g.lane); if (l) l.push(g.s); else goalOn.set(g.lane, [g.s]); }
  // Cost at the END of each lane, and the lane before it.
  const cost = new Map<number, number>(), prev = new Map<number, number>();
  const startS = new Map<number, number>();
  /** The best way found: its cost, the goal's lane and point on it, and the lane before (-1: it starts there). */
  let best: { c: number; lane: number; s1: number; from: number } | null = null;
  const heap: [number, number][] = [];
  const push = (c: number, l: number) => {
    heap.push([c, l]);
    for (let k = heap.length - 1; k > 0;) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let k = 0; ;) {
        const a = 2 * k + 1, b = a + 1;
        let m = k;
        if (a < heap.length && heap[a][0] < heap[m][0]) m = a;
        if (b < heap.length && heap[b][0] < heap[m][0]) m = b;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
      }
    }
    return top;
  };
  for (const st of starts) {
    const l = G.lanes[st.lane];
    for (const gs of goalOn.get(st.lane) ?? []) {
      if (gs - st.s >= min && (!best || gs - st.s < best.c)) best = { c: gs - st.s, lane: st.lane, s1: gs, from: -1 };
    }
    const c = l.len - st.s;
    if (c < (cost.get(st.lane) ?? Infinity)) { cost.set(st.lane, c); startS.set(st.lane, st.s); prev.set(st.lane, -1); push(c, st.lane); }
  }
  while (heap.length) {
    const [c, id] = pop();
    if (c > (cost.get(id) ?? Infinity)) continue;
    if (best && c >= best.c) break;
    for (const n of G.lanes[id].next) {
      const ln = G.lanes[n];
      for (const gs of goalOn.get(n) ?? []) {
        const total = c + costOf(ln) + gs;
        if (!best || total < best.c) best = { c: total, lane: n, s1: gs, from: id };
      }
      const nc = c + costOf(ln) + ln.len;
      if (nc < (cost.get(n) ?? Infinity)) { cost.set(n, nc); prev.set(n, id); startS.delete(n); push(nc, n); }
    }
  }
  if (!best) return null;
  const lanes: number[] = [best.lane];
  if (best.from < 0) return { lanes, s0: startS.get(best.lane) ?? 0, s1: best.s1 };
  for (let at = best.from; at >= 0; at = prev.get(at) ?? -1) lanes.push(at);
  lanes.reverse();
  return { lanes, s0: startS.get(lanes[0]) ?? 0, s1: best.s1 };
}

/** A route as one line, and where along it each of its lanes begins (its point 0, which may be behind the line's start). */
export function lineOf(G: LaneGraph, r: Route): { pts: Pt[]; start: number[] } {
  const pts: Pt[] = [];
  const start: number[] = [];
  let run = 0;
  r.lanes.forEach((id, k) => {
    const l = G.lanes[id];
    const a = k === 0 ? r.s0 : 0, b = k === r.lanes.length - 1 ? r.s1 : l.len;
    start.push(run - a);
    const piece = slice(l, a, b);
    for (const p of piece) {
      const last = pts[pts.length - 1];
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1e-6) continue;
      if (last) run += Math.hypot(p.x - last.x, p.y - last.y);
      pts.push(p);
    }
  });
  return { pts, start };
}

/** The piece of a lane from `a` to `b` along it. */
function slice(l: Lane, a: number, b: number): Pt[] {
  const out: Pt[] = [pointAt(l.pts, l.at, a).p];
  for (let k = 1; k < l.pts.length - 1; k++) if (l.at[k] > a && l.at[k] < b) out.push(l.pts[k]);
  out.push(pointAt(l.pts, l.at, b).p);
  return out;
}

/** A lane inside a junction: a car must be let onto it. */
export const inside = (l: Lane) => l.junction !== undefined;

/** The light an arm of a lights junction shows, at a time. */
export function lightOf(T: Traffic, junction: number, arm: number, t: number): "green" | "amber" | "red" {
  const J = T.G.junctions[junction];
  const a = J.arms[arm];
  if (!a) return "green";
  const group = Math.abs(a.out.x) > 0.5 ? 0 : 1;
  const tau = (((t + (T.offset.get(junction) ?? 0)) % CYCLE) + CYCLE) % CYCLE;
  const into = tau - group * (GREEN + AMBER + CLEARANCE);
  if (into >= 0 && into < GREEN) return "green";
  if (into >= GREEN && into < GREEN + AMBER) return "amber";
  return "red";
}

/** Where a zone is along one of its two lanes, and the other lane. */
export function zoneOn(T: Traffic, zone: number, lane: number): { s: number; other: number } {
  const z = T.G.zones[zone];
  return z.a === lane ? { s: z.sa, other: z.b } : { s: z.sb, other: z.a };
}

/** Whether cars coming onto `b` have the right of way over a car taking `y`. */
export function yieldsTo(T: Traffic, y: Lane, b: Lane): boolean {
  if (y.junction === undefined || y.junction !== b.junction) return false;
  const J = T.G.junctions[y.junction];
  if (J.kind === "roundabout") return y.kind === "entry" && b.kind === "ring";
  if (y.arm === undefined || b.arm === undefined) return false;
  const ay = J.arms[y.arm], ab = J.arms[b.arm];
  const opposite = dot(ay.out, ab.out) < -0.9;
  // Across oncoming traffic, a turn waits for it.
  const across = y.turn === "left" && opposite && b.turn !== "left";
  if (J.kind === "signals") return across;
  if (J.kind === "priority") return (ab.major && !ay.major) || (ab.major === ay.major && across);
  return false;
}

/**
 * How far round a roundabout's ring a point is from the port at angle `port`,
 * the way the ring goes (angles falling), tiles.
 */
export function roundTo(T: Traffic, junction: number, p: Pt, port: number): number {
  const J = T.G.junctions[junction];
  const R = Math.hypot(p.x - J.centre.x, p.y - J.centre.y);
  let a = Math.atan2(p.y - J.centre.y, p.x - J.centre.x) - port;
  a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return a * R;
}

/** Seconds waited at a line after which a car goes when it can, right of way or not. */
export const PATIENT = 8;
export { LANE_CLEAR };
