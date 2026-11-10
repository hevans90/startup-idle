/**
 * World v2 — THE LANE GRAPH: the roads as traffic and walkers use them, built
 * from the road cells once per change of the roads.
 * @see plans/traffic-overhaul.md, phase 1
 *
 * STREETS (`roads/streets.ts`) are the runs of road between junctions. A
 * CLEAN street is straight: slices of the same width across, each joined to
 * the next all the way across, and nothing joining it from the side. Each
 * gets LANES, a straight line each from end to end, placed where the paint
 * puts them: a lone lane each way ±0.12 from the middle of a one-cell road,
 * a lane a cell on a road two wide, more on wider roads. Traffic keeps right.
 *
 * JUNCTIONS are the rest: the cells no clean street has, joined up into
 * regions. The streets meeting there are its ARMS. Through a junction run
 * CONNECTORS, a curve from each lane in to each lane out it may take — the
 * right-hand lane turns right, the left-hand turns left, any goes straight —
 * and where two of those come within a lane's width of each other, a
 * CONFLICT ZONE, which phase 2's rules hand out one car at a time. A
 * ROUNDABOUT is a ring instead: lanes round it from port to port, with
 * curves on and off. A dead end gets a U-turn, and a street off the edge of
 * the map is where trips from the world beyond come and go.
 *
 * PAVEMENTS are wherever a road cell has no road beside it, as the paint
 * has them: a strip along each kerb, joined along the street, round outer
 * corners, and round the kerb's nub where a side street leaves. Across each
 * street's mouth at a junction, a CROSSING joins the kerbs either side. A
 * walker gets anywhere on the pavements, crossing only there.
 *
 * Pure: from the grid to plain data, in tile space (a cell's middle at its
 * whole coordinates). Heights are the road's, looked up where a mover is.
 */
import { NEIGHBOUR } from "../../../iso/dir";
import { idx, inBounds, type Grid } from "../../grid";
import { connects, isPaved } from "../../roads/mask";
import { streetsOf } from "../../roads/streets";
import {
  add, arc, chaikin, cross, distToLine, dot, lengths, minRadius, pointAt, right, turnCurve, type Pt,
} from "./geometry";

/** The pavement's width with its kerb, tiles: `WALK` in render/road-paint.ts. */
export const WALK = 0.26;
/** How far from a cell's middle a walker on its pavement is. */
export const PAVE_AT = 0.5 - WALK / 2;
/**
 * Two curves nearer than this, tiles, are in each other's way; or nearer
 * than {@link LANE_SWEEP} where they cross at an angle, since a car's body
 * swings wide of its line on a turn. Lanes side by side, either way, are not.
 */
export const LANE_CLEAR = 0.22;
export const LANE_SWEEP = 0.42;
/** How clear of the junction's other curves a car waiting at its line keeps its nose. */
export const HOLD_CLEAR = 0.3;

const DIRS = ["N", "E", "S", "W"] as const;
type Dir = (typeof DIRS)[number];
const V = (d: Dir): Pt => ({ x: NEIGHBOUR[d][0], y: NEIGHBOUR[d][1] });
const dirOf = (h: Pt): Dir => (h.x < 0 ? "N" : h.x > 0 ? "S" : h.y < 0 ? "E" : "W");

export type Turn = "straight" | "left" | "right" | "uturn";

export type Lane = {
  id: number;
  /** A street's lane; a curve through a junction; a ring's piece between ports; on or off a ring. */
  kind: "street" | "connector" | "ring" | "entry" | "exit";
  pts: Pt[];
  at: Float32Array;
  len: number;
  /** The lanes it leads into. */
  next: number[];
  /** A street lane's street, its slot from the middle (0 nearest it), and how many lanes its way has. */
  street?: number;
  slot?: number;
  lanes?: number;
  /** A street lane's neighbours going the same way, a slot either side: where a car may change lane to. */
  beside?: number[];
  /** A curve's junction, the arm it comes in from (an index into the junction's arms), the way it turns, and its tightest radius. */
  junction?: number;
  arm?: number;
  turn?: Turn;
  radius?: number;
  /** Where it starts or ends at the edge of the map: trips from or to the world beyond. */
  source?: boolean;
  sink?: boolean;
  /** Conflict zones along it, by id. */
  zones: number[];
  /**
   * Into a junction: how far short of its end a car waiting to go in keeps
   * its nose, clear of every curve across the junction but its own. @see HOLD_CLEAR
   */
  hold?: number;
};

/** Where two curves of a junction come within {@link LANE_CLEAR}: `sa` along `a`, `sb` along `b`. */
/** Two curves that come near: where along each they first do (`sa`, `sb`) and last do (`ea`, `eb`). */
export type Zone = { id: number; junction: number; a: number; sa: number; ea: number; b: number; sb: number; eb: number; merge: boolean };

export type JunctionKind = "end" | "bend" | "priority" | "signals" | "roundabout";

export type Arm = {
  street: number;
  /** Which end of its street: 0 the low end along its axis, 1 the high. */
  end: 0 | 1;
  /** Out of the junction, along the street. */
  out: Pt;
  /** Cells across. */
  width: number;
  /** Its lanes into the junction and out of it, by slot. */
  inLanes: number[];
  outLanes: number[];
  /** On the main road through a priority junction. */
  major: boolean;
  crossing?: number;
};

export type Junction = { id: number; kind: JunctionKind; cells: number[]; centre: Pt; arms: Arm[] };

export type Street = {
  id: number;
  axis: "x" | "y";
  /** Its first and last slice along the axis. */
  a0: number;
  a1: number;
  /** Each slice's first and last cell across, from `a0` on. */
  span: [number, number][];
  /** Cells across, as most of it is. */
  width: number;
  /** Its middle across at each slice, smoothed: a road drawn as a staircase is driven as a slope. */
  mid: number[];
  /** What each end meets: a junction (its id), the edge of the map, or nothing. */
  ends: [StreetEnd, StreetEnd];
  lanes: number[];
};
export type StreetEnd = { kind: "junction"; junction: number } | { kind: "rim" } | { kind: "dead" };

export type WalkEdge = { a: number; b: number; len: number; crossing?: number };
export type Crossing = { id: number; a: number; b: number; junction: number; street: number; end: 0 | 1 };

export type LaneGraph = {
  lanes: Lane[];
  zones: Zone[];
  junctions: Junction[];
  streets: Street[];
  /** The pavements: points, the stretches between them, and each point's stretches. */
  walk: { nodes: Pt[]; edges: WalkEdge[]; adj: number[][] };
  crossings: Crossing[];
  /** Road cells left out of any street or junction: joined to nothing. */
  loose: number;
};

/** How many lanes each way a road `k` cells wide has, and where slot `i` is, right of its middle. */
export const lanesFor = (k: number) => Math.max(1, Math.floor(k / 2));
export const laneOffset = (k: number, i: number) => ((i + 0.5) * (k / 2 - WALK)) / lanesFor(k);

export function buildLaneGraph(g: Grid): LaneGraph {
  const n = g.w * g.h;
  const S = streetsOf(g);
  const cellOf = (i: number): Pt => ({ x: i % g.w, y: (i / g.w) | 0 });
  const ways = (i: number) => { const c = cellOf(i); return DIRS.filter((d) => connects(g, c.x, c.y, d)); };

  // ── streets: which are clean ──────────────────────────────────────────
  const streets: Street[] = [];
  const streetOf = new Int32Array(n).fill(-1);
  const junctionCell = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (S.of[i] < 0 && isPaved(g, i % g.w, (i / g.w) | 0) && ways(i).length) junctionCell[i] = 1;
  const drafts: Draft[] = [];
  const of = S.of.slice();
  let ids = S.tiles.length;
  for (const cells of S.tiles) {
    const d = cleanStreet(g, cells, of);
    if (d) { drafts.push(d); continue; }
    // NOT STRAIGHT: cut it at its corners, and try the pieces.
    const { pieces, corners } = cutAtCorners(g, cells);
    for (const i of corners) { junctionCell[i] = 1; of[i] = -1; }
    for (const piece of pieces) {
      const id = ids++;
      for (const i of piece) of[i] = id;
      const p = cleanStreet(g, piece, of);
      if (p) drafts.push(p);
      else for (const i of piece) junctionCell[i] = 1;
    }
  }

  // ── junction regions ─────────────────────────────────────────────────
  const region = new Int32Array(n).fill(-1);
  const junctions: Junction[] = [];
  for (let i0 = 0; i0 < n; i0++) {
    if (!junctionCell[i0] || region[i0] >= 0) continue;
    const id = junctions.length, cells = [i0];
    region[i0] = id;
    for (let q = 0; q < cells.length; q++) {
      const c = cellOf(cells[q]);
      for (const d of DIRS) {
        if (!connects(g, c.x, c.y, d)) continue;
        const j = idx(g, c.x + NEIGHBOUR[d][0], c.y + NEIGHBOUR[d][1]);
        if (junctionCell[j] && region[j] < 0) { region[j] = id; cells.push(j); }
      }
    }
    const centre = cells.reduce((p, i) => add(p, cellOf(i), 1 / cells.length), { x: 0, y: 0 });
    junctions.push({ id, kind: "end", cells, centre, arms: [] });
  }

  // ── street lanes ─────────────────────────────────────────────────────
  const lanes: Lane[] = [];
  const mk = (l: Omit<Lane, "id" | "at" | "len" | "next" | "zones">): Lane => {
    const at = lengths(l.pts);
    const lane: Lane = { ...l, id: lanes.length, at, len: at[at.length - 1], next: [], zones: [] };
    lanes.push(lane);
    return lane;
  };
  for (const d of drafts) {
    const id = streets.length;
    for (const i of d.cells) streetOf[i] = id;
    const k = d.width;
    const ends: [StreetEnd, StreetEnd] = [0, 1].map((e) => {
      if (d.ends[e] !== "junction") return { kind: d.ends[e] } as StreetEnd;
      return { kind: "junction", junction: region[d.into[e]] } as StreetEnd;
    }) as [StreetEnd, StreetEnd];
    const mid = smooth(d.span.map(([b0, b1]) => (b0 + b1) / 2));
    const st: Street = { id, axis: d.axis, a0: d.a0, a1: d.a1, span: d.span, width: k, mid, ends, lanes: [] };
    streets.push(st);
    // A lane runs from gate to gate; at a dead end it stops short, for the U-turn.
    const endAt = (e: 0 | 1) => (e ? d.a1 + (ends[1].kind === "dead" ? -0.05 : 0.5) : d.a0 - (ends[0].kind === "dead" ? -0.05 : 0.5));
    const P = (a: number, b: number): Pt => (d.axis === "x" ? { x: a, y: b } : { x: b, y: a });
    const hPlus: Pt = d.axis === "x" ? { x: 1, y: 0 } : { x: 0, y: 1 };
    const rPlus = right(hPlus), bSign = d.axis === "x" ? rPlus.y : rPlus.x;
    // A stub too short to turn in has no lanes.
    const room = endAt(1) - endAt(0) > 0.2;
    for (const sign of room ? [1, -1] : []) {
      const way: Lane[] = [];
      for (let s = 0; s < lanesFor(k); s++) {
        const off = bSign * sign * laneOffset(k, s);
        const line: Pt[] = [P(endAt(0), mid[0] + off)];
        for (let a = d.a0; a <= d.a1; a++) {
          const at = a === d.a0 ? Math.max(a, endAt(0)) : a === d.a1 ? Math.min(a, endAt(1)) : a;
          line.push(P(at, mid[a - d.a0] + off));
        }
        line.push(P(endAt(1), mid[mid.length - 1] + off));
        const pts = straighten(sign > 0 ? line : line.reverse());
        const startEnd = sign > 0 ? 0 : 1, finishEnd = sign > 0 ? 1 : 0;
        const l = mk({
          kind: "street", pts, street: id, slot: s, lanes: lanesFor(k),
          ...(ends[startEnd].kind === "rim" ? { source: true } : {}),
          ...(ends[finishEnd].kind === "rim" ? { sink: true } : {}),
        });
        st.lanes.push(l.id);
        way.push(l);
      }
      for (let s = 1; s < way.length; s++) {
        (way[s - 1].beside ??= []).push(way[s].id);
        (way[s].beside ??= []).push(way[s - 1].id);
      }
    }
    // Its ends as arms of their junctions.
    for (const e of [0, 1] as const) {
      const end = ends[e];
      if (end.kind !== "junction" || end.junction < 0) continue;
      const out: Pt = e ? { x: -hPlus.x, y: -hPlus.y } : hPlus;
      const inward = (l: Lane) => dot(heading(l), out) < 0;
      const mine = st.lanes.map((x) => lanes[x]);
      const bySlot = (a: Lane, b: Lane) => a.slot! - b.slot!;
      junctions[end.junction].arms.push({
        street: id, end: e, out, width: k, major: false,
        inLanes: mine.filter(inward).sort(bySlot).map((l) => l.id),
        outLanes: mine.filter((l) => !inward(l)).sort(bySlot).map((l) => l.id),
      });
    }
    // DEAD ENDS turn round: each lane in to the lane out beside the middle.
    for (const e of [0, 1] as const) {
      if (ends[e].kind !== "dead") continue;
      const into = st.lanes.map((x) => lanes[x]).filter((l) => (e ? heading(l)[d.axis] > 0 : heading(l)[d.axis] < 0));
      const back = st.lanes.map((x) => lanes[x]).find((l) => l.slot === 0 && !into.includes(l));
      if (!back) continue;
      for (const l of into) {
        const p0 = l.pts[l.pts.length - 1], p1 = back.pts[0];
        const u = mk({ kind: "connector", pts: turnCurve(p0, heading(l), p1, heading(back), 8), turn: "uturn" });
        u.radius = minRadius(u.pts);
        l.next.push(u.id);
        u.next.push(back.id);
      }
    }
  }

  // ── junctions: what each is, and the way through ─────────────────────
  const zones: Zone[] = [];
  for (const J of junctions) {
    J.kind = kindOf(J);
    if (J.kind === "priority") markMajor(J, streets);
    const inner: Lane[] = J.kind === "roundabout" ? ring(J, lanes, mk) : throughJunction(g, J, lanes, mk, region);
    for (const l of inner) l.junction = J.id;
    findZones(J.id, inner, zones);
    // WHERE TO WAIT on each lane in: back from the edge until clear of the
    // curves of everyone else crossing the junction.
    for (const A of J.arms) for (const id of A.inLanes) {
      const l = lanes[id];
      const others = inner.filter((c) => !l.next.includes(c.id));
      let hold = 0.12;
      while (hold < 0.6 && others.some((c) => distToLine(pointAt(l.pts, l.at, l.len - hold).p, c.pts) < HOLD_CLEAR)) hold += 0.04;
      l.hold = hold;
    }
  }
  for (const z of zones) { lanes[z.a].zones.push(z.id); lanes[z.b].zones.push(z.id); }

  // ── pavements ────────────────────────────────────────────────────────
  const { walk, crossings } = pavements(g, streets, junctions);

  let loose = 0;
  for (let i = 0; i < n; i++) if (isPaved(g, i % g.w, (i / g.w) | 0) && streetOf[i] < 0 && region[i] < 0) loose++;
  return { lanes, zones, junctions, streets, walk, crossings, loose };
}

/** The way a lane runs at its end. */
export const heading = (l: Lane): Pt => pointAt(l.pts, l.at, l.len).h;

type Draft = {
  cells: number[]; axis: "x" | "y"; a0: number; a1: number; span: [number, number][]; width: number;
  ends: ("junction" | "rim" | "dead")[];
  /** The cell each end runs on into, where it meets a junction. */
  into: [number, number];
};

/**
 * Whether a street is CLEAN, and its shape if so. It runs along the axis it
 * is joined along most; each SLICE across it is one run of cells, joined to
 * the next where they meet, and nothing joins it from the side. The slices
 * may step sideways — a road built as a staircase — and be a cell wider at a
 * step, but no slice is far wider than the road: that is a corner, and the
 * street is a junction's. What each end meets: a junction, the edge of the
 * map, or nothing.
 */
function cleanStreet(g: Grid, cells: readonly number[], of: Int32Array): Draft | null {
  const me = of[cells[0]];
  let ax = 0, ay = 0;
  for (const i of cells) {
    const x = i % g.w, y = (i / g.w) | 0;
    for (const d of DIRS) if (connects(g, x, y, d)) { if (NEIGHBOUR[d][0]) ax++; else ay++; }
  }
  const axis: "x" | "y" = ax >= ay ? "x" : "y";
  const A = (i: number) => (axis === "x" ? i % g.w : (i / g.w) | 0);
  const B = (i: number) => (axis === "x" ? (i / g.w) | 0 : i % g.w);
  let a0 = Infinity, a1 = -Infinity;
  for (const i of cells) { a0 = Math.min(a0, A(i)); a1 = Math.max(a1, A(i)); }
  const span: [number, number][] = Array.from({ length: a1 - a0 + 1 }, () => [Infinity, -Infinity]);
  const count = new Int32Array(a1 - a0 + 1);
  for (const i of cells) {
    const r = span[A(i) - a0];
    r[0] = Math.min(r[0], B(i)); r[1] = Math.max(r[1], B(i));
    count[A(i) - a0]++;
  }
  for (let k = 0; k < span.length; k++) if (!count[k] || span[k][1] - span[k][0] + 1 !== count[k]) return null;
  const widths = span.map(([b0, b1]) => b1 - b0 + 1).sort((p, q) => p - q);
  const width = widths[widths.length >> 1];
  if (widths[widths.length - 1] > width + 1) return null;
  const xy = (a: number, b: number) => (axis === "x" ? [a, b] : [b, a]) as [number, number];
  const at = (a: number, b: number) => { const [x, y] = xy(a, b); return inBounds(g, x, y) ? idx(g, x, y) : -1; };
  const [fwd, back] = axis === "x" ? (["S", "N"] as const) : (["W", "E"] as const);
  const [lo, hi] = axis === "x" ? (["E", "W"] as const) : (["N", "S"] as const);
  for (let a = a0; a <= a1; a++) {
    const [b0, b1] = span[a - a0];
    let joined = a === a1;
    for (let b = b0; b <= b1; b++) {
      const [x, y] = xy(a, b);
      // Along: on to this street's next slice, or at its ends, out of it.
      if (a < a1 && connects(g, x, y, fwd)) { if (of[at(a + 1, b)] !== me) return null; joined = true; }
      if (a > a0 && connects(g, x, y, back) && of[at(a - 1, b)] !== me) return null;
    }
    if (!joined) return null;
    // Nothing from the side: the outer cells' outer sides are kerbs.
    { const [x, y] = xy(a, b0); if (connects(g, x, y, lo)) return null; }
    { const [x, y] = xy(a, b1); if (connects(g, x, y, hi)) return null; }
  }
  const into: [number, number] = [-1, -1];
  const endOf = (e: 0 | 1): "junction" | "rim" | "dead" => {
    const a = e ? a1 : a0, d = e ? fwd : back, step = e ? 1 : -1;
    const [b0, b1] = span[a - a0];
    for (let b = b0; b <= b1; b++) {
      const [x, y] = xy(a, b);
      if (connects(g, x, y, d)) { into[e] = at(a + step, b); return "junction"; }
    }
    const [x, y] = xy(a + step, b0);
    return inBounds(g, x, y) ? "dead" : "rim";
  };
  const ends = [endOf(0), endOf(1)];
  return { cells: [...cells], axis, a0, a1, span, width, ends, into };
}

/** A middle line smoothed, up to two slices either way: fewer toward its ends, which stay where they are. */
function smooth(v: readonly number[]): number[] {
  return v.map((_, k) => {
    const r = Math.min(2, k, v.length - 1 - k);
    let t = 0;
    for (let j = k - r; j <= k + r; j++) t += v[j];
    return t / (2 * r + 1);
  });
}

/**
 * A street that is not straight, cut at its CORNERS: the cells the road runs
 * on through both ways further than it is wide — the same rule the streets
 * are cut at junctions by, with the road's own width in place of the widest
 * any road is. The rest falls into pieces between them.
 * @see streetsOf
 */
function cutAtCorners(g: Grid, cells: readonly number[]): { pieces: number[][]; corners: number[] } {
  const mine = new Set(cells);
  const run = (i: number, d0: Dir, d1: Dir) => {
    let n = 1;
    for (const d of [d0, d1]) {
      let x = i % g.w, y = (i / g.w) | 0;
      while (connects(g, x, y, d) && mine.has(idx(g, x + NEIGHBOUR[d][0], y + NEIGHBOUR[d][1]))) { x += NEIGHBOUR[d][0]; y += NEIGHBOUR[d][1]; n++; }
    }
    return n;
  };
  const rx = new Map(cells.map((i) => [i, run(i, "N", "S")]));
  const ry = new Map(cells.map((i) => [i, run(i, "E", "W")]));
  const narrow = cells.map((i) => Math.min(rx.get(i)!, ry.get(i)!)).sort((a, b) => a - b);
  const W = narrow[narrow.length >> 1];
  const corners = cells.filter((i) => rx.get(i)! > W && ry.get(i)! > W);
  const corner = new Set(corners);
  const seen = new Set<number>();
  const pieces: number[][] = [];
  for (const i0 of cells) {
    if (corner.has(i0) || seen.has(i0)) continue;
    const piece = [i0];
    seen.add(i0);
    for (let q = 0; q < piece.length; q++) {
      const x = piece[q] % g.w, y = (piece[q] / g.w) | 0;
      for (const d of DIRS) {
        if (!connects(g, x, y, d)) continue;
        const j = idx(g, x + NEIGHBOUR[d][0], y + NEIGHBOUR[d][1]);
        if (mine.has(j) && !corner.has(j) && !seen.has(j)) { seen.add(j); piece.push(j); }
      }
    }
    pieces.push(piece);
  }
  return { pieces, corners };
}

/** A line without the points along it that are in a straight line with their neighbours. */
function straighten(raw: readonly Pt[]): Pt[] {
  const pts = raw.filter((p, k) => k === 0 || Math.hypot(p.x - raw[k - 1].x, p.y - raw[k - 1].y) > 1e-6);
  if (pts.length < 3) return pts;
  const out: Pt[] = [pts[0]];
  for (let k = 1; k < pts.length - 1; k++) {
    const a = out[out.length - 1], b = pts[k], c = pts[k + 1];
    if (Math.abs(cross({ x: b.x - a.x, y: b.y - a.y }, { x: c.x - b.x, y: c.y - b.y })) > 1e-9 || dot({ x: b.x - a.x, y: b.y - a.y }, { x: c.x - b.x, y: c.y - b.y }) <= 0) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/**
 * WHAT A JUNCTION IS. Two arms, a bend; one, the end of a road. Four, all of
 * roads two cells wide or more, a roundabout; four with any such, lights.
 * The rest give way to the main road. @see plans/traffic-overhaul.md
 */
function kindOf(J: Junction): JunctionKind {
  const arms = J.arms.length;
  if (arms <= 1) return "end";
  if (arms === 2) return "bend";
  const wide = J.arms.filter((a) => a.width >= 2).length;
  if (arms === 4 && wide === 4) return "roundabout";
  if (arms >= 4 && wide > 0) return "signals";
  return "priority";
}

/** The MAIN ROAD through a priority junction: the straight-through pair, widest, then longest. */
function markMajor(J: Junction, streets: readonly Street[]) {
  const len = (a: Arm) => { const s = streets[a.street]; return s.a1 - s.a0 + 1; };
  let best: [Arm, Arm] | null = null, score = -Infinity;
  for (let p = 0; p < J.arms.length; p++) for (let q = p + 1; q < J.arms.length; q++) {
    const a = J.arms[p], b = J.arms[q];
    if (dot(a.out, b.out) > -0.9) continue;
    const s = Math.min(a.width, b.width) * 1000 + len(a) + len(b);
    if (s > score) { score = s; best = [a, b]; }
  }
  if (!best) {
    const w = [...J.arms].sort((a, b) => b.width - a.width || len(b) - len(a));
    best = [w[0], w[1]];
  }
  best[0].major = best[1].major = true;
}

/** The way a car turns from heading `h0` to `h1`. */
export function turnOf(h0: Pt, h1: Pt): Turn {
  const d = dot(h0, h1);
  if (d > 0.5) return "straight";
  if (d < -0.5) return "uturn";
  return cross(h0, h1) > 0 ? "right" : "left";
}

/**
 * THE WAY THROUGH an ordinary junction: from each lane in to each lane out it
 * may take. One lane in takes every turn; with more, the right-hand lane turns
 * right into the right-hand lane out, the left-hand turns left into the
 * left-hand, and each goes straight on into its own.
 *
 * A curve that would leave the road — a junction of an odd shape — goes cell
 * by cell through the junction instead, its corners cut.
 */
function throughJunction(g: Grid, J: Junction, lanes: Lane[], mk: (l: Omit<Lane, "id" | "at" | "len" | "next" | "zones">) => Lane, region: Int32Array): Lane[] {
  const out: Lane[] = [];
  const lone = J.arms.length === 1;
  for (const A of J.arms) for (const B of J.arms) {
    if (A === B && !lone) continue;
    const h0: Pt = { x: -A.out.x, y: -A.out.y }, h1 = B.out;
    const turn = A === B ? "uturn" : turnOf(h0, h1);
    if (turn === "uturn" && !lone) continue;
    const ni = A.inLanes.length, no = B.outLanes.length;
    const pairs: [number, number][] = [];
    if (turn === "right") pairs.push([ni - 1, no - 1]);
    else if (turn === "left" || turn === "uturn") pairs.push([0, 0]);
    else for (let s = 0; s < ni; s++) pairs.push([s, Math.min(s, no - 1)]);
    for (const [si, so] of pairs) {
      const li = lanes[A.inLanes[si]], lo = lanes[B.outLanes[so]];
      if (!li || !lo) continue;
      const p0 = li.pts[li.pts.length - 1], p1 = lo.pts[0];
      let pts = turnCurve(p0, h0, p1, h1, 10);
      if (!pts.every((p) => isPaved(g, Math.round(p.x), Math.round(p.y)))) pts = cellByCell(g, J, region, p0, p1) ?? pts;
      const c = mk({ kind: "connector", pts, turn, arm: J.arms.indexOf(A) });
      c.radius = minRadius(pts);
      li.next.push(c.id);
      c.next.push(lo.id);
      out.push(c);
    }
  }
  return out;
}

/** A way through a junction's own cells from one point to another, its corners cut; null if none. */
function cellByCell(g: Grid, J: Junction, region: Int32Array, p0: Pt, p1: Pt): Pt[] | null {
  const near = (p: Pt) => J.cells.reduce((b, i) => {
    const c = { x: i % g.w, y: (i / g.w) | 0 };
    return Math.hypot(c.x - p.x, c.y - p.y) < Math.hypot((b % g.w) - p.x, ((b / g.w) | 0) - p.y) ? i : b;
  }, J.cells[0]);
  const s = near(p0), t = near(p1);
  const prev = new Map<number, number>([[s, -1]]);
  const q = [s];
  for (let k = 0; k < q.length && !prev.has(t); k++) {
    const i = q[k], x = i % g.w, y = (i / g.w) | 0;
    for (const d of DIRS) {
      if (!connects(g, x, y, d)) continue;
      const j = idx(g, x + NEIGHBOUR[d][0], y + NEIGHBOUR[d][1]);
      if (region[j] !== J.id || prev.has(j)) continue;
      prev.set(j, i);
      q.push(j);
    }
  }
  if (!prev.has(t)) return null;
  const path: Pt[] = [];
  for (let i = t; i >= 0; i = prev.get(i)!) path.push({ x: i % g.w, y: (i / g.w) | 0 });
  return chaikin([p0, ...path.reverse(), p1], 3);
}

/**
 * A ROUNDABOUT: a ring round the junction's middle, travelled with the island
 * on the left — clockwise as the angles go — and each arm a PORT on it, where
 * its lane in comes on just before the lane out goes off. The ring's lanes
 * run port to port; curves join each arm's lane in to the ring and the ring
 * to each arm's lane out.
 */
export const RING_OF = 0.62;
function ring(J: Junction, lanes: Lane[], mk: (l: Omit<Lane, "id" | "at" | "len" | "next" | "zones">) => Lane): Lane[] {
  const C = J.centre;
  const span = Math.sqrt(J.cells.length);
  const R = (span / 2) * RING_OF;
  type Port = { a: number; on?: Lane; off?: Lane; arm: Arm; kind: "on" | "off" };
  const ports: Port[] = [];
  for (const A of J.arms) {
    const th = Math.atan2(A.out.y, A.out.x);
    const lin = lanes[A.inLanes[0]];
    const side = lin ? Math.min(0.95, distToLine(lin.pts[lin.pts.length - 1], [C, add(C, A.out, 10)]) / R) : 0.5;
    const delta = Math.asin(side);
    ports.push({ a: th - delta, arm: A, kind: "on" }, { a: th + delta, arm: A, kind: "off" });
  }
  // Round the ring the way traffic goes: angles falling.
  ports.sort((p, q) => q.a - p.a);
  const at = (a: number): Pt => ({ x: C.x + Math.cos(a) * R, y: C.y + Math.sin(a) * R });
  const tangent = (a: number): Pt => ({ x: Math.sin(a), y: -Math.cos(a) });
  const out: Lane[] = [];
  const pieces: Lane[] = ports.map((p, k) => {
    const q = ports[(k + 1) % ports.length];
    let a1 = q.a;
    while (a1 >= p.a) a1 -= Math.PI * 2;
    const l = mk({ kind: "ring", pts: arc(C, R, p.a, a1, 0.15) });
    l.radius = R;
    out.push(l);
    return l;
  });
  ports.forEach((p, k) => {
    const into = pieces[k], from = pieces[(k - 1 + ports.length) % ports.length];
    from.next.push(into.id);
    if (p.kind === "on") {
      for (const id of p.arm.inLanes) {
        const li = lanes[id];
        const e = mk({ kind: "entry", pts: turnCurve(li.pts[li.pts.length - 1], heading(li), at(p.a), tangent(p.a), 8), turn: "right", arm: J.arms.indexOf(p.arm) });
        e.radius = minRadius(e.pts);
        li.next.push(e.id);
        e.next.push(into.id);
        out.push(e);
      }
    } else {
      for (const id of p.arm.outLanes.slice(0, 1)) {
        const lo = lanes[id];
        const x = mk({ kind: "exit", pts: turnCurve(at(p.a), tangent(p.a), lo.pts[0], p.arm.out, 8), turn: "right" });
        x.radius = minRadius(x.pts);
        from.next.push(x.id);
        x.next.push(lo.id);
        out.push(x);
      }
    }
  });
  return out;
}

/**
 * Where a junction's curves come within a lane's width of each other. Two
 * from the same lane part ways, and one running on into the other follows
 * it, so neither is a conflict; every other pair that comes that near is.
 */
function findZones(junction: number, inner: readonly Lane[], zones: Zone[]) {
  const near = (a: Lane, b: Lane, s: number): boolean => {
    const { p, h } = pointAt(a.pts, a.at, s);
    const d = distToLine(p, b.pts);
    return d < LANE_CLEAR || (d < LANE_SWEEP && Math.abs(cross(h, nearestPoint(p, b).h)) > 0.5);
  };
  const first = (a: Lane, b: Lane): number => {
    for (let s = 0; s <= a.len; s += 0.04) if (near(a, b, s)) return s;
    return -1;
  };
  const last = (a: Lane, b: Lane): number => {
    for (let s = a.len; s >= 0; s -= 0.04) if (near(a, b, s)) return s;
    return -1;
  };
  const box = (l: Lane) => l.pts.reduce((b, p) => [Math.min(b[0], p.x), Math.min(b[1], p.y), Math.max(b[2], p.x), Math.max(b[3], p.y)], [Infinity, Infinity, -Infinity, -Infinity]);
  const boxes = inner.map(box);
  const same = (p: Pt, q: Pt) => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6;
  for (let i = 0; i < inner.length; i++) for (let j = i + 1; j < inner.length; j++) {
    const a = inner[i], b = inner[j], A = boxes[i], B = boxes[j];
    if (A[0] > B[2] + LANE_CLEAR || B[0] > A[2] + LANE_CLEAR || A[1] > B[3] + LANE_CLEAR || B[1] > A[3] + LANE_CLEAR) continue;
    if (same(a.pts[0], b.pts[0])) continue;
    if (a.next.includes(b.id) || b.next.includes(a.id)) continue;
    const sa = first(a, b), sb = first(b, a);
    if (sa < 0 || sb < 0) continue;
    const merge = same(a.pts[a.pts.length - 1], b.pts[b.pts.length - 1]) || a.next.some((x) => b.next.includes(x));
    zones.push({ id: zones.length, junction, a: a.id, sa, ea: last(a, b), b: b.id, sb, eb: last(b, a), merge });
  }
}

/** The nearest point of a lane to a point, and the lane's heading there. */
function nearestPoint(p: Pt, l: Lane): { s: number; h: Pt } {
  let best = Infinity, bs = 0;
  for (let k = 1; k < l.pts.length; k++) {
    const a = l.pts[k - 1], b = l.pts[k];
    const abx = b.x - a.x, aby = b.y - a.y, l2 = abx * abx + aby * aby;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2)) : 0;
    const d = Math.hypot(a.x + abx * t - p.x, a.y + aby * t - p.y);
    if (d < best) { best = d; bs = l.at[k - 1] + t * (l.at[k] - l.at[k - 1]); }
  }
  return { s: bs, h: pointAt(l.pts, l.at, bs).h };
}

/**
 * THE PAVEMENTS. A point at each corner of a road cell, in from its sides by
 * {@link PAVE_AT}; a stretch along each side with no road beyond it; stretches
 * on to the next cell where the kerb runs on, and round the kerb's nub, corner
 * to corner, where it turns into a side street. Then a crossing over each
 * street's mouth at a junction.
 */
function pavements(g: Grid, streets: readonly Street[], junctions: readonly Junction[]) {
  const nodes: Pt[] = [];
  const key = new Map<string, number>();
  const node = (x: number, y: number, sx: number, sy: number) => {
    const k = `${x},${y},${sx},${sy}`;
    let id = key.get(k);
    if (id === undefined) { id = nodes.length; nodes.push({ x: x + sx * PAVE_AT, y: y + sy * PAVE_AT }); key.set(k, id); }
    return id;
  };
  const edges: WalkEdge[] = [];
  const seen = new Set<string>();
  const edge = (a: number, b: number, crossing?: number) => {
    const k = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (a === b || seen.has(k)) return;
    seen.add(k);
    edges.push({ a, b, len: Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y), ...(crossing !== undefined ? { crossing } : {}) });
  };
  /** A kerb: a side with no road beyond it, inside the map. */
  const kerb = (x: number, y: number, d: Dir) =>
    isPaved(g, x, y) && !connects(g, x, y, d) && inBounds(g, x + NEIGHBOUR[d][0], y + NEIGHBOUR[d][1]);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    if (!isPaved(g, x, y)) continue;
    for (const d of DIRS) {
      if (!kerb(x, y, d)) continue;
      const dv = V(d);
      // The two ways along this kerb.
      const along: Pt[] = dv.x ? [{ x: 0, y: -1 }, { x: 0, y: 1 }] : [{ x: -1, y: 0 }, { x: 1, y: 0 }];
      const [e0, e1] = along;
      edge(node(x, y, dv.x || e0.x, dv.y || e0.y), node(x, y, dv.x || e1.x, dv.y || e1.y));
      for (const e of along) {
        const ed = dirOf(e);
        if (!connects(g, x, y, ed)) continue;
        const nx = x + e.x, ny = y + e.y;
        const here = node(x, y, dv.x || e.x, dv.y || e.y);
        // The kerb runs on into the next cell…
        if (kerb(nx, ny, d)) { edge(here, node(nx, ny, dv.x || -e.x, dv.y || -e.y)); continue; }
        // …or turns round its nub, up the side street.
        const mx = nx + dv.x, my = ny + dv.y;
        if (connects(g, nx, ny, d) && kerb(mx, my, dirOf({ x: -e.x, y: -e.y }))) edge(here, node(mx, my, -e.x || -dv.x, -e.y || -dv.y));
      }
    }
  }
  // CROSSINGS over each street's mouth, kerb to kerb, at the junction's edge.
  const crossings: Crossing[] = [];
  for (const J of junctions) for (const A of J.arms) {
    // Round a bend, or at the end of a road, the pavement runs round: nothing to cross.
    if (J.arms.length < 3) continue;
    const st = streets[A.street];
    const a = A.end ? st.a1 : st.a0, s = A.end ? 1 : -1;
    const [b0, b1] = st.span[a - st.a0];
    const lo = st.axis === "x" ? node(a, b0, s, -1) : node(b0, a, -1, s);
    const hi = st.axis === "x" ? node(a, b1, s, 1) : node(b1, a, 1, s);
    const c: Crossing = { id: crossings.length, a: lo, b: hi, junction: J.id, street: st.id, end: A.end };
    crossings.push(c);
    A.crossing = c.id;
    edge(lo, hi, c.id);
  }
  const adj: number[][] = nodes.map(() => []);
  edges.forEach((e, k) => { adj[e.a].push(k); adj[e.b].push(k); });
  return { walk: { nodes, edges, adj }, crossings };
}
