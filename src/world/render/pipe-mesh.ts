/**
 * World v2 — A MAIN AS A SOLID: the tube built as geometry, not drawn as
 * strokes. Each length is a ring of faces swept from one end to the other,
 * every vertex carrying the surface's normal, so a shader can light it from
 * the town's own sun — the top lit, the flank turned to the light paler, the
 * underside dark, a line of shine, an edge where it turns away. A bend, a
 * tee and a loose end get a ball where the lengths meet, until the real
 * fittings come. @see plans/pipe-rendering.md
 *
 * In the map's own space: `u` along x (N–S), `v` along y (E–W), `h` up, all
 * in tiles. A half step of height is `ZT` of a tile, so the projection here
 * is the one `P` in mains-layer uses, made metric — a ball looks round.
 *
 * Only the faces turned to the camera are written. Seen from one fixed
 * direction, a tube's near side is all there is, and with no depth buffer
 * that is also what keeps its far side from drawing over its near.
 */
import { HEIGHT_UNIT, HH, HW } from "../iso";
import { rgba } from "./quads";

/** On screen, px a tile of length in any level direction, at scale 1 — 66√2. */
export const K = HW * Math.SQRT2;
/** On screen, px a tile of height, at scale 1. The camera looks down at 30°: HH/HW is its sine. */
export const KZ = K * Math.sqrt(1 - (HH / HW) ** 2);
/** A half step of height, in tiles. */
export const ZT = HEIGHT_UNIT / KZ;
/** The direction to the camera, (u, v, h). */
export const VIEW = [Math.SQRT1_2 * (KZ / K), Math.SQRT1_2 * (KZ / K), HH / HW] as const;

/** Floats per vertex: x, y on screen; the normal's u, v, h; the colour, bit-cast. */
export const WORDS = 6;

/** A pipe mesh being built: its vertices, its triangles, and how much of each is written. */
export type PipeMesh = { f32: Float32Array; u32: Uint32Array; idx: Uint32Array; nv: number; ni: number };

export function pipeMesh(cap = 256): PipeMesh {
  const f32 = new Float32Array(cap * WORDS);
  return { f32, u32: new Uint32Array(f32.buffer), idx: new Uint32Array(cap * 3), nv: 0, ni: 0 };
}

/** Room for `v` more vertices and `i` more indices, doubling as it must. */
function room(m: PipeMesh, v: number, i: number) {
  if ((m.nv + v) * WORDS > m.f32.length) {
    let cap = m.f32.length / WORDS;
    while (cap < m.nv + v) cap *= 2;
    const f32 = new Float32Array(cap * WORDS);
    f32.set(m.f32);
    m.f32 = f32;
    m.u32 = new Uint32Array(f32.buffer);
  }
  if (m.ni + i > m.idx.length) {
    let cap = m.idx.length;
    while (cap < m.ni + i) cap *= 2;
    const idx = new Uint32Array(cap);
    idx.set(m.idx);
    m.idx = idx;
  }
}

/** One vertex: the point (u, v, h) at scale `s`, its normal, its packed colour. Returns its index. */
function vert(m: PipeMesh, s: number, u: number, v: number, h: number, nu: number, nv: number, nh: number, colour: number): number {
  const o = m.nv * WORDS;
  m.f32[o] = (u - v) * HW * s;
  m.f32[o + 1] = (u + v) * HH * s - h * KZ * s;
  m.f32[o + 2] = nu; m.f32[o + 3] = nv; m.f32[o + 4] = nh;
  m.u32[o + 5] = colour;
  return m.nv++;
}

const tri = (m: PipeMesh, a: number, b: number, c: number) => {
  m.idx[m.ni++] = a; m.idx[m.ni++] = b; m.idx[m.ni++] = c;
};

const facing = (nu: number, nv: number, nh: number) => nu * VIEW[0] + nv * VIEW[1] + nh * VIEW[2];

/**
 * A LENGTH OF TUBE from (au, av, ah) to (bu, bv, bh), radius `r` tiles, with
 * `sides` faces round it — those of them the camera sees.
 */
export function tube(
  m: PipeMesh, s: number,
  au: number, av: number, ah: number, bu: number, bv: number, bh: number,
  r: number, colour: number, sides: number,
) {
  const du = bu - au, dv = bv - av, dh = bh - ah;
  if (du === 0 && dv === 0 && dh === 0) return;
  const half = sides >> 1, first = m.nv;
  room(m, (half + 1) * 2, half * 6);
  const n = halfRing(du, dv, dh, half);
  for (let k = 0; k <= half; k++) {
    const nu = n[k * 3], nv = n[k * 3 + 1], nh = n[k * 3 + 2];
    vert(m, s, au + nu * r, av + nv * r, ah + nh * r, nu, nv, nh, colour);
    vert(m, s, bu + nu * r, bv + nv * r, bh + nh * r, nu, nv, nh, colour);
  }
  for (let k = 0; k < half; k++) {
    const a0 = first + k * 2, a1 = a0 + 1, b0 = a0 + 2, b1 = a0 + 3;
    tri(m, a0, a1, b1);
    tri(m, a0, b1, b0);
  }
}

/**
 * THE NEAR HALF OF A RING round a tube running along (du, dv, dh): `half` + 1
 * normals, from one edge of the tube as the camera sees it, over the side
 * facing the camera, to the other. Starting exactly on the silhouette, no
 * face is half turned away — a face that is folds back over the near side
 * and draws a dark streak along it.
 */
function halfRing(du: number, dv: number, dh: number, half: number): Float64Array {
  const len = Math.hypot(du, dv, dh);
  du /= len; dv /= len; dh /= len;
  // The silhouette: square to the tube and to the line of sight.
  let e1u = dv * VIEW[2] - dh * VIEW[1], e1v = dh * VIEW[0] - du * VIEW[2], e1h = du * VIEW[1] - dv * VIEW[0];
  const l1 = Math.hypot(e1u, e1v, e1h);
  e1u /= l1; e1v /= l1; e1h /= l1;
  // Toward the camera, square to the tube.
  const vd = VIEW[0] * du + VIEW[1] * dv + VIEW[2] * dh;
  let e2u = VIEW[0] - vd * du, e2v = VIEW[1] - vd * dv, e2h = VIEW[2] - vd * dh;
  const l2 = Math.hypot(e2u, e2v, e2h);
  e2u /= l2; e2v /= l2; e2h /= l2;
  const out = new Float64Array((half + 1) * 3);
  for (let k = 0; k <= half; k++) {
    const t = (k / half) * Math.PI, c = Math.cos(t), sn = Math.sin(t);
    out[k * 3] = c * e1u + sn * e2u; out[k * 3 + 1] = c * e1v + sn * e2v; out[k * 3 + 2] = c * e1h + sn * e2h;
  }
  return out;
}

/**
 * A BALL of radius `r` at (cu, cv, ch): the half of it facing the camera,
 * built round the line of sight so every face of it is a near one. Where a
 * bend, a tee or a loose end meets.
 */
export function ball(m: PipeMesh, s: number, cu: number, cv: number, ch: number, r: number, colour: number, sides: number) {
  const [wu, wv, wh] = VIEW;
  // Two axes square to the line of sight: one level, one up the screen.
  const au = Math.SQRT1_2, av = -Math.SQRT1_2, ah = 0;
  const bu = av * wh - ah * wv, bv = ah * wu - au * wh, bh = au * wv - av * wu;
  const rings = Math.max(2, sides >> 2);
  room(m, 1 + rings * sides, sides * 3 + (rings - 1) * sides * 6);
  const pole = vert(m, s, cu + wu * r, cv + wv * r, ch + wh * r, wu, wv, wh, colour);
  for (let q = 1; q <= rings; q++) {
    const phi = (q / rings) * (Math.PI / 2), cp = Math.cos(phi), sp = Math.sin(phi);
    for (let k = 0; k < sides; k++) {
      const t = (k / sides) * Math.PI * 2, c = Math.cos(t) * sp, sn = Math.sin(t) * sp;
      const nu = wu * cp + au * c + bu * sn, nv = wv * cp + av * c + bv * sn, nh = wh * cp + ah * c + bh * sn;
      vert(m, s, cu + nu * r, cv + nv * r, ch + nh * r, nu, nv, nh, colour);
    }
  }
  const at = (q: number, k: number) => pole + 1 + (q - 1) * sides + (k % sides);
  for (let k = 0; k < sides; k++) tri(m, pole, at(1, k), at(1, k + 1));
  for (let q = 1; q < rings; q++) {
    for (let k = 0; k < sides; k++) {
      tri(m, at(q, k), at(q + 1, k), at(q + 1, k + 1));
      tri(m, at(q, k), at(q + 1, k + 1), at(q, k + 1));
    }
  }
}

/**
 * One limb of a cell's tube: the way out (a unit step in u or v) and the
 * level, half steps, at the face — and, where it runs into a building's
 * port, the `wall` collar's colour, its fluid's: the main meets the wall there.
 */
export type Limb = { dx: number; dy: number; zf: number; wall?: number };

/** How a cell's main looks: its radius, tiles; its colours as `0xRRGGBB`; its faces round. */
export type PipeLook = {
  r: number;
  colour: number;
  sides: number;
  /** The fitting at a loose end; a dome where there is none, or a building of its own stands over it. */
  end?: Fitting | null;
  /** Flanges at its joins, and their bolts. */
  flanges?: boolean;
  bolts?: boolean;
  /** What it stands on, and the ground there, half steps. */
  support?: Support;
  floor?: number;
  /**
   * A straight run's glass window: how far it reaches either side of the
   * middle, tiles; its glass — or `null`, to leave the length open for the
   * glass and what is in it to be written each frame. @see windowGlass
   */
  window?: number;
  glass?: number | null;
  /** A band painted round a straight run's middle: an AI line's violet, a sewer's brown. */
  band?: number | null;
  /** The small parts, left off far away: an outlet's valve wheel, the frames round a window. */
  valve?: boolean;
  frames?: boolean;
};

/** What can stand at a main's loose end. @see MAIN_END */
export type Fitting = "cap" | "intake" | "pump" | "outlet" | "drain" | "outfall";

/** The fittings' paint. */
export const FITTING = {
  cap: 0xc0392b, grate: 0x3d4a57, pumpWall: 0x6f8fae, pumpRoof: 0xe0a23a, pumpDoor: 0x3e5872,
  wheel: 0x2b3440, valve: 0xb8463a, slop: 0x7a5230, mouth: 0x5a4030, bore: 0x1a120c,
} as const;
/** A window's frame and a painted band: how much wider than the tube, and how long, tiles. */
const FRAME_R = 1.12, FRAME_T = 0.035, BAND_R = 1.05, BAND_T = 0.09;

/** How far off a building's wall its port's collar stands, tiles: clear of the wall's face. */
const WALL_GAP = 0.03;

/** A pump house's walls, half their length in u and in v; its height at least, half steps. */
const PUMP_U = 0.22, PUMP_V = 0.18, PUMP_TALL = 2.6;
/** An intake's box, half its width, tiles. */
const INTAKE = 0.12;

/** A flange: how much wider than the tube, how thick, tiles; how many bolts round it. */
export const FLANGE_R = 1.4, FLANGE_T = 0.05, BOLTS = 6;
/** A bend's radius to its middle line, tiles: most of the half tile, so it reads as a sweep. */
export const BEND_R = 0.35;
/** A tee's weld collar: how much wider than the tube, and where along the stub, in tube radii. */
const COLLAR_R = 1.14, COLLAR_FROM = 0.85, COLLAR_TO = 1.2;

/** `colour` darkened to `k` of itself. */
const darker = (colour: number, k: number) =>
  (Math.round(((colour >> 16) & 255) * k) << 16) | (Math.round(((colour >> 8) & 255) * k) << 8) | Math.round((colour & 255) * k);

/**
 * An AXIS made whole: (du, dv, dh) to unit length, and the two across it — the
 * level one, and the one square to both, straight up for a level axis.
 */
function across3(du: number, dv: number, dh: number) {
  const l = Math.hypot(du, dv, dh);
  du /= l; dv /= l; dh /= l;
  const lp = Math.hypot(du, dv) || 1;
  const e1u = dv / lp, e1v = -du / lp;
  return { du, dv, dh, e1u, e1v, e2u: e1v * dh, e2v: -e1u * dh, e2h: e1u * dv - e1v * du };
}

/**
 * A FLAT RING square to the axis (du, dv, dh) — level unless it climbs: from
 * radius `rIn` to `rOut` round (cu, cv, ch), facing along the axis — if the
 * camera can see that side of it. A whole disc when `rIn` is 0.
 */
export function disc(
  m: PipeMesh, s: number, cu: number, cv: number, ch: number, du0: number, dv0: number,
  rIn: number, rOut: number, colour: number, sides: number, dh0 = 0,
) {
  // The same axes across it as a tube along it has, so its rings meet the tube's. @see tube
  const { du, dv, dh, e1u, e1v, e2u, e2v, e2h } = across3(du0, dv0, dh0);
  if (facing(du, dv, dh) <= 0) return;
  room(m, sides * 2 + 1, sides * 6);
  const ring = (rad: number) => {
    const first = m.nv;
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2, c = Math.cos(a) * rad, sn = Math.sin(a) * rad;
      vert(m, s, cu + e1u * c + e2u * sn, cv + e1v * c + e2v * sn, ch + e2h * sn, du, dv, dh, colour);
    }
    return first;
  };
  const outer = ring(rOut);
  if (rIn <= 0) {
    const mid = vert(m, s, cu, cv, ch, du, dv, dh, colour);
    for (let k = 0; k < sides; k++) tri(m, mid, outer + k, outer + ((k + 1) % sides));
    return;
  }
  const inner = ring(rIn);
  for (let k = 0; k < sides; k++) {
    const j = (k + 1) % sides;
    tri(m, outer + k, outer + j, inner + j);
    tri(m, outer + k, inner + j, inner + k);
  }
}

/**
 * A FLANGE where two lengths are bolted together, at (cu, cv, ch) across an
 * axis (du, dv, dh) — square to the tube, so tilted where it climbs — that
 * points to the camera's side: its rim, its face, and the bolts round the
 * face. `blind` closes it — a capped end.
 */
export function flange(
  m: PipeMesh, s: number, cu: number, cv: number, ch: number, du0: number, dv0: number,
  r: number, colour: number, sides: number, bolts: boolean, blind: boolean, dh0 = 0,
) {
  const { du, dv, dh, e1u, e1v, e2u, e2v, e2h } = across3(du0, dv0, dh0);
  const R = r * FLANGE_R, half = FLANGE_T / 2, c = solid(colour);
  const fu = cu + du * half, fv = cv + dv * half, fh = ch + dh * half;
  tube(m, s, cu - du * half, cv - dv * half, ch - dh * half, fu, fv, fh, R, c, sides);
  disc(m, s, fu, fv, fh, du, dv, blind ? 0 : r, R, c, sides, dh);
  if (!bolts || facing(du, dv, dh) <= 0) return;
  // THE BOLTS: on the face, between the bore and the rim — round the whole face of a blind one.
  const at = blind ? R * 0.72 : (r + R) / 2, size = Math.max(0.006, (R - r) * 0.36);
  const b = solid(darker(colour, 0.55));
  for (let k = 0; k < BOLTS; k++) {
    const a = ((k + 0.5) / BOLTS) * Math.PI * 2, cc = Math.cos(a) * at, sn = Math.sin(a) * at;
    disc(m, s, fu + du * 0.003 + e1u * cc + e2u * sn, fv + dv * 0.003 + e1v * cc + e2v * sn, fh + dh * 0.003 + e2h * sn, du, dv, 0, size, b, 6, dh);
  }
}

/**
 * A SWEEP: a tube along a path of points, each ring square to the path
 * there, the lengths between written farthest from the camera first — so a
 * bend's near side draws over its far. `ends`, the way it runs at its first
 * point and its last, where a neighbour's ring must meet them exactly.
 */
export function sweep(
  m: PipeMesh, s: number, path: readonly (readonly [number, number, number])[], r: number, colour: number, sides: number,
  ends?: readonly [readonly number[] | null, readonly number[] | null],
) {
  const n = path.length, half = sides >> 1, row = half + 1;
  room(m, n * row, (n - 1) * half * 6);
  const first = m.nv;
  for (let p = 0; p < n; p++) {
    const a = path[Math.max(0, p - 1)], b = path[Math.min(n - 1, p + 1)];
    const end = ends && (p === 0 ? ends[0] : p === n - 1 ? ends[1] : null);
    const ring = end ? halfRing(end[0], end[1], end[2], half) : halfRing(b[0] - a[0], b[1] - a[1], b[2] - a[2], half);
    for (let k = 0; k <= half; k++) {
      const nu = ring[k * 3], nv = ring[k * 3 + 1], nh = ring[k * 3 + 2];
      vert(m, s, path[p][0] + nu * r, path[p][1] + nv * r, path[p][2] + nh * r, nu, nv, nh, colour);
    }
  }
  const depth = (p: number) => facing(path[p][0] + path[p + 1][0], path[p][1] + path[p + 1][1], path[p][2] + path[p + 1][2]);
  const order = Array.from({ length: n - 1 }, (_, p) => p).sort((a, b) => depth(a) - depth(b));
  for (const p of order) {
    for (let k = 0; k < half; k++) {
      const a0 = first + p * row + k, a1 = a0 + row, b0 = a0 + 1, b1 = a1 + 1;
      tri(m, a0, a1, b1);
      tri(m, a0, b1, b0);
    }
  }
}

/** A point in the map's space, (u, v, h), h in tiles. */
type Pt = [number, number, number];

/**
 * HOW A MAIN CLIMBS. Where it meets the next cell, a limb runs along the line
 * between the two cells' middles — the same line seen from either side, so
 * the two rings there are one ring. Between that and its own middle the
 * height is a cubic: at the right slope at each end, never overshooting.
 */
/** A limb's slope at its face, outward, height over length: from this cell's middle to the next's. */
const faceSlope = (l: Limb, z: number) => 2 * (l.zf - z) * ZT;
/** Height along a cubic from `h0` at slope `m0` to `h1` at slope `m1`, `len` long, `t` of the way. */
const hermite = (h0: number, m0: number, h1: number, m1: number, len: number, t: number) => {
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * h0 + (t3 - 2 * t2 + t) * len * m0 + (-2 * t3 + 3 * t2) * h1 + (t3 - t2) * len * m1;
};
/** A main's slope in its middle, from `a` toward `b`, each `len` long from it: level at a crest or a dip, else between the two halves' slopes. */
function midSlope(z: number, a: Limb, la: number, b: Limb, lb: number): number {
  const sa = ((z - a.zf) * ZT) / la, sb = ((b.zf - z) * ZT) / lb;
  return sa * sb > 0 ? (2 * sa * sb) / (sa + sb) : 0;
}
/** How many lengths a curved half is cut into: more, the rounder its tube. */
const segsFor = (sides: number) => (sides >= 14 ? 6 : sides >= 10 ? 3 : 2);
/** How many lengths a bend's quarter circle is cut into: up close, enough that no flat shows on it. */
const arcSteps = (sides: number) => (sides >= 14 ? 12 : sides >= 10 ? 6 : 4);

/**
 * HALF A CELL'S MAIN, out along `l`: from `from` tiles out of the middle, at
 * slope `m` there (outward) — level where it meets a fitting or a run — to
 * the face. Points from the inside out, and the way it runs at the face.
 */
function halfPath(x: number, y: number, z: number, l: Limb, from: number, m: number, sides: number): { path: Pt[]; out: number[] } {
  const h = z * ZT, hf = l.zf * ZT, sf = faceSlope(l, z);
  // A straight line when the slopes all agree: one length.
  const straight = Math.abs(m * 0.5 - (hf - h)) < 1e-9 && Math.abs(sf * 0.5 - (hf - h)) < 1e-9;
  const n = straight ? 1 : segsFor(sides), t0 = from / 0.5, path: Pt[] = [];
  for (let k = 0; k <= n; k++) {
    const t = t0 + (1 - t0) * (k / n), d = t * 0.5;
    path.push([x + l.dx * d, y + l.dy * d, hermite(h, m, hf, sf, 0.5, t)]);
  }
  return { path, out: [l.dx, l.dy, sf] };
}

/** A STRAIGHT RUN from face `a` through the middle to face `b`, and the way it runs at each end. */
function runPath(x: number, y: number, z: number, a: Limb, b: Limb, sides: number): { path: Pt[]; ends: [number[], number[]] } {
  const m = midSlope(z, a, 0.5, b, 0.5);
  const pa = halfPath(x, y, z, a, 0, -m, sides), pb = halfPath(x, y, z, b, 0, m, sides);
  return { path: [...pa.path.reverse(), ...pb.path.slice(1)], ends: [pa.out.map((c) => -c), pb.out] };
}

/**
 * A BEND'S PATH, (u, v, h) points: in from face `a` straight to where the
 * bend starts, round a quarter circle of radius BEND_R, and straight out to
 * face `b` — climbing along the whole of it, as a run does, at `h` in its
 * middle. With the way it runs at each end.
 */
export function bendPath(x: number, y: number, z: number, a: Limb, b: Limb, steps = 6): { path: Pt[]; ends: [number[], number[]] } {
  const level = a.zf === z && b.zf === z;
  // The plan: the straights in and out cut in two where it climbs, so their slope can change along them.
  const lead = 0.5 - BEND_R, plan: [number, number][] = [[x + a.dx * 0.5, y + a.dy * 0.5]];
  if (!level) plan.push([x + a.dx * (BEND_R + lead / 2), y + a.dy * (BEND_R + lead / 2)]);
  // The circle's middle sits BEND_R out along both limbs.
  const ou = x + (a.dx + b.dx) * BEND_R, ov = y + (a.dy + b.dy) * BEND_R;
  for (let k = 0; k <= steps; k++) {
    // From the point on limb a (the middle less b) round to the point on limb b (the middle less a).
    const t = (k / steps) * (Math.PI / 2), c = Math.cos(t), sn = Math.sin(t);
    plan.push([ou - b.dx * BEND_R * c - a.dx * BEND_R * sn, ov - b.dy * BEND_R * c - a.dy * BEND_R * sn]);
  }
  if (!level) plan.push([x + b.dx * (BEND_R + lead / 2), y + b.dy * (BEND_R + lead / 2)]);
  plan.push([x + b.dx * 0.5, y + b.dy * 0.5]);
  // Heights by the length along it: a cubic either side of its middle.
  const along = [0];
  for (let k = 1; k < plan.length; k++) along.push(along[k - 1] + Math.hypot(plan[k][0] - plan[k - 1][0], plan[k][1] - plan[k - 1][1]));
  const L = along[along.length - 1], half = L / 2, h = z * ZT;
  const m = midSlope(z, a, half, b, half), sa = -faceSlope(a, z), sb = faceSlope(b, z);
  const path = plan.map(([u, v], k): Pt => {
    const s = along[k];
    return [u, v, s <= half ? hermite(a.zf * ZT, sa, h, m, half, s / half) : hermite(h, m, b.zf * ZT, sb, half, (s - half) / half)];
  });
  return { path, ends: [[-a.dx, -a.dy, sa], [b.dx, b.dy, sb]] };
}

/** A BEND'S PATH alone. @see bendPath */
export const elbowPath = (x: number, y: number, h: number, a: Limb, b: Limb, steps = 6): Pt[] => bendPath(x, y, h / ZT, a, b, steps).path;

const far = (l: Limb) => l.dx + l.dy < 0;
const across = (a: Limb, b: Limb) => a.dx === -b.dx && a.dy === -b.dy;

/**
 * A CELL'S SHAPE: a bend, or a run straight through — along u where there
 * is one, for a cross — and the stubs off it. A loose end is a run of one.
 */
function shape(limbs: readonly Limb[]): { bend: boolean; run: Limb[]; stubs: Limb[] } {
  if (limbs.length === 2 && !across(limbs[0], limbs[1])) return { bend: true, run: [...limbs], stubs: [] };
  if (limbs.length < 2) return { bend: false, run: [...limbs], stubs: [] };
  const through = limbs.filter((l) => limbs.some((o) => across(l, o)));
  const run = through.length > 2 ? through.filter((l) => l.dx !== 0) : through;
  // The far end first, so a run's path goes away from the camera to toward it.
  run.sort((a, b) => (a.dx + a.dy) - (b.dx + b.dy));
  return { bend: false, run, stubs: limbs.filter((l) => !run.includes(l)) };
}

/** The middle line of each length a cell's main is made of, as paths of points. */
export function cellPaths(x: number, y: number, h: number, limbs: readonly Limb[], r: number, sides = 14): Pt[][] {
  const z = h / ZT;
  const { bend, run, stubs } = shape(limbs);
  if (bend) return [bendPath(x, y, z, run[0], run[1], arcSteps(sides)).path];
  const out: Pt[][] = [];
  if (run.length === 2) out.push(runPath(x, y, z, run[0], run[1], sides).path);
  else if (run.length === 1) {
    const p = halfPath(x, y, z, run[0], 0, 0, sides).path;
    out.push(far(run[0]) ? p.reverse() : p);
  }
  for (const l of stubs) out.push(halfPath(x, y, z, l, r, 0, sides).path);
  return out;
}

/**
 * THE SUN, a unit (u, v, h) toward it: high, and from the camera's left —
 * a box's top lit, its left face (+v) next, its right (+u) in shade, as the
 * Kenney buildings are. The shader lights by it.
 */
export const SUN: readonly [number, number, number] = (() => {
  const l = [-0.4, 0.35, 1], n = Math.hypot(...l);
  return [l[0] / n, l[1] / n, l[2] / n];
})();
/** Concrete, for what a main rests on. */
export const CONCRETE = 0xc9c4b8;
/** A saddle's length along the tube; a frame's legs, square, and its beam's depth, tiles. */
const SADDLE = 0.1, LEG = 0.05, BEAM = 0.05;

/** One flat face, its four corners in order round it, all facing `n`. */
function quad(m: PipeMesh, s: number, q: readonly Pt[], nu: number, nv: number, nh: number, colour: number) {
  room(m, 4, 6);
  const a = vert(m, s, q[0][0], q[0][1], q[0][2], nu, nv, nh, colour);
  for (let k = 1; k < 4; k++) vert(m, s, q[k][0], q[k][1], q[k][2], nu, nv, nh, colour);
  tri(m, a, a + 1, a + 2);
  tri(m, a, a + 2, a + 3);
}

/** A SOLID BOX in the map's axes: the three faces the camera sees — its top, and its +u and +v sides. */
export function box(m: PipeMesh, s: number, u0: number, v0: number, h0: number, u1: number, v1: number, h1: number, colour: number) {
  if (h1 <= h0) return;
  quad(m, s, [[u1, v0, h1], [u1, v1, h1], [u1, v1, h0], [u1, v0, h0]], 1, 0, 0, colour);
  quad(m, s, [[u0, v1, h1], [u1, v1, h1], [u1, v1, h0], [u0, v1, h0]], 0, 1, 0, colour);
  quad(m, s, [[u0, v0, h1], [u1, v0, h1], [u1, v1, h1], [u0, v1, h1]], 0, 0, 1, colour);
}

/**
 * WHERE A CELL'S MAIN IS HELD UP: under the middle of its run, or of its
 * bend's curve; and which way the tube runs there, if it is straight.
 */
function supportAt(x: number, y: number, h: number, limbs: readonly Limb[]): { u: number; v: number; along: "u" | "v" | null } {
  const { bend, run } = shape(limbs);
  if (bend) {
    const path = bendPath(x, y, h / ZT, run[0], run[1]).path;
    const [u, v] = path[path.length >> 1];
    return { u, v, along: null };
  }
  const l = run[0];
  return { u: x, v: y, along: !l ? null : l.dx !== 0 ? "u" : "v" };
}

/** What a cell's main stands on: a saddle on the ground, a frame of legs and a beam where it rides high, or nothing. */
export type Support = "saddle" | "frame" | "none";

/** A saddle's footprint, (u0, v0, u1, v1): short along the tube, a little narrower than it across. */
function saddle(at: { u: number; v: number; along: "u" | "v" | null }, r: number): [number, number, number, number] {
  const du = at.along === "u" ? SADDLE / 2 : r * 0.8, dv = at.along === "v" ? SADDLE / 2 : r * 0.8;
  return [at.u - du, at.v - dv, at.u + du, at.v + dv];
}

/** A frame's two legs, far one first: either side of the tube, across it. */
function legs(at: { u: number; v: number; along: "u" | "v" | null }, r: number): [number, number, number, number][] {
  const off = r + LEG, half = LEG / 2;
  // Across a run along u, the legs stand either side in v — the +v one nearer the camera; and the other way about.
  const [au, av] = at.along === "u" ? [0, 1] : [1, 0];
  return [-1, 1].map((k) => {
    const cu = at.u + au * off * k, cv = at.v + av * off * k;
    return [cu - half, cv - half, cu + half, cv + half];
  });
}

/**
 * A CELL'S MAIN as a solid, at `z` half steps in its middle, joined out
 * along `limbs`: a straight run, a bend, a tee (a run with a stub welded on),
 * a cross, or a loose end — capped, or domed under the fitting there. A
 * flange at each join on its far side (each join is some cell's far side,
 * so each is drawn once), written before the length that meets it; and what
 * it stands on, under it, on the ground at `look.floor`.
 */
export function pipeCell(m: PipeMesh, s: number, x: number, y: number, z: number, limbs: readonly Limb[], look: PipeLook) {
  const h = z * ZT, { r, sides } = look, c = solid(look.colour);
  const face = (l: Limb): Pt => [x + l.dx * 0.5, y + l.dy * 0.5, l.zf * ZT];
  // A LIMB ALONE, from `from` out of the middle — level there — to its face.
  const length = (l: Limb, from = 0) => {
    const { path, out } = halfPath(x, y, z, l, from, 0, sides);
    if (far(l)) sweep(m, s, path.reverse(), r, c, sides, [out.map((k) => -k), null]);
    else sweep(m, s, path, r, c, sides, [null, out]);
  };
  // A STUB'S COLLAR, where it is welded to the run.
  const collar = (l: Limb) => {
    tube(m, s, x + l.dx * r * COLLAR_FROM, y + l.dy * r * COLLAR_FROM, h, x + l.dx * r * COLLAR_TO, y + l.dy * r * COLLAR_TO, h, r * COLLAR_R, c, sides);
    disc(m, s, x + l.dx * r * COLLAR_TO, y + l.dy * r * COLLAR_TO, h, l.dx, l.dy, r, r * COLLAR_R, c, sides);
  };
  const stub = (l: Limb) => {
    if (far(l)) { length(l, r * COLLAR_TO); collar(l); } else { collar(l); length(l, r * COLLAR_TO); }
  };

  // A PORT'S COLLAR where a limb meets a building's wall: in its fluid's colour, on whichever side.
  const wall = (l: Limb) => {
    const [fu, fv, fh] = face(l);
    flange(m, s, fu - l.dx * WALL_GAP, fv - l.dy * WALL_GAP, fh, -l.dx, -l.dy, r, l.wall!, sides, look.bolts !== false, false, -faceSlope(l, z));
  };
  for (const l of limbs) {
    if (!far(l)) continue;
    if (l.wall !== undefined) { wall(l); continue; }
    if (look.flanges === false) continue;
    const [fu, fv, fh] = face(l);
    // Square to the tube there: tilted with it where it climbs.
    flange(m, s, fu, fv, fh, -l.dx, -l.dy, r, look.colour, sides, look.bolts !== false, false, -faceSlope(l, z));
  }

  // WHAT IT STANDS ON: a saddle up to its underside; or the far leg and the beam of a frame, its near leg after the tube.
  const support = look.support ?? "none", g = (look.floor ?? 0) * ZT, concrete = solid(CONCRETE);
  const at = supportAt(x, y, h, limbs);
  let nearLeg: [number, number, number, number] | null = null;
  if (support === "saddle" && limbs.length) {
    const [u0, v0, u1, v1] = saddle(at, r);
    box(m, s, u0, v0, g, u1, v1, h - r * 0.5, concrete);
  } else if (support === "frame" && limbs.length) {
    const [farLeg, near] = legs(at, r), top = h - r - BEAM;
    box(m, s, farLeg[0], farLeg[1], g, farLeg[2], farLeg[3], top, concrete);
    const span = r + LEG * 1.5;
    const [du, dv] = at.along === "u" ? [BEAM / 2, span] : [span, BEAM / 2];
    box(m, s, at.u - du, at.v - dv, top, at.u + du, at.v + dv, h - r, concrete);
    nearLeg = near;
  }

  const { bend, run, stubs } = shape(limbs);
  const kind = look.end ?? null;
  if (limbs.length === 0) {
    // A LONE FITTING, joined to nothing yet: as if its main came in from the far side.
    if (kind) fitting(m, s, kind, x, y, h, g, 1, 0, look); else ball(m, s, x, y, h, r, c, sides);
  } else if (limbs.length === 1) {
    // A LOOSE END: its fitting, facing out the way the main ends — the length reaching only to a house's wall — or a dome.
    const l = limbs[0];
    const wall = kind === "pump" ? (l.dx ? PUMP_U : PUMP_V) : kind === "intake" ? INTAKE : 0;
    const end = () => kind ? fitting(m, s, kind, x, y, h, g, -l.dx, -l.dy, look) : ball(m, s, x, y, h, r, c, sides);
    if (far(l)) { length(l, wall); end(); } else { end(); length(l, wall); }
    if (kind === "outlet" && look.valve !== false) valve(m, s, x, y, h, r);
  } else if (bend) {
    const { path, ends } = bendPath(x, y, z, run[0], run[1], arcSteps(sides));
    sweep(m, s, path, r, c, sides, ends);
  } else {
    for (const l of stubs) if (far(l)) stub(l);
    const [a, b] = [face(run[0]), face(run[1])];
    const win = look.window ?? 0;
    if (win > 0 && run.length === 2 && !stubs.length) {
      // A WINDOW: steel to its far frame, glass between its frames, steel on; then the frames round the joins.
      const [w0, w1] = windowSpan(x, y, z, run[0], run[1], win);
      tube(m, s, a[0], a[1], a[2], w0[0], w0[1], w0[2], r, c, sides);
      if (look.glass !== null) tube(m, s, w0[0], w0[1], w0[2], w1[0], w1[1], w1[2], r, solid(look.glass ?? 0xcfe6f2), sides);
      tube(m, s, w1[0], w1[1], w1[2], b[0], b[1], b[2], r, c, sides);
      const du = w1[0] - w0[0], dv = w1[1] - w0[1], dh = w1[2] - w0[2];
      if (look.frames !== false) for (const p of [w0, w1]) hoop(m, s, p, du, dv, r, r * FRAME_R, FRAME_T, c, sides, dh);
    } else {
      // The run as one sweep, far face to near, curving where it changes slope.
      const { path, ends } = runPath(x, y, z, run[0], run[1], sides);
      sweep(m, s, path, r, c, sides, ends);
      const slope = midSlope(z, run[0], 0.5, run[1], 0.5);
      if (look.band != null) hoop(m, s, [x, y, h], -run[0].dx, -run[0].dy, r, r * BAND_R, BAND_T, solid(look.band), sides, slope);
    }
    for (const l of stubs) if (!far(l)) stub(l);
  }
  for (const l of limbs) if (l.wall !== undefined && !far(l)) wall(l);
  if (nearLeg) box(m, s, nearLeg[0], nearLeg[1], g, nearLeg[2], nearLeg[3], h - r - BEAM, concrete);
}

/**
 * A HOOP round a tube at `p`, the tube running along (du, dv, dh): a
 * short wider length, and its face on the camera's side. A window's frame,
 * a painted band.
 */
function hoop(m: PipeMesh, s: number, p: readonly number[], du0: number, dv0: number, r: number, rr: number, len: number, colour: number, sides: number, dh0 = 0) {
  const { du, dv, dh } = across3(du0, dv0, dh0), half = len / 2;
  tube(m, s, p[0] - du * half, p[1] - dv * half, p[2] - dh * half, p[0] + du * half, p[1] + dv * half, p[2] + dh * half, rr, colour, sides);
  // One of the two faces is toward the camera; disc draws only that one.
  for (const k of [1, -1]) disc(m, s, p[0] + du * half * k, p[1] + dv * half * k, p[2] + dh * half * k, du * k, dv * k, r, rr, colour, sides, dh * k);
}

/** A FLAT RING lying level, (cu, cv, ch), from `rIn` to `rOut` — a handwheel, seen from above. */
function hring(m: PipeMesh, s: number, cu: number, cv: number, ch: number, rIn: number, rOut: number, colour: number, sides: number) {
  room(m, sides * 2, sides * 6);
  const first = m.nv;
  for (let k = 0; k < sides; k++) {
    const a = (k / sides) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
    vert(m, s, cu + c * rOut, cv + sn * rOut, ch, 0, 0, 1, colour);
    vert(m, s, cu + c * rIn, cv + sn * rIn, ch, 0, 0, 1, colour);
  }
  for (let k = 0; k < sides; k++) {
    const a = first + k * 2, b = first + ((k + 1) % sides) * 2;
    tri(m, a, b, b + 1);
    tri(m, a, b + 1, a + 1);
  }
}

/**
 * WHERE A WINDOW IS: its two ends, the far one first, `win` tiles either side
 * of the middle of a straight run from the `far` limb's face to the `near` one's.
 */
export function windowSpan(x: number, y: number, z: number, far: Limb, near: Limb, win: number): [Pt, Pt] {
  const h = z * ZT;
  const at = (l: Limb): Pt => {
    const q = win / 0.5;
    return [x + l.dx * 0.5 * q, y + l.dy * 0.5 * q, h + (l.zf * ZT - h) * q];
  };
  return [at(far), at(near)];
}

/** Up the screen, square to the line of sight, in the map's axes: where the top of a tube is seen. @see pipe-gpu */
const UP = (() => {
  const c = Math.sqrt(1 - (HH / HW) ** 2);
  return [-Math.SQRT1_2 * (HH / HW), -Math.SQRT1_2 * (HH / HW), c] as const;
})();

/** What a window shows: its fill's colour; marks along it, -1 to 1, in their colour — streaks on water, or lumps in slop. */
export type WindowFill = { colour: number; marks: readonly number[]; mark: number; lumps: boolean };
/** The fill inside the glass, and a streak's length and a lump's size, shares of the tube's radius. */
const FILL_R = 0.8, STREAK = 1.1, STREAK_R = 0.16, LUMP_R = 0.28;

/**
 * A WINDOW'S GLASS, AND WHAT IS IN IT, from `w0` to `w1`, written each frame:
 * the water a lit tube inside the glass, streaks of light running along the
 * top of it, or slop with lumps sliding down it; then the glass itself over
 * all of that, tinted and mostly clear. `inset` keeps clear of the frames.
 */
export function windowGlass(
  m: PipeMesh, s: number, w0: readonly number[], w1: readonly number[], inset: number,
  r: number, sides: number, fill: WindowFill | null, glass: number, clear: number,
) {
  const len = Math.hypot(w1[0] - w0[0], w1[1] - w0[1], w1[2] - w0[2]);
  const du = (w1[0] - w0[0]) / len, dv = (w1[1] - w0[1]) / len, dh = (w1[2] - w0[2]) / len;
  const at = (k: number, lift = 0): Pt => {
    const q = 0.5 + k * (0.5 - inset / len);
    return [w0[0] + (w1[0] - w0[0]) * q + top[0] * lift, w0[1] + (w1[1] - w0[1]) * q + top[1] * lift, w0[2] + (w1[2] - w0[2]) * q + top[2] * lift];
  };
  // Square to the tube, toward the top of it as the camera sees it.
  const d = UP[0] * du + UP[1] * dv + UP[2] * dh;
  const tu = UP[0] - d * du, tv = UP[1] - d * dv, th = UP[2] - d * dh, tl = Math.hypot(tu, tv, th) || 1;
  const top = [tu / tl, tv / tl, th / tl];
  if (fill) {
    const a = at(-1), b = at(1), rf = r * FILL_R;
    tube(m, s, a[0], a[1], a[2], b[0], b[1], b[2], rf, solid(fill.colour), sides);
    const mark = solid(fill.mark), half = (STREAK * rf) / Math.max(1e-6, len - 2 * inset);
    for (const k of fill.marks) {
      if (fill.lumps) {
        const p = at(Math.max(-0.85, Math.min(0.85, k)), rf * 0.35);
        ball(m, s, p[0], p[1], p[2], r * LUMP_R, mark, Math.max(6, sides >> 1));
        continue;
      }
      // A streak, cut off where the glass ends.
      const k0 = Math.max(-1, k - half), k1 = Math.min(1, k + half);
      if (k1 - k0 < half * 0.25) continue;
      const p = at(k0, rf * 0.7), q = at(k1, rf * 0.7);
      tube(m, s, p[0], p[1], p[2], q[0], q[1], q[2], r * STREAK_R, mark, Math.max(6, sides >> 1));
    }
  }
  const a = at(-1), b = at(1);
  tube(m, s, a[0], a[1], a[2], b[0], b[1], b[2], r, rgba(glass, clear), sides);
}

/** A window's frame, half its length, tiles: what the glass keeps clear of, either end. */
export const FRAME_HALF = FRAME_T / 2;

/** AN OUTLET'S VALVE: a stem up out of the top of the tube, and a red handwheel on it. */
export function valve(m: PipeMesh, s: number, x: number, y: number, h: number, r: number) {
  const top = h + r + 0.07, steel = solid(FITTING.wheel), red = solid(FITTING.valve);
  box(m, s, x - 0.012, y - 0.012, h + r * 0.8, x + 0.012, y + 0.012, top, steel);
  hring(m, s, x, y, top, 0.045, 0.062, red, 16);
  box(m, s, x - 0.018, y - 0.018, top, x + 0.018, y + 0.018, top + 0.01, red);
}

/**
 * THE FITTING at a main's loose end, at (x, y, h) on ground at `g`, the end
 * facing out along (ou, ov):
 * - a cap: a red blind flange;
 * - an intake: a concrete box down into the water, grated on top;
 * - a pump house, where no pump building stands: walls, an amber roof, a door, a wheel on its side;
 * - an outlet, at a building, and a drain, at a workplace's slop port: the
 *   building's nozzle reaches out to meet the main, its lip the joint, so
 *   here only the knuckle where they turn into each other — and an outlet's
 *   valve, which goes on after the tube;
 * - an outfall over the bank: a flared mouth, dark inside, on a post down to the water.
 */
function fitting(m: PipeMesh, s: number, kind: Fitting, x: number, y: number, h: number, g: number, ou: number, ov: number, look: PipeLook) {
  const { r, sides } = look, bolts = look.bolts !== false, concrete = solid(CONCRETE);
  switch (kind) {
    case "cap":
      flange(m, s, x, y, h, ou, ov, r, FITTING.cap, sides, bolts, true);
      return;
    case "outlet":
    case "drain":
      ball(m, s, x, y, h, r, solid(look.colour), sides);
      return;
    case "outfall": {
      box(m, s, x - 0.03, y - 0.03, g - 0.12, x + 0.03, y + 0.03, h - r, concrete);
      flange(m, s, x, y, h, ou, ov, r * 1.05, FITTING.mouth, sides, false, false);
      const lip = FLANGE_T / 2 + 0.002;
      disc(m, s, x + ou * lip, y + ov * lip, h, ou, ov, 0, r * 1.05, solid(FITTING.bore), sides);
      return;
    }
    case "intake": {
      const top = h + r * 0.9, grate = solid(FITTING.grate), bar = solid(look.colour);
      box(m, s, x - INTAKE, y - INTAKE, g - 0.1, x + INTAKE, y + INTAKE, top, concrete);
      const i = INTAKE - 0.025;
      box(m, s, x - i, y - i, top, x + i, y + i, top + 0.004, grate);
      for (const k of [-0.5, 0, 0.5]) box(m, s, x - i, y + k * i - 0.008, top + 0.004, x + i, y + k * i + 0.008, top + 0.012, bar);
      return;
    }
    case "pump": {
      const top = Math.max(h + r * 2, g + PUMP_TALL * ZT), o = 0.03;
      box(m, s, x - PUMP_U, y - PUMP_V, g, x + PUMP_U, y + PUMP_V, top, solid(FITTING.pumpWall));
      // Its door, on the +v wall; its wheel, on the +u.
      box(m, s, x - 0.06, y + PUMP_V, g, x + 0.06, y + PUMP_V + 0.006, g + (top - g) * 0.6, solid(FITTING.pumpDoor));
      const mid = (g + top) / 2, wheel = solid(FITTING.wheel);
      disc(m, s, x + PUMP_U + 0.004, y, mid, 1, 0, 0.045, 0.065, wheel, 16);
      disc(m, s, x + PUMP_U + 0.004, y, mid, 1, 0, 0, 0.016, wheel, 8);
      box(m, s, x - PUMP_U - o, y - PUMP_V - o, top, x + PUMP_U + o, y + PUMP_V + o, top + 0.07, solid(FITTING.pumpRoof));
      return;
    }
  }
}

/**
 * A BUILDING'S PORT: a nozzle out of its wall, from the wall of the cell
 * at (x, y) — the building on the far side of it, along (−dx, −dy) — in
 * its fluid's colour: a steel collar at the wall, a lip at the mouth. Open,
 * with no main joined to it, it stops short of the cell's middle, dark
 * inside; joined, it reaches the middle, where the main ends, and its lip is
 * the joint. Part of the building, joined to or not.
 */
export function nozzle(
  m: PipeMesh, s: number, x: number, y: number, z: number, dx: number, dy: number,
  r: number, colour: number, steel: number, sides: number, open = true,
) {
  const h = z * ZT, c = solid(colour);
  const short = open ? 0.12 : 0;
  const wu = x - dx * 0.5, wv = y - dy * 0.5, mu = x - dx * short, mv = y - dy * short;
  const toward = facing(dx, dy, 0) > 0;
  const collar = () => flange(m, s, wu + dx * 0.03, wv + dy * 0.03, h, dx, dy, r, steel, sides, false, false);
  const lip = () => {
    flange(m, s, mu, mv, h, dx, dy, r, colour, sides, false, false);
    if (!open) return;
    const o = FLANGE_T / 2 + 0.002;
    disc(m, s, mu + dx * o, mv + dy * o, h, dx, dy, 0, r * 0.95, solid(FITTING.bore), sides);
  };
  if (toward) { collar(); tube(m, s, wu, wv, h, mu, mv, h, r * 0.85, c, sides); lip(); }
  else { lip(); tube(m, s, mu, mv, h, wu, wv, h, r * 0.85, c, sides); collar(); }
}

/** `0xRRGGBB`, opaque, as a vertex word. */
export const solid = (colour: number) => rgba(colour, 1);
