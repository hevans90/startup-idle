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
 * WHICH SIDE TRAFFIC KEEPS TO is the town's: right (`agents/roads.ts`). Every
 * marking that belongs to one lane — give-way lines, the triangle, arrows,
 * SLOW — is laid on the lane a driver arriving there is in, the one on their
 * right; a town driving on the left would flip {@link KEEP}.
 */
import { idx, inBounds, type Grid } from "../grid";
import { hash } from "../structures/projects/model";
import { DIAG, DIR, isPaved, maskAt } from "./mask";
import { streetsOf } from "./streets";
import { resolveRole, type RoadRole } from "./table";
import { RING_OF } from "../agents/lanes/graph";

/** Half a ring lane's width and a little: the island's edge inside the lane's middle. */
const RING_LANE = 0.22;

/** The side of the road traffic keeps to: +1 right, −1 left. @see rightOf in agents/roads */
export const KEEP = 1;

export type Side = 0 | 1 | 2 | 3;
/** How many variants a road tile has; four of them carry a fitting, the rest are plain road. */
export const VARIANTS = 10;
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
  /** Which of VARIANTS: the pavement's pattern (its low two bits) and, for 0–3 only, a gully, manhole, patch or crack. */
  vr: number;
  /**
   * THE CENTRE LINE. `u`/`v`: dashed down the middle along that axis; upper
   * case, the warning line, long dashes, short gaps, before a junction or a
   * bend. `b`: round a bend. `h0`–`h3` (`H` warning): half of a two-lane
   * road's line, on that side, the lane across drawing the other half.
   */
  ctr: string;
  /**
   * THE LANE LINES of a road two cells wide or more: `u`/`v`, the way it
   * runs; `!` before a junction (the centre line its warning line); then its
   * width in cells and which this is across it, from the low side: `u!3.1`.
   * Empty elsewhere. @see agents/lanes/graph laneLines
   */
  ln: string;
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
};

/** A look as a key: every field, compact. */
export const keyOf = (l: Look): string =>
  `${l.open}.${l.diag}.${l.ramp}.${l.lvl}.${l.vr}.${l.ctr}.${l.ln}.${l.gw}.${l.stop}.${l.arrow}.${l.box}.${l.yl ? 1 : 0}.${l.zz}.${l.zeb}.${l.xing}.${l.slow}.${l.rb}`;

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
/** A cell's road role, by the same rule the sprite table used. */
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
 * street with no level yet, tarmac and no zebras.
 */
export function looksOf(g: Grid, dress?: Uint8Array): (Look | null)[] {
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
  const paved = (x: number, y: number) => { const i = at(x, y); return i >= 0 && mask[i] >= 0; };
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
  const regions: { arms: Map<number, Side[]>; major: "u" | "v" | ""; cells: number; sx: number; sy: number }[] = [];
  for (let i0 = 0; i0 < n; i0++) {
    if (mask[i0] < 0 || streets.of[i0] >= 0 || region[i0] >= 0) continue;
    const id = regions.length, R = { arms: new Map<number, Side[]>(), major: "" as "u" | "v" | "", cells: 0, sx: 0, sy: 0 };
    regions.push(R);
    const stack = [i0];
    region[i0] = id;
    while (stack.length) {
      const i = stack.pop()!, x = i % g.w, y = (i / g.w) | 0;
      R.cells++;
      R.sx += x; R.sy += y;
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
  // ACROSS A WIDE STREET: the way it runs, how wide it is, and where each of its cells is across it.
  const across = new Map<number, { ax: "u" | "v"; k: number; c: number }>();
  for (const cells of streets.tiles) {
    if (cells.length < 2) continue;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const i of cells) { const x = i % g.w, y = (i / g.w) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const ax: "u" | "v" = x1 - x0 >= y1 - y0 ? "u" : "v";
    const slices = new Map<number, number[]>();
    for (const i of cells) { const x = i % g.w, y = (i / g.w) | 0, a = ax === "u" ? x : y; const s = slices.get(a); if (s) s.push(ax === "u" ? y : x); else slices.set(a, [ax === "u" ? y : x]); }
    for (const [a, bs] of slices) {
      if (bs.length < 2) continue;
      const lo = Math.min(...bs);
      for (const b of bs) across.set(ax === "u" ? idx(g, a, b) : idx(g, b, a), { ax, k: bs.length, c: b - lo });
    }
  }
  const regionAt = (x: number, y: number) => { const i = at(x, y); return i < 0 ? null : region[i] < 0 ? null : regions[region[i]]; };
  // A ROUNDABOUT where four roads two cells wide or more meet, as the lanes have it. @see agents/lanes/graph kindOf
  const roundabout = (R: (typeof regions)[number] | null) => !!R && R.arms.size === 4 && [...R.arms.values()].every((sd) => sd.length >= 2);
  // LIGHTS where four roads or more meet and one is two cells wide or more, short of a roundabout.
  const lights = (R: (typeof regions)[number] | null) => !!R && R.arms.size >= 4 && !roundabout(R) && [...R.arms.values()].some((sd) => sd.length >= 2);
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
      vr: Math.floor(hash(x * 31.7 + y * 57.3 + 0.5) * VARIANTS),
      ctr: "", ln: "", gw: "", stop: "", arrow: "", box: 0, yl: false, zz: "", zeb: "", xing: "", slow: "", rb: "",
    };
    out[i] = L;
    const kerbed = o !== 15;
    const nub = [0, 1, 2, 3].some((c) => {
      const su = c & 1, sv = c >> 1;
      return has(o, su ? 1 : 0) && has(o, sv ? 3 : 2) && !(L.diag & (1 << c));
    });
    const lane = lane2(x, y);
    const straight = r === "thin-straight" && ax !== "";

    // A ZEBRA, and the zigzags either side of it.
    if (zebraAt(x, y) && (straight || lane >= 0) && ax) { L.zeb = ax; continue; }
    if ((straight || lane >= 0) && ax) {
      const [ex, ey] = ax === "u" ? [1, 0] : [0, 1];
      if (zebraAt(x + ex, y + ey) || zebraAt(x - ex, y - ey)) { L.zz = ax; continue; }
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

    // ON A STREET: its centre line, and what it says before the end of it.
    const wide = across.get(i);
    const along = (straight ? (ax === "u" ? [0, 1] : [2, 3]) : lane >= 0 ? (opposite(lane as Side) < 2 ? [2, 3] : [0, 1]) : wide ? (wide.ax === "u" ? [0, 1] : [2, 3]) : []) as Side[];
    let warn = false;
    for (const sd of along) {
      const [dx, dy] = STEP[sd], J = regionAt(x + dx, y + dy);
      if (!J) continue;
      warn = true;
      L.yl = true;
      if (J.arms.size < 3 && J.cells <= PLAZA) {
        // A bend ahead: SLOW, for a one-lane road's driver coming up to it.
        if (straight && J.arms.size === 2) L.slow += sd;
        continue;
      }
      // ONTO A ROUNDABOUT: everyone gives way, to the ring.
      // (Three ways or more, the street's mouth is crossed: the line set back behind the crossing, `a`–`h`.)
      const code = (k: number) => (J.arms.size >= 3 ? String.fromCharCode(97 + k) : String(k));
      if (roundabout(J)) {
        const [rx, ry] = rightOf(dx, dy);
        if (straight) L.gw += code(sd);
        else if (sideOf(rx, ry) === lane) L.gw += code(sd + 4);
        continue;
      }
      // AT LIGHTS: a stop line on every way in.
      const lit = lights(J);
      // A junction ahead: give way, unless this is the major road through it.
      const minor = !lit && (J.major === "" || J.major !== (sd < 2 ? "u" : "v"));
      // Crossed at the lights: marked, where it is not a zebra.
      if (lit && J.arms.size >= 3 && !L.zeb) L.xing = sd < 2 ? "u" : "v";
      if (straight) { if (minor) L.gw += code(sd); else if (lit) L.stop += code(sd); continue; }
      // On a two-lane road, only the lane coming in: the one with its kerb on the right.
      const [rx, ry] = rightOf(dx, dy);
      if (sideOf(rx, ry) !== lane) continue;
      if (lit || (J.arms.size >= 4 && boxAt(x + dx, y + dy))) L.stop += code(sd + 4);
      else if (minor) L.gw += code(sd + 4);
      if (!minor && !L.stop) continue;
    }
    // THE ARROW in the lane, a cell back from the line — the cell at the line is
    // the crossing's — at lights or a box, on a two-lane road's lane coming in.
    if (lane >= 0) for (const sd of along) {
      const [dx, dy] = STEP[sd], J = regionAt(x + 2 * dx, y + 2 * dy);
      if (!J || regionAt(x + dx, y + dy) || J.arms.size < 3 || roundabout(J)) continue;
      const [rx, ry] = rightOf(dx, dy);
      if (sideOf(rx, ry) !== lane) continue;
      if (!lights(J) && !(J.arms.size >= 4 && boxAt(x + 2 * dx, y + 2 * dy))) continue;
      const left = paved(x + 3 * dx - 2 * rx, y + 3 * dy - 2 * ry);
      const ahead = paved(x + 4 * dx, y + 4 * dy);
      const right = paved(x + 2 * dx + rx, y + 2 * dy + ry);
      if (left || ahead || right) L.arrow = `${sd}${left ? "L" : ""}${ahead ? "A" : ""}${right ? "R" : ""}`;
    }
    if (straight) L.ctr = warn ? ax.toUpperCase() : ax;
    else if (wide) L.ln = `${wide.ax}${warn ? "!" : ""}${wide.k}.${wide.c}`;
    else if (lane >= 0) L.ctr = (warn ? "H" : "h") + opposite(lane as Side);
    else if (r === "thick-curve") { L.ctr = "b"; L.yl = true; }
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
