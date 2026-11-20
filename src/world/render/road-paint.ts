/**
 * World v2 — ROADS PAINTED IN CODE: the carriageway, its kerbs, the pavement
 * by the street's level, and every line a British road has on it.
 *
 * ONE TEXTURE A LOOK. A cell's texture is painted once for its {@link Look}
 * and its neighbours', cached by that key in atlas pages, and shared by every
 * cell that looks the same. Still one sprite a cell, in the paved tier.
 *
 * DRAWN IN THE TILE'S OWN TERMS. The canvas is set to the tile's projection
 * — (u, v) on the ground to the frame's pixels, tilted for a ramp — so a line
 * is a line in tiles, a kerb's curve a circle in tiles, and both come out
 * foreshortened as the ground is.
 *
 * NO SEAMS, BY CONSTRUCTION. A texture paints its own cell and, in a margin
 * past its edges, its neighbours, each from its own look by the same code. So
 * where two sprites overlap they hold the same pixels, and the sprite needs
 * no bleed: it is drawn at its true size. Every pattern repeats on the tile
 * (flags, dashes, grain), so it runs on from one tile into the next.
 *
 * TWO PASSES. On the ground first, every cell's: asphalt, wear, ironwork,
 * lines, and the kerb's face. Then raised, a kerb's height up: the pavement
 * and its kerb. Where the raised layer has moved off the ground one, on a
 * kerb facing the eye, the face shows.
 *
 * DETAIL BY ZOOM. A look is painted at one of {@link LOD_RES}'s resolutions,
 * each on pages of its own. The finer ones, for cells seen close up, add what
 * only shows there: the stone in the asphalt, tyre-polished lanes, the bevel
 * of each flag, brick and kerb. @see lodFor
 */
import { CanvasSource, Container, Rectangle, RenderTexture, Sprite, Texture, type Renderer } from "pixi.js";

import { HEIGHT_UNIT, rampDir, rampRise, RAMP } from "../iso";
import { hash } from "../structures/projects/model";
import { mix, tone } from "../structures/projects/pen";
import { KEEP, WORN, opposite, rightOf, STEP, type Look, type Side } from "../roads/looks";
import { CROSS_HOLD, LAYBY, MEDIAN_HALF, PARK_STRIP } from "../agents/lanes/graph";

/** How far in from the tile's edge the pavement runs, its kerb, and both. */
export const PAVE = 0.22, KERB = 0.04, WALK = PAVE + KERB;
/** How high a kerb stands, in frame pixels. */
const KERB_PX = 1.6;
/**
 * Texels a frame pixel, by level of detail: the map's own, then two closer.
 * A level is used once the screen shows a frame pixel bigger than its
 * resolution, so a texture is never magnified past about 1.2×.
 */
export const LOD_RES = [2, 3, 5] as const;
/**
 * An atlas page, texels square, by level of detail. SMALL, because a page
 * costs its texture whether it holds one tile or is full, and the closer
 * levels come and go by the page: at 4096², with a canvas of its own each, a
 * page was 150 MB, and a minute's zooming about left over a gigabyte of them.
 * A whole number of frame pixels each; the closest is three tiles across
 * exactly (3 × 140 frame pixels × 5).
 */
const PAGE_OF = [2048, 2040, 2100] as const;
/** Tiles painted side by side before they are copied to their pages, by level of detail. @see createRoadPainter */
const STRIP = [16, 8, 4] as const;
/**
 * Pages a level fills before a look no cell draws gives up its place
 * to a new one, and how long between destroying the pages of a level let go.
 * @see RoadPainter.keep
 */
const ROOM = 4;
const DOOM_EVERY_MS = 250;

/**
 * The level of detail for a screen showing `pxPerFrame` screen pixels to a
 * frame pixel. Up a level as soon as it is needed; down only well past the
 * line (`current`, the level now), so a zoom resting on it does not swap
 * textures back and forth.
 */
export function lodFor(pxPerFrame: number, current = -1): number {
  let l = 0;
  while (l < LOD_RES.length - 1 && pxPerFrame > LOD_RES[l] * 1.2) l++;
  if (current > l && pxPerFrame > LOD_RES[current - 1] * 1.2 * 0.8) return current;
  return l;
}

/** The level of detail being painted: set for the length of one texture's paint. */
let DETAIL = 0;
/** How far past its own edges a texture paints its neighbours, tiles: more than the AA of an edge. */
const MARGIN = 0.03;
/** Frame pixels of room round the diamond, and over it for a ramp rising up-screen — or a tile of road on the continuous surface, whose top corner can stand four half steps over its lowest. */
const PAD = 4, RAMP_PAD = 76;

const ASPHALT = 0x55575b, WHITE = 0xeeece4, YELLOW = 0xe6b437, IRON = 0x2f3236;
const TARMAC = 0x6b6c6f;
const JOINT = [TARMAC, 0xa9a69d, 0x7e7062, 0x8b8070];
const KERB_OF = [0xa8a7a1, 0xb9b8b0, 0xb3b2aa, 0xc9c8c0];

type Ctx = CanvasRenderingContext2D;
const css = (c: number, a = 1) => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;
const has = (open: number, s: number) => (open & (1 << s)) !== 0;

/**
 * A cell to paint into a texture: its look, where it is from the texture's
 * own cell, and its surface, `z0 + zu·u + zv·v` in height units up from the
 * texture's cell's base.
 */
export type CellPaint = {
  look: Look; dx: number; dy: number; z0: number; zu: number; zv: number;
  /**
   * ON THE CONTINUOUS SURFACE, where its corners are not in one plane: its height at (0,0), (1,0), (1,1), (0,1),
   * from the texture's cell's base. It is then painted as the two triangles the ground's mesh draws under it —
   * split from (0,0) to (1,1) — each on its own plane, so a tile meets its neighbours exactly along every edge.
   */
  zc?: readonly [number, number, number, number];
};

/** A cell's surface plane from its ramp, its base `z` up. */
export function planeOf(ramp: number, z: number): { z0: number; zu: number; zv: number } {
  const d = rampDir(ramp), r = d === RAMP.NONE ? 0 : rampRise(ramp);
  // A ramp's named edge is its high one. @see edgeHeight
  if (d === RAMP.N) return { z0: z + r, zu: -r, zv: 0 };
  if (d === RAMP.S) return { z0: z, zu: r, zv: 0 };
  if (d === RAMP.E) return { z0: z + r, zu: 0, zv: -r };
  if (d === RAMP.W) return { z0: z, zu: 0, zv: r };
  return { z0: z, zu: 0, zv: 0 };
}

// ─── THE SHAPE OF THE PAVEMENT ───────────────────────────────────────────────

/**
 * A run of pavement along a kerbed side, from `a0` to `a1` along it, its
 * kerb's road edge `w0` in from the tile's edge at `a0` and `w1` at `a1`:
 * `WALK`, but less beside a lay-by, and sloping where one tapers in.
 */
type Band = { s: Side; a0: number; a1: number; w0: number; w1: number };
/** How far in from the tile's edge a lay-by's kerb is; and how far along a tile it tapers in over. */
const LAY_W = WALK - LAYBY, TAPER = 0.45;
/** A band's kerb edge `a` along it. */
const wAt = (B: Band, a: number) => (B.a1 === B.a0 ? B.w0 : B.w0 + ((B.w1 - B.w0) * (a - B.a0)) / (B.a1 - B.a0));
/** A kerbed side's edge along it, as its parking has it: points `[a, w]` from one end to the other. */
function profileOf(L: Look, s: Side): [number, number][] {
  const m = L.bay.match(new RegExp(`([LT])${s}(\\d?)`));
  if (!m) return [[0, WALK], [1, WALK]];
  if (m[1] === "L") return [[0, LAY_W], [1, LAY_W]];
  const e = Number(m[2]), pts: [number, number][] = [[0, e & 1 ? LAY_W : WALK]];
  if (e & 1) pts.push([TAPER, WALK]);
  if (e & 2) pts.push([1 - TAPER, WALK]);
  pts.push([1, e & 2 ? LAY_W : WALK]);
  return pts;
}
/** A rounded corner where two kerbs meet: the carriageway's corner, radius `rc`. */
type Round = { c: number; rc: number };
/**
 * A corner CUT STRAIGHT ACROSS, where a wide road jogs a cell sideways: `big`,
 * the corner cell of the jog, its kerb a diagonal from one way on to the
 * other and all behind it pavement; else the small corner opposite, in place
 * of a round nub. Together the kerb runs straight through the jog.
 */
type Cut = { c: number; big: boolean };
type Shape = { bands: Band[]; rounds: Round[]; nubs: number[]; cuts: Cut[]; full: boolean };
/** A cut's kerb line at depth `o` as a band measures it — the road's edge at WALK — its two ends. As thick across as a band's. */
function cutEdge(K: Cut, o: number): [[number, number], [number, number]] {
  const { cu, cv, du, dv } = cornerOf(K.c), d = WALK + (o - WALK) * Math.SQRT2;
  return K.big ? [[cu + du, cv + dv * d], [cu + du * d, cv + dv]] : [[cu + du * d, cv], [cu, cv + dv * d]];
}
/** A cut's pavement: everything behind its kerb line. */
function cutShape(K: Cut): [number, number][] {
  const { cu, cv, du, dv } = cornerOf(K.c), [p, q] = cutEdge(K, WALK);
  return K.big ? [[cu, cv], [cu + du, cv], p, q, [cu, cv + dv]] : [[cu, cv], p, q];
}

/** A corner's two sides: the u one, the v one. */
const sidesOf = (c: number): [Side, Side] => [(c & 1 ? 1 : 0) as Side, (c & 2 ? 3 : 2) as Side];

/**
 * Where a cell's pavement is. Along each kerbed side a band; where two kerbs
 * meet, the carriageway's corner rounded, as wide as the road lets it — a
 * one-cell road's bend a quarter circle round its far corner, a dead end's
 * head a half circle; and where two roads meet with the corner between them
 * not road, a nub of kerb, round.
 */
function shapeOf(L: Look): Shape {
  const kerb = (s: Side) => !has(L.open, s);
  if (L.open === 0) return { bands: [], rounds: [], nubs: [], cuts: [], full: true };
  const rounds: Round[] = [], nubs: number[] = [], cuts: Cut[] = [];
  // WHERE A WIDE ROAD JOGS, its corners are cut straight: the kerb runs on through, not out and round.
  const jog = L.wx.endsWith("j");
  const cutSide = new Set<Side>();
  const rcOf: (number | null)[] = [null, null, null, null];
  for (let c = 0; c < 4; c++) {
    const [su, sv] = sidesOf(c);
    if (jog && kerb(su) && kerb(sv) && !kerb(opposite(su)) && !kerb(opposite(sv))) { cuts.push({ c, big: true }); cutSide.add(su); cutSide.add(sv); continue; }
    if (jog && !kerb(su) && !kerb(sv) && !(L.diag & (1 << c))) { cuts.push({ c, big: false }); continue; }
    if (kerb(su) && kerb(sv)) {
      // As far as the road runs from the corner either way: to the far kerb's half, or the far edge.
      const along = (s: Side) => (kerb(opposite(s)) ? (1 - 2 * WALK) / 2 : 1 - WALK);
      const rc = Math.min(along(su), along(sv));
      rounds.push({ c, rc });
      rcOf[c] = rc;
    } else if (!kerb(su) && !kerb(sv) && !(L.diag & (1 << c))) nubs.push(c);
  }
  const bands: Band[] = [];
  // Each band's ends are two corners: where one is rounded, the round takes over.
  const ends: Record<Side, [number, number]> = { 0: [0, 2], 1: [1, 3], 2: [0, 1], 3: [2, 3] };
  for (const s of [0, 1, 2, 3] as Side[]) {
    if (!kerb(s) || cutSide.has(s)) continue;
    const [c0, c1] = ends[s];
    const a0 = rcOf[c0] !== null ? WALK + rcOf[c0]! : 0;
    const a1 = rcOf[c1] !== null ? 1 - WALK - rcOf[c1]! : 1;
    // A band for each straight of its kerb's edge.
    const pts = profileOf(L, s);
    for (let k = 1; k < pts.length; k++) {
      const [p0, q0] = pts[k - 1], [p1, q1] = pts[k];
      const b0 = Math.max(a0, p0), b1 = Math.min(a1, p1);
      if (b1 <= b0) continue;
      const w = (a: number) => q0 + ((q1 - q0) * (a - p0)) / (p1 - p0);
      bands.push({ s, a0: b0, a1: b1, w0: w(b0), w1: w(b1) });
    }
  }
  return { bands, rounds, nubs, cuts, full: false };
}

/** A point `a` along a band and `d` in from its side. */
function bandPt(s: Side, a: number, d: number): [number, number] {
  return s === 0 ? [d, a] : s === 1 ? [1 - d, a] : s === 2 ? [a, d] : [a, 1 - d];
}
/** A corner's point, and the way into the tile from it. */
const cornerOf = (c: number) => ({ cu: c & 1 ? 1 : 0, cv: c & 2 ? 1 : 0, du: c & 1 ? -1 : 1, dv: c & 2 ? -1 : 1 });

/**
 * A round's point at angle `t` (0 at its u side's band, π/2 at its v side's)
 * and radius `r` from the centre of its curve.
 */
function roundPt(R: Round, t: number, r: number): [number, number] {
  const { cu, cv, du, dv } = cornerOf(R.c), k = WALK + R.rc;
  return [cu + du * (k - r * Math.cos(t)), cv + dv * (k - r * Math.sin(t))];
}
/** A nub's point at angle `t` and radius `r` from its corner. */
function nubPt(c: number, t: number, r: number): [number, number] {
  const { cu, cv, du, dv } = cornerOf(c);
  return [cu + du * r * Math.cos(t), cv + dv * r * Math.sin(t)];
}

/** A closed path through points. */
function poly(ctx: Ctx, pts: [number, number][]) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
  ctx.closePath();
}
/** An annular sector by a point function, `t` from t0 to t1, `r` from r0 to r1. */
function sector(ctx: Ctx, pt: (t: number, r: number) => [number, number], t0: number, t1: number, r0: number, r1: number) {
  const n = Math.max(2, Math.ceil(((t1 - t0) * Math.max(r0, r1)) / 0.02));
  const pts: [number, number][] = [];
  for (let k = 0; k <= n; k++) pts.push(pt(t0 + ((t1 - t0) * k) / n, r0));
  for (let k = n; k >= 0; k--) pts.push(pt(t0 + ((t1 - t0) * k) / n, r1));
  poly(ctx, pts);
}
/** A rectangle in a band's terms. */
function bandRect(ctx: Ctx, s: Side, a0: number, a1: number, d0: number, d1: number) {
  poly(ctx, [bandPt(s, a0, d0), bandPt(s, a1, d0), bandPt(s, a1, d1), bandPt(s, a0, d1)]);
}
/** A band's strip from `a0` to `a1`, between depths as at a plain kerb (its road edge at `WALK`), moved in or out with its own. */
function bandQuad(ctx: Ctx, B: Band, a0: number, a1: number, d0: number, d1: number) {
  const k0 = wAt(B, a0) - WALK, k1 = wAt(B, a1) - WALK;
  poly(ctx, [bandPt(B.s, a0, d0 + k0), bandPt(B.s, a1, d0 + k1), bandPt(B.s, a1, d1 + k1), bandPt(B.s, a0, d1 + k0)]);
}

/**
 * Fill a strip along the whole line of the kerb, between depths `o0` and
 * `o1` as a band measures them, in from the tile's edge: the kerb is PAVE to
 * WALK, the road begins at WALK. Bands at that depth, rounds and nubs at the
 * radius that is.
 */
function alongKerb(ctx: Ctx, S: Shape, o0: number, o1: number, colour: string | CanvasPattern) {
  ctx.fillStyle = colour;
  for (const B of S.bands) { bandQuad(ctx, B, B.a0, B.a1, o0, o1); ctx.fill(); }
  for (const R of S.rounds) {
    // A depth `d` from the houses' side is radius `WALK + rc − d` from the curve's centre.
    sector(ctx, (t, r) => roundPt(R, t, r), 0, Math.PI / 2, WALK + R.rc - o0, WALK + R.rc - o1);
    ctx.fill();
  }
  for (const c of S.nubs) { sector(ctx, (t, r) => nubPt(c, t, r), 0, Math.PI / 2, o0, o1); ctx.fill(); }
  for (const K of S.cuts) { const [a0, a1] = cutEdge(K, o0), [b0, b1] = cutEdge(K, o1); poly(ctx, [a0, a1, b1, b0]); ctx.fill(); }
}

/** The pavement's outline, kerb and all: what stands up off the road. */
function footprint(ctx: Ctx, S: Shape) {
  ctx.beginPath();
  if (S.full) { ctx.rect(0, 0, 1, 1); return; }
  const add = (pts: [number, number][]) => { ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]); ctx.closePath(); };
  for (const B of S.bands) add([bandPt(B.s, B.a0, 0), bandPt(B.s, B.a1, 0), bandPt(B.s, B.a1, B.w1), bandPt(B.s, B.a0, B.w0)]);
  for (const R of S.rounds) {
    const { cu, cv, du, dv } = cornerOf(R.c), k = WALK + R.rc;
    const pts: [number, number][] = [[cu, cv], [cu + du * k, cv]];
    // Round the curve's near side, from the v band's end to the u band's.
    const n = Math.max(4, Math.ceil((Math.PI / 2) * R.rc / 0.02));
    for (let j = 0; j <= n; j++) pts.push(roundPt(R, Math.PI / 2 - (Math.PI / 2) * (j / n), R.rc));
    pts.push([cu, cv + dv * k]);
    add(pts);
  }
  for (const c of S.nubs) {
    const { cu, cv } = cornerOf(c);
    const pts: [number, number][] = [[cu, cv]];
    const n = 12;
    for (let j = 0; j <= n; j++) pts.push(nubPt(c, (Math.PI / 2) * (j / n), WALK));
    add(pts);
  }
  for (const K of S.cuts) add(cutShape(K));
}

// ─── PAVING, BY THE STREET'S LEVEL ──────────────────────────────────────────

/** A piece of paving: `a` along its kerb, `d` in from its side. */
type Piece = { a0: number; a1: number; d0: number; d1: number; c: number };

/**
 * A level's paving between depths `from` and `to` (negative: farther from
 * the road than a band's own edge, where a corner's paving runs on). Every
 * pattern repeats on the tile, its joints at the tile's edges.
 */
function piecesOf(level: number, vr: number, seed: number, from: number, to: number): Piece[] {
  const out: Piece[] = [];
  const h = (k: number) => hash(seed * 13.1 + (vr & 3) * 71.7 + k * 7.31);
  const rows = (depth: number, along: number, make: (r: number, i: number, d0: number, d1: number, n: number) => void) => {
    const r0 = Math.floor(from / depth), r1 = Math.ceil(to / depth);
    for (let r = r0; r < r1; r++) {
      const d0 = Math.max(from, r * depth), d1 = Math.min(to, (r + 1) * depth);
      if (d1 > d0) for (let i = 0; i < along; i++) make(r, i, d0, d1, along);
    }
  };
  if (level === 1) {
    // CONCRETE FLAGS, square, two to the pavement's depth, each a shade of its own.
    const J = 0.006;
    rows(PAVE / 2, 8, (r, i, d0, d1, n) => out.push({ a0: i / n + J / 2, a1: (i + 1) / n - J / 2, d0: d0 + J / 2, d1: d1 - J / 2, c: tone(0xcfccc3, 0.93 + h(r * 31 + i) * 0.1) }));
  } else if (level === 2) {
    // CLAY BLOCK PAVING in stretcher bond, a soldier course along the kerb.
    const J = 0.005, course = 0.036, n = 14;
    const REDS = [0xa85a42, 0xb4634a, 0x9a5038, 0xbd7055, 0x8f4b37];
    const top = Math.min(to, PAVE - 0.04);
    for (let r = Math.floor(from / course); r < Math.ceil(top / course); r++) {
      const d0 = Math.max(from, r * course), d1 = Math.min(top, (r + 1) * course);
      if (d1 <= d0) continue;
      const off = r & 1 ? 0.5 / n : 0;
      for (let i = -1; i <= n; i++) {
        const a0 = i / n + off, a1 = (i + 1) / n + off;
        if (a1 <= 0 || a0 >= 1) continue;
        out.push({ a0: Math.max(0, a0) + J / 2, a1: Math.min(1, a1) - J / 2, d0: d0 + J / 2, d1: d1 - J / 2, c: REDS[Math.floor(h(r * 41 + i) * REDS.length)] });
      }
    }
    if (to > PAVE - 0.04) {
      const m = n * 2;
      for (let i = 0; i < m; i++) out.push({ a0: i / m + J / 2, a1: (i + 1) / m - J / 2, d0: PAVE - 0.04 + J / 2, d1: PAVE - J / 2, c: tone(0x8f4a36, 0.9 + h(500 + i) * 0.16) });
    }
  } else if (level === 3) {
    // YORK STONE: big flags of lengths of their own, in the buffs and greys of
    // the stone; a band of granite setts along the kerb.
    const STONES = [0xd6bf92, 0xc7ad84, 0xdfcca2, 0xbca98e, 0xcdb48a, 0xb9ab95];
    const J = 0.007, S0 = PAVE - 0.055;
    const flagsTo = Math.min(to, S0);
    for (let r = Math.floor(from / 0.08); r < Math.ceil(flagsTo / 0.08); r++) {
      const d0 = Math.max(from, r * 0.08), d1 = Math.min(flagsTo, (r + 1) * 0.08);
      if (d1 <= d0) continue;
      const n = 3 + (Math.abs(r) % 2);
      const cut = [0];
      for (let i = 1; i < n; i++) cut.push(i / n + (h(r * 17 + i) - 0.5) * (0.5 / n));
      cut.push(1);
      for (let i = 0; i < n; i++) out.push({ a0: cut[i] + J / 2, a1: cut[i + 1] - J / 2, d0: d0 + J / 2, d1: d1 - J / 2, c: tone(STONES[Math.floor(h(r * 17 + i + 50) * STONES.length)], 0.95 + h(r * 17 + i + 80) * 0.1) });
    }
    if (to > S0) {
      const m = 30;
      for (let r = 0; r < 2; r++) for (let i = 0; i <= m; i++) {
        const off = r ? 0.5 / m : 0, a0 = i / m - off, a1 = (i + 1) / m - off;
        if (a1 <= 0 || a0 >= 1) continue;
        const d0 = S0 + r * 0.0275;
        out.push({ a0: Math.max(0, a0) + 0.003, a1: Math.min(1, a1) - 0.003, d0: d0 + 0.003, d1: d0 + 0.0275 - 0.003, c: tone(0x7a7d80, 0.85 + h(300 + r * 40 + i) * 0.3) });
      }
    }
  }
  return out;
}

// ─── ON THE GROUND ───────────────────────────────────────────────────────────

const grains: HTMLCanvasElement[] = [];
/**
 * Asphalt's grain: speckle, light and dark, a quarter tile square and
 * repeating — the same speckle at every level, drawn at its resolution. Closer
 * up, the stone of the aggregate too: chips of grey, buff and near-black.
 */
function grainCanvas(): HTMLCanvasElement {
  const lod = DETAIL;
  if (grains[lod]) return grains[lod];
  const k0 = LOD_RES[lod] / 2, N = Math.round(96 * k0);
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d")!;
  for (let k = 0; k < 900; k++) {
    const x = hash(k * 1.3) * N, y = hash(k * 2.7 + 9) * N, s = (0.6 + hash(k * 3.1) * 1.2) * k0;
    g.fillStyle = hash(k * 5.9) < 0.5 ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.09)";
    g.fillRect(x, y, s, s);
  }
  if (lod > 0) {
    const STONE = [0x8d8b86, 0x9f9788, 0x6f6e6b, 0x2c2c2e, 0xb3ada0];
    for (let k = 0; k < 2600 * lod; k++) {
      const x = hash(k * 4.1 + 3) * N, y = hash(k * 6.3 + 1) * N, r = (0.35 + hash(k * 2.2 + 7) * 0.55) * k0 * 0.7;
      g.fillStyle = css(STONE[Math.floor(hash(k * 8.7) * STONE.length)], 0.16 + hash(k * 9.1) * 0.18);
      g.beginPath(); g.ellipse(x, y, r, r * (0.6 + hash(k * 1.9) * 0.4), hash(k * 3.3) * Math.PI, 0, Math.PI * 2); g.fill();
    }
  }
  grains[lod] = c;
  return c;
}
/** The grain as a fill, in tile units. */
function grainFill(ctx: Ctx): CanvasPattern | null {
  const c = grainCanvas(), pat = ctx.createPattern(c, "repeat");
  pat?.setTransform(new DOMMatrix().scale(0.25 / c.width));
  return pat;
}

/** A marking's frame: at the edge toward side `s`, `e` back from it and `c` right of the middle. */
function laneFrame(s: Side) {
  const [hx, hy] = STEP[s], [rx, ry] = rightOf(hx, hy);
  const mu = 0.5 + 0.5 * hx, mv = 0.5 + 0.5 * hy;
  const pt = (e: number, c: number): [number, number] => [mu - e * hx + c * rx, mv - e * hy + c * ry];
  return { pt, hx, hy, rx, ry };
}
function laneRect(ctx: Ctx, s: Side, e0: number, e1: number, c0: number, c1: number) {
  const F = laneFrame(s);
  poly(ctx, [F.pt(e0, c0), F.pt(e1, c0), F.pt(e1, c1), F.pt(e0, c1)]);
}

/** Dashes from a0 to a1 along, each `dash` long with `gap` between, starting with a dash. */
function dashes(a0: number, a1: number, dash: number, gap: number): [number, number][] {
  const out: [number, number][] = [];
  for (let a = a0; a < a1 - 1e-6; a += dash + gap) out.push([a, Math.min(a1, a + dash)]);
  return out;
}

/** The centre line's dashes on a tile: one in the middle; a warning line's two long ones. */
const CENTRE: [number, number][] = [[0.34, 0.66]];
const WARNING: [number, number][] = [[0.04, 0.42], [0.58, 0.96]];

const LINE = 0.007;

function centreLine(ctx: Ctx, L: Look) {
  const w = LINE;
  ctx.fillStyle = css(WHITE, 0.92);
  const c = L.ctr;
  if (c === "u" || c === "U" || c === "v" || c === "V") {
    for (const [a0, a1] of c === c.toUpperCase() ? WARNING : CENTRE) {
      poly(ctx, c.toLowerCase() === "u" ? [[a0, 0.5 - w], [a1, 0.5 - w], [a1, 0.5 + w], [a0, 0.5 + w]] : [[0.5 - w, a0], [0.5 + w, a0], [0.5 + w, a1], [0.5 - w, a1]]);
      ctx.fill();
    }
  } else if (c === "b") {
    // Round a bend: on the arc half way across, round the corner its two ways out meet at.
    for (let k = 0; k < 4; k++) {
      const [su, sv] = sidesOf(k);
      if (!has(L.open, su) || !has(L.open, sv)) continue;
      for (const [a0, a1] of WARNING) { sector(ctx, (t, r) => nubPt(k, t, r), a0 * Math.PI / 2, a1 * Math.PI / 2, 0.5 - w, 0.5 + w); ctx.fill(); }
    }
  } else if (c[0] === "h" || c[0] === "H") {
    // Half a two-lane road's line, along its side away from the kerb; the lane across lays the other half.
    const s = Number(c[1]) as Side;
    for (const [a0, a1] of c[0] === "H" ? WARNING : CENTRE) { bandRect(ctx, s, a0, a1, 0, w); ctx.fill(); }
  }
}

/** A point of a road running along `ax`: `a` along it, `q` across. */
const runPt = (ax: "u" | "v", a: number, q: number): [number, number] => (ax === "u" ? [a, q] : [q, a]);
/** A rectangle of a road running along `ax`: from `a0` to `a1` along it, `q0` to `q1` across. */
function runRect(ctx: Ctx, ax: "u" | "v", a0: number, a1: number, q0: number, q1: number) {
  poly(ctx, ax === "u" ? [[a0, q0], [a1, q0], [a1, q1], [a0, q1]] : [[q0, a0], [q1, a0], [q1, a1], [q0, a1]]);
}

/** A central reservation's run: its middle line's points, and which of its ends are rounded (1 the first, 2 the last). */
type Median = { caps: number; pts: number[][] };
/** The cell's central reservations, as its markings lay them. @see paintMarks */
const mediansOf = (L: Look): Median[] =>
  L.mk ? L.mk.split(";").filter((it) => it[0] === "M").map((it) => {
    const cut = it.indexOf(":");
    return { caps: Number(it.slice(1, cut)), pts: it.slice(cut + 1).split(" ").map((q) => q.split(",").map(Number)) };
  }) : [];
/** A strip `w` either side of a reservation's middle, its ends rounded where its run ends, `(du, dv)` aside. */
function medianStrip(ctx: Ctx, M: Median, w: number, colour: string, du = 0, dv = 0) {
  const { pts, caps } = M;
  ctx.save(); ctx.translate(du, dv);
  ctx.strokeStyle = colour; ctx.lineWidth = 2 * w; ctx.lineJoin = "round"; ctx.lineCap = "butt";
  ctx.beginPath(); pts.forEach(([u, v], k) => (k ? ctx.lineTo(u, v) : ctx.moveTo(u, v))); ctx.stroke();
  ctx.fillStyle = colour;
  if (caps & 1) { ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], w, 0, Math.PI * 2); ctx.fill(); }
  if (caps & 2) { const e = pts[pts.length - 1]; ctx.beginPath(); ctx.arc(e[0], e[1], w, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

/**
 * A WIDE ROAD'S MARKINGS, as its lanes have them: the shapes `roads/marks` worked out for this cell, painted. On the
 * road (`raised` false): its lines, studs, arrows, the lines its lanes wait at, the hatching where its middle ends,
 * its roundels, and the foot and shade of its central reservation. A kerb's height up: the reservation itself, and
 * the barrier along it. Nothing here decides anything. @see roads/marks
 */
function paintMarks(ctx: Ctx, L: Look, raised: boolean) {
  if (!L.mk) return;
  const STUD = [WHITE, 0xd8432f, 0xf2a31c, 0x44c065];
  const path = (pts: number[][], close = false) => { ctx.beginPath(); pts.forEach(([u, v], k) => (k ? ctx.lineTo(u, v) : ctx.moveTo(u, v))); if (close) ctx.closePath(); };
  for (const item of L.mk.split(";")) {
    const cut = item.indexOf(":"), kind = item[0], arg = item.slice(1, cut);
    const pts = item.slice(cut + 1).split(" ").map((q) => q.split(",").map(Number));
    if (kind === "M") {
      // THE CENTRAL RESERVATION: a concrete strip a kerb's height up, lit along one edge, a steel barrier down it.
      const caps = Number(arg), kc = KERB_OF[L.lvl];
      const strip = (w: number, colour: string, du = 0, dv = 0) => medianStrip(ctx, { caps, pts }, w, colour, du, dv);
      if (!raised) { strip(MEDIAN_HALF + 0.014, css(0x000000, 0.16), 0.008, 0.008); strip(MEDIAN_HALF, css(tone(kc, 0.55))); continue; }
      strip(MEDIAN_HALF, css(kc));
      strip(MEDIAN_HALF - 0.016, css(tone(kc, 0.86)));
      strip(0.016, css(0x8d959d));
      strip(0.004, css(0xc9d0d6), 0.008, 0.004);
      strip(0.004, css(0xc9d0d6), -0.008, -0.004);
      continue;
    }
    if (raised) continue;
    if (kind === "K") {
      // WHERE THE TYRES RUN, close up: a darker, polished track.
      if (DETAIL <= 0) continue;
      ctx.strokeStyle = css(0x1f2023, 0.09); ctx.lineWidth = 0.036; ctx.lineJoin = "round"; ctx.lineCap = "butt";
      path(pts); ctx.stroke();
    } else if (kind === "L") {
      const [c, w] = arg.split(",").map(Number);
      ctx.strokeStyle = css(STUD[c], 0.92); ctx.lineWidth = 2 * w; ctx.lineJoin = "miter"; ctx.lineCap = "butt";
      path(pts); ctx.stroke();
    } else if (kind === "P") {
      ctx.fillStyle = css(STUD[Number(arg)], 0.93);
      path(pts, true); ctx.fill();
    } else if (kind === "O") {
      ctx.strokeStyle = css(WHITE, 0.9); ctx.lineWidth = Number(arg); ctx.lineJoin = "miter";
      path(pts, true); ctx.stroke();
    } else if (kind === "D") {
      if (DETAIL <= 0) continue;
      ctx.fillStyle = css(STUD[Number(arg)], 0.95);
      ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], Number(arg) ? 0.008 : 0.009, 0, Math.PI * 2); ctx.fill();
    } else if (kind === "H") {
      // HATCHED: a taper from the nose of the road's middle to a point, barred across, a line down each side of it.
      const h = Number(arg), [a, b] = pts, d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / d, uy = (b[1] - a[1]) / d;
      const at = (t: number, c: number): [number, number] => [a[0] + ux * t - uy * c, a[1] + uy * t + ux * c];
      ctx.fillStyle = css(WHITE, 0.92);
      ctx.save();
      poly(ctx, [at(0, -h), at(0, h), at(d, 0)]);
      ctx.clip();
      for (let t = -0.1; t < d + 0.1; t += 0.055) { poly(ctx, [at(t, -h), at(t + 0.022, -h), at(t + 0.022 + h, h), at(t + h, h)]); ctx.fill(); }
      ctx.restore();
      for (const sg of [-1, 1]) { poly(ctx, [at(0, sg * h), at(0, sg * (h - 0.014)), at(d, -sg * 0.007), at(d, sg * 0.007)]); ctx.fill(); }
    } else if (kind === "R") {
      roundelAt(ctx, arg, pts[0][0], pts[0][1], pts[1][0], pts[1][1]);
    }
  }
}

/** The lane coming in toward side `s`, across: a one-cell road's right half, or a whole lane of a wider one. */
const inbound = (wide: boolean): [number, number] => (wide ? [-0.5, 0.5 - WALK] : [0, 0.5 - WALK]);

/** GIVE WAY: two broken lines across the lane coming in, and the triangle behind them — set back behind a crossing, the lines alone. */
function giveWay(ctx: Ctx, s: Side, wide: boolean, back = false) {
  const [c0, c1] = inbound(wide);
  ctx.fillStyle = css(WHITE, 0.92);
  const e0 = back ? SET_BACK - 0.03 : 0;
  for (const e of [0.035, 0.085]) for (const [a, b] of dashes(c0 + 0.01, c1 - 0.005, 0.045, 0.03)) { laneRect(ctx, s, e0 + e, e0 + e + 0.022, a, b); ctx.fill(); }
  if (back) return;
  // The triangle, long, its base toward the line: an outline.
  const F = laneFrame(s), cm = (c0 + c1) / 2, half = Math.min(0.06, (c1 - c0) / 2 - 0.03);
  ctx.strokeStyle = css(WHITE, 0.9);
  ctx.lineWidth = 0.016;
  ctx.lineJoin = "miter";
  poly(ctx, [F.pt(0.22, cm - half), F.pt(0.22, cm + half), F.pt(0.66, cm)]);
  ctx.stroke();
}

/** Where a line set back behind a junction's crossing is, from the junction's edge: just ahead of where cars wait. @see agents/lanes/graph CROSS_HOLD */
const SET_BACK = 0.5 + CROSS_HOLD - 0.045;

/** STOP: a solid line across the lane coming in — set back behind the crossing where there is one. */
function stopLine(ctx: Ctx, s: Side, wide: boolean, back = false) {
  const [c0, c1] = inbound(wide);
  const e = back ? SET_BACK : 0.04;
  ctx.fillStyle = css(WHITE, 0.94);
  laneRect(ctx, s, e, e + 0.045, c0 + 0.01, c1 - 0.005);
  ctx.fill();
}

/** An ARROW in the lane, its head toward `s`: ahead, and a turn off it left or right; filled, broad-headed. */
function arrow(ctx: Ctx, spec: string) {
  const s = Number(spec[0]) as Side, F = laneFrame(s);
  const [c0, c1] = inbound(true), cm = (c0 + c1) / 2;
  ctx.fillStyle = css(WHITE, 0.92);
  const ahead = spec.includes("A");
  // The shaft, from its tail up to its head, or to where a turn leaves it.
  const top = ahead ? 0.29 : 0.5;
  poly(ctx, [F.pt(0.88, cm - 0.02), F.pt(top, cm - 0.02), F.pt(top, cm + 0.02), F.pt(0.88, cm + 0.02)]);
  ctx.fill();
  if (ahead) { poly(ctx, [F.pt(0.13, cm), F.pt(0.3, cm - 0.07), F.pt(0.3, cm + 0.07)]); ctx.fill(); }
  for (const [k, sg] of [["L", -1], ["R", 1]] as const) {
    if (!spec.includes(k)) continue;
    // Off the shaft at a slant, its head on the end.
    const e0 = 0.56, e1 = 0.4, c1t = cm + sg * 0.085;
    const [x0, y0] = F.pt(e0, cm), [x1, y1] = F.pt(e1, c1t);
    const len = Math.hypot(x1 - x0, y1 - y0), dx = (x1 - x0) / len, dy = (y1 - y0) / len, px = -dy, py = dx;
    const w = 0.019;
    poly(ctx, [[x0 + px * w, y0 + py * w], [x1 + px * w, y1 + py * w], [x1 - px * w, y1 - py * w], [x0 - px * w, y0 - py * w]]);
    ctx.fill();
    poly(ctx, [[x1 + dx * 0.11, y1 + dy * 0.11], [x1 + px * 0.06, y1 + py * 0.06], [x1 - px * 0.06, y1 - py * 0.06]]);
    ctx.fill();
  }
}

/** SLOW, in the lane coming in toward `s`, elongated as road lettering is, read from behind it. */
function slow(ctx: Ctx, s: Side) {
  const F = laneFrame(s), [c0, c1] = inbound(false);
  const [ox, oy] = F.pt(0.48, (c0 + c1) / 2);
  ctx.save();
  // Its right is the driver's right, its up toward where they are going.
  ctx.font = "900 10px Arial, Helvetica, sans-serif";
  const w = ctx.measureText("SLOW").width;
  // Across the lane, and long down it as road lettering is, if not as long as the real thing: it has to read from above.
  const sx = 0.2 / w, sy = 0.2 / 7.2;
  // (Its letters run to the reader's right, whichever side of the road they drive on: a turn of the way they
  // go, never a side — a side flips with the hand of the road, and lettering laid by it reads back to front.)
  ctx.transform(-F.hy * sx, F.hx * sx, -F.hx * sy, -F.hy * sy, ox, oy);
  ctx.fillStyle = css(WHITE, 0.9);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("SLOW", 0, 0);
  ctx.restore();
}

/** A YELLOW BOX: criss-crossed, and bordered where it ends. */
function yellowBox(ctx: Ctx, L: Look) {
  ctx.strokeStyle = css(YELLOW, 0.9);
  ctx.lineWidth = 0.014;
  ctx.beginPath();
  for (let k = -4; k <= 4; k++) {
    ctx.moveTo(k / 4 - 0.1, -0.1); ctx.lineTo(k / 4 + 1.1, 1.1);
    ctx.moveTo(k / 4 - 0.1, 1.1); ctx.lineTo(k / 4 + 1.1, -0.1);
  }
  ctx.stroke();
  ctx.fillStyle = css(YELLOW, 0.92);
  for (const s of [0, 1, 2, 3] as Side[]) if (L.box & (2 << s)) { bandRect(ctx, s, 0, 1, 0.012, 0.034); ctx.fill(); }
}

/** The road's axis' two kerbed sides: across a road along `ax`. */
const acrossOf = (ax: string): [Side, Side] => (ax === "u" ? [2, 3] : [0, 1]);

/** ZIGZAGS along the kerbs and down the middle, before a zebra: no stopping. */
function zigzags(ctx: Ctx, L: Look) {
  ctx.strokeStyle = css(WHITE, 0.92);
  ctx.lineWidth = 0.012;
  ctx.lineJoin = "miter";
  const line = (pt: (a: number, d: number) => [number, number], d: number) => {
    ctx.beginPath();
    for (let k = 0; k <= 12; k++) { const p = pt(k / 12, d + (k % 2 ? 0.02 : -0.02)); if (k) ctx.lineTo(...p); else ctx.moveTo(...p); }
    ctx.stroke();
  };
  for (const s of acrossOf(L.zz)) if (!has(L.open, s)) line((a, d) => bandPt(s, a, d), WALK + 0.045);
  // Down the middle on a one-cell road.
  const [s0, s1] = acrossOf(L.zz);
  if (!has(L.open, s0) && !has(L.open, s1)) line((a, d) => bandPt(s0, a, d), 0.5);
}

/** A ZEBRA: broad white bars across the road, a broken give-way line either side. */
function zebra(ctx: Ctx, L: Look) {
  const [s0, s1] = acrossOf(L.zeb);
  const lo = has(L.open, s0) ? 0 : WALK + 0.01, hi = has(L.open, s1) ? 1 : 1 - WALK - 0.01;
  ctx.fillStyle = css(WHITE, 0.94);
  // Bars every twelfth of a tile across, so they run on across a two-lane road.
  for (let k = 0; k < 12; k++) {
    const b0 = k / 12 + 0.015, b1 = b0 + 0.05;
    if (b0 < lo || b1 > hi) continue;
    bandRect(ctx, s0, 0.3, 0.7, b0, b1);
    ctx.fill();
  }
  for (const a of [0.2, 0.78]) for (const [b0, b1] of dashes(lo, hi, 0.04, 0.03)) { bandRect(ctx, s0, a, a + 0.02, b0, b1); ctx.fill(); }
}

/** A CROSSING AT LIGHTS: two broken lines over the road, either side of where walkers cross. */
function signalCrossing(ctx: Ctx, L: Look) {
  const [s0, s1] = acrossOf(L.xing);
  const lo = has(L.open, s0) ? 0 : WALK + 0.01, hi = has(L.open, s1) ? 1 : 1 - WALK - 0.01;
  ctx.fillStyle = css(WHITE, 0.9);
  for (const a of [0.33, 0.65]) for (const [b0, b1] of dashes(lo, hi, 0.035, 0.03)) { bandRect(ctx, s0, a, a + 0.02, b0, b1); ctx.fill(); }
}

/**
 * WEAR that follows the road's own run: a trench dug across it and made good,
 * tar poured along its seams, a long strip relaid in one lane. On a straight
 * run only: across a junction they would belong to no road.
 */
function wear(ctx: Ctx, L: Look, v: number) {
  const c = L.ctr.toLowerCase();
  const ax: "u" | "v" | "" = L.wx ? (L.wx[0] as "u" | "v") : c === "u" || c === "v" ? c : "";
  if (!ax) return;
  // Across the road, the carriageway between its kerbs: the whole cell in the middle of a wide one.
  const side = (s: number) => (has(L.open, s) ? 0 : WALK + 0.01);
  const [q0, q1] = ax === "u" ? [side(2), 1 - side(3)] : [side(0), 1 - side(1)];
  if (v === 4) {
    // A TRENCH across, relaid darker, its edges sealed and one of them sunk a little.
    const a0 = 0.3 + hash(L.vr * 3.1 + L.open) * 0.3;
    ctx.fillStyle = css(0x47494d, 0.9);
    runRect(ctx, ax, a0, a0 + 0.075, q0, q1); ctx.fill();
    ctx.fillStyle = css(0x1c1d20, 0.5);
    for (const a of [a0, a0 + 0.075]) { runRect(ctx, ax, a - 0.004, a + 0.004, q0, q1); ctx.fill(); }
    ctx.fillStyle = css(0xffffff, 0.05);
    runRect(ctx, ax, a0 + 0.008, a0 + 0.02, q0, q1); ctx.fill();
  } else if (v === 5) {
    // TAR along the seams: two wandering lines of sealant down the lane.
    ctx.strokeStyle = css(0x17181a, 0.55);
    ctx.lineWidth = 0.007;
    ctx.lineJoin = "round";
    for (const t of [0.3, 0.68]) {
      const q = q0 + (q1 - q0) * t;
      ctx.beginPath();
      for (let k = 0; k <= 8; k++) { const [x, y] = runPt(ax, -0.05 + k * 0.1375, q + (hash(k * 5.3 + t * 9) - 0.5) * 0.02); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.stroke();
    }
  } else {
    // A STRIP RELAID down one lane, newer and darker, a seam along each side.
    const lo = q0 + (q1 - q0) * 0.14, hi = q0 + (q1 - q0) * 0.4;
    ctx.fillStyle = css(0x4a4c50, 0.45);
    runRect(ctx, ax, 0.12, 0.9, lo, hi); ctx.fill();
    ctx.strokeStyle = css(0x1e1f22, 0.28); ctx.lineWidth = 0.005; ctx.stroke();
  }
}

/** A road's wear and fittings: a gully, a manhole, a patch, cracks and a stain; or wear along its run. @see wear */
function fittings(ctx: Ctx, L: Look, S: Shape) {
  if (L.open === 0 || L.box || L.zeb || L.xing || L.rb) return;
  const v = L.vr;
  if (v >= WORN) return; // most of a road is just road
  if (v >= 4) { wear(ctx, L, v); return; }
  const gutter = S.bands.length ? S.bands.find((B) => B.s === S.bands[0].s && B.a0 <= 0.42 && B.a1 >= 0.56) : undefined;
  if (v === 0 && S.bands.length) {
    // A GULLY in the gutter: an iron grate, its slots.
    if (!gutter) return;
    const B = gutter;
    ctx.fillStyle = css(IRON);
    bandQuad(ctx, B, 0.42, 0.56, WALK + 0.004, WALK + 0.06); ctx.fill();
    ctx.fillStyle = css(0x1a1c1f);
    for (let k = 0; k < 5; k++) { bandQuad(ctx, B, 0.432 + k * 0.025, 0.442 + k * 0.025, WALK + 0.012, WALK + 0.052); ctx.fill(); }
  } else if (v === 1) {
    // A MANHOLE COVER, round, its ring and its tread.
    const cu = 0.44, cv = 0.56;
    ctx.fillStyle = css(0x3b3d41);
    ctx.beginPath(); ctx.arc(cu, cv, 0.06, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = css(0x24262a); ctx.lineWidth = 0.008;
    ctx.beginPath(); ctx.arc(cu, cv, 0.054, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 0.004;
    ctx.beginPath();
    for (let k = -2; k <= 2; k++) { ctx.moveTo(cu + k * 0.018, cv - 0.045); ctx.lineTo(cu + k * 0.018, cv + 0.045); }
    ctx.stroke();
  } else if (v === 2) {
    // A PATCH where the road was dug up, its edges sealed.
    ctx.fillStyle = css(0x4b4d51);
    poly(ctx, [[0.38, 0.4], [0.62, 0.41], [0.61, 0.6], [0.39, 0.59]]); ctx.fill();
    ctx.strokeStyle = css(0x1e1f22, 0.45); ctx.lineWidth = 0.007; ctx.stroke();
  } else {
    // CRACKS, and a stain where a car stood.
    ctx.fillStyle = css(0x2a2622, 0.13);
    ctx.beginPath(); ctx.ellipse(0.56, 0.44, 0.07, 0.05, 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = css(0x2b2c2f, 0.5); ctx.lineWidth = 0.004;
    ctx.beginPath(); ctx.moveTo(0.36, 0.56); ctx.lineTo(0.42, 0.52); ctx.lineTo(0.45, 0.55); ctx.lineTo(0.52, 0.5); ctx.lineTo(0.55, 0.53); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0.42, 0.52); ctx.lineTo(0.43, 0.46); ctx.stroke();
  }
}

/** A straight road's lane middles, across it from the low edge of the `across` axis; null where it is not straight. */
function lanesOf(L: Look): { across: "u" | "v"; mids: number[] } | null {
  const c = L.ctr;
  if (c === "u" || c === "U" || c === "v" || c === "V") {
    const half = (0.5 - WALK) / 2;
    return { across: c.toLowerCase() === "u" ? "v" : "u", mids: [0.5 - half, 0.5 + half] };
  }
  if (c[0] === "h" || c[0] === "H") {
    const s = Number(c[1]) as Side, lane = (1 - WALK) / 2;
    return { across: s < 2 ? "u" : "v", mids: [s & 1 ? 1 - lane : lane] };
  }
  return null;
}

/**
 * Close up, where the tyres run: two darker, polished tracks in each lane of a
 * straight road, the length of the tile so they run on into the next.
 */
function wheelTracks(ctx: Ctx, L: Look) {
  if (L.box || L.zeb || L.rb) return;
  const lanes = lanesOf(L);
  if (!lanes) return;
  const { across, mids } = lanes;
  ctx.fillStyle = css(0x1f2023, 0.09);
  for (const m of mids) for (const o of [-0.055, 0.055]) {
    const c0 = m + o - 0.018, c1 = m + o + 0.018;
    if (across === "u") ctx.fillRect(c0, -0.1, c1 - c0, 1.2); else ctx.fillRect(-0.1, c0, 1.2, c1 - c0);
  }
}

/**
 * PARKING BAYS, in white: in a lay-by, a line along its mouth where the kerb
 * would be and one across between each bay and the next; in a wide road's
 * parking strip, a line along its edge with the lane and the same across.
 */
function bayLines(ctx: Ctx, L: Look) {
  const W = 0.012;
  ctx.fillStyle = css(WHITE, 0.85);
  for (const m of L.bay.matchAll(/([LM])(\d)/g)) {
    const s = Number(m[2]) as Side;
    const [d0, d1] = m[1] === "L" ? [LAY_W + 0.012, WALK] : [WALK + 0.012, WALK + PARK_STRIP];
    bandRect(ctx, s, 0, 1, d1 - W / 2, d1 + W / 2); ctx.fill();
    for (const a of [0, 0.5, 1]) { bandRect(ctx, s, a - W / 2, a + W / 2, d0, d1); ctx.fill(); }
  }
}

/**
 * A BUS STOP'S CAGE at a kerb: a broken yellow line round the stretch a bus
 * stands in, and BUS STOP in it, read by the driver coming up to it.
 */
function busCages(ctx: Ctx, L: Look) {
  for (const m of L.bay.matchAll(/B(\d)/g)) {
    const s = Number(m[1]) as Side, w = 0.014, d0 = WALK + 0.014, d1 = WALK + 0.2;
    ctx.fillStyle = css(YELLOW, 0.92);
    for (const [a0, a1] of dashes(0.06, 0.94, 0.07, 0.04)) { bandRect(ctx, s, a0, a1, d1 - w / 2, d1 + w / 2); ctx.fill(); }
    for (const a of [0.06, 0.94]) { bandRect(ctx, s, a - w / 2, a + w / 2, d0, d1); ctx.fill(); }
    // The words, their tops toward where the bus is going: the kerb is on its right.
    const [kx, ky] = STEP[s], hx = ky * KEEP, hy = -kx * KEEP;
    const mid = 0.5 - (d0 + d1) / 2, cu = 0.5 + kx * mid, cv = 0.5 + ky * mid;
    ctx.save();
    ctx.font = "900 10px Arial, Helvetica, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const [word, t] of [["BUS", -0.13], ["STOP", 0.1]] as const) {
      const sx = 0.15 / ctx.measureText(word).width, sy = 0.15 / 7.2;
      ctx.save();
      ctx.transform(-hy * sx, hx * sx, -hx * sy, -hy * sy, cu + hx * t, cv + hy * t);
      ctx.fillText(word, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }
}

/** How far back along its way a roundel sits from the cell's middle: the two ways' roundels pass each other, never side by side. */
const ROUNDEL_BACK = 0.2;
/**
 * SPEED ROUNDELS: the limit in a ring, ONE for each way along the road — in
 * that way's nearside lane, its top toward where that traffic is going — so
 * both sides of the road have one and neither has two. @see Look.spd
 */
function roundels(ctx: Ctx, L: Look) {
  if (!L.spd) return;
  for (const m of L.spd.matchAll(/([0-3])(\d\d)/g)) {
    const s = Number(m[1]) as Side, [hx, hy] = STEP[s], [rx, ry] = rightOf(hx, hy);
    // The lane's middle, on its side of a one-cell street: its half of the road.
    const off = (0.5 - WALK) / 2;
    roundelAt(ctx, m[2], 0.5 + rx * off - hx * ROUNDEL_BACK, 0.5 + ry * off - hy * ROUNDEL_BACK, hx, hy);
  }
}

/**
 * A ROUNDEL at a point, for traffic going `(hx, hy)`: its top toward where they are going, its figures running to
 * the driver's right — a turn of the way they go, never a side of the road, which flips with the hand of the road
 * and lays lettering back to front.
 */
function roundelAt(ctx: Ctx, n: string, u: number, v: number, hx: number, hy: number) {
  ctx.save();
  ctx.transform(-hy, hx, -hx, -hy, u, v);
  ctx.strokeStyle = css(WHITE, 0.9);
  ctx.lineWidth = 0.012;
  // LONGER DOWN THE LANE than across it, as it is painted — but half again, not the real thing's near three
  // times, which is drawn to read round from a driver's seat and from above reads as nothing.
  ctx.beginPath(); ctx.ellipse(0, 0, 0.085, 0.135, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = css(WHITE, 0.92);
  ctx.font = "900 10px Arial, Helvetica, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const sx = 0.115 / ctx.measureText(n).width, sy = 0.165 / 7.2;
  ctx.scale(sx, sy);
  ctx.fillText(n, 0, 0.3);
  ctx.restore();
}

/** Everything on the ground of one cell, in its own (u, v). */
function paintGround(ctx: Ctx, L: Look) {
  const S = shapeOf(L);
  ctx.fillStyle = css(ASPHALT);
  ctx.fillRect(-0.1, -0.1, 1.2, 1.2);
  const pat = grainFill(ctx);
  if (pat) {
    ctx.fillStyle = pat;
    ctx.fillRect(-0.1, -0.1, 1.2, 1.2);
  }
  if (DETAIL > 0) wheelTracks(ctx, L);
  // The gutter: darker where the kerb meets the road.
  alongKerb(ctx, S, WALK, WALK + 0.03, css(0x000000, 0.12));
  fittings(ctx, L, S);
  if (L.box) yellowBox(ctx, L);
  if (L.rb) islandFoot(ctx, L);
  if (L.zeb) zebra(ctx, L);
  else if (L.xing) signalCrossing(ctx, L);
  if (L.zz) zigzags(ctx, L);
  centreLine(ctx, L);
  paintMarks(ctx, L, false);
  if (L.bay) { bayLines(ctx, L); busCages(ctx, L); }
  roundels(ctx, L);
  if (L.yl) {
    alongKerb(ctx, S, WALK + 0.018, WALK + 0.03, css(YELLOW, 0.92));
    alongKerb(ctx, S, WALK + 0.04, WALK + 0.052, css(YELLOW, 0.92));
  }
  for (const ch of L.gw) {
    const back = ch >= "a", k = back ? ch.charCodeAt(0) - 97 : Number(ch);
    giveWay(ctx, (k & 3) as Side, k >= 4, back);
  }
  for (const ch of L.stop) {
    const back = ch >= "a", k = back ? ch.charCodeAt(0) - 97 : Number(ch);
    stopLine(ctx, (k & 3) as Side, k >= 4, back);
  }
  if (L.arrow) arrow(ctx, L.arrow);
  for (const ch of L.slow) slow(ctx, Number(ch) as Side);
  // The kerb's face, where the raised pavement leaves it showing.
  ctx.fillStyle = css(tone(KERB_OF[L.lvl], 0.55));
  footprint(ctx, S);
  ctx.fill();
}

/** A roundabout's island: where it is, in the cell's own (u, v). */
const islandOf = (L: Look) => { const [u, v, r] = L.rb.split(",").map(Number); return { u, v, r }; };

/**
 * ON THE ROAD round a roundabout's island: a white line round the ring's
 * inside, and the island's kerb face, where the raised island leaves it.
 */
function islandFoot(ctx: Ctx, L: Look) {
  const { u, v, r } = islandOf(L);
  ctx.strokeStyle = css(WHITE, 0.85);
  ctx.lineWidth = 0.014;
  ctx.setLineDash([0.05, 0.035]);
  ctx.beginPath(); ctx.arc(u, v, r + 0.05, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = css(tone(KERB_OF[L.lvl], 0.55));
  ctx.beginPath(); ctx.arc(u, v, r, 0, Math.PI * 2); ctx.fill();
}

/** A roundabout's island, a kerb's height up: a stone kerb round grass, planted. */
function island(ctx: Ctx, L: Look) {
  const { u, v, r } = islandOf(L);
  ctx.fillStyle = css(KERB_OF[L.lvl]);
  ctx.beginPath(); ctx.arc(u, v, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = css(0x6f9d45);
  ctx.beginPath(); ctx.arc(u, v, r - 0.035, 0, Math.PI * 2); ctx.fill();
  // A ring of low shrubs, and flowers inside it.
  ctx.fillStyle = css(0x4f7f3a);
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    ctx.beginPath(); ctx.arc(u + Math.cos(a) * (r - 0.075), v + Math.sin(a) * (r - 0.075), 0.03, 0, Math.PI * 2); ctx.fill();
  }
  const BLOOM = [0xd8432f, 0xf2c230, 0xf27aa8, 0xa65ad6];
  for (let k = 0; k < 9; k++) {
    const a = k * 2.39996, d = (r - 0.13) * Math.sqrt((k + 0.5) / 9);
    ctx.fillStyle = css(BLOOM[k % BLOOM.length]);
    ctx.beginPath(); ctx.arc(u + Math.cos(a) * d, v + Math.sin(a) * d, 0.016, 0, Math.PI * 2); ctx.fill();
  }
}

/** The pavement and its kerb, a kerb's height up. */
function paintRaised(ctx: Ctx, L: Look) {
  if (L.rb) island(ctx, L);
  paintMarks(ctx, L, true);
  const S = shapeOf(L), lvl = L.lvl;
  // Under the pieces, what lies between them.
  ctx.fillStyle = css(JOINT[lvl]);
  footprint(ctx, S);
  ctx.fill();
  if (lvl === 0) {
    const pat = grainFill(ctx);
    if (pat) { ctx.fillStyle = pat; footprint(ctx, S); ctx.fill(); }
  }
  const piece = (q: Piece, shape: (a0: number, a1: number, d0: number, d1: number) => void) => {
    ctx.fillStyle = css(q.c);
    shape(q.a0, q.a1, q.d0, q.d1);
    ctx.fill();
    if (DETAIL === 0) return;
    // Close up, each piece's bevel: lit along its back edge, shaded along the
    // kerb side, and the grit of its surface.
    const b = Math.min(0.006, (q.d1 - q.d0) / 4);
    ctx.fillStyle = css(mix(q.c, 0xffffff, 0.22)); shape(q.a0, q.a1, q.d0, q.d0 + b); ctx.fill();
    ctx.fillStyle = css(tone(q.c, 0.8)); shape(q.a0, q.a1, q.d1 - b, q.d1); ctx.fill();
    const pat = grainFill(ctx);
    if (pat) { ctx.fillStyle = pat; ctx.globalAlpha = 0.6; shape(q.a0, q.a1, q.d0, q.d1); ctx.fill(); ctx.globalAlpha = 1; }
  };
  if (S.full) {
    // A cell of road on its own: paved all over.
    for (const q of piecesOf(lvl, L.vr, 9, PAVE - 1, PAVE)) piece(q, (a0, a1, d0, d1) => bandRect(ctx, 2, a0, a1, d0 + 1 - PAVE, d1 + 1 - PAVE));
    return;
  }
  for (const B of S.bands) {
    if (B.w0 === WALK && B.w1 === WALK) {
      for (const q of piecesOf(lvl, L.vr, B.s, 0, PAVE)) {
        const a0 = Math.max(B.a0, q.a0), a1 = Math.min(B.a1, q.a1);
        if (a1 > a0) piece(q, (_a, _b, d0, d1) => bandRect(ctx, B.s, a0, a1, d0, d1));
      }
      continue;
    }
    // BESIDE A LAY-BY, narrower: the paving's kerb side, all of it there is room for; cut along a taper.
    const cut = WALK - Math.max(B.w0, B.w1);
    ctx.save();
    poly(ctx, [bandPt(B.s, B.a0, 0), bandPt(B.s, B.a1, 0), bandPt(B.s, B.a1, B.w1 - KERB), bandPt(B.s, B.a0, B.w0 - KERB)]);
    ctx.clip();
    for (const q of piecesOf(lvl, L.vr, B.s, cut, PAVE)) {
      const a0 = Math.max(B.a0, q.a0), a1 = Math.min(B.a1, q.a1);
      if (a1 > a0) piece(q, (_a, _b, d0, d1) => bandRect(ctx, B.s, a0, a1, Math.max(0, d0 - cut), d1 - cut));
    }
    ctx.restore();
  }
  for (const R of S.rounds) {
    const k = WALK + R.rc;
    // Past the curve's pavement, out to the tile's corner, the paving runs on.
    for (const q of piecesOf(lvl, L.vr, 10 + R.c, -(k * (Math.SQRT2 - 1)) - 0.05, PAVE)) {
      piece(q, (a0, a1, d0, d1) => sector(ctx, (t, r) => roundPt(R, t, r), (a0 * Math.PI) / 2, (a1 * Math.PI) / 2, k - d0, k - d1));
    }
  }
  for (const c of S.nubs) for (const q of piecesOf(lvl, L.vr, 20 + c, 0, PAVE)) {
    piece(q, (a0, a1, d0, d1) => sector(ctx, (t, r) => nubPt(c, t, r), (a0 * Math.PI) / 2, (a1 * Math.PI) / 2, d0, d1));
  }
  // A CUT CORNER'S PAVING: laid square to the tile, as much of it as lies behind the cut.
  for (const K of S.cuts) {
    ctx.save();
    poly(ctx, cutShape(K));
    ctx.clip();
    const side: Side = K.c & 2 ? 3 : 2;
    for (const q of piecesOf(lvl, L.vr, 30 + K.c, PAVE - 1, PAVE)) piece(q, (a0, a1, d0, d1) => bandRect(ctx, side, a0, a1, d0 + 1 - PAVE, d1 + 1 - PAVE));
    ctx.restore();
  }
  // TACTILE PAVING at a zebra's ends: buff, studded, the kerb dropped flush.
  if (L.zeb) {
    for (const s of acrossOf(L.zeb)) {
      if (has(L.open, s)) continue;
      ctx.fillStyle = css(0xd9c48a);
      bandRect(ctx, s, 0.3, 0.7, 0.05, PAVE); ctx.fill();
      ctx.fillStyle = css(tone(0xd9c48a, 0.8));
      for (let a = 0.32; a < 0.69; a += 0.04) for (let d = 0.07; d < PAVE - 0.005; d += 0.035) { bandRect(ctx, s, a, a + 0.014, d, d + 0.014); ctx.fill(); }
    }
  }
  // THE KERB: its top, a lit edge along the pavement side, its joints.
  const kc = KERB_OF[lvl];
  alongKerb(ctx, S, PAVE, WALK, css(kc));
  alongKerb(ctx, S, PAVE, PAVE + 0.007, css(mix(kc, 0xffffff, 0.35)));
  alongKerb(ctx, S, WALK - 0.006, WALK, css(tone(kc, 0.85)));
  if (DETAIL > 0) {
    // Close up, each kerbstone a shade of its own, and their worn arrises.
    for (const B of S.bands) for (let k = 0; k < 6; k++) {
      const a0 = Math.max(B.a0, k / 6), a1 = Math.min(B.a1, (k + 1) / 6);
      if (a1 <= a0) continue;
      ctx.fillStyle = css(tone(kc, 0.94 + hash(B.s * 7.3 + k * 1.7 + L.vr) * 0.1));
      bandQuad(ctx, B, a0, a1, PAVE + 0.007, WALK - 0.006); ctx.fill();
    }
    const pat = grainFill(ctx);
    if (pat) { ctx.globalAlpha = 0.5; alongKerb(ctx, S, PAVE, WALK, pat); ctx.globalAlpha = 1; }
    alongKerb(ctx, S, WALK - 0.012, WALK - 0.006, css(tone(kc, 0.92)));
  }
  ctx.fillStyle = css(tone(kc, 0.78));
  for (const B of S.bands) for (let k = 1; k < 6; k++) {
    const a = k / 6;
    if (a > B.a0 && a < B.a1) { bandQuad(ctx, B, a - 0.0025, a + 0.0025, PAVE, WALK); ctx.fill(); }
  }
  if (L.zeb) for (const s of acrossOf(L.zeb)) if (!has(L.open, s)) { ctx.fillStyle = css(mix(kc, 0xffffff, 0.2)); bandRect(ctx, s, 0.3, 0.7, PAVE, WALK); ctx.fill(); }
}

// ─── SNOW ON THE ROAD ────────────────────────────────────────────────────────
//
// Painted over the road in its own tile, at the strength the snow lies (@see
// paved snowPaved): the pavements white, a bank along each kerb, the road
// itself still to be seen.

const SNOW_TOP = 0xf2f5f9, SNOW_SHADE = 0xb4bdc8, SNOW_TROD = 0xc9d0d9;

/** Slots for clumps a tile along a kerb: their places repeat each tile, so a bank runs on into the next. */
const CLUMPS = 22;
/** A kerb's run: a point `f` along it and `d` out over the road from its kerb; `f` from f0 to f1, `n` slots a tile. */
type KerbRun = { at: (f: number, d: number) => [number, number]; f0: number; f1: number; n: number; key: number; wrap: boolean; dMax: number };
function kerbRuns(S: Shape): KerbRun[] {
  const runs: KerbRun[] = [];
  for (const B of S.bands) {
    runs.push({
      at: (a, d) => bandPt(B.s, a, wAt(B, Math.min(B.a1, Math.max(B.a0, a))) + d),
      // (Past a tile's edge, where the bank runs on, the next tile's own clumps: cut off by the tile's outline.)
      f0: B.a0 > 0 ? B.a0 : -0.08, f1: B.a1 < 1 ? B.a1 : 1.08, n: CLUMPS, key: B.s * 31.7, wrap: true, dMax: 1,
    });
  }
  for (const R of S.rounds) {
    runs.push({ at: (t, d) => roundPt(R, t * Math.PI / 2, R.rc - d), f0: 0, f1: 1, n: Math.max(3, Math.round(R.rc * Math.PI / 2 * CLUMPS)), key: 100 + R.c * 13.1, wrap: false, dMax: R.rc * 0.7 });
  }
  for (const c of S.nubs) {
    runs.push({ at: (t, d) => nubPt(c, t * Math.PI / 2, WALK + d), f0: 0, f1: 1, n: Math.max(3, Math.round(WALK * Math.PI / 2 * CLUMPS)), key: 200 + c * 17.3, wrap: false, dMax: 1 });
  }
  for (const K of S.cuts) {
    const [p, q] = cutEdge(K, WALK), len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    runs.push({
      at: (t, d) => { const [e0, e1] = cutEdge(K, WALK + d / Math.SQRT2); return [e0[0] + (e1[0] - e0[0]) * t, e0[1] + (e1[1] - e0[1]) * t]; },
      f0: 0, f1: 1, n: Math.max(3, Math.round(len * CLUMPS)), key: 300 + K.c * 7.7, wrap: false, dMax: 1,
    });
  }
  return runs;
}

const CLUMPS_OF = new Map<string, Clump[]>();
/**
 * Along each foot of a reservation, the runs its bank of snow is thrown up along: a straight's slots by where they
 * are along the tile, as a kerb's are, so a bank runs on from tile to tile.
 */
function medianRuns(M: Median): KerbRun[] {
  const runs: KerbRun[] = [];
  for (let k = 1; k < M.pts.length; k++) {
    const [pu, pv] = M.pts[k - 1], [qu, qv] = M.pts[k], du = qu - pu, dv = qv - pv, len = Math.hypot(du, dv);
    if (len < 1e-6) continue;
    const alongU = Math.abs(du) >= Math.abs(dv), p0 = alongU ? pu : pv, q0 = alongU ? qu : qv;
    if (Math.abs(q0 - p0) < 1e-6) continue;
    const nu = -dv / len, nv = du / len;
    for (const side of [-1, 1]) {
      runs.push({
        at: (a, d) => { const t = (a - p0) / (q0 - p0), o = side * (MEDIAN_HALF + d); return [pu + du * t + nu * o, pv + dv * t + nv * o]; },
        f0: Math.min(p0, q0), f1: Math.max(p0, q0), n: CLUMPS, key: 400 + side * 7.3 + (alongU ? 0 : 3.1), wrap: true, dMax: 1,
      });
    }
  }
  // Round a rounded end, too.
  const P = M.pts, ends = [[P[0], P[1], 1], [P[P.length - 1], P[P.length - 2], 2]] as const;
  for (const [e, f, bit] of ends) {
    if (!(M.caps & bit) || !f) continue;
    const out = Math.atan2(e[1] - f[1], e[0] - f[0]);
    runs.push({
      at: (t, d) => { const th = out - Math.PI / 2 + Math.PI * t, r = MEDIAN_HALF + d; return [e[0] + Math.cos(th) * r, e[1] + Math.sin(th) * r]; },
      f0: 0, f1: 1, n: Math.max(3, Math.round(Math.PI * MEDIAN_HALF * CLUMPS)), key: 450 + bit * 5.9, wrap: false, dMax: 1,
    });
  }
  return runs;
}

/** A lump of snow: where, how big, its turn and squash, how white, whether gritted. */
type Clump = { u: number; v: number; r: number; turn: number; sq: number; white: number; grit: number };

/**
 * The clumps along a kerb: a solid core against it, lumps thinning out over the road, and loose chunks beyond —
 * each from its slot's own hash, the same whichever tile paints it.
 */
function clumpsOf(runs: KerbRun[]): Clump[] {
  const out: Clump[] = [];
  for (const R of runs) {
    const j0 = Math.floor(R.f0 * R.n - 1), j1 = Math.ceil(R.f1 * R.n + 1);
    for (let j = j0; j <= j1; j++) {
      const jm = R.wrap ? ((j % R.n) + R.n) % R.n : j;
      for (let k = 0; k < 13; k++) {
        const h = (x: number) => hash(jm * 7.31 + k * 91.7 + R.key + x * 13.37);
        const f = (j + 0.5 + (h(3) - 0.5) * 0.9) / R.n;
        if (f < R.f0 || f > R.f1) continue;
        // THE BANK SWELLS AND THINS along the kerb, where the plough left more or less: whole waves a tile.
        const swell = R.wrap ? 0.8 + 0.3 * Math.sin((f + R.key) * Math.PI * 2) + 0.15 * Math.sin((f * 3 + R.key * 0.3) * Math.PI * 2) : 1;
        let d: number, r: number;
        // A solid core against the kerb; lumps out from it, fewer and smaller the further; a few loose chunks.
        if (k < 3) { d = 0.01 + h(1) * 0.03; r = 0.022 + 0.02 * h(2); }
        else if (k < 7) { if (h(0) > 0.6) continue; d = 0.035 + Math.pow(h(1), 1.6) * 0.07; r = 0.008 + 0.022 * h(2) * (1 - d / 0.13); }
        else if (k < 9) { if (h(0) > 0.3) continue; d = 0.08 + h(1) * 0.08; r = 0.004 + 0.007 * h(2); }
        // A dusting over the road, thinner out from the bank: flakes the wind and the wheels left.
        else { if (h(0) > 0.55) continue; d = 0.06 + Math.pow(h(1), 1.8) * 0.22; r = 0.0018 + 0.0022 * h(2); }
        d = Math.min(d * swell, R.dMax);
        if (k < 7) r *= 0.75 + 0.35 * swell;
        const [u, v] = R.at(f, d);
        out.push({ u, v, r, turn: h(4) * Math.PI, sq: 0.65 + 0.35 * h(5), white: h(6), grit: h(7) });
      }
    }
  }
  return out;
}

/**
 * What of the cell being painted shows in the tile, in its own (u, v): all of it for the tile's own cell, the
 * strip along the edge it shares for a neighbour — whose clumps elsewhere are cut away, and were most of the work.
 */
let SEEN = { u0: -1, u1: 2, v0: -1, v1: 2 };

/** Clumps drawn: a wet dark halo round them, dirty slush at their feet, soft shadows, them lit from up the screen. */
function drawClumps(ctx: Ctx, all: Clump[], base: () => void, dirt = 0) {
  // (Zoomed out, a flake is less than a pixel: only lumps.)
  const S = SEEN, least = DETAIL > 0 ? 0 : 0.006;
  const clumps = all.filter((c) => c.r > least && c.u + 2.2 * c.r > S.u0 && c.u - 2.2 * c.r < S.u1 && c.v + 2.2 * c.r > S.v0 && c.v - 2.2 * c.r < S.v1);
  // Each layer one path and one fill: the clumps in it run together.
  const layer = (style: string, list: Clump[], s: (c: Clump) => number, off: (c: Clump) => number) => {
    if (!list.length) return;
    ctx.fillStyle = style;
    ctx.beginPath();
    for (const c of list) {
      const o = off(c), x = c.u + o, y = c.v + o;
      ctx.moveTo(x + Math.cos(c.turn) * c.r * s(c), y + Math.sin(c.turn) * c.r * s(c));
      ctx.ellipse(x, y, c.r * s(c), c.r * s(c) * c.sq, c.turn, 0, Math.PI * 2);
    }
    ctx.fill();
  };
  const big = clumps.filter((c) => c.r > 0.005);
  // THE ROAD WET round the snow.
  layer(css(0x15171a, 0.12), big, () => 2, () => 0.005);
  // Grey mush at its feet, road dirt in it: thrown up by the wheels, half melted.
  layer(css(mix(0xaeaba4, 0x8a8780, dirt), 0.4), big, () => 1.55, () => 0.004);
  // Shadows down the screen, away from the light: blue, soft, snow's.
  layer(css(0x8e9aa9, 0.5), clumps, () => 1.04, (c) => c.r * 0.28);
  base();
  // The lumps, run together: each a touch bigger than its place, so a bank is one thing with a lumpy edge.
  for (let k = 0; k < 3; k++) {
    layer(css(mix(mix(0xe2e8ef, 0xf3f6f9, k / 2), 0xb9b8b2, dirt)), clumps.filter((c) => Math.min(2, Math.floor(c.white * 3)) === k), () => 1.1, () => 0);
  }
  if (DETAIL === 0) return;
  // Lit on their tops, softly.
  layer(css(0xffffff, 0.45), clumps.filter((c) => c.r > 0.008), () => 0.6, (c) => -c.r * 0.25);
  // Grit thrown on them, a little, here and there.
  ctx.fillStyle = css(0x6a5f53, 0.4);
  ctx.beginPath();
  for (const c of clumps) {
    if (c.grit > 0.12 || c.r < 0.016) continue;
    for (let g = 0; g < 2; g++) {
      const a = c.turn * 3 + g * 2.1, d = c.r * 0.5 * ((g + 1) / 2), x = c.u + Math.cos(a) * d, y = c.v + Math.sin(a) * d;
      ctx.moveTo(x + 0.0018, y); ctx.arc(x, y, 0.0018, 0, Math.PI * 2);
    }
  }
  ctx.fill();
}

/**
 * The snow on the carriageway: the road itself left to be seen, the snow ploughed and thrown up against each kerb
 * in a clumpy bank, and on a street a broken line of dirty slush down its middle, between the ways the wheels go.
 */
function paintGroundSnow(ctx: Ctx, L: Look) {
  const S = shapeOf(L);
  // (Worked out once a shape: by what makes it.)
  const meds = mediansOf(L);
  const sk = `${L.open}.${L.diag}.${L.wx}.${L.bay}|${meds.map((M) => M.pts.join(" ")).join(";")}`;
  let cl = CLUMPS_OF.get(sk);
  if (!cl) { if (CLUMPS_OF.size > 400) CLUMPS_OF.clear(); CLUMPS_OF.set(sk, (cl = clumpsOf([...kerbRuns(S), ...meds.flatMap(medianRuns)]))); }
  drawClumps(ctx, cl, () => {
    alongKerb(ctx, S, WALK - 0.01, WALK + 0.035, css(0xeaeff4));
    for (const M of meds) medianStrip(ctx, M, MEDIAN_HALF + 0.035, css(0xeaeff4));
  });
  // A reservation's kerb face, as a pavement's.
  for (const M of meds) medianStrip(ctx, M, MEDIAN_HALF, css(SNOW_SHADE));
  const c = L.ctr;
  if (!L.box && !L.rb && !L.zeb && (c === "u" || c === "U" || c === "v" || c === "V")) {
    // SLUSH DOWN THE MIDDLE: a ridge of dirty lumps, broken, on a grey smear, between the ways the wheels go.
    const along = c.toLowerCase() === "u", P = (a: number, o: number): [number, number] => (along ? [a, 0.5 + o] : [0.5 + o, a]);
    ctx.fillStyle = css(0x9a9ea4, 0.22);
    ctx.beginPath();
    const n = 24;
    for (let t = 0; t <= n; t++) { const a = -0.1 + 1.2 * t / n; ctx.lineTo(...P(a, -0.035 - 0.012 * Math.sin(a * 4 * Math.PI))); }
    for (let t = n; t >= 0; t--) { const a = -0.1 + 1.2 * t / n; ctx.lineTo(...P(a, 0.035 + 0.012 * Math.sin(a * 6 * Math.PI + 1))); }
    ctx.closePath(); ctx.fill();
    const mid: Clump[] = [], N = 24;
    for (let j = -1; j <= N + 1; j++) for (let k = 0; k < 4; k++) {
      const jm = ((j % N) + N) % N, h = (x: number) => hash(jm * 5.17 + k * 43.1 + x * 11.9 + 500);
      // (Thicker in places, gone in others: whole waves a tile.)
      const a = (j + h(1)) / N, thick = 0.55 + 0.45 * Math.sin(a * 2 * Math.PI + 0.7);
      if (h(0) > 0.25 + 0.6 * thick) continue;
      const [u, v] = P(a, (h(2) - 0.5) * (k < 2 ? 0.03 : 0.07));
      mid.push({ u, v, r: k < 2 ? 0.01 + 0.012 * h(3) * thick : 0.004 + 0.006 * h(3), turn: h(4) * Math.PI, sq: 0.6 + 0.4 * h(5), white: h(6), grit: h(7) });
    }
    drawClumps(ctx, mid, () => {}, 0.35);
  }
  if (L.rb) {
    // Snow thrown up round the island too.
    const { u, v, r } = islandOf(L);
    const ring: Clump[] = [];
    for (let j = 0; j < 40; j++) for (let k = 0; k < 2; k++) {
      const h = (x: number) => hash(j * 3.3 + k * 17.9 + x * 7.7 + 900), a = (j + h(1)) / 40 * Math.PI * 2, d = r + 0.01 + h(2) * (k ? 0.06 : 0.025);
      ring.push({ u: u + Math.cos(a) * d, v: v + Math.sin(a) * d, r: k ? 0.006 + 0.01 * h(3) : 0.016 + 0.012 * h(3), turn: h(4) * Math.PI, sq: 0.65 + 0.35 * h(5), white: h(6), grit: h(7) });
    }
    drawClumps(ctx, ring, () => { ctx.fillStyle = css(0xeef2f6); ctx.beginPath(); ctx.arc(u, v, r + 0.012, 0, Math.PI * 2); ctx.fill(); });
  }
  // The kerb's face, snow on its edge.
  ctx.fillStyle = css(SNOW_SHADE);
  footprint(ctx, S);
  ctx.fill();
}

/** The snow on the pavement: clean, a way trodden along it, and the kerb's top and edge still to be seen. */
function paintRaisedSnow(ctx: Ctx, L: Look) {
  const S = shapeOf(L);
  ctx.fillStyle = css(SNOW_TOP);
  footprint(ctx, S);
  ctx.fill();
  const pat = grainFill(ctx);
  if (pat) { ctx.globalAlpha = 0.3; ctx.fillStyle = pat; footprint(ctx, S); ctx.fill(); ctx.globalAlpha = 1; }
  // THE CENTRAL RESERVATION under snow: white over, its edge in shade, and the barrier down it still dark, snow
  // lying along its top rail.
  for (const M of mediansOf(L)) {
    medianStrip(ctx, M, MEDIAN_HALF, css(0xd9dfe6));
    medianStrip(ctx, M, MEDIAN_HALF - 0.01, css(SNOW_TOP));
    medianStrip(ctx, M, 0.012, css(0xc6cdd5), 0.005, 0.005);
    medianStrip(ctx, M, 0.009, css(0x7d858d));
    medianStrip(ctx, M, 0.005, css(0xf4f7fa), -0.003, -0.003);
  }
  if (L.rb) {
    const { u, v, r } = islandOf(L);
    ctx.fillStyle = css(0xdfe5ec);
    ctx.beginPath(); ctx.arc(u, v, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = css(SNOW_TOP);
    ctx.beginPath(); ctx.arc(u, v, r - 0.035, 0, Math.PI * 2); ctx.fill();
    // The shrubs, humps under it.
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2, x = u + Math.cos(a) * (r - 0.075), y = v + Math.sin(a) * (r - 0.075);
      ctx.fillStyle = css(0xd2d9e1); ctx.beginPath(); ctx.arc(x + 0.006, y + 0.006, 0.03, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = css(0xffffff); ctx.beginPath(); ctx.arc(x - 0.004, y - 0.004, 0.024, 0, Math.PI * 2); ctx.fill();
    }
  }
  if (S.full) return;
  // THE WAY WALKED, a little in from the kerb: greyer, and close up the prints in it.
  alongKerb(ctx, S, 0.06, 0.15, css(mix(SNOW_TOP, SNOW_TROD, 0.55)));
  alongKerb(ctx, S, 0.08, 0.13, css(mix(SNOW_TOP, SNOW_TROD, 0.75)));
  // THE KERB under it: a lit edge, its top, the shadow down its face.
  alongKerb(ctx, S, PAVE, WALK, css(0xe7ecf1));
  alongKerb(ctx, S, PAVE - 0.004, PAVE + 0.006, css(0xffffff));
  alongKerb(ctx, S, WALK - 0.008, WALK, css(0xc3cbd4));
  if (DETAIL > 0) {
    ctx.fillStyle = css(0xd5dce3);
    for (const B of S.bands) for (let k = 1; k < 6; k++) {
      const a = k / 6;
      if (a > B.a0 && a < B.a1) { bandQuad(ctx, B, a - 0.002, a + 0.002, PAVE + 0.006, WALK - 0.008); ctx.fill(); }
    }
  }
}

// ─── THE ATLAS ───────────────────────────────────────────────────────────────

type Page = { lod: number; rt: RenderTexture; x: number; y: number; row: number };
/** A look's place on a page, in frame pixels, and the texture over it: both outlive the look. */
type Slot = { p: Page; x: number; y: number; ramp: boolean; tex: Texture };

export type RoadPainter = {
  /**
   * The texture for a key at a level of detail, painted from its cells the
   * first time it is asked for. Every level's texture is the same size in
   * frame pixels, so a sprite can swap between them and not move.
   */
  textureFor(key: string, cells: CellPaint[], ramp: boolean, lod?: number, snow?: number): Texture;
  /** A key's texture at a level, if painted yet. Asking is drawing it: it is no longer idle. @see keep */
  peek(key: string, lod: number): Texture | undefined;
  /**
   * Which of a level's looks are drawn now: `used`, every key a sprite shows
   * at that level. The rest are IDLE — kept, and handed back by
   * {@link peek} if their cell comes on screen again, but the first to give
   * their place and their texture to a new look once the level has filled
   * `ROOM` pages. So a level grows to what a screen shows at once and stays
   * there however far the map is panned, with nothing repainted that is
   * still on screen. Call only when every sprite has the texture it should.
   */
  keep(lod: number, used: Set<string>): void;
  /**
   * Drop a closer level's pages and textures: destroyed, a few a second.
   * Nothing may still draw them. Whether there were any.
   */
  evict(lod: number): boolean;
  /**
   * Destroy what was let go two calls ago: call once a frame. NOT AT ONCE,
   * because a render group's batches keep every page they have ever bound
   * (a sprite moved to another page already in its batch is swapped in place,
   * `Batcher.checkAndUpdateTexture`), so a page destroyed under them is bound
   * again and the renderer crashes on its null resource. Whoever lets pages go
   * marks those render groups to rebuild; by the time this destroys the pages,
   * a frame has drawn with batches that no longer list them.
   */
  reap(): void;
  /**
   * Copy what was painted since the last flush to its pages. Called before
   * each frame is drawn — not left to a microtask, which runs after it: a
   * sprite moved onto a newly painted texture drew the page as it was for a frame.
   */
  flush(): void;
  stats(): { keys: number; pages: number; tiers: { keys: number; pages: number; idle: number }[] };
  destroy(): void;
};

/** A tile's room on a strip, frame pixels: a ramp's, the taller. */
const CELL_W = 132 + 2 * PAD, CELL_H = RAMP_PAD + 99 + PAD;

export function createRoadPainter(renderer: Renderer): RoadPainter {
  type Set_ = { pages: Page[]; cache: Map<string, Slot> };
  const tiers = LOD_RES.map(() => ({ pages: [] as Page[], cache: new Map<string, Slot>(), idle: new Set<string>() }));
  let flushing = false;
  // PAGES LET GO, destroyed one a while: destroying a page is the GPU letting
  // go of a texture, and a level let go destroyed them all in one frame —
  // zooming out of a big town, most of a second. One still waiting is painted
  // again if its level comes back first. @see reap
  const surplus: Page[] = [];
  let lastDoomed = 0;

  // PAINTED ON A STRIP, COPIED TO A PAGE. A page is a texture and nothing
  // else: a canvas each to paint on was as big again, and uploaded whole for
  // one new tile. So a level has one small canvas, a few tiles long; a look is
  // painted in the next cell along, and at the flush each cell is drawn into
  // its place on its page — the place rubbed out first, since a look painted
  // over an idle one must not show through its own clear pixels.
  type Strip = { ctx: Ctx; source: CanvasSource; cells: Texture[][]; waiting: Slot[] };
  const strips: (Strip | undefined)[] = [];
  const stripOf = (lod: number): Strip => {
    let st = strips[lod];
    if (st) return st;
    const RES = LOD_RES[lod], canvas = document.createElement("canvas");
    canvas.width = STRIP[lod] * CELL_W * RES;
    canvas.height = CELL_H * RES;
    const ctx = canvas.getContext("2d", { willReadFrequently: false })!;
    // Copied texel for texel: `nearest`, so a cell never takes from the next.
    const source = new CanvasSource({ resource: canvas, resolution: RES, scaleMode: "nearest" });
    const cells = Array.from({ length: STRIP[lod] }, (_, i) => [PAD, RAMP_PAD].map((top) =>
      new Texture({ source, frame: new Rectangle(i * CELL_W, 0, CELL_W, top + 99 + PAD) })));
    st = strips[lod] = { ctx, source, cells, waiting: [] };
    return st;
  };
  const stage = new Container(), rubbers: Sprite[] = [], stamps: Sprite[] = [];
  /** A canvas a level the size of its strip, the snow painted on before it is laid over the road. */
  const scratch: (Ctx | undefined)[] = [];
  let dead = false;

  const newPage = (lod: number): Page => {
    const at = surplus.findIndex((p) => p.lod === lod);
    if (at >= 0) {
      const [again] = surplus.splice(at, 1);
      Object.assign(again, { x: 0, y: 0, row: 0 });
      tiers[lod].pages.push(again);
      return again;
    }
    const size = PAGE_OF[lod] / LOD_RES[lod];
    // MIPMAPS ONLY FOR THE MAP'S OWN LEVEL, the one drawn zoomed out. A closer
    // one is on screen cells only, at no less than half its size, where plain
    // linear filtering reads every texel — and a mip chain is a third again.
    const rt = RenderTexture.create({ width: size, height: size, resolution: LOD_RES[lod], antialias: false, autoGenerateMipmaps: lod === 0, scaleMode: "linear" });
    const p = { lod, rt, x: 0, y: 0, row: 0 };
    tiers[lod].pages.push(p);
    return p;
  };
  /** Room for `w × h` frame pixels on a page's shelves, if it has any left. */
  const shelve = (p: Page, w: number, h: number) => {
    const size = PAGE_OF[p.lod] / LOD_RES[p.lod];
    if (p.x + w > size) { p.x = 0; p.y += p.row; p.row = 0; }
    if (p.y + h > size) return null;
    const at = { x: p.x, y: p.y };
    p.x += w;
    p.row = Math.max(p.row, h);
    return at;
  };
  /** A place for a look of `w × h` frame pixels: unused room, an idle look's, or a new page. */
  const place = (lod: number, ramp: boolean, w: number, h: number, top: number): Slot => {
    const tier = tiers[lod], last = tier.pages[tier.pages.length - 1];
    let p = last, at = last ? shelve(last, w, h) : null;
    if (!at && tier.pages.length >= ROOM) {
      // The longest idle of its shape: a ramp's place is taller. @see RAMP_PAD
      for (const k of tier.idle) {
        const s = tier.cache.get(k)!;
        if (s.ramp !== ramp) continue;
        tier.idle.delete(k);
        tier.cache.delete(k);
        return s;
      }
    }
    if (!at) { p = newPage(lod); at = shelve(p, w, h)!; }
    const tex = new Texture({ source: p.rt.source, frame: new Rectangle(at.x, at.y, w, h), defaultAnchor: { x: 0.5, y: (top + 99) / h } });
    return { p, x: at.x, y: at.y, ramp, tex };
  };

  const flush = () => {
    flushing = false;
    if (dead) return;
    for (const st of strips) {
      if (!st?.waiting.length) continue;
      st.source.update();
      const pages = new Set(st.waiting.map((s) => s.p));
      for (const p of pages) {
        stage.removeChildren();
        let n = 0;
        // Every place rubbed out, then every look drawn: two batches a page.
        for (let i = 0; i < st.waiting.length; i++) {
          const s = st.waiting[i];
          if (s.p !== p) continue;
          const rub = rubbers[n] ??= Object.assign(new Sprite(Texture.WHITE), { blendMode: "erase" as const });
          rub.position.set(s.x, s.y);
          rub.setSize(s.tex.frame.width, s.tex.frame.height);
          const stamp = stamps[n] ??= new Sprite();
          stamp.texture = st.cells[i][s.ramp ? 1 : 0];
          stamp.position.set(s.x, s.y);
          n++;
        }
        for (let i = 0; i < n; i++) stage.addChild(rubbers[i]);
        for (let i = 0; i < n; i++) stage.addChild(stamps[i]);
        renderer.render({ container: stage, target: p.rt, clear: false });
        if (p.lod === 0) p.rt.source.updateMipmaps();
      }
      stage.removeChildren();
      st.waiting.length = 0;
    }
  };
  // Let go, then destroyed two reaps later. @see RoadPainter.reap
  let letGo: Set_[] = [], dying: Set_[] = [];
  const destroy = (t: Set_) => {
    for (const s of t.cache.values()) s.tex.destroy(false);
    surplus.push(...t.pages);
  };
  const drop = (lod: number) => {
    const t = tiers[lod];
    if (!t.pages.length && !t.cache.size) return false;
    letGo.push({ pages: [...t.pages], cache: new Map(t.cache) });
    t.cache.clear();
    t.idle.clear();
    t.pages.length = 0;
    return true;
  };

  const painter: RoadPainter = {
    textureFor(key, cells, ramp, lod = 0, snow = 0) {
      const tier = tiers[lod];
      const hit = tier.cache.get(key);
      if (hit) { tier.idle.delete(key); return hit.tex; }
      const RES = LOD_RES[lod];
      const top = ramp ? RAMP_PAD : PAD;
      const w = 132 + 2 * PAD, h = top + 99 + PAD;
      const slot = place(lod, ramp, w, h, top);
      const st = stripOf(lod);
      if (st.waiting.length === STRIP[lod]) flush();
      const x = st.waiting.length * CELL_W, y = 0;
      st.waiting.push(slot);
      DETAIL = lod;
      // Painted on `ctx`: the road, or the snow over it.
      const paintOn = (ctx: Ctx, snowy: boolean) => {
        ctx.save();
        ctx.setTransform(RES, 0, 0, RES, 0, 0);
        ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
        ctx.clearRect(x, y, w, h);
        const HU = HEIGHT_UNIT;
        // The tile's projection for a cell `dx, dy` from this one, on plane `p`, `lift` frame pixels up.
        const project = (c: CellPaint, lift: number, p: { z0: number; zu: number; zv: number } = c) => {
          ctx.setTransform(
            66 * RES, (33 - p.zu * HU) * RES,
            -66 * RES, (33 - p.zv * HU) * RES,
            (x + PAD + 66 + 66 * (c.dx - c.dy)) * RES,
            (y + top + 33 * (c.dx + c.dy) - p.z0 * HU - lift) * RES,
          );
        };
        // Only this cell's diamond and a margin: the neighbours' parts that its sprite overlaps.
        const self = cells.find((c) => c.dx === 0 && c.dy === 0)!;
        if (self.zc) {
          // (Its corners not in one plane: the outline through them, each carried a margin out along its edges.)
          const z = self.zc, M = MARGIN;
          const at = (u: number, v: number) => {
            const h = (z[0] * (1 - u) + z[1] * u) * (1 - v) + (z[3] * (1 - u) + z[2] * u) * v;
            return [x + PAD + 66 + 66 * (u - v), y + top + 33 * (u + v) - h * HU] as const;
          };
          ctx.setTransform(RES, 0, 0, RES, 0, 0);
          ctx.beginPath();
          for (const [u, v] of [[-M, -M], [1 + M, -M], [1 + M, 1 + M], [-M, 1 + M]] as const) ctx.lineTo(...at(u, v));
          ctx.closePath();
        } else {
          project(self, 0);
          ctx.beginPath(); ctx.rect(-MARGIN, -MARGIN, 1 + 2 * MARGIN, 1 + 2 * MARGIN);
          ctx.setTransform(RES, 0, 0, RES, 0, 0);
        }
        ctx.clip();
        const E = 0.004;
        for (const pass of [0, 1]) for (const c of cells) {
          // A cell on one plane, painted once; one whose corners are not, as its two triangles, each a hair over the
          // diagonal so no seam opens down it.
          for (const k of c.zc ? [0, 1] : [-1]) {
            ctx.save();
            const z = c.zc;
            project(c, pass ? KERB_PX : 0, !z ? c : k === 0 ? { z0: z[0], zu: z[1] - z[0], zv: z[2] - z[1] } : { z0: z[0], zu: z[2] - z[3], zv: z[3] - z[0] });
            ctx.beginPath();
            if (k < 0) ctx.rect(-E, -E, 1 + 2 * E, 1 + 2 * E);
            else for (const [u, v] of (k === 0 ? [[-E, -E], [1 + E, -E], [1 + E, 1 + E], [1 - E, 1 + E], [-E, E]] : [[-E, -E], [E, -E], [1 + E, 1 - E], [1 + E, 1 + E], [-E, 1 + E]])) ctx.lineTo(u, v);
            ctx.clip();
            if (snowy) {
              const M = MARGIN + 0.01;
              SEEN = { u0: Math.max(-0.1, -M - c.dx), u1: Math.min(1.1, 1 + M - c.dx), v0: Math.max(-0.1, -M - c.dy), v1: Math.min(1.1, 1 + M - c.dy) };
              if (pass) paintRaisedSnow(ctx, c.look); else paintGroundSnow(ctx, c.look);
            }
            else if (pass) paintRaised(ctx, c.look); else paintGround(ctx, c.look);
            ctx.restore();
          }
        }
        ctx.restore();
      };
      // SNOW, `snow` of it: painted on a canvas of its own and laid over the road at that strength — one layer, so
      // what is in it is not seen through itself.
      paintOn(st.ctx, false);
      if (snow > 0) {
        const sc = (scratch[lod] ??= (() => {
          const c = document.createElement("canvas");
          c.width = st.ctx.canvas.width; c.height = st.ctx.canvas.height;
          return c.getContext("2d")!;
        })());
        paintOn(sc, true);
        const c = st.ctx;
        c.save();
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.globalAlpha = snow;
        c.drawImage(sc.canvas, x * RES, y * RES, w * RES, h * RES, x * RES, y * RES, w * RES, h * RES);
        c.restore();
      }
      DETAIL = 0;
      if (!flushing) { flushing = true; queueMicrotask(flush); }
      tier.cache.set(key, slot);
      return slot.tex;
    },
    peek(key, lod) {
      const hit = tiers[lod].cache.get(key);
      if (hit) tiers[lod].idle.delete(key);
      return hit?.tex;
    },
    keep(lod, used) {
      const t = tiers[lod];
      for (const k of t.idle) if (used.has(k)) t.idle.delete(k);
      // Added after those idle already: the longest idle stays first.
      for (const k of t.cache.keys()) if (!used.has(k)) t.idle.add(k);
    },
    evict: (lod) => lod > 0 && drop(lod),
    reap() {
      for (const t of dying) destroy(t);
      dying = letGo;
      letGo = [];
      // One page let go destroyed at a time, a while apart.
      const now = performance.now();
      if (surplus.length && now - lastDoomed > DOOM_EVERY_MS) { surplus.pop()!.rt.destroy(true); lastDoomed = now; }
    },
    flush,
    stats: () => ({
      keys: tiers.reduce((n, t) => n + t.cache.size, 0),
      pages: tiers.reduce((n, t) => n + t.pages.length, 0),
      tiers: tiers.map((t) => ({ keys: t.cache.size, pages: t.pages.length, idle: t.idle.size })),
    }),
    destroy() {
      for (let l = 0; l < tiers.length; l++) drop(l);
      for (const t of [...dying, ...letGo]) destroy(t);
      dying = letGo = [];
      for (const p of surplus) p.rt.destroy(true);
      surplus.length = 0;
      dead = true;
      stage.removeChildren();
      for (const s of [...rubbers, ...stamps]) s.destroy();
      for (const st of strips) if (st) { for (const c of st.cells.flat()) c.destroy(false); st.source.destroy(); }
      stage.destroy();
    },
  };
  // How many looks, how many pages: for the console. @see stats
  if (import.meta.env?.DEV) (globalThis as { __roadPainter?: RoadPainter }).__roadPainter = painter;
  return painter;
}
