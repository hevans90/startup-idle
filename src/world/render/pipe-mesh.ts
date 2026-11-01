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
  let du = bu - au, dv = bv - av, dh = bh - ah;
  const len = Math.hypot(du, dv, dh);
  if (len === 0) return;
  du /= len; dv /= len; dh /= len;
  // ACROSS IT: one axis level, the other square to that and to the tube.
  let e1u = dv, e1v = -du, e1h = 0;
  const l1 = Math.hypot(e1u, e1v);
  if (l1 < 1e-6) { e1u = 1; e1v = 0; } else { e1u /= l1; e1v /= l1; }
  const e2u = e1v * dh - e1h * dv, e2v = e1h * du - e1u * dh, e2h = e1u * dv - e1v * du;
  room(m, sides * 2, sides * 6);
  const first = m.nv;
  const seen: boolean[] = [];
  for (let k = 0; k < sides; k++) {
    const t = (k / sides) * Math.PI * 2, c = Math.cos(t), sn = Math.sin(t);
    const nu = c * e1u + sn * e2u, nv = c * e1v + sn * e2v, nh = c * e1h + sn * e2h;
    vert(m, s, au + nu * r, av + nv * r, ah + nh * r, nu, nv, nh, colour);
    vert(m, s, bu + nu * r, bv + nv * r, bh + nh * r, nu, nv, nh, colour);
    seen.push(facing(nu, nv, nh) > 0);
  }
  for (let k = 0; k < sides; k++) {
    const j = (k + 1) % sides;
    // A face with either edge in view: the one across the silhouette is half of it.
    if (!seen[k] && !seen[j]) continue;
    const a0 = first + k * 2, a1 = a0 + 1, b0 = first + j * 2, b1 = b0 + 1;
    tri(m, a0, a1, b1);
    tri(m, a0, b1, b0);
  }
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

/**
 * A CELL'S TUBE: a length from its middle out to each face it is joined on,
 * at `z` half steps there — the ones running away from the camera first,
 * then a ball where they meet unless it is a straight run, then those
 * running toward it, so the nearer always draws over the farther.
 */
export function pipeCell(
  m: PipeMesh, s: number, x: number, y: number, z: number, limbs: readonly Limb[],
  r: number, colour: number, sides: number,
) {
  const h = z * ZT;
  const straight = limbs.length === 2 && limbs[0].dx === -limbs[1].dx && limbs[0].dy === -limbs[1].dy;
  const out = (l: Limb) => tube(m, s, x, y, h, x + l.dx * 0.5, y + l.dy * 0.5, l.zf * ZT, r, colour, sides);
  for (const l of limbs) if (l.dx + l.dy < 0) out(l);
  if (!straight) ball(m, s, x, y, h, r, colour, sides);
  for (const l of limbs) if (l.dx + l.dy > 0) out(l);
}

/** `0xRRGGBB`, opaque, as a vertex word. */
export const solid = (colour: number) => rgba(colour, 1);
