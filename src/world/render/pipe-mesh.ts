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

/** One limb of a cell's tube: the way out (a unit step in u or v) and the level, half steps, at the face. */
export type Limb = { dx: number; dy: number; zf: number };

/** How a cell's main looks: its radius, tiles; its colours as `0xRRGGBB`; its faces round. */
export type PipeLook = {
  r: number;
  colour: number;
  sides: number;
  /** A blind flange's paint, where the main is capped; a dome otherwise. */
  cap?: number | null;
  /** Flanges at its joins, and their bolts. */
  flanges?: boolean;
  bolts?: boolean;
};

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
 * A FLAT RING square to a level axis (du, dv): from radius `rIn` to `rOut`
 * round (cu, cv, ch), facing along the axis — if the camera can see that
 * side of it. A whole disc when `rIn` is 0.
 */
export function disc(
  m: PipeMesh, s: number, cu: number, cv: number, ch: number, du: number, dv: number,
  rIn: number, rOut: number, colour: number, sides: number,
) {
  if (facing(du, dv, 0) <= 0) return;
  // The same axes across it as a tube along it has, so its rings meet the tube's. @see tube
  const e1u = dv, e1v = -du, e2h = e1u * dv - e1v * du;
  room(m, sides * 2 + 1, sides * 6);
  const ring = (rad: number) => {
    const first = m.nv;
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2, c = Math.cos(a) * rad, sn = Math.sin(a) * rad;
      vert(m, s, cu + e1u * c, cv + e1v * c, ch + e2h * sn, du, dv, 0, colour);
    }
    return first;
  };
  const outer = ring(rOut);
  if (rIn <= 0) {
    const mid = vert(m, s, cu, cv, ch, du, dv, 0, colour);
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
 * A FLANGE where two lengths are bolted together, at (cu, cv, ch) across a
 * level axis (du, dv) that points to the camera's side: its rim, its face,
 * and the bolts round the face. `blind` closes it — a capped end.
 */
export function flange(
  m: PipeMesh, s: number, cu: number, cv: number, ch: number, du: number, dv: number,
  r: number, colour: number, sides: number, bolts: boolean, blind: boolean,
) {
  const R = r * FLANGE_R, half = FLANGE_T / 2, c = solid(colour);
  const fu = cu + du * half, fv = cv + dv * half;
  tube(m, s, cu - du * half, cv - dv * half, ch, fu, fv, ch, R, c, sides);
  disc(m, s, fu, fv, ch, du, dv, blind ? 0 : r, R, c, sides);
  if (!bolts || facing(du, dv, 0) <= 0) return;
  // THE BOLTS: on the face, between the bore and the rim — round the whole face of a blind one.
  const at = blind ? R * 0.72 : (r + R) / 2, size = Math.max(0.006, (R - r) * 0.36);
  const e1u = dv, e1v = -du, e2h = e1u * dv - e1v * du, b = solid(darker(colour, 0.55));
  for (let k = 0; k < BOLTS; k++) {
    const a = ((k + 0.5) / BOLTS) * Math.PI * 2, cc = Math.cos(a) * at, sn = Math.sin(a) * at;
    disc(m, s, fu + du * 0.003 + e1u * cc, fv + dv * 0.003 + e1v * cc, ch + e2h * sn, du, dv, 0, size, b, 6);
  }
}

/**
 * A SWEEP: a tube along a path of points, each ring square to the path
 * there, the lengths between written farthest from the camera first — so a
 * bend's near side draws over its far.
 */
export function sweep(m: PipeMesh, s: number, path: readonly (readonly [number, number, number])[], r: number, colour: number, sides: number) {
  const n = path.length, half = sides >> 1, row = half + 1;
  room(m, n * row, (n - 1) * half * 6);
  const first = m.nv;
  for (let p = 0; p < n; p++) {
    const a = path[Math.max(0, p - 1)], b = path[Math.min(n - 1, p + 1)];
    const ring = halfRing(b[0] - a[0], b[1] - a[1], b[2] - a[2], half);
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

/**
 * A BEND'S PATH, (u, v, h) points: in from face `a` straight to where the
 * bend starts, round a quarter circle of radius BEND_R, and straight out to
 * face `b` — level through the bend at `h`, sloping to each face's level.
 */
export function elbowPath(x: number, y: number, h: number, a: Limb, b: Limb, steps = 6): [number, number, number][] {
  const out: [number, number, number][] = [[x + a.dx * 0.5, y + a.dy * 0.5, a.zf * ZT]];
  // The circle's middle sits BEND_R out along both limbs.
  const ou = x + (a.dx + b.dx) * BEND_R, ov = y + (a.dy + b.dy) * BEND_R;
  for (let k = 0; k <= steps; k++) {
    // From the point on limb a (the middle less b) round to the point on limb b (the middle less a).
    const t = (k / steps) * (Math.PI / 2), c = Math.cos(t), sn = Math.sin(t);
    out.push([ou - b.dx * BEND_R * c - a.dx * BEND_R * sn, ov - b.dy * BEND_R * c - a.dy * BEND_R * sn, h]);
  }
  out.push([x + b.dx * 0.5, y + b.dy * 0.5, b.zf * ZT]);
  return out;
}

/**
 * A CELL'S MAIN as a solid, at `z` half steps in its middle, joined out
 * along `limbs`: a straight run, a bend, a tee (a run with a stub welded on),
 * a cross, or a loose end — capped, or domed under the fitting there. A
 * flange at each join on its far side (each join is some cell's far side,
 * so each is drawn once), written before the length that meets it.
 */
export function pipeCell(m: PipeMesh, s: number, x: number, y: number, z: number, limbs: readonly Limb[], look: PipeLook) {
  const h = z * ZT, { r, sides } = look, c = solid(look.colour);
  const far = (l: Limb) => l.dx + l.dy < 0;
  const face = (l: Limb) => [x + l.dx * 0.5, y + l.dy * 0.5, l.zf * ZT] as const;
  const length = (l: Limb, from = 0) => {
    const [fu, fv, fh] = face(l), k = from / 0.5;
    const a: [number, number, number] = [x + l.dx * from, y + l.dy * from, h + (fh - h) * k];
    if (far(l)) tube(m, s, fu, fv, fh, a[0], a[1], a[2], r, c, sides);
    else tube(m, s, a[0], a[1], a[2], fu, fv, fh, r, c, sides);
  };
  // A STUB'S COLLAR, where it is welded to the run.
  const collar = (l: Limb) => {
    tube(m, s, x + l.dx * r * COLLAR_FROM, y + l.dy * r * COLLAR_FROM, h, x + l.dx * r * COLLAR_TO, y + l.dy * r * COLLAR_TO, h, r * COLLAR_R, c, sides);
    disc(m, s, x + l.dx * r * COLLAR_TO, y + l.dy * r * COLLAR_TO, h, l.dx, l.dy, r, r * COLLAR_R, c, sides);
  };
  const stub = (l: Limb) => {
    if (far(l)) { length(l, r * COLLAR_TO); collar(l); } else { collar(l); length(l, r * COLLAR_TO); }
  };

  if (look.flanges !== false) {
    for (const l of limbs) {
      if (!far(l)) continue;
      const [fu, fv, fh] = face(l);
      flange(m, s, fu, fv, fh, -l.dx, -l.dy, r, look.colour, sides, look.bolts !== false, false);
    }
  }

  const n = limbs.length;
  const across = (a: Limb, b: Limb) => a.dx === -b.dx && a.dy === -b.dy;
  if (n === 0) { ball(m, s, x, y, h, r, c, sides); return; }
  if (n === 1) {
    // A LOOSE END: a blind flange if it is capped, else a dome under whatever fitting is there.
    const l = limbs[0];
    const end = () => look.cap != null
      ? flange(m, s, x, y, h, -l.dx, -l.dy, r, look.cap, sides, look.bolts !== false, true)
      : ball(m, s, x, y, h, r, c, sides);
    if (far(l)) { length(l); end(); } else { end(); length(l); }
    return;
  }
  if (n === 2 && !across(limbs[0], limbs[1])) {
    sweep(m, s, elbowPath(x, y, h, limbs[0], limbs[1]), r, c, sides);
    return;
  }
  // A RUN straight through — along u where there is one, for a cross — and any stubs off it.
  const run = limbs.filter((l) => limbs.some((o) => across(l, o)));
  const main = run.length > 2 ? run.filter((l) => l.dx !== 0) : run;
  const stubs = limbs.filter((l) => !main.includes(l));
  for (const l of stubs) if (far(l)) stub(l);
  for (const l of main) if (far(l)) length(l);
  for (const l of main) if (!far(l)) length(l);
  for (const l of stubs) if (!far(l)) stub(l);
}

/** `0xRRGGBB`, opaque, as a vertex word. */
export const solid = (colour: number) => rgba(colour, 1);
