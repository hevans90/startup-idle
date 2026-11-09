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
import { CanvasSource, Rectangle, Texture } from "pixi.js";

import { HEIGHT_UNIT, rampDir, rampRise, RAMP } from "../iso";
import { hash } from "../structures/projects/model";
import { mix, tone } from "../structures/projects/pen";
import { opposite, rightOf, STEP, type Look, type Side } from "../roads/looks";

/** How far in from the tile's edge the pavement runs, its kerb, and both. */
export const PAVE = 0.22, KERB = 0.04, WALK = PAVE + KERB;
/** How high a kerb stands, in frame pixels. */
const KERB_PX = 1.6;
/**
 * Texels a frame pixel, by level of detail: the map's own, then two closer.
 * A level is used once the screen shows a frame pixel bigger than its
 * resolution, so a texture is never magnified past about 1.2×.
 */
export const LOD_RES = [2, 4, 7] as const;
/** An atlas page, texels square, by level of detail. */
const PAGE_OF = [2048, 4096, 4096] as const;

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
/** Frame pixels of room round the diamond, and over it for a ramp rising up-screen. */
const PAD = 4, RAMP_PAD = 36;

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
export type CellPaint = { look: Look; dx: number; dy: number; z0: number; zu: number; zv: number };

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

/** A run of pavement along a kerbed side, from `a0` to `a1` along it. */
type Band = { s: Side; a0: number; a1: number };
/** A rounded corner where two kerbs meet: the carriageway's corner, radius `rc`. */
type Round = { c: number; rc: number };
type Shape = { bands: Band[]; rounds: Round[]; nubs: number[]; full: boolean };

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
  if (L.open === 0) return { bands: [], rounds: [], nubs: [], full: true };
  const rounds: Round[] = [], nubs: number[] = [];
  const rcOf: (number | null)[] = [null, null, null, null];
  for (let c = 0; c < 4; c++) {
    const [su, sv] = sidesOf(c);
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
    if (!kerb(s)) continue;
    const [c0, c1] = ends[s];
    const a0 = rcOf[c0] !== null ? WALK + rcOf[c0]! : 0;
    const a1 = rcOf[c1] !== null ? 1 - WALK - rcOf[c1]! : 1;
    if (a1 > a0) bands.push({ s, a0, a1 });
  }
  return { bands, rounds, nubs, full: false };
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

/**
 * Fill a strip along the whole line of the kerb, between depths `o0` and
 * `o1` as a band measures them, in from the tile's edge: the kerb is PAVE to
 * WALK, the road begins at WALK. Bands at that depth, rounds and nubs at the
 * radius that is.
 */
function alongKerb(ctx: Ctx, S: Shape, o0: number, o1: number, colour: string | CanvasPattern) {
  ctx.fillStyle = colour;
  for (const B of S.bands) { bandRect(ctx, B.s, B.a0, B.a1, o0, o1); ctx.fill(); }
  for (const R of S.rounds) {
    // A depth `d` from the houses' side is radius `WALK + rc − d` from the curve's centre.
    sector(ctx, (t, r) => roundPt(R, t, r), 0, Math.PI / 2, WALK + R.rc - o0, WALK + R.rc - o1);
    ctx.fill();
  }
  for (const c of S.nubs) { sector(ctx, (t, r) => nubPt(c, t, r), 0, Math.PI / 2, o0, o1); ctx.fill(); }
}

/** The pavement's outline, kerb and all: what stands up off the road. */
function footprint(ctx: Ctx, S: Shape) {
  ctx.beginPath();
  if (S.full) { ctx.rect(0, 0, 1, 1); return; }
  const add = (pts: [number, number][]) => { ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]); ctx.closePath(); };
  for (const B of S.bands) add([bandPt(B.s, B.a0, 0), bandPt(B.s, B.a1, 0), bandPt(B.s, B.a1, WALK), bandPt(B.s, B.a0, WALK)]);
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

function centreLine(ctx: Ctx, L: Look) {
  const w = 0.011;
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

/** The lane coming in toward side `s`, across: a one-cell road's right half, or a whole lane of a wider one. */
const inbound = (wide: boolean): [number, number] => (wide ? [-0.5, 0.5 - WALK] : [0, 0.5 - WALK]);

/** GIVE WAY: two broken lines across the lane coming in, and the triangle behind them. */
function giveWay(ctx: Ctx, s: Side, wide: boolean) {
  const [c0, c1] = inbound(wide);
  ctx.fillStyle = css(WHITE, 0.92);
  for (const e of [0.035, 0.085]) for (const [a, b] of dashes(c0 + 0.01, c1 - 0.005, 0.045, 0.03)) { laneRect(ctx, s, e, e + 0.022, a, b); ctx.fill(); }
  // The triangle, long, its base toward the line: an outline.
  const F = laneFrame(s), cm = (c0 + c1) / 2, half = Math.min(0.06, (c1 - c0) / 2 - 0.03);
  ctx.strokeStyle = css(WHITE, 0.9);
  ctx.lineWidth = 0.016;
  ctx.lineJoin = "miter";
  poly(ctx, [F.pt(0.22, cm - half), F.pt(0.22, cm + half), F.pt(0.66, cm)]);
  ctx.stroke();
}

/** STOP: a solid line across the lane coming in. */
function stopLine(ctx: Ctx, s: Side) {
  const [c0, c1] = inbound(true);
  ctx.fillStyle = css(WHITE, 0.94);
  laneRect(ctx, s, 0.04, 0.085, c0 + 0.01, c1 - 0.005);
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
  ctx.transform(F.rx * sx, F.ry * sx, -F.hx * sy, -F.hy * sy, ox, oy);
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

/** A road's wear and fittings, one of four: a gully, a manhole, a patch, cracks and a stain. */
function fittings(ctx: Ctx, L: Look, S: Shape) {
  if (L.open === 0 || L.box || L.zeb) return;
  const v = L.vr;
  if (v > 3) return; // most of a road is just road
  if (v === 0 && S.bands.length) {
    // A GULLY in the gutter: an iron grate, its slots.
    const B = S.bands[0];
    ctx.fillStyle = css(IRON);
    bandRect(ctx, B.s, 0.42, 0.56, WALK + 0.004, WALK + 0.06); ctx.fill();
    ctx.fillStyle = css(0x1a1c1f);
    for (let k = 0; k < 5; k++) { bandRect(ctx, B.s, 0.432 + k * 0.025, 0.442 + k * 0.025, WALK + 0.012, WALK + 0.052); ctx.fill(); }
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

/**
 * Close up, where the tyres run: two darker, polished tracks in each lane of a
 * straight road, the length of the tile so they run on into the next.
 */
function wheelTracks(ctx: Ctx, L: Look) {
  if (L.box || L.zeb) return;
  const c = L.ctr;
  // Lane middles, across the road, from the low edge of the across axis.
  let across: "u" | "v", mids: number[];
  if (c === "u" || c === "U" || c === "v" || c === "V") {
    across = c.toLowerCase() === "u" ? "v" : "u";
    const half = (0.5 - WALK) / 2;
    mids = [0.5 - half, 0.5 + half];
  } else if (c[0] === "h" || c[0] === "H") {
    const s = Number(c[1]) as Side, lane = (1 - WALK) / 2;
    across = s < 2 ? "u" : "v";
    mids = [s & 1 ? 1 - lane : lane];
  } else return;
  ctx.fillStyle = css(0x1f2023, 0.09);
  for (const m of mids) for (const o of [-0.055, 0.055]) {
    const c0 = m + o - 0.018, c1 = m + o + 0.018;
    if (across === "u") ctx.fillRect(c0, -0.1, c1 - c0, 1.2); else ctx.fillRect(-0.1, c0, 1.2, c1 - c0);
  }
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
  if (L.zeb) zebra(ctx, L);
  if (L.zz) zigzags(ctx, L);
  centreLine(ctx, L);
  if (L.yl) {
    alongKerb(ctx, S, WALK + 0.018, WALK + 0.03, css(YELLOW, 0.92));
    alongKerb(ctx, S, WALK + 0.04, WALK + 0.052, css(YELLOW, 0.92));
  }
  for (const ch of L.gw) { const k = Number(ch); giveWay(ctx, (k & 3) as Side, k >= 4); }
  for (const ch of L.stop) stopLine(ctx, Number(ch) as Side);
  if (L.arrow) arrow(ctx, L.arrow);
  for (const ch of L.slow) slow(ctx, Number(ch) as Side);
  // The kerb's face, where the raised pavement leaves it showing.
  ctx.fillStyle = css(tone(KERB_OF[L.lvl], 0.55));
  footprint(ctx, S);
  ctx.fill();
}

/** The pavement and its kerb, a kerb's height up. */
function paintRaised(ctx: Ctx, L: Look) {
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
  for (const B of S.bands) for (const q of piecesOf(lvl, L.vr, B.s, 0, PAVE)) {
    const a0 = Math.max(B.a0, q.a0), a1 = Math.min(B.a1, q.a1);
    if (a1 > a0) piece(q, (_a, _b, d0, d1) => bandRect(ctx, B.s, a0, a1, d0, d1));
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
      bandRect(ctx, B.s, a0, a1, PAVE + 0.007, WALK - 0.006); ctx.fill();
    }
    const pat = grainFill(ctx);
    if (pat) { ctx.globalAlpha = 0.5; alongKerb(ctx, S, PAVE, WALK, pat); ctx.globalAlpha = 1; }
    alongKerb(ctx, S, WALK - 0.012, WALK - 0.006, css(tone(kc, 0.92)));
  }
  ctx.fillStyle = css(tone(kc, 0.78));
  for (const B of S.bands) for (let k = 1; k < 6; k++) {
    const a = k / 6;
    if (a > B.a0 && a < B.a1) { bandRect(ctx, B.s, a - 0.0025, a + 0.0025, PAVE, WALK); ctx.fill(); }
  }
  if (L.zeb) for (const s of acrossOf(L.zeb)) if (!has(L.open, s)) { ctx.fillStyle = css(mix(kc, 0xffffff, 0.2)); bandRect(ctx, s, 0.3, 0.7, PAVE, WALK); ctx.fill(); }
}

// ─── THE ATLAS ───────────────────────────────────────────────────────────────

type Page = { canvas: HTMLCanvasElement; ctx: Ctx; source: CanvasSource; x: number; y: number; row: number; dirty: boolean };

export type RoadPainter = {
  /**
   * The texture for a key at a level of detail, painted from its cells the
   * first time it is asked for. Every level's texture is the same size in
   * frame pixels, so a sprite can swap between them and not move.
   */
  textureFor(key: string, cells: CellPaint[], ramp: boolean, lod?: number): Texture;
  /** A key's texture at a level, if painted yet. */
  peek(key: string, lod: number): Texture | undefined;
  /**
   * Start a level afresh: new pages for what is painted from now on, the old
   * ones kept, still drawn, until {@link dropOld}. So a level that has filled
   * its pages is replaced without anything on screen losing its texture.
   */
  rotate(lod: number): void;
  /** Let go of a level's old pages. Nothing may still draw them. Whether there were any. */
  dropOld(lod: number): boolean;
  /** Drop a closer level's pages and textures, old and new. Nothing may still draw them. Whether there were any. */
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
  /** Upload what was painted since the last flush. */
  flush(): void;
  stats(): { keys: number; pages: number; tiers: { keys: number; pages: number; old: number }[] };
  destroy(): void;
};

export function createRoadPainter(): RoadPainter {
  type Set_ = { pages: Page[]; cache: Map<string, Texture> };
  const tiers = LOD_RES.map(() => ({ pages: [] as Page[], cache: new Map<string, Texture>(), old: null as Set_ | null }));
  let flushing = false;

  const newPage = (lod: number): Page => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = PAGE_OF[lod];
    const ctx = canvas.getContext("2d", { willReadFrequently: false })!;
    const source = new CanvasSource({ resource: canvas, resolution: LOD_RES[lod], autoGenerateMipmaps: true, scaleMode: "linear" });
    const p = { canvas, ctx, source, x: 0, y: 0, row: 0, dirty: false };
    tiers[lod].pages.push(p);
    return p;
  };
  /** A slot of `w × h` frame pixels on a level's pages. */
  const slot = (lod: number, w: number, h: number) => {
    const size = PAGE_OF[lod] / LOD_RES[lod], pages = tiers[lod].pages;
    let p = pages[pages.length - 1] ?? newPage(lod);
    if (p.x + w > size) { p.x = 0; p.y += p.row; p.row = 0; }
    if (p.y + h > size) { p = newPage(lod); }
    const at = { p, x: p.x, y: p.y };
    p.x += w;
    p.row = Math.max(p.row, h);
    return at;
  };

  const flush = () => {
    flushing = false;
    for (const t of tiers) for (const p of t.pages) if (p.dirty) { p.dirty = false; p.source.update(); }
  };
  // Let go, then destroyed two reaps later. @see RoadPainter.reap
  let letGo: Set_[] = [], dying: Set_[] = [];
  const destroy = (t: Set_) => {
    for (const tex of t.cache.values()) tex.destroy(false);
    for (const p of t.pages) p.source.destroy();
  };
  const free = (t: Set_) => {
    if (!t.pages.length && !t.cache.size) return false;
    letGo.push({ pages: [...t.pages], cache: new Map(t.cache) });
    t.cache.clear();
    t.pages.length = 0;
    return true;
  };
  const dropOld = (lod: number) => {
    const t = tiers[lod];
    if (!t.old) return false;
    free(t.old);
    t.old = null;
    return true;
  };
  const drop = (lod: number) => { const a = dropOld(lod); return free(tiers[lod]) || a; };

  const painter: RoadPainter = {
    textureFor(key, cells, ramp, lod = 0) {
      const tier = tiers[lod];
      const hit = tier.cache.get(key);
      if (hit) return hit;
      const RES = LOD_RES[lod];
      const top = ramp ? RAMP_PAD : PAD;
      const w = 132 + 2 * PAD, h = top + 99 + PAD;
      const { p, x, y } = slot(lod, w, h);
      const ctx = p.ctx;
      DETAIL = lod;
      ctx.save();
      ctx.setTransform(RES, 0, 0, RES, 0, 0);
      ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      ctx.clearRect(x, y, w, h);
      // The tile's projection for a cell `dx, dy` from this one, `lift` frame pixels up.
      const project = (c: CellPaint, lift: number) => {
        const HU = HEIGHT_UNIT;
        ctx.setTransform(
          66 * RES, (33 - c.zu * HU) * RES,
          -66 * RES, (33 - c.zv * HU) * RES,
          (x + PAD + 66 + 66 * (c.dx - c.dy)) * RES,
          (y + top + 33 * (c.dx + c.dy) - c.z0 * HU - lift) * RES,
        );
      };
      // Only this cell's diamond and a margin: the neighbours' parts that its sprite overlaps.
      const self = cells.find((c) => c.dx === 0 && c.dy === 0)!;
      project(self, 0);
      ctx.beginPath(); ctx.rect(-MARGIN, -MARGIN, 1 + 2 * MARGIN, 1 + 2 * MARGIN);
      ctx.setTransform(RES, 0, 0, RES, 0, 0);
      ctx.clip();
      const E = 0.004;
      for (const pass of [0, 1]) for (const c of cells) {
        ctx.save();
        project(c, pass ? KERB_PX : 0);
        ctx.beginPath(); ctx.rect(-E, -E, 1 + 2 * E, 1 + 2 * E); ctx.clip();
        if (pass) paintRaised(ctx, c.look); else paintGround(ctx, c.look);
        ctx.restore();
      }
      ctx.restore();
      DETAIL = 0;
      p.dirty = true;
      if (!flushing) { flushing = true; queueMicrotask(flush); }
      const tex = new Texture({ source: p.source, frame: new Rectangle(x, y, w, h), defaultAnchor: { x: 0.5, y: (top + 99) / h } });
      tier.cache.set(key, tex);
      return tex;
    },
    peek: (key, lod) => tiers[lod].cache.get(key),
    rotate(lod) {
      const t = tiers[lod];
      if (t.old) return;
      t.old = { pages: t.pages, cache: t.cache };
      t.pages = [];
      t.cache = new Map();
    },
    dropOld,
    evict: (lod) => lod > 0 && drop(lod),
    reap() {
      for (const t of dying) destroy(t);
      dying = letGo;
      letGo = [];
    },
    flush,
    stats: () => ({
      keys: tiers.reduce((n, t) => n + t.cache.size, 0),
      pages: tiers.reduce((n, t) => n + t.pages.length, 0),
      tiers: tiers.map((t) => ({ keys: t.cache.size, pages: t.pages.length, old: t.old?.pages.length ?? 0 })),
    }),
    destroy() {
      for (let l = 0; l < tiers.length; l++) drop(l);
      for (const t of [...dying, ...letGo]) destroy(t);
      dying = letGo = [];
    },
  };
  // How many looks, how many pages: for the console. @see stats
  if (import.meta.env?.DEV) (globalThis as { __roadPainter?: RoadPainter }).__roadPainter = painter;
  return painter;
}
