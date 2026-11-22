/**
 * World v2 — STREETS: the road between one junction and the next. The road
 * network is one piece wherever it joins up, which says where a trip can go
 * but not which street a building is on; a street is a run of road between
 * junctions — where the road runs on both ways, further than any road is
 * wide — and a junction is where streets meet, on none of them.
 *
 * A street has no name of its own: it is known by the biggest earner on it,
 * "the street by the Vibe Coder Studio". @see streetEarnings
 */
import { NEIGHBOUR } from "../../iso/dir";
import { idx, type Grid } from "../grid";
import { connects } from "./mask";

const DIRS = ["N", "E", "S", "W"] as const;

export type Streets = {
  /** The street each road tile is on, -1 for a junction or no road. */
  of: Int32Array;
  /** Each street's tiles, by its number. */
  tiles: number[][];
};

/** How many ways on a road tile has. */
const waysOn = (g: Grid, x: number, y: number) => DIRS.reduce((n, d) => n + (connects(g, x, y, d) ? 1 : 0), 0);

/** Wider than any road is: a tile the road runs on past this both ways is a junction. @see GenParams.roadWidth */
const WIDEST = 4;

/** How far the road runs through each tile, joined up, along one axis. */
function runs(g: Grid, along: "x" | "y"): Int32Array {
  const out = new Int32Array(g.w * g.h);
  const [back, on] = along === "x" ? (["N", "S"] as const) : (["E", "W"] as const);
  const [dx, dy] = NEIGHBOUR[on];
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const i = idx(g, x, y);
      if (out[i] || !waysOn(g, x, y) || connects(g, x, y, back)) continue;
      // From the start of a run, along it to its end, and every tile told the length.
      const run = [i];
      for (let cx = x, cy = y; connects(g, cx, cy, on); cx += dx, cy += dy) run.push(idx(g, cx + dx, cy + dy));
      for (const j of run) out[j] = run.length;
    }
  }
  return out;
}

/**
 * The streets of a map, found once for each state of it: its looks, its lanes, its props, its beauty and its
 * services each asked for them after every edit, and each was a walk of the whole map. Kept by the map's own count
 * of its edits (@see Grid.rev); a map made as a copy is its own map. Read only.
 */
const found = new WeakMap<Grid, { rev: number; streets: Streets }>();
export function streetsOf(g: Grid): Streets {
  const was = found.get(g);
  if (was && was.rev === g.rev) return was.streets;
  const streets = findStreets(g);
  found.set(g, { rev: g.rev, streets });
  return streets;
}
function findStreets(g: Grid): Streets {
  const of = new Int32Array(g.w * g.h).fill(-1);
  const tiles: number[][] = [];
  // A JUNCTION is where the road runs on both ways further than any road is
  // wide: a crossing, a corner, the head of a T. Across a wide road is not one:
  // its lanes are the one street.
  const junction = new Uint8Array(g.w * g.h);
  const rx = runs(g, "x"), ry = runs(g, "y");
  // BUT FOR A JOG: where the widest road steps a cell sideways, the one slice is a cell wider than any road — the
  // road as it comes in, and as it goes out, a cell over. That slice is the road still, as a narrower road's is.
  const paved = (x: number, y: number) => x >= 0 && y >= 0 && x < g.w && y < g.h && waysOn(g, x, y) > 0;
  const jog = (i: number, along: "x" | "y") => {
    const across = along === "x" ? ry : rx;
    if (across[i] !== WIDEST + 1) return false;
    const [dx, dy] = along === "x" ? [1, 0] : [0, 1], [ax, ay] = along === "x" ? [0, 1] : [1, 0];
    let x = i % g.w, y = (i - x) / g.w;
    while (paved(x - ax, y - ay) && connects(g, x, y, along === "x" ? "E" : "N")) { x -= ax; y -= ay; }
    // Either side of the slice: the road at its own width, over the low cells one side and the high the other.
    const side = (s: number) => {
      const at = (q: number) => paved(x + s * dx + q * ax, y + s * dy + q * ay) && across[idx(g, x + s * dx + q * ax, y + s * dy + q * ay)] === WIDEST;
      return at(0) && !paved(x + s * dx + WIDEST * ax, y + s * dy + WIDEST * ay) ? -1 : at(WIDEST) && !paved(x + s * dx, y + s * dy) ? 1 : 0;
    };
    const lo = side(-1), hi = side(1);
    return lo !== 0 && hi !== 0 && lo !== hi;
  };
  // NOR A BROAD STRIP: road wider than any road is, but one width for longer than it is wide — two roads laid side
  // by side, say. It is a road still, with the widest road's lanes and the rest of it shoulder; not a square with
  // nothing in it. Only where it is crossed, or its width changes, is there a junction.
  const strip = (i: number, along: "x" | "y") => {
    const across = along === "x" ? ry : rx, w = across[i];
    if (w <= WIDEST || w > 2 * WIDEST) return false;
    const [dx, dy] = along === "x" ? [1, 0] : [0, 1], [ax, ay] = along === "x" ? [0, 1] : [1, 0];
    const x0 = i % g.w, y0 = (i - x0) / g.w;
    // Its low edge across, here; and the same width from the same edge, cell after cell along.
    const low = (x: number, y: number) => { let q = 0; while (paved(x - (q + 1) * ax, y - (q + 1) * ay) && connects(g, x - q * ax, y - q * ay, along === "x" ? "E" : "N")) q++; return q; };
    const mine = low(x0, y0);
    let n = 1;
    for (const sg of [1, -1]) for (let k = 1; ; k++) {
      const x = x0 + sg * k * dx, y = y0 + sg * k * dy;
      if (!paved(x, y) || across[idx(g, x, y)] !== w || low(x, y) !== mine || !connects(g, x - sg * dx, y - sg * dy, along === "x" ? (sg > 0 ? "S" : "N") : (sg > 0 ? "W" : "E"))) break;
      n++;
    }
    return n > w;
  };
  for (let i = 0; i < junction.length; i++) if (rx[i] > WIDEST && ry[i] > WIDEST && !jog(i, "x") && !jog(i, "y") && !strip(i, "x") && !strip(i, "y")) junction[i] = 1;
  // WHERE A ROAD CHANGES WIDTH it is two streets, and the last slice of the wider one the junction between
  // them: three lanes each way do not run on down a road one cell wide. Only where each width holds for two
  // slices or more — a staircase's step, a cell wider for one slice, is the one street still.
  const widthAt = (i: number, along: "x" | "y") => (along === "x" ? (rx[i] > ry[i] ? ry[i] : 0) : ry[i] > rx[i] ? rx[i] : 0);
  for (const along of ["x", "y"] as const) {
    const [dx, dy] = along === "x" ? [1, 0] : [0, 1];
    const [fwd, across0, across1] = along === "x" ? (["S", "E", "W"] as const) : (["W", "N", "S"] as const);
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      const i = idx(g, x, y), w = widthAt(i, along);
      if (!w || junction[i] || !connects(g, x, y, fwd)) continue;
      const j = idx(g, x + dx, y + dy), v = widthAt(j, along);
      if (!v || v === w || junction[j]) continue;
      const held = (cx: number, cy: number, want: number) => cx >= 0 && cy >= 0 && cx < g.w && cy < g.h && widthAt(idx(g, cx, cy), along) === want;
      if (!held(x - dx, y - dy, w) || !held(x + 2 * dx, y + 2 * dy, v)) continue;
      // The wider slice, the whole of it across.
      const [wx, wy] = w > v ? [x, y] : [x + dx, y + dy];
      junction[idx(g, wx, wy)] = 1;
      for (const d of [across0, across1] as const) {
        const [ax, ay] = NEIGHBOUR[d];
        for (let cx = wx, cy = wy; connects(g, cx, cy, d); cx += ax, cy += ay) junction[idx(g, cx + ax, cy + ay)] = 1;
      }
    }
  }
  /** The streets as the junctions leave them: road joined up, between them. */
  const flood = () => {
    of.fill(-1); tiles.length = 0;
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        const i = idx(g, x, y);
        if (of[i] >= 0 || junction[i] || !waysOn(g, x, y)) continue;
        const n = tiles.length, run = [i];
        of[i] = n;
        for (let q = 0; q < run.length; q++) {
          const c = run[q], cx = c % g.w, cy = (c - cx) / g.w;
          for (const d of DIRS) {
            if (!connects(g, cx, cy, d)) continue;
            const [dx, dy] = NEIGHBOUR[d];
            const j = idx(g, cx + dx, cy + dy);
            if (of[j] >= 0 || junction[j]) continue;
            of[j] = n;
            run.push(j);
          }
        }
        tiles.push(run);
      }
    }
  };
  flood();
  // A STREET IS ONE WIDTH. Where a slice of it is narrower than the rest — the throat a narrower road comes into it
  // by, a pinch — its lanes do not fit: that slice is the junction's, and the street is what is as wide as itself.
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const cells of tiles) {
      if (cells.length < 3) continue;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const i of cells) { const x = i % g.w, y = (i - x) / g.w; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const alongX = x1 - x0 >= y1 - y0;
      const slices = new Map<number, number[]>();
      for (const i of cells) { const x = i % g.w, y = (i - x) / g.w, a = alongX ? x : y; (slices.get(a) ?? slices.set(a, []).get(a)!).push(i); }
      if (slices.size < 2) continue;
      const widths = [...slices.values()].map((q) => q.length).sort((p, q) => p - q), k = widths[widths.length >> 1];
      if (k < 2) continue;
      // (But not a narrow tail it ends in that leads nowhere: its dead end, where its traffic turns back.)
      const keys = [...slices.keys()].sort((p, q) => p - q), mine = of[cells[0]], tail = new Set<number>();
      const leadsOut = (i: number) => { const x = i % g.w, y = (i - x) / g.w; return DIRS.some((d) => connects(g, x, y, d) && of[idx(g, x + NEIGHBOUR[d][0], y + NEIGHBOUR[d][1])] !== mine); };
      for (const order of [keys, [...keys].reverse()]) {
        const run: number[] = [];
        for (const a of order) { if (slices.get(a)!.length >= k) break; run.push(a); }
        if (run.length && !run.some((a) => slices.get(a)!.some(leadsOut))) for (const a of run) tail.add(a);
      }
      for (const [a, q] of slices) if (q.length < k && !tail.has(a)) { for (const i of q) junction[i] = 1; changed = true; }
      // AND WHERE ITS END MEETS THE ROAD BEYOND ALONG ONLY PART OF ITS WIDTH — the rest of it facing the verge — its
      // last slice is the junction's: every lane then turns on paving, not over the grass to reach it.
      for (const [a, sg] of [[keys[0], -1], [keys[keys.length - 1], 1]] as const) {
        const q = slices.get(a)!;
        if (q.length < k) continue;
        const on = q.filter((i) => { const x = i % g.w, y = (i - x) / g.w; return connects(g, x, y, alongX ? (sg > 0 ? "S" : "N") : (sg > 0 ? "W" : "E")); }).length;
        if (on > 0 && on < q.length) { for (const i of q) junction[i] = 1; changed = true; }
      }
      // NOR IS IT A STREET where it steps sideways by more than a cell in the length of one: no lane takes that.
      // (A step of one cell is a jog, and the road still.)
      const low = (a: number) => { const q = slices.get(a); return q && q.length >= k ? Math.min(...q.map((i) => (alongX ? (i - (i % g.w)) / g.w : i % g.w))) : null; };
      for (const [a, q] of slices) {
        const p = low(a - 1), n = low(a + 1);
        if (q.length > k && p !== null && n !== null && Math.abs(p - n) >= 2) { for (const i of q) junction[i] = 1; changed = true; }
      }
    }
    if (!changed) break;
    flood();
  }
  return { of, tiles };
}

/** A street's earnings, and its biggest earner. */
export type StreetEarning = { street: number; perSecond: number; best: number };

/**
 * WHAT EACH STREET EARNS: everything earned by the buildings whose doors open
 * onto it, a second, best first. `doors` is each building's door tile; a door
 * on a junction counts for the street it leads on to first.
 */
export function streetEarnings(
  g: Grid, streets: Streets, doors: ReadonlyMap<number, number>, earning: ReadonlyMap<number, number>,
): StreetEarning[] {
  const by = new Map<number, { perSecond: number; best: number; most: number }>();
  for (const [structure, amount] of earning) {
    const door = doors.get(structure);
    if (door === undefined || amount <= 0) continue;
    let street = streets.of[door];
    if (street < 0) {
      const x = door % g.w, y = (door - x) / g.w;
      for (const d of DIRS) {
        if (!connects(g, x, y, d)) continue;
        const [dx, dy] = NEIGHBOUR[d];
        street = streets.of[idx(g, x + dx, y + dy)];
        if (street >= 0) break;
      }
    }
    if (street < 0) continue;
    const e = by.get(street) ?? { perSecond: 0, best: structure, most: 0 };
    e.perSecond += amount;
    if (amount > e.most) { e.most = amount; e.best = structure; }
    by.set(street, e);
  }
  return [...by.entries()].map(([street, e]) => ({ street, perSecond: e.perSecond, best: e.best }))
    .sort((a, b) => b.perSecond - a.perSecond);
}
