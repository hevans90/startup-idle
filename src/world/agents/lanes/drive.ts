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

/**
 * LIGHTS, as real ones are: a green held while traffic keeps coming on it and
 * given up once it stops and somebody waits the other way — no sooner than
 * `MIN_GREEN`, no later than `MAX_GREEN` while they do; amber, then all red.
 * People cross a road while its traffic is held, the cars turning into it
 * giving way to them: no walk of its own to stop everybody for. Seconds.
 * @see stepSignals, walkOn
 */
export const MIN_GREEN = 4, MAX_GREEN = 8, AMBER = 2, CLEARANCE = 1.5;
/** How long into a green people may step out over the roads it holds: after it, those turning get their turn. */
export const WALK_FOR = 4;
/** The longest round: both ways at their longest. */
export const CYCLE = 2 * (MAX_GREEN + AMBER + CLEARANCE);

/** A lights junction now: the way that has (or last had) the green, what it shows, and since when. */
export type Signal = { group: 0 | 1; stage: "green" | "amber" | "clear"; since: number };

export type Traffic = {
  G: LaneGraph;
  /** What the roads were when it was built. @see roadKey */
  key: string;
  /** The street lanes passing through each cell. */
  byCell: Map<number, number[]>;
  /** Each held zone: the curve whose cars hold it, and which cars. */
  claims: Map<number, { lane: number; cars: Set<number> }>;
  /** Each lights junction's controller. @see stepSignals */
  signals: Map<number, Signal>;
  /** The lanes leading into each lane. */
  into: Map<number, number[]>;
  /**
   * Two curves from one lane, `a,b`: how far along `a` it is till it is clear
   * of `b` — a car on `b` till then follows one on `a` as if on its own lane.
   */
  split: Map<string, number>;
  /** Zones a car has waited long for, a curve of another's holding them: whose curve, and when last asked. No more join that hold. */
  hungry: Map<number, { lane: number; at: number }>;
  /** Each lane's crossings, where along it, in order; and each crossing's lanes. */
  over: Map<number, { c: number; s: number }[]>;
  lanesOver: Map<number, number[]>;
};

/** Curves this far apart, middle to middle, keep their cars clear of each other, tiles. */
const APART = 0.34;

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
  const signals = new Map<number, Signal>();
  for (const J of G.junctions) if (J.kind === "signals") signals.set(J.id, { group: (J.id % 2) as 0 | 1, stage: "green", since: -((J.id * 7.31) % 1) * MIN_GREEN });
  const into = new Map<number, number[]>();
  for (const l of G.lanes) for (const n of l.next) { const p = into.get(n); if (p) p.push(l.id); else into.set(n, [l.id]); }
  const split = new Map<string, number>();
  for (const l of G.lanes) {
    if (l.next.length < 2) continue;
    for (const a of l.next) for (const b of l.next) {
      if (a === b) continue;
      const A = G.lanes[a], B = G.lanes[b];
      let s = 0;
      while (s < A.len && nearestOn(B, pointAt(A.pts, A.at, s).p).d < APART) s += 0.1;
      split.set(`${a},${b}`, s);
    }
  }
  // OVER THE CROSSINGS: where each lane runs over each, by lane, along it.
  const over = new Map<number, { c: number; s: number }[]>();
  const lanesOver = new Map<number, number[]>();
  for (const c of G.crossings) {
    const a = G.walk.nodes[c.a], b = G.walk.nodes[c.b];
    const near = new Set<number>();
    for (const i of c.cells) for (const l of byCell.get(i) ?? []) near.add(l);
    for (const id of near) {
      const l = G.lanes[id];
      for (let k = 1; k < l.pts.length; k++) {
        const t = segCross(l.pts[k - 1], l.pts[k], a, b);
        if (t === null) continue;
        const s = l.at[k - 1] + t * (l.at[k] - l.at[k - 1]);
        const list = over.get(id) ?? [];
        list.push({ c: c.id, s });
        over.set(id, list.sort((p, q) => p.s - q.s));
        const ls = lanesOver.get(c.id) ?? [];
        if (!ls.includes(id)) ls.push(id);
        lanesOver.set(c.id, ls);
        break;
      }
    }
  }
  return { G, key, byCell, claims: new Map(), signals, into, split, hungry: new Map(), over, lanesOver };
}

/** Where along p0→p1 it crosses q0→q1, 0–1, or null. */
function segCross(p0: Pt, p1: Pt, q0: Pt, q1: Pt): number | null {
  const rx = p1.x - p0.x, ry = p1.y - p0.y, sx = q1.x - q0.x, sy = q1.y - q0.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const qx = q0.x - p0.x, qy = q0.y - p0.y;
  const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
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

/**
 * WHERE A VEHICLE ALREADY UNDER WAY GOES ON FROM, the roads changed under
 * it: the lanes right by it — round a new roundabout's ring, or on a curve
 * through a junction, as much as along a street — running the way it faces,
 * nearest first. Never one across the junction or behind it: it would have
 * to cut over the island, or turn on the spot, to get to it.
 */
export function spotsUnderWay(T: Traffic, at: { x: number; y: number; heading: number }): Spot[] {
  const hx = Math.cos(at.heading), hy = Math.sin(at.heading);
  const found: { lane: number; s: number; score: number }[] = [];
  for (const l of T.G.lanes) {
    const { s, d } = nearestOn(l, at);
    if (d > UNDER_WAY_NEAR) continue;
    const { p, h } = pointAt(l.pts, l.at, s);
    const along = h.x * hx + h.y * hy;
    if (along < UNDER_WAY_FACING || (p.x - at.x) * hx + (p.y - at.y) * hy < -0.15 || l.len - s < 0.1) continue;
    // (Onto it a little ahead, the further off it the further: across gently, not sideways.)
    found.push({ lane: l.id, s: Math.min(l.len - 0.1, s + 0.5 + 1.5 * d), score: d + (1 - along) * 0.5 });
  }
  const best = Math.min(...found.map((f) => f.score));
  return found.filter((f) => f.score < best + 0.15).map(({ lane, s }) => ({ lane, s }));
}
/** How near a lane has to be, tiles, and how much the way it runs the way a vehicle faces, to go on from. */
const UNDER_WAY_NEAR = 0.9, UNDER_WAY_FACING = 0.4;

/**
 * CHANGING LANE: what it costs a route, the clear road it needs from where it
 * starts on the lane it leaves, and how long the move across takes, tiles.
 */
export const CHANGE_COST = 1.5;
const CHANGE_ROOM = 2.6;
export const CHANGE_LEN = 1;
/** Whether a route's step from `a` to `b` is a change of lane on one street. */
export const isChange = (G: LaneGraph, a: number, b: number) => !!G.lanes[a].beside?.includes(b);

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
  // How many lanes across a lane was come to by, one after another.
  const changesBefore = (id: number) => { let n = 0; for (let at = id, p = prev.get(at) ?? -1; p >= 0 && isChange(G, p, at); at = p, p = prev.get(at) ?? -1) n++; return n; };
  while (heap.length) {
    const [c, id] = pop();
    if (c > (cost.get(id) ?? Infinity)) continue;
    if (best && c >= best.c) break;
    // ACROSS to a lane beside it, if there is the road to do it in — and on
    // across the next, one after another, as far as the turn wants. (Never back.)
    const here = G.lanes[id], before = prev.get(id) ?? -1;
    if (here.beside && here.len - (startS.get(id) ?? 0) >= CHANGE_ROOM * (1 + changesBefore(id))) {
      for (const n of here.beside) {
        if (n === before) continue;
        const nc = c + CHANGE_COST;
        if (nc < (cost.get(n) ?? Infinity)) { cost.set(n, nc); prev.set(n, id); startS.delete(n); push(nc, n); }
      }
    }
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

/**
 * A route as one line; where along it each of its lanes begins (its point 0,
 * which may be behind the line's start, or level with a lane changed from);
 * and where the vehicle comes onto each — for a change of lane, where it
 * starts across.
 */
export function lineOf(G: LaneGraph, r: Route): { pts: Pt[]; start: number[]; enter: number[] } {
  const pts: Pt[] = [];
  const start: number[] = [], enter: number[] = [];
  let run = 0;
  const add = (p: Pt) => {
    const last = pts[pts.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1e-6) return;
    if (last) run += Math.hypot(p.x - last.x, p.y - last.y);
    pts.push(p);
  };
  let from = r.s0;
  r.lanes.forEach((id, k) => {
    const l = G.lanes[id];
    const a = from, next = r.lanes[k + 1];
    from = 0;
    let b = k === r.lanes.length - 1 ? r.s1 : l.len;
    if (next !== undefined && isChange(G, id, next)) {
      // Across before the end, with room to settle in the new lane first.
      b = Math.max(a + 0.2, Math.min(l.len - CHANGE_LEN - 1.6, l.len - 3));
    }
    if (k > 0 && isChange(G, r.lanes[k - 1], id)) {
      // THE MOVE ACROSS: from the lane left, eased onto this one.
      const was = G.lanes[r.lanes[k - 1]];
      const c0 = pointAt(was.pts, was.at, Math.min(was.len, nearestOn(was, pts[pts.length - 1]).s)).p;
      const s0 = nearestOn(was, c0).s;
      enter.push(run);
      for (let i = 1; i <= 4; i++) {
        const f = i / 4, w = f * f * (3 - 2 * f);
        const pa = pointAt(was.pts, was.at, Math.min(was.len, s0 + f * CHANGE_LEN)).p;
        const pb = pointAt(l.pts, l.at, nearestOn(l, pa).s).p;
        add({ x: pa.x + (pb.x - pa.x) * w, y: pa.y + (pb.y - pa.y) * w });
      }
      const on = nearestOn(l, pts[pts.length - 1]).s;
      start.push(run - on);
      for (const p of slice(l, on, Math.max(on, b))) add(p);
      return;
    }
    start.push(run - a);
    enter.push(run);
    for (const p of slice(l, a, b)) add(p);
  });
  return { pts, start, enter };
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

/** Which way an arm of a lights junction is: across (0) or up and down (1). */
export const groupOf = (T: Traffic, junction: number, arm: number): 0 | 1 => {
  const a = T.G.junctions[junction].arms[arm];
  return a && Math.abs(a.out.x) > 0.5 ? 0 : 1;
};

/** The light an arm of a lights junction shows now. @see stepSignals */
export function lightOf(T: Traffic, junction: number, arm: number, _t?: number): "green" | "amber" | "red" {
  const S = T.signals.get(junction);
  if (!S || !T.G.junctions[junction].arms[arm]) return "green";
  if (groupOf(T, junction, arm) !== S.group) return "red";
  return S.stage === "green" ? "green" : S.stage === "amber" ? "amber" : "red";
}

/** Whether the walk is lit over an arm's crossing at `t`: its traffic held, early in the other way's green. */
export function walkOn(T: Traffic, junction: number, arm: number, t: number): boolean {
  const S = T.signals.get(junction);
  return !!S && S.stage === "green" && t - S.since < WALK_FOR && groupOf(T, junction, arm) !== S.group;
}

/**
 * THE LIGHTS, a step on, at `t`: `wants(j, group)`, whether traffic is coming
 * to junction `j` that way — or people waiting to cross the other. A green
 * stays while it is wanted and nobody waits the other way; once they do, it
 * goes when its traffic stops coming, or at its longest.
 */
export function stepSignals(T: Traffic, t: number, wants: (j: number, group: 0 | 1) => boolean): void {
  for (const [j, S] of T.signals) {
    const e = t - S.since, go = (stage: Signal["stage"]) => { S.stage = stage; S.since = t; };
    if (S.stage === "green") {
      if (e >= MIN_GREEN && wants(j, (1 - S.group) as 0 | 1) && (!wants(j, S.group) || e >= MAX_GREEN)) go("amber");
    } else if (S.stage === "amber") {
      if (e >= AMBER) go("clear");
    } else if (e >= CLEARANCE) { S.group = (1 - S.group) as 0 | 1; go("green"); }
  }
}

/** Where a zone is along one of its two lanes, and the other lane. */
export function zoneOn(T: Traffic, zone: number, lane: number): { s: number; e: number; other: number } {
  const z = T.G.zones[zone];
  return z.a === lane ? { s: z.sa, e: z.ea, other: z.b } : { s: z.sb, e: z.eb, other: z.a };
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
