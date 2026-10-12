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
 * ONE COLUMN AT A TIME. A building is drawn as a Graphics per column of its
 * footprint, each filed in that column's front band, so that a house in front
 * of one end of a long building can still stand in front of it. Everything
 * here is clipped to the column it is drawing: tops and +v faces to its span,
 * a +u face only in the column it stands in. @see project-renderer
 *
 * LOCAL COORDINATES: `u` across the footprint from 0 to its width, `v` from 0
 * to its depth, `z` in half steps above the ground it stands on. Column `c`
 * is `c <= u <= c + 1`.
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

/**
 * A pen for column `c` of a footprint whose local origin is the world point
 * `(ou, ov)` on ground `ground` half steps up, at view scale `sc`. A `c` of
 * null draws unclipped: for what stands clear above the whole building, a
 * crane's jib, drawn once in front of every column. @see site
 */
export function makePen(g: Graphics, ou: number, ov: number, ground: number, sc: number, c: number | null): Pen {
  const P = (u: number, v: number, z: number): Pt => [
    (ou + u - (ov + v)) * HW * sc,
    (ou + u + ov + v) * HH * sc - (ground + z) * HEIGHT_UNIT * sc,
  ];
  const cu0 = c ?? -1e9, cu1 = c === null ? 1e9 : c + 1;
  const EPS = 1e-6;
  const poly = (pts: Pt[], colour: number, alpha = 1) => {
    g.poly(pts.flat());
    g.fill({ color: colour, alpha });
  };
  /** Whether a +u face at `u` is this column's to draw. */
  const ownsU = (u: number) => u > cu0 + EPS && u <= cu1 + EPS;

  const flat: Pen["flat"] = (u0, v0, u1, v1, z, colour, alpha = 1) => {
    const a = Math.max(u0, cu0), b = Math.min(u1, cu1);
    if (b <= a + EPS || v1 <= v0) return;
    poly([P(a, v0, z), P(b, v0, z), P(b, v1, z), P(a, v1, z)], colour, alpha);
  };
  const onV: Pen["onV"] = (v, a0, a1, z0, z1, colour, alpha = 1) => {
    const a = Math.max(a0, cu0), b = Math.min(a1, cu1);
    if (b <= a + EPS || z1 <= z0) return;
    poly([P(a, v, z1), P(b, v, z1), P(b, v, z0), P(a, v, z0)], colour, alpha);
  };
  const onU: Pen["onU"] = (u, b0, b1, z0, z1, colour, alpha = 1) => {
    if (!ownsU(u) || b1 <= b0 || z1 <= z0) return;
    poly([P(u, b0, z1), P(u, b1, z1), P(u, b1, z0), P(u, b0, z0)], colour, alpha);
  };
  const box: Pen["box"] = (u0, v0, u1, v1, z0, z1, colour, o = {}) => {
    const a = Math.max(u0, cu0), b = Math.min(u1, cu1);
    if (b <= a + EPS || z1 <= z0 || v1 <= v0) return;
    const alpha = o.alpha ?? 1;
    // The +u face, then the +v, then the top: the top's edges lie over both.
    if (ownsU(u1)) poly([P(u1, v0, z1), P(u1, v1, z1), P(u1, v1, z0), P(u1, v0, z0)], o.right ?? tone(colour, RIGHT), alpha);
    poly([P(a, v1, z1), P(b, v1, z1), P(b, v1, z0), P(a, v1, z0)], colour, alpha);
    if (!o.noTop) poly([P(a, v0, z1), P(b, v0, z1), P(b, v1, z1), P(a, v1, z1)], o.top ?? tone(colour, TOP), alpha);
  };
  const strut: Pen["strut"] = (pa, pb, w, colour, alpha = 1) => {
    // The part of the segment inside the column, by its `u`.
    let t0 = 0, t1 = 1;
    const du = pb[0] - pa[0];
    if (Math.abs(du) < EPS) {
      if (!(pa[0] > cu0 - EPS && pa[0] <= cu1 + EPS)) return;
    } else {
      const ta = (cu0 - pa[0]) / du, tb = (cu1 - pa[0]) / du;
      t0 = Math.max(0, Math.min(ta, tb));
      t1 = Math.min(1, Math.max(ta, tb));
      if (t1 <= t0 + EPS) return;
    }
    const at = (t: number) => P(pa[0] + du * t, pa[1] + (pb[1] - pa[1]) * t, pa[2] + (pb[2] - pa[2]) * t);
    const [x0, y0] = at(t0), [x1, y1] = at(t1);
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 1e-3) return;
    const half = Math.max(0.5, (w * HW * sc) / 2);
    const nx = (-(y1 - y0) / len) * half, ny = ((x1 - x0) / len) * half;
    poly([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]], colour, alpha);
  };
  const dot: Pen["dot"] = (u, v, z, r, colour, alpha = 1) => {
    if (!(u > cu0 - EPS && u <= cu1 + EPS)) return;
    const [x, y] = P(u, v, z);
    g.circle(x, y, Math.max(0.6, r * HW * sc));
    g.fill({ color: colour, alpha });
  };
  return { P, cu0, cu1, sc, poly, box, flat, onV, onU, strut, dot };
}
