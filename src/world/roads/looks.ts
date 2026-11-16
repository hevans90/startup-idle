/**
 * World v2 — WHAT A ROAD CELL LOOKS LIKE, as a British road would be marked.
 *
 * Pure: from the grid (and the street's level, and where its zebra crossings
 * are) to a {@link Look} per paved cell — its shape, its pavement, and every
 * line painted on it. `render/road-paint.ts` paints a texture from a cell's
 * look and its neighbours'; the look is the texture's cache key, so two cells
 * that look the same share one.
 *
 * SIDES, in the cell's own (u, v) = (x, y): 0 is the u = 0 side, toward x − 1
 * (DIR.N); 1 is u = 1 (S); 2 is v = 0 (E); 3 is v = 1 (W). A CORNER is
 * `su + 2 * sv`, each 0 or 1: the corner at (su, sv).
 *
 * WHICH SIDE TRAFFIC KEEPS TO is the town's: the left ({@link KEEP}, said in
 * `agents/lanes/geometry`). Every marking that belongs to one lane — give-way
 * lines, the triangle, arrows, SLOW — is laid on the lane a driver arriving
 * there is in, the one on their nearside; "right" in a name here is that side.
 */
import { idx, inBounds, type Grid } from "../grid";
import { hash } from "../structures/projects/model";
import { DIAG, DIR, isPaved, maskAt } from "./mask";
import { streetsOf } from "./streets";
import { resolveRole, type RoadRole } from "./role";
import { RING_OF, buildLaneGraph } from "../agents/lanes/graph";
import { marksOf } from "./marks";
import { KEEP } from "../agents/lanes/geometry";

/** Half a ring lane's width and a little: the island's edge inside the lane's middle. */
const RING_LANE = 0.22;

/** The side of the road traffic keeps to: +1 right, −1 left. @see rightOf in agents/roads */
export { KEEP };

export type Side = 0 | 1 | 2 | 3;
/** How many variants a road tile has; seven of them carry a fitting or some wear, the rest — most of a road — are plain. */
export const VARIANTS = 24;
/** How many of them carry a fitting or wear: the first so many. @see render/road-paint fittings */
export const WORN = 7;
/**
 * A draw of VARIANTS as the look keeps it: a fitting or wear as itself; a
 * plain one as one of four — the pavement's four patterns — from `PLAIN` up,
 * so plain road is a handful of textures and not one for every draw.
 */
export const PLAIN = 8;
export const variantOf = (draw: number) => (draw < WORN ? draw : PLAIN + (draw & 3));
/** A road this many cells wide or more is a HIGHWAY — two lanes or more each way: its directions kept apart, edge lines, arrows in its lanes. */
export const HIGHWAY = 2;
/** From this many cells wide what keeps a highway's directions apart is a raised median with a barrier; narrower, a double line. */
export const MEDIAN_FROM = 3;
/** A street shorter than this many cells has no speed roundels. */
const ROUNDEL_MIN = 6;
/** A junction of more cells than this is a square: the widest crossroads, of two 2-wide roads, is four. */
const PLAZA = 4;
export const SIDES: readonly Side[] = [0, 1, 2, 3];
/** A side's step to the neighbour across it, in (x, y). */
export const STEP: readonly (readonly [number, number])[] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIR_OF = [DIR.N, DIR.S, DIR.E, DIR.W] as const;
/** A corner's diagonal bit: (0,0) NE, (1,0) SE, (0,1) NW, (1,1) SW. @see DIAG_NEIGHBOUR */
const DIAG_OF = [DIAG.NE, DIAG.SE, DIAG.NW, DIAG.SW] as const;
export const opposite = (s: Side): Side => (s ^ 1) as Side;
/** The side a step goes out through. */
export const sideOf = (dx: number, dy: number): Side => (dx < 0 ? 0 : dx > 0 ? 1 : dy < 0 ? 2 : 3);
/** Right of a heading, in (x, y): the same turn `agents/roads` makes. */
export const rightOf = (dx: number, dy: number): [number, number] => [-dy * KEEP, dx * KEEP];

/**
 * A paved cell's look. Every field is part of its texture's key; keep them
 * small and only what the paint reads.
 */
export type Look = {
  /** Open sides, a bit each. */
  open: number;
  /** Paved corners (diagonal neighbours level with it), a bit each. */
  diag: number;
  /** Its ramp, packed as the grid has it; 0 flat. */
  ramp: number;
  /** The street's level, 0–3: tarmac, concrete flags, block paving, York stone. */
  lvl: number;
  /** Its variant: the pavement's pattern (its low two bits) and, below `WORN`, a gully, manhole, patch, cracks or wear along its run. @see variantOf */
  vr: number;
  /**
   * THE CENTRE LINE. `u`/`v`: dashed down the middle along that axis; upper
   * case, the warning line, long dashes, short gaps, before a junction or a
   * bend. `b`: round a bend. `h0`–`h3` (`H` warning): half of a two-lane
   * road's line, on that side, the lane across drawing the other half.
   */
  ctr: string;
  /**
   * A WIDE ROAD'S MARKINGS on this cell, from its lanes: lane lines, its
   * middle or central reservation, edge lines, the lines its lanes wait at,
   * their arrows and roundels — shapes in the cell's own (u, v), as text.
   * Empty on a one-cell street, whose markings are the fields beside this.
   * @see roads/marks
   */
  mk: string;
  /** ON A WIDE STREET: the way it runs, `u` or `v`; and `j` after it in the slice where it jogs a cell sideways, whose kerbs cut the corner. Empty elsewhere. */
  wx: string;
  /** Give way, across the lane coming in on each side listed: `0`–`3` on a one-cell road, `4`–`7` (side + 4) across a whole lane; set back behind a crossing, `a`–`h`. */
  gw: string;
  /** A stop line across the lane coming in, before a box or at lights: encoded as `gw` is. */
  stop: string;
  /** An arrow in the lane, toward the side: its side, then `L`, `A`, `R` for each way it may go. */
  arrow: string;
  /** A yellow box junction: 1, plus its border, a bit a side, shifted up one. */
  box: number;
  /** Double yellow lines along its kerbs. */
  yl: boolean;
  /** Zigzags along the kerbs and the middle, the cell before a zebra: `u`/`v`, the road's axis. */
  zz: string;
  /** A zebra crossing over the road, which runs along `u`/`v`. */
  zeb: string;
  /** A crossing at lights over the road along `u`/`v`: two broken lines, where there is no zebra. */
  xing: string;
  /** SLOW, toward the side listed, in the lane coming in. */
  slow: string;
  /**
   * A ROUNDABOUT's island over this cell: its middle in the cell's own
   * (u, v) and its radius, `u,v,r`; empty if none. @see agents/lanes/graph ring
   */
  rb: string;
  /**
   * PARKING BAYS along its kerbs, a token a side: `L` and the side, a lay-by,
   * the kerb set back; `M`, bays marked in a wide road's parking strip; `T`, a
   * lay-by beside tapering in, then which ends of this kerb it is beyond (1,
   * the low end along it; 2, the high; 3, both); `B`, a bus stop's cage.
   * @see agents/lanes/graph baysOf, bayMarksOf
   */
  bay: string;
  /**
   * SPEED ROUNDELS, one for each way along the road, two cells out of a
   * junction: the side that way's traffic is going toward, then the limit —
   * `020120`, 20 each way. @see render/road-paint roundels
   */
  spd: string;
};

/** A look as a key: every field, compact. */
export const keyOf = (l: Look): string =>
  `${l.open}.${l.diag}.${l.ramp}.${l.lvl}.${l.vr}.${l.ctr}.${l.mk}.${l.wx}.${l.gw}.${l.stop}.${l.arrow}.${l.box}.${l.yl ? 1 : 0}.${l.zz}.${l.zeb}.${l.xing}.${l.slow}.${l.rb}.${l.bay}.${l.spd}`;

/** What the town's beauty puts on a road cell: its level, and a zebra if it has one. @see roadDressOf */
export const dressOf = (lvl: number, zebra: boolean) => (lvl & 3) | (zebra ? 4 : 0);

/** Open sides from a mask, in {@link Side} bits. */
export function openOf(mask: number): number {
  let o = 0;
  for (const s of SIDES) if (mask & DIR_OF[s]) o |= 1 << s;
  return o;
}
/** Paved corners from a mask, in corner bits. */
export function diagOf(mask: number): number {
  let d = 0;
  for (let c = 0; c < 4; c++) if (mask & DIAG_OF[c]) d |= 1 << c;
  return d;
}
/** A cell's road role. @see resolveRole */
export function roleAt(g: Grid, x: number, y: number): RoadRole | null {
  if (!inBounds(g, x, y) || !isPaved(g, x, y)) return null;
  const m = maskAt(g, x, y);
  return resolveRole(m & 15, m & 0xf0);
}
const has = (open: number, s: Side) => (open & (1 << s)) !== 0;
/** The axis a straight runs along: `u` if open both ways in x, `v` in y. */
const axisOf = (open: number): "u" | "v" | "" => (has(open, 0) && has(open, 1) ? "u" : has(open, 2) && has(open, 3) ? "v" : "");

/**
 * Every paved cell's look. `dress` is {@link dressOf} per cell, or none: a
 * street with no level yet, tarmac and no zebras. `bays` per cell, its kerbs
 * with parking bays, as the lanes have them: lay-bys a bit a side, a wide
 * road's marked bays a bit a side shifted up four. @see bayMarksOf
 */
export function looksOf(g: Grid, dress?: Uint8Array, bays?: Uint8Array | Uint16Array): (Look | null)[] {
  const out: (Look | null)[] = new Array(g.w * g.h).fill(null);
  const mask = new Int32Array(g.w * g.h).fill(-1);
  const role: (RoadRole | null)[] = new Array(g.w * g.h).fill(null);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    if (!isPaved(g, x, y)) continue;
    const i = idx(g, x, y), m = maskAt(g, x, y);
    mask[i] = m;
    role[i] = resolveRole(m & 15, m & 0xf0);
  }
  const at = (x: number, y: number) => (inBounds(g, x, y) ? idx(g, x, y) : -1);
  const roleOf = (x: number, y: number) => { const i = at(x, y); return i < 0 ? null : role[i]; };
  const openAt = (x: number, y: number) => { const i = at(x, y); return i < 0 || mask[i] < 0 ? 0 : openOf(mask[i]); };
  const zebraAt = (x: number, y: number) => { const i = at(x, y); return i >= 0 && !!dress && (dress[i] & 4) !== 0 && mask[i] >= 0; };
  const fourOpen = (x: number, y: number) => openAt(x, y) === 15;
  // A LANE of a road two cells wide: open three ways, its kerb on the fourth, and the lane across kerbed beyond it.
  const lane2 = (x: number, y: number): Side | -1 => {
    if (roleOf(x, y) !== "thick-lane") return -1;
    const o = openAt(x, y);
    const k = SIDES.find((s) => !has(o, s))!;
    const t = opposite(k), [dx, dy] = STEP[t];
    return has(openAt(x + dx, y + dy), t) ? -1 : k;
  };

  // JUNCTIONS, as the streets have them: where the road runs on both ways
  // further than a road is wide. Joined up, a junction's tiles are one
  // REGION, and the streets that meet there its ARMS: two, it is a bend;
  // three or more, a junction proper. @see streetsOf
  const streets = streetsOf(g);
  const n = g.w * g.h;
  const region = new Int32Array(n).fill(-1);
  const regions: { cell0: number; arms: Map<number, Side[]>; major: "u" | "v" | ""; cells: number; sx: number; sy: number; x0: number; x1: number; y0: number; y1: number }[] = [];
  for (let i0 = 0; i0 < n; i0++) {
    if (mask[i0] < 0 || streets.of[i0] >= 0 || region[i0] >= 0) continue;
    const id = regions.length, R = { cell0: i0, arms: new Map<number, Side[]>(), major: "" as "u" | "v" | "", cells: 0, sx: 0, sy: 0, x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
    regions.push(R);
    const stack = [i0];
    region[i0] = id;
    while (stack.length) {
      const i = stack.pop()!, x = i % g.w, y = (i / g.w) | 0;
      R.cells++;
      R.sx += x; R.sy += y;
      R.x0 = Math.min(R.x0, x); R.x1 = Math.max(R.x1, x); R.y0 = Math.min(R.y0, y); R.y1 = Math.max(R.y1, y);
      const o = openOf(mask[i]);
      for (const sd of SIDES) {
        if (!has(o, sd)) continue;
        const [dx, dy] = STEP[sd], j = at(x + dx, y + dy);
        if (j < 0) continue;
        const st = streets.of[j];
        if (st >= 0) { const arm = R.arms.get(st) ?? []; arm.push(sd); R.arms.set(st, arm); continue; }
        if (region[j] < 0) { region[j] = id; stack.push(j); }
      }
    }
    // The MAJOR way through: the one with arms either side; at a crossroads, the longer streets.
    const sides = new Set([...R.arms.values()].flat());
    const through = (["u", "v"] as const).filter((ax) => (ax === "u" ? sides.has(0) && sides.has(1) : sides.has(2) && sides.has(3)));
    const len = (ax: "u" | "v") => [...R.arms].reduce((t, [st, sd]) => t + (sd.some((q) => (q < 2) === (ax === "u")) ? streets.tiles[st].length : 0), 0);
    R.major = through.length === 1 ? through[0] : through.length === 2 ? (len("v") > len("u") ? "v" : "u") : "";
  }
  // A WIDE STREET'S CELLS, as the lanes have them, and the way each runs: what is painted on them of lanes is
  // worked out from the lanes themselves. @see roads/marks
  const G = buildLaneGraph(g), marks = marksOf(g, G);
  const wideAx = new Map<number, string>();
  for (const st of G.streets) {
    if (st.width < 2) continue;
    st.span.forEach(([b0, b1], k) => {
      // (The slice of a jog: a cell wider than the road, the road stepping over between the slices either side.)
      const jog = b1 - b0 + 1 > st.width && k > 0 && k + 1 < st.span.length && st.span[k - 1][0] !== st.span[k + 1][0];
      for (let b = b0; b <= b1; b++) wideAx.set(st.axis === "x" ? idx(g, st.a0 + k, b) : idx(g, b, st.a0 + k), (st.axis === "x" ? "u" : "v") + (jog ? "j" : ""));
    });
  }
  const regionAt = (x: number, y: number) => { const i = at(x, y); return i < 0 ? null : region[i] < 0 ? null : regions[region[i]]; };
  // A ROUNDABOUT where four roads two cells wide or more meet, as the lanes have it. @see agents/lanes/graph kindOf
  // (What a junction is, the lanes say: one decision, for the traffic and for the paint.)
  const kindAt = new Map<number, string>();
  for (const J of G.junctions) for (const c of J.cells) kindAt.set(c, J.kind);
  const roundabout = (R: (typeof regions)[number] | null) => !!R && kindAt.get(R.cell0) === "roundabout";
  // LIGHTS where four roads or more meet and one is two cells wide or more, short of a roundabout.
  const lights = (R: (typeof regions)[number] | null) => !!R && kindAt.get(R.cell0) === "signals";
  // A WIDE ROAD'S BEND: two ways out at right angles, each the road's whole width, the corner a square of it.
  const bendOf = (R: (typeof regions)[number] | null): { k: number; px: number; py: number } | null => {
    if (!R || R.arms.size !== 2) return null;
    const k = R.x1 - R.x0 + 1;
    if (k < HIGHWAY || R.y1 - R.y0 + 1 !== k || R.cells !== k * k) return null;
    const [a, b] = [...R.arms.values()];
    if (a.length !== k || b.length !== k || !a.every((q) => q === a[0]) || !b.every((q) => q === b[0]) || (a[0] < 2) === (b[0] < 2)) return null;
    const sides = [a[0], b[0]];
    // The inside corner: on the side each way leaves by. In corners, a cell at x spanning x to x + 1.
    return { k, px: sides.includes(0) ? R.x0 : R.x1 + 1, py: sides.includes(2) ? R.y0 : R.y1 + 1 };
  };
  // A YELLOW BOX: where wider roads cross, the 2×2 of cells open every way at a junction of four.
  const boxAt = (x: number, y: number) => {
    const R = regionAt(x, y);
    if (!R || R.arms.size < 4 || !fourOpen(x, y) || diagOf(mask[at(x, y)]) === 15) return false;
    for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
      if (fourOpen(x + ox, y + oy) && fourOpen(x + ox + 1, y + oy) && fourOpen(x + ox, y + oy + 1) && fourOpen(x + ox + 1, y + oy + 1)) return true;
    }
    return false;
  };

  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const i = idx(g, x, y);
    if (mask[i] < 0) continue;
    const o = openOf(mask[i]), r = role[i]!, ax = axisOf(o);
    const lvl = dress ? dress[i] & 3 : 0;
    const L: Look = {
      open: o, diag: diagOf(mask[i]), ramp: g.ramp[i], lvl,
      vr: variantOf(Math.floor(hash(x * 31.7 + y * 57.3 + 0.5) * VARIANTS)),
      ctr: "", mk: marks[i], wx: wideAx.get(i) ?? "", gw: "", stop: "", arrow: "", box: 0, yl: false, zz: "", zeb: "", xing: "", slow: "", rb: "", bay: "", spd: "",
    };
    out[i] = L;
    // PARKING BAYS at its kerbs, and a lay-by's taper in beside them.
    if (bays) for (const sd of SIDES) {
      if (has(o, sd)) continue;
      const bit = 1 << sd;
      if (bays[i] & (bit << 8)) { L.bay += `B${sd}`; continue; }
      if (bays[i] & bit) { L.bay += `L${sd}`; continue; }
      if (bays[i] & (bit << 4)) { L.bay += `M${sd}`; continue; }
      // (Along a straight kerb only: open both ways along it.)
      const [lo, hi] = (sd < 2 ? [2, 3] : [0, 1]) as [Side, Side];
      if (!has(o, lo) || !has(o, hi)) continue;
      const near = (e: Side) => { const [dx, dy] = STEP[e], j = at(x + dx, y + dy); return j >= 0 && (bays[j] & bit) !== 0; };
      const ends = (near(lo) ? 1 : 0) | (near(hi) ? 2 : 0);
      if (ends) L.bay += `T${sd}${ends}`;
    }
    const kerbed = o !== 15;
    const nub = [0, 1, 2, 3].some((c) => {
      const su = c & 1, sv = c >> 1;
      return has(o, su ? 1 : 0) && has(o, sv ? 3 : 2) && !(L.diag & (1 << c));
    });
    const lane = lane2(x, y);
    const straight = r === "thin-straight" && ax !== "";

    // A ZEBRA, and the zigzags either side of it.
    // (Over a zebra no lane is marked; beside one, the zigzags are its lines, and only a central reservation runs on.)
    if (zebraAt(x, y) && (straight || lane >= 0) && ax) { L.zeb = ax; L.mk = ""; continue; }
    if ((straight || lane >= 0) && ax) {
      const [ex, ey] = ax === "u" ? [1, 0] : [0, 1];
      if (zebraAt(x + ex, y + ey) || zebraAt(x - ex, y - ey)) { L.zz = ax; L.mk = L.mk.split(";").filter((q) => q[0] === "M").join(";"); continue; }
    }

    const R = regionAt(x, y);
    if (R) {
      // IN A JUNCTION OR ROUND A BEND.
      if (roundabout(R)) {
        // Its island, round the middle: inside the ring the lanes run on. @see RING_OF
        const cx = R.sx / R.cells, cy = R.sy / R.cells;
        const r = (Math.sqrt(R.cells) / 2) * RING_OF - RING_LANE;
        L.rb = `${(cx - x + 0.5).toFixed(3)},${(cy - y + 0.5).toFixed(3)},${r.toFixed(3)}`;
        continue;
      }
      // ROUND A WIDE ROAD'S BEND: its lines carried on round the corner.
      if (bendOf(R)) continue;
      if (R.arms.size >= 3 && boxAt(x, y)) {
        let border = 0;
        for (const sd of SIDES) { const [dx, dy] = STEP[sd]; if (!boxAt(x + dx, y + dy)) border |= 1 << sd; }
        L.box = 1 | (border << 1);
      } else if (r === "thick-curve") L.ctr = "b";
      else if ((r === "thin-T" || r === "thin-cross") && R.major) L.ctr = R.major.toUpperCase();
      // No double yellows round a square: it is somewhere to stop.
      if (kerbed && R.cells <= PLAZA) L.yl = true;
      continue;
    }

    // ON A STREET: its centre line, and what it says before the end of it. (A wide street's lines, the lines its
    // lanes wait at, its arrows and its roundels are its lanes' own, in `mk`: here only what is the kerb's and the crossing's.)
    const wide = wideAx.get(i);
    const along = (straight ? (ax === "u" ? [0, 1] : [2, 3]) : wide ? (wide[0] === "u" ? [0, 1] : [2, 3]) : []) as Side[];
    let warn = false;
    for (const sd of along) {
      const [dx, dy] = STEP[sd], J = regionAt(x + dx, y + dy);
      if (!J) continue;
      warn = true;
      L.yl = true;
      // A wide road's own bend ahead: it runs on round it, nothing to give way to.
      if (bendOf(J)) continue;
      if (J.arms.size < 3 && J.cells <= PLAZA) {
        // A bend ahead: SLOW, for a one-lane road's driver coming up to it.
        if (straight && J.arms.size === 2) L.slow += sd;
        continue;
      }
      // (Three ways or more, the street's mouth is crossed: the line set back behind the crossing, `a`–`h`.)
      const code = (k: number) => (J.arms.size >= 3 ? String.fromCharCode(97 + k) : String(k));
      // Crossed at the lights: marked, where it is not a zebra.
      const lit = lights(J);
      if (lit && J.arms.size >= 3 && !L.zeb) L.xing = sd < 2 ? "u" : "v";
      if (!straight) continue;
      // ONTO A ROUNDABOUT: everyone gives way, to the ring.
      if (roundabout(J)) { L.gw += code(sd); continue; }
      // A junction ahead: give way, unless this is the major road through it; at lights, a stop line.
      const minor = !lit && (J.major === "" || J.major !== (sd < 2 ? "u" : "v"));
      if (minor) L.gw += code(sd); else if (lit) L.stop += code(sd);
    }
    // A SPEED ROUNDEL three cells out of a junction, on a one-cell street long enough to want one: one for each way along it.
    if (straight && !warn && streets.tiles[streets.of[i]]?.length >= ROUNDEL_MIN
      && along.some((sd) => { const [dx, dy] = STEP[sd], J = regionAt(x - 3 * dx, y - 3 * dy); return !!J && !regionAt(x - dx, y - dy) && !regionAt(x - 2 * dx, y - 2 * dy) && J.arms.size >= 3; })) {
      for (const sd of along) L.spd += `${sd}20`;
    }
    if (straight) L.ctr = warn ? ax.toUpperCase() : ax;
    else if (r === "thick-curve" && !wide) { L.ctr = "b"; L.yl = true; }
    if (kerbed && nub) L.yl = true;
  }
  return out;
}

/** The look of one cell, as {@link looksOf} would have it. For tests and a single cell's readout. */
export function lookAt(g: Grid, x: number, y: number, dress?: Uint8Array): Look | null {
  return looksOf(g, dress)[idx(g, x, y)];
}

/** Cells whose look a change at `(x, y)` can alter: everything within four, the farthest any rule above looks. */
export function lookDirtyCells(g: Grid, x: number, y: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) if (inBounds(g, x + dx, y + dy)) out.push({ x: x + dx, y: y + dy });
  return out;
}
