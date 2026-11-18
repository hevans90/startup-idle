/**
 * World v2 — HOW A BUILDING FALLS DOWN. Pure: no drawing in it.
 *
 * As the games that do this well do it (a model fractured by material, its
 * fragments held up by what is under them, let go at staggered times, a
 * rigid-body fall kept inside the footprint), but worked out as it happens
 * rather than baked:
 *
 *  - A building is its MASSES — wings, towers — and each is FRACTURED along
 *    its own lines: a storey's walls into panels, its floor into plates, the
 *    roof into plates. What a piece is made of is its mass's skin: masonry,
 *    glass on a frame, sheet on a portal, concrete.
 *  - Every piece STANDS ON something: a wall panel on the panel under it, a
 *    floor plate on the walls round it and the plate (the columns) under it.
 *    With half of what held it gone, it goes — a moment later.
 *  - HOW IT IS BROUGHT DOWN is by what it is (@see planOf): a low building is
 *    PULLED DOWN from the digger's side, top first; a tall one is IMPLODED —
 *    its lowest storey blown, the rest dropping through it floor on floor; a
 *    glass one loses its glazing first; a shed's roof goes in, then its walls
 *    fold after it.
 *  - What has gone FALLS: gravity, a spin, the ground — and the rubble
 *    already on it, a height a cell — where the big pieces of masonry BREAK
 *    in two and all of them come to rest, heaping where they land. Nothing is
 *    let far outside the plot.
 *
 * Tiles, from the plot's back corner; heights in tiles too.
 */

export type Skin = "masonry" | "glass" | "sheet" | "concrete";
/** A mass of a building as it is to be broken: its box, tiles; how high a storey of it is; what it is clad in. */
export type MassIn = { u0: number; v0: number; u1: number; v1: number; w0: number; w1: number; storey: number; skin: Skin; /** A box put round a picture, not the building's own shape: its inside is not to be seen till it is broken. */ hollow?: boolean;
  /** The box is given a little bigger than the building, to carry what overhangs it in its picture: by so much sideways and up. Its two far walls — which carry no picture — are built where the building's own are, and as high. */
  pad?: { side: number; up: number } };

export type V3 = [number, number, number];
/** What a piece is: a wall panel on one of its mass's four sides, or a plate of floor or roof. */
export type Part = "wall" | "plate";
export type Chunk = {
  /** Its middle, its half sizes along its own axes, how it is turned (a quaternion), how fast it moves and turns. */
  c: V3; e: V3; q: [number, number, number, number]; v: V3; om: V3;
  skin: Skin; part: Part; mass: number; floor: number;
  /** Standing as built; falling; lying; gone (shattered, broken in two, cleared). */
  state: 0 | 1 | 2 | 3;
  /** Seconds from the start at which it is let go; never, till something says. */
  due: number;
  /** What it stands on, and what stands on it; how many of the first it had. On the ground itself: none. */
  sup: number[]; dep: number[]; had: number;
  /** How many times it is the half of something broken. */
  gen: number;
  /** Which of its six faces show the building's own picture — +x −x +y −y +z −z of its own axes — each as four corners of that picture, set by whoever draws it; null, a face nobody saw: bare. */
  tex: (Float32Array | null)[];
  /** Which of its faces were outside faces as built: for whoever gives them their picture. */
  outer: number;
  /** A push it is given as it is let go. */
  kick?: V3;
  /** Going over, stood on an edge: how fast, and which way. */
  tip?: number;
  /** Which of the building's masses it is of; and — standing — that something which stood between it and the camera has gone: its bare faces are to be seen now, and were not before. */
  m: number; seen?: boolean;
  /** What its bare faces are the colour of, where its drawer says: its building's own wall. */
  bare?: number;
  /**
   * ITS OUTLINE: no piece is a rectangle. `ma` is its thin axis; `shape`, the four corners of its face across that —
   * along the two axes after `ma`, from its middle: (−,−), (+,−), (+,+), (−,+) — jagged where it was broken from
   * its neighbours, which share those corners.
   */
  ma: number; shape: Float32Array;
  /** Of a box put round a picture: its bare faces are not drawn while it stands. @see MassIn.hollow */
  hollow?: boolean;
};
export type Happening = { kind: "dust" | "shatter" | "thud"; at: V3; size: number; skin: Skin };
export type Style = "pull" | "implode" | "shed";

export const GRAVITY = 1.5;
/** A wall's thickness and a plate's, tiles; how wide a panel and a plate are cut, by what they are of. */
const WALL = 0.05, PLATE = 0.035;
const CUT: Record<Skin, { panel: number; plate: number }> = { masonry: { panel: 0.19, plate: 0.3 }, glass: { panel: 0.3, plate: 0.34 }, sheet: { panel: 0.3, plate: 0.3 }, concrete: { panel: 0.24, plate: 0.3 } };
/** How hard a piece must land to break in two, tiles a second; never, for what does not break. */
const BREAKS: Record<Skin, number> = { masonry: 0.85, concrete: 1.15, glass: 0, sheet: Infinity };
const CELL = 0.25, MARGIN = 1;
/** How far up the picture a tile of height is, in the picture's own half-tiles: for what is in front of what. */
const RISE = 2.45;

const hash = (n: number) => { const s = Math.sin(n * 12.9898 + 4.1414) * 43758.5453; return s - Math.floor(s); };

/** A building's masses, broken into the pieces it falls in, each knowing what it stands on. */
export function fracture(masses: readonly MassIn[]): Chunk[] {
  const out: Chunk[] = [];
  let hollow = false, mi = 0;
  const add = (c: V3, e: V3, skin: Skin, part: Part, floor: number, outer: number): number => {
    const ma = part === "plate" ? 2 : e[0] < e[1] ? 0 : 1, bm = (ma + 1) % 3, cm = (ma + 2) % 3;
    out.push({ hollow, m: mi, ma, shape: new Float32Array([-e[bm], -e[cm], e[bm], -e[cm], e[bm], e[cm], -e[bm], e[cm]]), c, e, q: [0, 0, 0, 1], v: [0, 0, 0], om: [0, 0, 0], skin, part, mass: 8 * e[0] * e[1] * e[2] * (skin === "glass" ? 0.6 : skin === "sheet" ? 0.4 : 1), floor, state: 0, due: Infinity, sup: [], dep: [], had: 0, gen: 0, tex: [null, null, null, null, null, null], outer });
    return out.length - 1;
  };
  const rests = (on: number, what: number) => { out[what].sup.push(on); out[on].dep.push(what); };
  /** Each mass's lowest pieces and its roof's, for standing one mass on another. */
  const feet: number[][] = [], tops: number[][] = [];
  for (const m of masses) {
    mi++; feet[mi] = []; tops[mi] = [];
    const du = m.u1 - m.u0, dv = m.v1 - m.v0, dw = m.w1 - m.w0;
    if (du < 0.12 || dv < 0.12 || dw < 0.06) continue;
    hollow = !!m.hollow;
    const n = Math.max(1, Math.round(dw / Math.max(0.2, m.storey))), fh = dw / n, cut = CUT[m.skin];
    // (Glass hangs on a frame: it holds nothing up. Everything else's walls carry what is over them.)
    const bearing = m.skin !== "glass";
    let under: { plates: number[] } | null = null, below: number[][] | null = null, colsUnder: number[] | null = null, walls0: number[][] = [];
    for (let k = 0; k < n; k++) {
      const wa = m.w0 + k * fh, wb = wa + fh, top = k === n - 1;
      // ITS FOUR WALLS, in courses: the two toward the camera (+u, +v) carry its picture; the two behind are bare.
      // BROKEN JAGGEDLY: every corner where four pieces meet is moved a little, the same for all four.
      const rows = Math.max(1, Math.round(fh / cut.panel)), all = n * rows;
      let walls: number[][] = [];
      for (let r = 0; r < rows; r++) {
        const gr = k * rows + r, course: number[][] = [];
        for (const [side, len] of [[0, dv], [1, dv], [2, du], [3, du]] as const) {
          // (A far wall is the building's own: in from the padded box, and no higher than the building.)
          const far = side === 1 || side === 3, ps = far ? m.pad?.side ?? 0 : 0, pe = m.pad?.side ?? 0;
          const cnt = Math.max(1, Math.round(len / cut.panel)), ids: number[] = [], rh = (dw - (far ? m.pad?.up ?? 0 : 0)) / all;
          const along = (a: number) => ps + (a * (len - ps - (far ? pe : 0))) / len;
          /** A corner of the wall's grid: how far along the wall, and how high. */
          const at = (ci: number, ri: number): [number, number] => [
            along((len * ci) / cnt + (ci > 0 && ci < cnt ? (hash(mi * 91.7 + side * 13.1 + ci * 7.3 + ri * 3.9) - 0.5) * 0.55 * (len / cnt) : 0)),
            m.w0 + rh * ri + (ri > 0 && ri < all ? (hash(mi * 57.3 + side * 5.7 + ci * 2.3 + ri * 11.1) - 0.5) * 0.55 * rh : 0),
          ];
          for (let i = 0; i < cnt; i++) {
            const mid = along((len * (i + 0.5)) / cnt), half = (len - ps - (far ? pe : 0)) / cnt / 2, zc = m.w0 + rh * (gr + 0.5);
            const c: V3 = side === 0 ? [m.u1 - WALL / 2, m.v0 + mid, zc] : side === 1 ? [m.u0 + ps + WALL / 2, m.v0 + mid, zc] : side === 2 ? [m.u0 + mid, m.v1 - WALL / 2, zc] : [m.u0 + mid, m.v0 + ps + WALL / 2, zc];
            const e: V3 = side < 2 ? [WALL / 2, half, rh / 2] : [half, WALL / 2, rh / 2];
            const id = add(c, e, m.skin, "wall", k, side === 0 ? 1 : side === 2 ? 4 : 0);
            const A = at(i, gr), B = at(i + 1, gr), C2 = at(i + 1, gr + 1), D = at(i, gr + 1), sh = out[id].shape;
            // (Its corners from its middle: along the wall and up, in the order its thin axis asks.)
            const pts = side < 2 ? [A, B, C2, D] : [A, D, C2, B];
            pts.forEach((q, n2) => { const al = q[0] - mid, up = q[1] - zc; sh[n2 * 2] = side < 2 ? al : up; sh[n2 * 2 + 1] = side < 2 ? up : al; });
            // (On the piece under it.)
            if (below) { const b2 = below[course.length]; rests(b2[Math.min(b2.length - 1, i)], id); }
            ids.push(id);
          }
          course.push(ids);
        }
        below = course; walls = course;
        if (gr === 0) walls0 = course;
      }
      // GLASS HANGS ON A FRAME: columns round the edge of every floor of it, which are what carry the floor over.
      let carry: number[][] = walls;
      if (!bearing) {
        const cols: number[] = [], per = (len: number) => Math.max(1, Math.round(len / 0.55)), IN = 0.09, ch = (fh - PLATE) / 2;
        const spots: [number, number][] = [];
        for (let i = 0; i <= per(du); i++) for (const v of [m.v0 + IN, m.v1 - IN]) spots.push([m.u0 + IN + ((du - 2 * IN) * i) / per(du), v]);
        for (let j = 1; j < per(dv); j++) for (const u of [m.u0 + IN, m.u1 - IN]) spots.push([u, m.v0 + IN + ((dv - 2 * IN) * j) / per(dv)]);
        spots.forEach(([u, v], q) => {
          const id = add([u, v, wa + ch], [0.028, 0.03, ch], "concrete", "wall", k, 0);
          if (colsUnder) rests(colsUnder[q], id);
          cols.push(id);
        });
        colsUnder = cols; carry = [cols];
        if (k === 0) feet[mi].push(...cols);
      }
      if (k === 0) for (const ids of walls0) feet[mi].push(...ids);
      // ITS FLOOR OVER IT — the roof, on the top storey, which carries the picture of the roof.
      const nu = Math.max(1, Math.round(du / cut.plate)), nv = Math.max(1, Math.round(dv / cut.plate)), plates: number[] = [];
      for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
        const c: V3 = [m.u0 + (du * (i + 0.5)) / nu, m.v0 + (dv * (j + 0.5)) / nv, wb - PLATE / 2];
        const id = add(c, [du / nu / 2, dv / nv / 2, PLATE / 2], m.skin === "sheet" ? "sheet" : "concrete", "plate", k, top ? 16 : 0);
        // ON THE WALLS ROUND IT, where they carry anything; and on the plate under it, which is its columns.
        for (const ids of carry) for (const wid of ids) { const p = out[wid]; if (Math.abs(p.c[0] - c[0]) < du / nu / 2 + 0.3 && Math.abs(p.c[1] - c[1]) < dv / nv / 2 + 0.3) rests(wid, id); }
        if (under) rests(under.plates[i * nv + j], id);
        plates.push(id);
        if (top) tops[mi].push(id);
      }
      under = { plates };
    }
  }
  // A MASS STOOD ON ANOTHER — a tower on its podium — stands on that one's roof: its lowest pieces on the plates under them.
  masses.forEach((m, k) => {
    if (m.w0 < 0.08) return;
    for (const id of feet[k + 1] ?? []) {
      const c = out[id];
      let best = -1, bd = 0.6;
      masses.forEach((o, j) => { if (j !== k && Math.abs(o.w1 - m.w0) < 0.3) for (const pid of tops[j + 1] ?? []) { const d = Math.hypot(out[pid].c[0] - c.c[0], out[pid].c[1] - c.c[1]); if (d < bd) { bd = d; best = pid; } } });
      if (best >= 0) rests(best, id);
    }
  });
  for (const c of out) c.had = c.sup.length;
  return out;
}

/** How a building is brought down, by what it is: its tallest mass's storeys and what it is clad in. */
export function styleOf(masses: readonly MassIn[]): Style {
  let floors = 0, sheet = 0, vol = 0;
  for (const m of masses) {
    const v = (m.u1 - m.u0) * (m.v1 - m.v0) * (m.w1 - m.w0);
    floors = Math.max(floors, Math.round((m.w1 - m.w0) / Math.max(0.2, m.storey)));
    vol += v; if (m.skin === "sheet") sheet += v;
  }
  return floors >= 5 ? "implode" : sheet > vol * 0.5 && floors <= 2 ? "shed" : "pull";
}

export type Collapse = {
  chunks: Chunk[]; style: Style;
  /** A step of it: `t` seconds from its start. What happened in it — a wall shattered, a slab landed — for whoever draws dust. */
  step(dt: number, t: number): Happening[];
  /** How many still stand; how many are still in the air. */
  standing(): number; falling(): number;
  /** Everything still standing let go, soon: its time is nearly up. */
  finish(t: number): void;
  /** So much of what lies there taken away, nearest `from` first, nought to one. */
  clear(share: number): void;
  /** Where the work is: the middle of whatever went last. */
  at: V3;
  /** Which masses have had anything go from them, by number (from one): their footings are to be seen. */
  opened: boolean[];
};

/**
 * A building to be brought down in `seconds`, by a digger stood at `from`. Its pieces are let go by the plan its
 * style gives (@see styleOf), and by each other as they lose what they stood on.
 */
export function createCollapse(masses: readonly MassIn[], plot: { w: number; h: number }, from: { u: number; v: number }, seconds: number, seed = 1): Collapse {
  const chunks = fracture(masses), style = styleOf(masses);
  let top = 0, cu = 0, cv = 0;
  for (const c of chunks) { top = Math.max(top, c.c[2]); cu += c.c[0] / chunks.length; cv += c.c[1] / chunks.length; }
  // ── THE PLAN: what is let go when, before anything has lost its footing ─────────────────
  const K = Math.max(2, seconds);
  chunks.forEach((c, i) => {
    const r = hash(seed * 7.7 + i * 1.31), far = Math.hypot(c.c[0] - from.u, c.c[1] - from.v), out = Math.hypot(c.c[0] - cu, c.c[1] - cv);
    // GLAZING GOES FIRST, a storey at a time from the top: a frame stripped before it is brought down.
    // (Not the ground floor's: that is there till the building comes down, and goes with it.)
    if (c.skin === "glass" && c.part === "wall" && c.c[2] > 0.66) { c.due = K * (0.02 + 0.2 * (1 - c.c[2] / Math.max(0.01, top))) + r * 0.35; return; }
    if (style === "implode") {
      // THE LOWEST STOREY BLOWN, from its middle outward — and a third and two thirds of the way up, a beat after: it
      // comes down through itself.
      const lvl = Math.floor(c.c[2] / 0.63), floors = Math.max(1, Math.round(top / 0.63));
      const charge = lvl === 0 ? 0 : lvl === Math.floor(floors / 3) ? 0.35 : lvl === Math.floor((2 * floors) / 3) ? 0.6 : -1;
      if (charge >= 0) c.due = K * 0.3 + charge + out * 0.22 + r * 0.08;
    } else if (style === "shed") {
      // THE ROOF IN, from its middle; then the walls after it, folding inward.
      if (c.part === "plate") c.due = K * 0.08 + out * 0.5 + r * 0.25;
      else { c.due = K * 0.3 + far * 0.35 + r * 0.3; const d = Math.hypot(cu - c.c[0], cv - c.c[1]) || 1; c.kick = [((cu - c.c[0]) / d) * 0.35, ((cv - c.c[1]) / d) * 0.35, 0]; }
    } else {
      // (Pulled down in BITES: given their times below, all of a bite together.)
      c.due = -1;
    }
  });
  // PULLED DOWN IN BITES from the digger's side, the top of each part first: the bucket takes hold of a piece of the
  // building — everything within its reach — and tears it out toward the machine; then the next. What that leaves
  // standing on nothing comes down after it.
  {
    const todo = chunks.map((c, i) => ({ c, i, key: Math.hypot(c.c[0] - from.u, c.c[1] - from.v) * 0.5 - c.c[2] * 1.7 })).filter((x) => x.c.due === -1).sort((a, b) => a.key - b.key);
    const bites: { c: Chunk; i: number }[][] = [], taken = new Set<number>(), REACH = 0.4;
    for (const x of todo) {
      if (taken.has(x.i)) continue;
      const bite = todo.filter((y) => !taken.has(y.i) && Math.hypot(y.c.c[0] - x.c.c[0], y.c.c[1] - x.c.c[1], (y.c.c[2] - x.c.c[2]) * 0.8) < REACH);
      for (const y of bite) taken.add(y.i);
      bites.push(bite);
    }
    bites.forEach((bite, b) => {
      const when = K * (0.03 + 0.9 * (b / Math.max(1, bites.length))) ;
      for (const { c, i } of bite) {
        const r = hash(seed * 3.1 + i * 2.7), r2 = hash(seed * 5.9 + i * 1.3), d = Math.hypot(c.c[0] - from.u, c.c[1] - from.v) || 1;
        c.due = when + r * 0.14;
        c.kick = [((from.u - c.c[0]) / d) * (0.25 + 0.5 * r2) + (r - 0.5) * 0.5, ((from.v - c.c[1]) / d) * (0.25 + 0.5 * r2) + (r2 - 0.5) * 0.5, -0.15 + 0.5 * r];
      }
    });
  }
  // ── THE GROUND, and what lies on it: a height a cell ───────────────────────────────────
  const gw = Math.ceil((plot.w + 2 * MARGIN) / CELL), gh = Math.ceil((plot.h + 2 * MARGIN) / CELL), heap = new Float32Array(gw * gh);
  const cell = (u: number, v: number) => Math.max(0, Math.min(gw - 1, Math.floor((u + MARGIN) / CELL))) + gw * Math.max(0, Math.min(gh - 1, Math.floor((v + MARGIN) / CELL)));
  let cleared = 0;
  const opened: boolean[] = [];
  /**
   * A piece BROKEN IN TWO across its length, where it has landed at `hit`: each half flung a little, turning; each
   * keeps its half of what picture it carried — or, some of the time, loses it: what breaks shows its inside.
   * False for one too small, or broken twice already.
   */
  const breakUp = (c: Chunk, hit: number, ground: number, said: Happening[]): boolean => {
    const bm = (c.ma + 1) % 3, cm = (c.ma + 2) % 3, s = c.e[bm] >= c.e[cm] ? bm : cm, big = c.e[s];
    if (c.gen >= 2 || big < 0.07 || chunks.length >= 5200) return false;
    c.state = 3;
    said.push({ kind: "thud", at: [c.c[0], c.c[1], ground], size: big * 2, skin: c.skin });
    const ax = axisOf(c.q, s), P = c.shape, SG = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const sg of [-1, 1]) {
      // ITS HALF OF THE OUTLINE: its own two corners, and the middles of the two sides the break crosses.
      const sh = new Float32Array(8);
      for (let k = 0; k < 4; k++) {
        const ss = s === bm ? SG[k][0] : SG[k][1], other = s === bm ? (k ^ 1) : 3 - k;
        if (ss === sg) { sh[k * 2] = P[k * 2]; sh[k * 2 + 1] = P[k * 2 + 1]; }
        else { sh[k * 2] = (P[k * 2] + P[other * 2]) / 2; sh[k * 2 + 1] = (P[k * 2 + 1] + P[other * 2 + 1]) / 2; }
      }
      // (About its own middle along the break.)
      const o = s === bm ? 0 : 1, d = (sh[o] + sh[2 + o] + sh[4 + o] + sh[6 + o]) / 4;
      for (let k = 0; k < 4; k++) sh[k * 2 + o] -= d;
      const e: V3 = [c.e[0], c.e[1], c.e[2]]; e[s] /= 2;
      const cc: V3 = [c.c[0] + ax[0] * d, c.c[1] + ax[1] * d, c.c[2] + ax[2] * d + 0.01];
      const rr = hash(chunks.length * 2.3 + seed), rs = hash(chunks.length * 6.1 + seed);
      const tex = c.tex.map((f, face) => (hash(chunks.length * 3.9 + face * 1.7 + seed) < 0.7 ? halfOf(f, face, s, sg) : null));
      // (Flung out from the middle of the heap, and up a little: rubble spreads.)
      const ox = cc[0] - cu, oy = cc[1] - cv, ol = Math.hypot(ox, oy) || 1;
      chunks.push({
        ...c, c: cc, e, shape: sh, q: [c.q[0], c.q[1], c.q[2], c.q[3]], state: 1, gen: c.gen + 1, mass: c.mass / 2, tex, sup: [], dep: [], kick: undefined, tip: 0,
        v: [c.v[0] * 0.4 + (rr - 0.5) * 0.7 + (ox / ol) * 0.3 + ax[0] * sg * 0.2, c.v[1] * 0.4 + (rs - 0.5) * 0.7 + (oy / ol) * 0.3 + ax[1] * sg * 0.2, Math.max(0.2, hit * (0.18 + 0.25 * rr))],
        om: [(rr - 0.5) * 11, (rs - 0.5) * 11, (rr - rs) * 6],
      });
    }
    return true;
  };
  const C: Collapse = {
    chunks, style, opened, at: [cu, cv, top],
    standing: () => chunks.reduce((n, c) => n + (c.state === 0 ? 1 : 0), 0),
    falling: () => chunks.reduce((n, c) => n + (c.state === 1 ? 1 : 0), 0),
    finish(t) { chunks.forEach((c, i) => { if (c.state === 0 && c.due > t + 1.2) c.due = t + (1 - c.c[2] / Math.max(0.01, top)) * 0.8 + hash(i * 3.7) * 0.3; }); },
    clear(share) {
      const lying = chunks.filter((c) => c.state === 2), want = Math.floor(share * (lying.length + cleared));
      if (want <= cleared) return;
      lying.sort((a, b) => Math.hypot(a.c[0] - from.u, a.c[1] - from.v) - Math.hypot(b.c[0] - from.u, b.c[1] - from.v));
      for (const c of lying.slice(0, want - cleared)) { c.state = 3; cleared++; C.at = [c.c[0], c.c[1], c.c[2]]; }
    },
    step(dt, t) {
      const said: Happening[] = [];
      const n0 = chunks.length;
      for (let i = 0; i < n0; i++) {
        const c = chunks[i];
        if (c.state === 0) {
          if (c.due > t) continue;
          // LET GO. Glass does not fall: it is gone in a shower. What stood on it has a moment, and follows.
          for (const d of c.dep) {
            const o = chunks[d];
            if (o.state !== 0) continue;
            let left = 0;
            for (const s of o.sup) if (chunks[s].state === 0 && s !== i) left++;
            // (A tower blown at its foot DROPS AS ONE — nothing of it lags — and is broken at the ground. Anything else
            // follows what held it a moment after.)
            if (left * 2 < o.had) o.due = Math.min(o.due, style === "implode" ? t : t + 0.03 + hash(d * 5.3 + seed) * 0.08);
          }
          C.at = [c.c[0], c.c[1], c.c[2]];
          // WHAT STOOD BEHIND IT IS SEEN NOW: every piece still standing that it was in front of, from where the camera is.
          {
            const sx = c.c[0] - c.c[1], sy = c.c[0] + c.c[1] - RISE * c.c[2], dep = c.c[0] + c.c[1] + 0.816 * c.c[2];
            const rx = c.e[0] + c.e[1] + 0.12, ry = c.e[0] + c.e[1] + RISE * c.e[2] + 0.12;
            for (const o of chunks) {
              if (o.state !== 0 || o.seen) continue;
              if (Math.abs(o.c[0] - o.c[1] - sx) < rx + o.e[0] + o.e[1] && Math.abs(o.c[0] + o.c[1] - RISE * o.c[2] - sy) < ry + o.e[0] + o.e[1] + RISE * o.e[2] && o.c[0] + o.c[1] + 0.816 * o.c[2] < dep + 0.05) o.seen = true;
            }
            opened[c.m] = true;
          }
          if (c.skin === "glass" && c.part === "wall") { c.state = 3; said.push({ kind: "shatter", at: [c.c[0], c.c[1], c.c[2]], size: Math.max(c.e[0], c.e[1]) + c.e[2], skin: c.skin }); continue; }
          c.state = 1;
          const r = hash(i * 9.1 + seed), r2 = hash(i * 4.3 + seed * 2);
          if (c.kick) { c.v = [c.kick[0], c.kick[1], c.kick[2]]; c.om = [(r - 0.5) * 7, (r2 - 0.5) * 7, (r - r2) * 3]; said.push({ kind: "dust", at: [c.c[0], c.c[1], c.c[2]], size: 0.25, skin: c.skin }); }
          // (Dropping with what was over it and under it: square, till it meets the ground.)
          else if (style === "implode") c.om = [0, 0, 0];
          else { c.v = [(r - 0.5) * 0.3, (r2 - 0.5) * 0.3, -0.2]; c.om = [(r - 0.5) * 3.5, (r2 - 0.5) * 3.5, (r - r2) * 1.5]; }
          if (c.floor === 0 && style === "implode") said.push({ kind: "dust", at: [c.c[0], c.c[1], 0.05], size: 0.5, skin: c.skin });
          continue;
        }
        if (c.state !== 1) continue;
        c.v[2] -= GRAVITY * dt;
        c.c[0] += c.v[0] * dt; c.c[1] += c.v[1] * dt; c.c[2] += c.v[2] * dt;
        // (Turned by its spin: a small turn a step, the quaternion kept a unit.)
        const [ox, oy, oz] = c.om, [qx, qy, qz, qw] = c.q, h = dt / 2;
        let nx = qx + h * (ox * qw + oy * qz - oz * qy), ny = qy + h * (oy * qw + oz * qx - ox * qz), nz = qz + h * (oz * qw + ox * qy - oy * qx), nw = qw - h * (ox * qx + oy * qy + oz * qz);
        const nl = Math.hypot(nx, ny, nz, nw) || 1; nx /= nl; ny /= nl; nz /= nl; nw /= nl;
        c.q = [nx, ny, nz, nw];
        // KEPT ON ITS PLOT: what strays over the edge is turned back.
        for (const [a, lim] of [[0, plot.w], [1, plot.h]] as const) {
          if (c.c[a] < -0.12 && c.v[a] < 0) c.v[a] *= -0.3; else if (c.c[a] > lim + 0.12 && c.v[a] > 0) c.v[a] *= -0.3;
        }
        // HOW LOW IT REACHES, turned as it is: the third row of its turning, by its half sizes.
        const r20 = 2 * (nx * nz - ny * nw), r21 = 2 * (ny * nz + nx * nw), r22 = 1 - 2 * (nx * nx + ny * ny);
        const reach = Math.abs(r20) * c.e[0] + Math.abs(r21) * c.e[1] + Math.abs(r22) * c.e[2];
        const k = cell(c.c[0], c.c[1]), ground = heap[k];
        if (c.c[2] - reach > ground || c.v[2] > 0) continue;
        const hit = -c.v[2], big = Math.max(c.e[0], c.e[1], c.e[2]);
        // IT LANDS. Masonry that comes down hard BREAKS in two across its length — each half flung a little.
        if (hit > BREAKS[c.skin] && breakUp(c, hit, ground, said)) continue;
        c.c[2] = ground + reach;
        // STOOD ON AN EDGE, IT GOES OVER: a panel does not stand where it landed — it tips, faster as it goes, the way
        // it was moving, till it lies on its face.
        const thin = c.e[0] <= c.e[1] && c.e[0] <= c.e[2] ? 0 : c.e[1] <= c.e[2] ? 1 : 2, ta = axisOf(c.q, thin);
        // (How flat is flat is each piece's own: a heap is not laid.)
        if (Math.abs(ta[2]) < 0.8 + 0.17 * hash(i * 6.7 + seed) && c.e[thin] * 2.2 < Math.max(c.e[0], c.e[1], c.e[2])) {
          const hl = Math.hypot(ta[0], ta[1]) || 1;
          if (!c.tip) { const along = c.v[0] * ta[0] + c.v[1] * ta[1]; c.tip = (Math.abs(along) > 0.02 ? Math.sign(along) : hash(i * 2.9 + seed) > 0.5 ? 1 : -1) * 0.7; if (hit > 0.7) said.push({ kind: "thud", at: [c.c[0], c.c[1], ground], size: big * 2, skin: c.skin }); }
          // (Faster as it goes, no faster than a wall falls; and always the way that lays it down.)
          const way = Math.abs(ta[2]) > 0.05 ? -Math.sign(ta[2]) : Math.sign(c.tip);
          c.tip = way * Math.min(4.2, Math.abs(c.tip) + (4 + 8 * Math.abs(ta[2])) * dt);
          // (About the line it stands on: its face's own way, turned a quarter on the ground — and the one way round till it is down.)
          c.om = [(-ta[1] / hl) * c.tip, (ta[0] / hl) * c.tip, 0];
          c.v = [c.v[0] * 0.6, c.v[1] * 0.6, 0];
          continue;
        }
        // (Down on its face, it BREAKS as one that fell would: a wall does not lie whole.)
        if (c.tip) { c.tip = 0; said.push({ kind: "thud", at: [c.c[0], c.c[1], ground], size: big * 2, skin: c.skin }); if (Number.isFinite(BREAKS[c.skin]) && BREAKS[c.skin] > 0 && breakUp(c, 0.9, ground, said)) continue; }
        // (Lighter each bounce, slowed along the ground, its spin taken out of it: and soon it lies.)
        c.v[2] = hit > 0.5 ? hit * 0.16 : 0; c.v[0] *= 0.5; c.v[1] *= 0.5; c.om = [c.om[0] * 0.45, c.om[1] * 0.45, c.om[2] * 0.45];
        if (hit > 0.7) said.push({ kind: "thud", at: [c.c[0], c.c[1], ground], size: big * 2, skin: c.skin });
        if (hit <= 0.5 && Math.hypot(c.v[0], c.v[1]) < 0.35) {
          // IT LIES, and the heap is that much higher there — and a little higher round about.
          c.state = 2; c.v = [0, 0, 0]; c.om = [0, 0, 0];
          const up = Math.min(0.09, ((8 * c.e[0] * c.e[1] * c.e[2]) / (CELL * CELL)) * 0.55);
          heap[k] += up;
          for (const d of [-1, 1, -gw, gw]) if (k + d >= 0 && k + d < heap.length) heap[k + d] += up * 0.35;
        }
      }
      return said;
    },
  };
  return C;
}

/** One of a piece's own axes, turned as the piece is. */
export function axisOf(q: readonly number[], a: number): V3 {
  const [x, y, z, w] = q;
  return a === 0 ? [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)]
    : a === 1 ? [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)]
      : [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)];
}

/**
 * A face's picture for the half of a piece broken across axis `s` (the half on side `sg` of it). A face square to
 * the break is kept by the half it is on, and the new face of the break is bare; the others are halved with it.
 * A face's corners go (b−,c−), (b+,c−), (b+,c+), (b−,c+), b and c the two axes after its own.
 */
function halfOf(f: Float32Array | null, face: number, s: number, sg: number): Float32Array | null {
  if (!f) return null;
  const a = face >> 1;
  if (a === s) return (face & 1 ? -1 : 1) === sg ? f : null;
  const b = (a + 1) % 3, mid = (i: number, j: number) => [(f[i * 2] + f[j * 2]) / 2, (f[i * 2 + 1] + f[j * 2 + 1]) / 2];
  const q = (i: number) => [f[i * 2], f[i * 2 + 1]];
  const pts = s === b
    ? (sg < 0 ? [q(0), mid(0, 1), mid(3, 2), q(3)] : [mid(0, 1), q(1), q(2), mid(3, 2)])
    : (sg < 0 ? [q(0), q(1), mid(1, 2), mid(0, 3)] : [mid(0, 3), mid(1, 2), q(2), q(3)]);
  return new Float32Array(pts.flat());
}

/** A corner of a piece, from its middle along its own axes: the one on the sides `sx`, `sy`, `sz` (each ±1) of it. @see Chunk.shape */
export function cornerOf(c: Chunk, sx: number, sy: number, sz: number, out: number[]): number[] {
  const sg = [sx, sy, sz], bm = (c.ma + 1) % 3, cm = (c.ma + 2) % 3, k = sg[bm] < 0 ? (sg[cm] < 0 ? 0 : 3) : sg[cm] < 0 ? 1 : 2;
  out[c.ma] = sg[c.ma] * c.e[c.ma]; out[bm] = c.shape[k * 2]; out[cm] = c.shape[k * 2 + 1];
  return out;
}
