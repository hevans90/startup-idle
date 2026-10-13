/**
 * World v2 — the drawing kit a project's building is made with.
 *
 * EVERYTHING IN THE TILE PLANE, nothing in pixels. A pole is a box a few
 * hundredths of a tile across, a window a quad on a face, a brace a strip of
 * a given width in tiles — so the whole site scales with the zoom. The kit it
 * replaces stroked its scaffolds and fences in screen pixels, which read as
 * wire zoomed out and as felt pen zoomed in.
 *
 * LIT FROM THE LEFT, as the town's sprites are. Measured off them: the face
 * looking down and left (the +v face here) is the colour itself, the top a
 * shade lighter, and the face looking down and right (+u) three quarters of
 * it — wall, stone and skirt alike. @see TOP, RIGHT
 *
 * ONE TILE AT A TIME. A building is drawn as a Graphics per tile of its
 * footprint, each filed in that tile's band, so a house beside any part of
 * it stands in front of or behind that part as it should. Everything here is
 * clipped to the tile it is drawing: tops to its square, a +u face only in
 * the tiles along the line it stands on, a +v face likewise. @see makePen
 *
 * LOCAL COORDINATES: `u` across the footprint from 0 to its width, `v` from 0
 * to its depth, `z` in half steps above the ground it stands on. The tile at
 * column `c`, row `r` is `c <= u <= c + 1`, `r <= v <= r + 1`.
 */
import type { Graphics } from "pixi.js";

import { HEIGHT_UNIT, HH, HW } from "../../iso";

/** How much lighter a top is than the face lit from the left. */
export const TOP = 1.06;
/** How dark the face looking down and right is, against the one lit from the left. */
export const RIGHT = 0.76;

/** A colour scaled channel by channel, `k` above one lightening it. */
export function tone(c: number, k: number): number {
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round(((c >> s) & 255) * k)));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** A colour moved `t` of the way toward another. */
export function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export type Pt = [number, number];

export type Pen = {
  /** Projection of a local point to the Graphics' own space. */
  P: (u: number, v: number, z: number) => Pt;
  /** The column being drawn, in local `u`. */
  cu0: number;
  cu1: number;
  /** The view's scale, for anything that has to know it. */
  sc: number;
  /** A polygon in screen space, filled. */
  poly: (pts: Pt[], colour: number, alpha?: number) => void;
  /**
   * A box: its top and the two faces the camera sees, shaded from `colour`
   * (the left face's). `top` overrides the top's colour as given, unshaded.
   */
  box: (
    u0: number, v0: number, u1: number, v1: number, z0: number, z1: number,
    colour: number, o?: { top?: number; noTop?: boolean; alpha?: number; right?: number },
  ) => void;
  /** A level rectangle at height `z`, unshaded. */
  flat: (u0: number, v0: number, u1: number, v1: number, z: number, colour: number, alpha?: number) => void;
  /** A rectangle on a +v face (the one lit from the left) at `v`, across `a0..a1` in `u`. */
  onV: (v: number, a0: number, a1: number, z0: number, z1: number, colour: number, alpha?: number) => void;
  /** A rectangle on a +u face (the darker) at `u`, across `b0..b1` in `v`. */
  onU: (u: number, b0: number, b1: number, z0: number, z1: number, colour: number, alpha?: number) => void;
  /**
   * A strip `w` tiles wide from one point to another, for braces, cables and
   * anything else not along an axis. Cut to the column like everything else.
   */
  strut: (a: [number, number, number], b: [number, number, number], w: number, colour: number, alpha?: number) => void;
  /** A disc, `r` tiles across, standing in screen space at a point. */
  dot: (u: number, v: number, z: number, r: number, colour: number, alpha?: number) => void;
};

/** The tile a pen draws, by its column and row in the footprint; null for no clipping at all. */
export type Cell = { c: number; r: number } | null;

/**
 * A pen for one TILE of a footprint — column `c`, row `r` — whose local
 * origin is the world point `(ou, ov)` on ground `ground` half steps up, at
 * view scale `sc`. A null cell draws unclipped: for what stands clear above
 * the whole building, a crane's jib, drawn once in front of everything.
 * @see site
 *
 * A TILE AT A TIME, in that tile's own band. It was a column at a time in the
 * band of the column's front tile, and that filed the BACK of a deep building
 * as late as its front — over a house standing beside its back corner, which
 * is in front of that part of it and in an earlier band. Everything drawn in
 * a tile stays inside that tile's strip of the screen, so tiles drawn band by
 * band are drawn back to front.
 */
export function makePen(g: Graphics, ou: number, ov: number, ground: number, sc: number, cell: Cell): Pen {
  const P = (u: number, v: number, z: number): Pt => [
    (ou + u - (ov + v)) * HW * sc,
    (ou + u + ov + v) * HH * sc - (ground + z) * HEIGHT_UNIT * sc,
  ];
  const BIG = 1e9;
  const cu0 = cell ? cell.c : -BIG, cu1 = cell ? cell.c + 1 : BIG;
  const cv0 = cell ? cell.r : -BIG, cv1 = cell ? cell.r + 1 : BIG;
  const EPS = 1e-6;
  const poly = (pts: Pt[], colour: number, alpha = 1) => {
    g.poly(pts.flat());
    g.fill({ color: colour, alpha });
  };
  /** Whether a face standing at `u` (or `v`) is this tile's to draw: the tile it is the far edge of. */
  const ownsU = (u: number) => u > cu0 + EPS && u <= cu1 + EPS;
  const ownsV = (v: number) => v > cv0 + EPS && v <= cv1 + EPS;

  const flat: Pen["flat"] = (u0, v0, u1, v1, z, colour, alpha = 1) => {
    const a = Math.max(u0, cu0), b = Math.min(u1, cu1);
    const c = Math.max(v0, cv0), d = Math.min(v1, cv1);
    if (b <= a + EPS || d <= c + EPS) return;
    poly([P(a, c, z), P(b, c, z), P(b, d, z), P(a, d, z)], colour, alpha);
  };
  const onV: Pen["onV"] = (v, a0, a1, z0, z1, colour, alpha = 1) => {
    const a = Math.max(a0, cu0), b = Math.min(a1, cu1);
    if (!ownsV(v) || b <= a + EPS || z1 <= z0) return;
    poly([P(a, v, z1), P(b, v, z1), P(b, v, z0), P(a, v, z0)], colour, alpha);
  };
  const onU: Pen["onU"] = (u, b0, b1, z0, z1, colour, alpha = 1) => {
    const c = Math.max(b0, cv0), d = Math.min(b1, cv1);
    if (!ownsU(u) || d <= c + EPS || z1 <= z0) return;
    poly([P(u, c, z1), P(u, d, z1), P(u, d, z0), P(u, c, z0)], colour, alpha);
  };
  const box: Pen["box"] = (u0, v0, u1, v1, z0, z1, colour, o = {}) => {
    const a = Math.max(u0, cu0), b = Math.min(u1, cu1);
    const c = Math.max(v0, cv0), d = Math.min(v1, cv1);
    if (b <= a + EPS || d <= c + EPS || z1 <= z0) return;
    const alpha = o.alpha ?? 1;
    // The +u face, then the +v, then the top: the top's edges lie over both.
    if (ownsU(u1)) poly([P(u1, c, z1), P(u1, d, z1), P(u1, d, z0), P(u1, c, z0)], o.right ?? tone(colour, RIGHT), alpha);
    if (ownsV(v1)) poly([P(a, v1, z1), P(b, v1, z1), P(b, v1, z0), P(a, v1, z0)], colour, alpha);
    if (!o.noTop) poly([P(a, c, z1), P(b, c, z1), P(b, d, z1), P(a, d, z1)], o.top ?? tone(colour, TOP), alpha);
  };
  /** The part of a segment from `a` to `b`, as a range of its parameter, inside one slab of the tile. */
  const slab = (a: number, b: number, lo: number, hi: number, t: [number, number]): boolean => {
    const d = b - a;
    if (Math.abs(d) < EPS) return a > lo - EPS && a <= hi + EPS;
    const ta = (lo - a) / d, tb = (hi - a) / d;
    t[0] = Math.max(t[0], Math.min(ta, tb));
    t[1] = Math.min(t[1], Math.max(ta, tb));
    return t[1] > t[0] + EPS;
  };
  const strut: Pen["strut"] = (pa, pb, w, colour, alpha = 1) => {
    const t: [number, number] = [0, 1];
    if (!slab(pa[0], pb[0], cu0, cu1, t) || !slab(pa[1], pb[1], cv0, cv1, t)) return;
    const at = (k: number) => P(pa[0] + (pb[0] - pa[0]) * k, pa[1] + (pb[1] - pa[1]) * k, pa[2] + (pb[2] - pa[2]) * k);
    const [x0, y0] = at(t[0]), [x1, y1] = at(t[1]);
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 1e-3) return;
    const half = Math.max(0.5, (w * HW * sc) / 2);
    const nx = (-(y1 - y0) / len) * half, ny = ((x1 - x0) / len) * half;
    poly([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]], colour, alpha);
  };
  const dot: Pen["dot"] = (u, v, z, r, colour, alpha = 1) => {
    if (!ownsU(u) || !ownsV(v)) return;
    const [x, y] = P(u, v, z);
    g.circle(x, y, Math.max(0.6, r * HW * sc));
    g.fill({ color: colour, alpha });
  };
  return { P, cu0, cu1, sc, poly, box, flat, onV, onU, strut, dot };
}
