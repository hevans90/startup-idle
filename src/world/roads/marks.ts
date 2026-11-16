/**
 * World v2 — A WIDE ROAD'S MARKINGS, FROM ITS LANES. Everything painted on a
 * road two cells wide or more that says where to drive is worked out here
 * from the lanes its traffic drives on (`agents/lanes/graph`), and from
 * nothing else:
 *
 *  - a LANE LINE runs half way between two lanes going the same way;
 *  - the MIDDLE, half way between the two lanes nearest it going opposite
 *    ways: a double line, or the central reservation where they stand apart;
 *  - an EDGE LINE, half a lane beyond the outside lane;
 *  - a STOP or GIVE-WAY LINE across each lane where its traffic waits, by the
 *    rule that traffic keeps at that junction;
 *  - an ARROW in each lane for the turns its traffic can take from it;
 *  - a ROUNDEL in the kerb lane, set to the way it is driven.
 *
 * So paint cannot say one thing and traffic do another, and nothing here
 * knows what a jog, a bend, a hill or a hand of the road is: a line goes
 * where the lanes either side of it go. Where there are no lanes there is
 * nothing painted.
 *
 * WHAT COMES OUT is a list of shapes for each cell, in the cell's own (u, v),
 * cut to a little more than the cell, as text: the cell's texture is keyed by
 * it, and a straight road's cells, which get the same shapes, share one.
 * @see render/road-paint paintMarks, plans/roads-quality.md
 */
import type { Grid } from "../grid";
import { idx } from "../grid";
import {
  MEDIAN_HALF, laneSpan, lanesFor, type Arm, type Junction, type Lane, type LaneGraph, type Street,
} from "../agents/lanes/graph";
import { lengths, pointAt, type Pt } from "../agents/lanes/geometry";

/** Half a line's width, tiles: a lane or centre line 150 mm across, an edge line 200 mm. */
export const LINE = 0.007, EDGE = 0.009;
/** A stud's colours, as a line's: white between lanes, red along the edge, amber by the central reservation, green across a side road's mouth. */
export const WHITE = 0, RED = 1, AMBER = 2, GREEN = 3;
/** How far past a cell a shape is kept for it: its neighbours paint a margin of it too. */
const KEEP = 0.25;
/** How far short of a junction a road's middle stops; behind a crossing; and how long its hatched taper is. */
const NOSE = 0.45, NOSE_CROSSED = 0.9, TAPER = 0.36;
/** A street shorter than this has no roundels; one shorter than this, no arrows. */
const ROUNDEL_MIN = 6, ARROW_MIN = 3;

/** A shape in the world: the cell at (x, y) spans x − ½ to x + ½. */
type Shape =
  | { t: "L"; c: number; w: number; p: Pt[] }
  | { t: "K"; p: Pt[] }
  | { t: "P"; c: number; p: Pt[] }
  | { t: "O"; w: number; p: Pt[] }
  | { t: "D"; c: number; at: Pt }
  | { t: "M"; caps: number; p: Pt[] }
  | { t: "H"; at: Pt; to: Pt; h: number }
  | { t: "R"; n: number; at: Pt; h: Pt };

const r3 = (v: number) => { const q = Math.round(v * 1000) / 1000; return q === 0 ? 0 : q; };
const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** A line a share `t` of the way from one lane's to another's: half way between them, or beyond the second. */
function between(P: readonly Pt[], Q: readonly Pt[], t: number): Pt[] {
  if (P.length === Q.length) return P.map((p, k) => lerp(p, Q[k], t));
  // Lanes not built alike: each by how far along it is.
  const ap = lengths(P), aq = lengths(Q), n = Math.max(2, Math.ceil(Math.max(ap[ap.length - 1], aq[aq.length - 1]) * 8));
  return Array.from({ length: n + 1 }, (_, k) => lerp(pointAt(P, ap, (ap[ap.length - 1] * k) / n).p, pointAt(Q, aq, (aq[aq.length - 1] * k) / n).p, t));
}

/** The stretch of a line from `s0` to `s1` along it. */
function part(P: readonly Pt[], at: Float32Array, s0: number, s1: number): Pt[] {
  const out: Pt[] = [pointAt(P, at, s0).p];
  for (let k = 0; k < P.length; k++) if (at[k] > s0 + 1e-6 && at[k] < s1 - 1e-6) out.push(P[k]);
  out.push(pointAt(P, at, s1).p);
  return out;
}

/** A line moved `d` to one side of itself, each point square to the line there. */
function aside(P: readonly Pt[], d: number): Pt[] {
  return P.map((p, k) => {
    const a = P[Math.max(0, k - 1)], b = P[Math.min(P.length - 1, k + 1)], l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: p.x - ((b.y - a.y) / l) * d, y: p.y + ((b.x - a.x) / l) * d };
  });
}

/** A way: its lanes going one way and the other, each from the middle out, all run the same way along it. */
type Way = { k: number; a: Pt[][]; b: Pt[][] };

/** A line's cells and the shapes they get. */
export function marksOf(g: Grid, G: LaneGraph): string[] {
  const out: string[][] = [];
  const put = (x: number, y: number, text: string) => { if (x >= 0 && y >= 0 && x < g.w && y < g.h && g.paved[idx(g, x, y)]) (out[idx(g, x, y)] ??= []).push(text); };
  const loc = (p: Pt, x: number, y: number) => `${r3(p.x - x + 0.5)},${r3(p.y - y + 0.5)}`;
  /** The cells a shape's points come within reach of. */
  const cellsOf = (pts: readonly Pt[], reach: number) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    const cells: [number, number][] = [];
    for (let y = Math.round(y0 - reach); y <= Math.round(y1 + reach); y++) for (let x = Math.round(x0 - reach); x <= Math.round(x1 + reach); x++) cells.push([x, y]);
    return cells;
  };
  /** A line cut to a cell and a little more: its pieces there. */
  const cut = (pts: readonly Pt[], x: number, y: number): { p: Pt[]; first: boolean; last: boolean }[] => {
    const lo = -0.5 - KEEP, hi = 0.5 + KEEP, pieces: { p: Pt[]; first: boolean; last: boolean }[] = [];
    let cur: Pt[] | null = null;
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k], b = pts[k + 1], dx = b.x - a.x, dy = b.y - a.y;
      let t0 = 0, t1 = 1;
      // Liang–Barsky: the part of the segment inside the box.
      const clip = (p: number, q: number) => { if (p === 0) return q >= 0; const r = q / p; if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; } return true; };
      const inside = clip(-dx, a.x - x - lo) && clip(dx, x + hi - a.x) && clip(-dy, a.y - y - lo) && clip(dy, y + hi - a.y);
      if (!inside) { cur = null; continue; }
      const p0 = lerp(a, b, t0), p1 = lerp(a, b, t1);
      if (cur && t0 === 0) cur.push(p1);
      else { cur = [p0, p1]; pieces.push({ p: cur, first: k === 0 && t0 === 0, last: false }); }
      if (t1 < 1) cur = null;
      else if (k + 2 === pts.length) pieces[pieces.length - 1].last = true;
    }
    return pieces;
  };
  const add = (s: Shape) => {
    if (s.t === "L" || s.t === "M" || s.t === "K") {
      for (const [x, y] of cellsOf(s.p, 0.5 + KEEP)) for (const piece of cut(s.p, x, y)) {
        if (piece.p.length < 2) continue;
        const body = piece.p.map((p) => loc(p, x, y)).join(" ");
        put(x, y, s.t === "K" ? `K:${body}` : s.t === "L" ? `L${s.c},${r3(s.w)}:${body}` : `M${(piece.first ? s.caps & 1 : 0) | (piece.last ? s.caps & 2 : 0)}:${body}`);
      }
    } else if (s.t === "P" || s.t === "O") {
      for (const [x, y] of cellsOf(s.p, 0.5 + 0.05)) put(x, y, `${s.t}${s.t === "P" ? s.c : r3(s.w)}:${s.p.map((p) => loc(p, x, y)).join(" ")}`);
    } else if (s.t === "D") {
      for (const [x, y] of cellsOf([s.at], 0.5 + 0.03)) put(x, y, `D${s.c}:${loc(s.at, x, y)}`);
    } else if (s.t === "H") {
      for (const [x, y] of cellsOf([s.at, s.to], 0.5 + 0.1)) put(x, y, `H${r3(s.h)}:${loc(s.at, x, y)} ${loc(s.to, x, y)}`);
    } else {
      for (const [x, y] of cellsOf([s.at], 0.5 + 0.2)) put(x, y, `R${s.n}:${loc(s.at, x, y)} ${r3(s.h.x)},${r3(s.h.y)}`);
    }
  };

  /** Dashes along a line: each `on` long, one every `every`, the first `from` along — and where, a cell's length apart, a road's dashes fall alike in every cell. */
  const dashed = (P: Pt[], c: number, w: number, from: number, on: number, every: number, s0 = 0, s1 = Infinity) => {
    const at = lengths(P), len = Math.min(s1, at[at.length - 1]);
    for (let s = from + Math.ceil((s0 - from - on) / every) * every; s < len; s += every) {
      const a = Math.max(s0, s), b = Math.min(len, s + on);
      if (b - a > 0.01) add({ t: "L", c, w, p: part(P, at, a, b) });
    }
  };
  const solid = (P: Pt[], c: number, w: number, s0 = 0, s1 = Infinity) => {
    const at = lengths(P), len = at[at.length - 1], a = Math.max(0, s0), b = Math.min(len, s1);
    if (b - a > 0.01) add({ t: "L", c, w, p: part(P, at, a, b) });
  };
  const studs = (P: Pt[], c: number, from: number, every: number, s0 = 0, s1 = Infinity) => {
    const at = lengths(P), len = Math.min(s1, at[at.length - 1]);
    for (let s = from + Math.ceil((s0 - from) / every) * every; s <= len + 1e-6; s += every) add({ t: "D", c, at: pointAt(P, at, s).p });
  };

  const junctionAt = (st: Street, e: 0 | 1): Junction | null => { const end = st.ends[e]; return end.kind === "junction" && end.junction >= 0 ? G.junctions[end.junction] : null; };
  const armOf = (J: Junction, st: Street, e: 0 | 1): Arm | undefined => J.arms.find((a) => a.street === st.id && a.end === e);
  /** A wide road's bend: a junction of two ways and no more, the one road both sides of it — as wide, with as many lanes — turning a corner. Its lanes run on round it. (Where a road changes width its lines end, as at any junction.) */
  const bend = (J: Junction | null) => !!J && J.kind === "bend" && J.arms.length === 2 && J.arms[0].width >= 2 && J.arms[0].width === J.arms[1].width
    && Math.abs(J.arms[0].out.x * J.arms[1].out.x + J.arms[0].out.y * J.arms[1].out.y) < 0.1
    && J.arms.every((a) => a.inLanes.length === lanesFor(a.width) && a.outLanes.length === lanesFor(a.width));

  /** A WAY'S LINES: between its lanes, down its middle, and beyond its outside lanes. `t0`, `t1`: how far short of each end its middle stops, and whether hatched there. */
  const lines = (W: Way, ends: [{ trim: number; hatch: boolean; open: boolean }, { trim: number; hatch: boolean; open: boolean }], mouths?: [boolean, boolean]) => {
    const lw = laneSpan(W.k) / lanesFor(W.k);
    if (!W.a.length && !W.b.length) return;
    // (Where its dashes fall along it: by where it starts, so a cell's are in the cell's middle.)
    const first = (W.a[0] ?? W.b[0]), start = first[0], phase = (((Math.abs(first[1]?.x - start.x) > Math.abs(first[1]?.y - start.y) ? start.x : start.y) + 0.5) % 1 + 1) % 1;
    for (const dir of [W.a, W.b]) for (let i = 0; i + 1 < dir.length; i++) {
      const P = between(dir[i], dir[i + 1], 0.5);
      dashed(P, WHITE, LINE, 0.4 - phase, 0.2, 1);
      studs(P, WHITE, -phase, 1);
    }
    // THE EDGES: solid — or, across a side road's mouth, a metre of line to a metre of gap. (On a two-cell road too,
    // thinner, where its lanes end and its parking strip begins: without it the kerb lane reads as running to the
    // kerb, and what is painted in the middle of it looks off to one side.)
    [W.a, W.b].forEach((dir, side) => {
      // (Each way by its own lanes: round a bend between roads of two widths they are not as many.)
      const n = dir.length;
      if (n < 2) return;
      const P = between(dir[n - 2], dir[n - 1], 1.5);
      const w = W.k >= 3 ? EDGE : LINE;
      if (mouths?.[side]) { dashed(P, WHITE, w, 0.02 - phase, 0.09, 0.18); if (W.k >= 3) studs(P, GREEN, 0.155 - phase, 0.36); return; }
      solid(P, WHITE, w);
      if (W.k >= 3) studs(between(dir[n - 2], dir[n - 1], 1.5 + 0.022 / lw), RED, -phase, 0.5);
    });
    if (mouths || !W.a.length || !W.b.length) return;
    // THE MIDDLE.
    const C = between(W.a[0], W.b[0], 0.5), at = lengths(C), len = at[at.length - 1];
    const gap = Math.hypot(W.a[0][0].x - W.b[0][0].x, W.a[0][0].y - W.b[0][0].y);
    const s0 = ends[0].trim, s1 = len - ends[1].trim;
    // (Between two junctions close together there is no room for it at all.)
    if (s1 - s0 < 0.6) return;
    const half = W.k >= 3 ? MEDIAN_HALF : 0.016 + LINE;
    if (W.k >= 3) {
      add({ t: "M", caps: (ends[0].open ? 0 : 1) | (ends[1].open ? 0 : 2), p: part(C, at, s0, s1) });
      for (const sg of [-1, 1]) studs(between(W.a[0], W.b[0], 0.5 + (sg * (MEDIAN_HALF + 0.012)) / gap), AMBER, -phase, 0.5, s0 + 0.1, s1 - 0.1);
    } else for (const sg of [-1, 1]) solid(between(W.a[0], W.b[0], 0.5 + (sg * 0.016) / gap), WHITE, LINE, s0, s1);
    // HATCHED where it ends before a junction: a taper from its nose to a point.
    ends.forEach((e, k) => {
      if (!e.hatch || e.trim < TAPER + 0.05) return;
      const nose = k ? s1 : s0, tip = k ? s1 + TAPER : s0 - TAPER;
      add({ t: "H", at: pointAt(C, at, nose).p, to: pointAt(C, at, tip).p, h: half + (W.k >= 3 ? 0.012 : 0.01) });
    });
  };

  const wide = G.streets.filter((st) => st.width >= 2 && st.lanes.length === 2 * lanesFor(st.width));
  for (const st of wide) {
    const n = lanesFor(st.width), L = st.lanes.map((id) => G.lanes[id]);
    const W: Way = { k: st.width, a: L.slice(0, n).map((l) => l.pts), b: L.slice(n).map((l) => [...l.pts].reverse()) };
    const end = (e: 0 | 1) => {
      const J = junctionAt(st, e);
      if (!J) return { trim: st.ends[e].kind === "dead" ? 0.12 : 0, hatch: false, open: st.ends[e].kind !== "dead" };
      if (bend(J)) return { trim: 0, hatch: false, open: true };
      return { trim: armOf(J, st, e)?.crossing !== undefined ? NOSE_CROSSED : NOSE, hatch: true, open: false };
    };
    // WHERE THE TYRES RUN: two tracks down each lane, first, under everything else.
    for (const l of L) for (const o of [-0.055, 0.055]) add({ t: "K", p: aside(l.pts, o) });
    lines(W, [end(0), end(1)]);

    // AT EACH END, for the lanes coming in to it: where they wait, and what they may do there.
    for (const e of [0, 1] as const) {
      const J = junctionAt(st, e);
      if (!J || bend(J)) continue;
      const arm = armOf(J, st, e), incoming = (e ? L.slice(0, n) : L.slice(n));
      const lw = laneSpan(st.width) / n;
      // THE LINE THEY WAIT AT: a stop line at lights; give way onto a roundabout, and from the minor road.
      const rule = J.kind === "signals" ? "stop" : J.kind === "roundabout" || (J.kind === "priority" && arm && !arm.major) ? "give" : "";
      const hold = Math.min(...incoming.map((l) => l.hold ?? 0.12));
      if (rule) for (const l of incoming) {
        const frame = (back: number, across: number): Pt => { const { p, h } = pointAt(l.pts, l.at, l.len - back); return { x: p.x - h.y * across, y: p.y + h.x * across }; };
        const bar = (b0: number, b1: number, c0: number, c1: number) => add({ t: "P", c: WHITE, p: [frame(b0, c0), frame(b0, c1), frame(b1, c1), frame(b1, c0)] });
        if (rule === "stop") { bar(hold - 0.045, hold, -lw / 2, lw / 2); continue; }
        for (const b of [hold - 0.03, hold - 0.08]) for (let c = -lw / 2 + 0.012; c < lw / 2 - 0.02; c += 0.075) bar(b, b + 0.022, c, Math.min(lw / 2 - 0.005, c + 0.045));
        // The triangle behind it, where the way in is not crossed on foot: long, its point toward the driver.
        if (arm?.crossing === undefined && l.len > 1.2) add({ t: "O", w: 0.016, p: [frame(hold + 0.1, -0.06), frame(hold + 0.1, 0.06), frame(hold + 0.54, 0)] });
      }
      // ARROWS, where there are lanes to choose between: in each, the turns its traffic can take from it.
      if (n >= 2 && J.arms.length >= 3 && J.kind !== "roundabout") for (const l of incoming) {
        if (l.len < ARROW_MIN) continue;
        const turns = new Set(l.next.map((c) => G.lanes[c]?.turn));
        const { p, h } = pointAt(l.pts, l.at, l.len - 1.5);
        // `t` on the way it is going, `c` to its right as the driver sees it: a turn of the way, not a side of the road.
        const pt = (t: number, c: number): Pt => ({ x: p.x + h.x * t - h.y * c, y: p.y + h.y * t + h.x * c });
        const ahead = turns.has("straight");
        add({ t: "P", c: WHITE, p: ahead ? [pt(-0.3, -0.018), pt(0.13, -0.018), pt(0.13, 0.018), pt(-0.3, 0.018)] : [pt(-0.3, -0.018), pt(-0.06, -0.018), pt(-0.06, 0.018), pt(-0.3, 0.018)] });
        if (ahead) add({ t: "P", c: WHITE, p: [pt(0.3, 0), pt(0.12, -0.058), pt(0.12, 0.058)] });
        for (const [turn, sg] of [["left", -1], ["right", 1]] as const) {
          if (!turns.has(turn)) continue;
          const a = pt(-0.1, 0), b = pt(0.05, sg * 0.085), d = Math.hypot(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / d, uy = (b.y - a.y) / d, hw = 0.017;
          add({ t: "P", c: WHITE, p: [{ x: a.x - uy * hw, y: a.y + ux * hw }, { x: b.x - uy * hw, y: b.y + ux * hw }, { x: b.x + uy * hw, y: b.y - ux * hw }, { x: a.x + uy * hw, y: a.y - ux * hw }] });
          add({ t: "P", c: WHITE, p: [{ x: b.x + ux * 0.1, y: b.y + uy * 0.1 }, { x: b.x - uy * 0.052, y: b.y + ux * 0.052 }, { x: b.x + uy * 0.052, y: b.y - ux * 0.052 }] });
        }
      }
      // A ROUNDEL in the kerb lane each way, three cells out of a junction of three ways or more.
      if (J.arms.length >= 3 && st.a1 - st.a0 + 1 >= ROUNDEL_MIN) {
        const limit = st.width < 3 ? 30 : 40;
        const out = (e ? L.slice(n) : L.slice(0, n))[n - 1], inn = incoming[n - 1];
        for (const [l, s] of [[out, 2.3], [inn, inn.len - 2.7]] as [Lane, number][]) {
          if (s < 0.5 || s > l.len - 0.5) continue;
          const { p, h } = pointAt(l.pts, l.at, s);
          add({ t: "R", n: limit, at: p, h });
        }
      }
    }
  }

  for (const J of G.junctions) {
    const streetLane = (c: Lane) => G.lanes.find((l) => l.kind === "street" && l.next.includes(c.id));
    const conns = G.lanes.filter((l) => l.kind === "connector" && l.junction === J.id);
    /** The curves from one arm to another, by the slot of the lane each leaves. */
    const from = (i: number, j: number, turn?: string) => conns
      .filter((c) => c.arm === i && (turn === undefined || c.turn === turn) && J.arms[j].outLanes.includes(c.next[0]))
      .map((c) => ({ c, slot: streetLane(c)?.slot ?? 0 })).sort((p, q) => p.slot - q.slot).map((q) => q.c.pts);
    // ROUND A WIDE ROAD'S BEND its lines run on: the curves its lanes take, as a way of their own.
    if (bend(J)) {
      const a = from(0, 1), b = from(1, 0).map((p) => [...p].reverse());
      const k = Math.min(J.arms[0].width, J.arms[1].width);
      if (a.length && b.length) lines({ k, a, b }, [{ trim: 0, hatch: false, open: true }, { trim: 0, hatch: false, open: true }]);
      continue;
    }
    // THROUGH A JUNCTION ON THE MAIN ROAD, where side roads meet it and it has the right of way: its lane lines run
    // on, and its edge line across each side road's mouth as an exit's dashes. Its middle is open: traffic turns across it.
    if (J.kind !== "priority") continue;
    const major = J.arms.map((a, i) => (a.major && a.width >= 2 ? i : -1)).filter((i) => i >= 0);
    if (major.length !== 2) continue;
    const [i, j] = major, a = from(i, j, "straight"), b = from(j, i, "straight").map((p) => [...p].reverse());
    // (The one road both sides, straight through: as wide, a lane on for every lane in.)
    const same = J.arms[i].width === J.arms[j].width && J.arms[i].out.x * J.arms[j].out.x + J.arms[i].out.y * J.arms[j].out.y < -0.9;
    if (!same || a.length !== lanesFor(J.arms[i].width) || b.length !== a.length) continue;
    // A side road off each side: an arm that is neither of the two, on that side of the way through.
    const h = { x: J.arms[j].out.x, y: J.arms[j].out.y };
    const sideOf = (dir: Pt[][]) => { const o = { x: dir[dir.length - 1][0].x - dir[0][0].x, y: dir[dir.length - 1][0].y - dir[0][0].y }; return Math.sign(h.x * o.y - h.y * o.x); };
    const mouth = (dir: Pt[][]) => J.arms.some((A, q) => q !== i && q !== j && Math.sign(h.x * A.out.y - h.y * A.out.x) === sideOf(dir));
    lines({ k: Math.min(J.arms[i].width, J.arms[j].width), a, b }, [{ trim: 0, hatch: false, open: true }, { trim: 0, hatch: false, open: true }], [mouth(a), mouth(b)]);
  }
  const text: string[] = new Array(g.w * g.h).fill("");
  out.forEach((list, i) => { text[i] = list.join(";"); });
  return text;
}
