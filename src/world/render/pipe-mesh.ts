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

/**
 * Floats per vertex: x, y on screen; the normal's u, v, h; the colour,
 * bit-cast; then WHAT IT IS MADE OF, for the shader to draw the detail of:
 * how far along its run it is, tiles; how far across it — round a tube from
 * one edge the camera sees to the other, nought to one, or along a wall; and
 * the material. @see MATERIAL, pipe-gpu
 */
export const WORDS = 9;

/**
 * WHAT A PIECE IS MADE OF. Plain is one flat colour under the light. The
 * rest are drawn by the shader from where on the piece a pixel is:
 * - cast iron (sewers): a joint line each pipe length, a casting seam along
 *   it, rust blooming down from the joints;
 * - steel (water mains): a weld bead each two lengths, a faint spiral seam,
 *   scuffs along the top, a stain under each weld;
 * - concrete: the lines its boards left, a pour at a time;
 * - brick: courses, half a brick over from the course below;
 * - a trunk: cast iron, and the flow's CHEVRONS along it, pointing the way it
 *   falls — on along its run as that is counted, or back. A pattern of the
 *   tube itself, not shapes laid over it.
 * A tube's `along` is its place on the map along the way it runs, so the
 * marks carry on from one tile's length to the next. A wall's `along` is its
 * height and its `across` its place along the wall.
 */
export const MATERIAL = { plain: 0, iron: 1, steel: 2, concrete: 3, brick: 4, trunkOn: 5, trunkBack: 6 } as const;
/** The material being written: set round the pieces that have one. @see made */
let material = 0;
/** Build with a material: what `build` writes that takes one — tubes, sweeps, boxes — is made of it. */
export function made<T>(of: number, build: () => T): T {
  const was = material;
  material = of;
  try { return build(); } finally { material = was; }
}

/**
 * A LIVE SLOT: a number a piece, by which the shader looks up what that
 * piece is doing now — how full, how far its marks have moved — in a small
 * texture the layer writes a frame. Carried with the material, `LIVE_BASE`
 * of it a slot, so a vertex is no wider. Nought is no slot: still and empty.
 * @see pipe-gpu, pipe-live
 */
export const LIVE_BASE = 16;
let slot = 0;
/** Build with a live slot: what `build` writes of a material answers to it. */
export function live<T>(at: number, build: () => T): T {
  const was = slot;
  slot = at;
  try { return build(); } finally { slot = was; }
}

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

/**
 * One vertex: the point (u, v, h) at scale `s`, its normal, its packed
 * colour — and, for a piece with a material, where along and across it this
 * is. Left out, it is plain whatever is being built. Returns its index.
 */
function vert(m: PipeMesh, s: number, u: number, v: number, h: number, nu: number, nv: number, nh: number, colour: number, along?: number, across = 0): number {
  const o = m.nv * WORDS;
  m.f32[o] = (u - v) * HW * s;
  m.f32[o + 1] = (u + v) * HH * s - h * KZ * s;
  m.f32[o + 2] = nu; m.f32[o + 3] = nv; m.f32[o + 4] = nh;
  m.u32[o + 5] = colour;
  // Plain, it says nothing: three noughts.
  const of = along === undefined ? 0 : material;
  m.f32[o + 6] = of ? along! : 0; m.f32[o + 7] = of ? across : 0; m.f32[o + 8] = of ? of + LIVE_BASE * slot : 0;
  return m.nv++;
}

/** A way a tube runs, turned so its marks count the same whichever end it was built from: its largest part positive. */
const forward = (du: number, dv: number, dh: number) => {
  const a = Math.abs(du) >= Math.abs(dv) && Math.abs(du) >= Math.abs(dh) ? du : Math.abs(dv) >= Math.abs(dh) ? dv : dh;
  return a < 0 ? -1 : 1;
};

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
  // WHERE ALONG ITS RUN each end is: its place on the map along the way it goes.
  const len = Math.hypot(du, dv, dh), f = forward(du, dv, dh) / len;
  const at = material ? (au * du + av * dv + ah * dh) * f : undefined, to = material ? (bu * du + bv * dv + bh * dh) * f : undefined;
  for (let k = 0; k <= half; k++) {
    const nu = n[k * 3], nv = n[k * 3 + 1], nh = n[k * 3 + 2];
    vert(m, s, au + nu * r, av + nv * r, ah + nh * r, nu, nv, nh, colour, at, k / half);
    vert(m, s, bu + nu * r, bv + nv * r, bh + nh * r, nu, nv, nh, colour, to, k / half);
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
export function halfRing(du: number, dv: number, dh: number, half: number): Float64Array {
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
export type Limb = {
  dx: number; dy: number; zf: number;
  /** Into a building's port: its fluid's colour; and how far past the cell's face its outlet stands, tiles. */
  wall?: number; reach?: number;
  /** The radius of the length it meets at that face, tiles, where that differs: the wider of the two tapers down to the other in a reducer. */
  meets?: number;
};

/** How a cell's main looks: its radius, tiles; its colours as `0xRRGGBB`; its faces round. */
export type PipeLook = {
  r: number;
  colour: number;
  sides: number;
  /** What its tube is made of: the detail the shader draws along it. Plain where left out. @see MATERIAL */
  material?: number;
  /** A saddle's strap over the tube: left off far away. */
  strap?: boolean;
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
   * glass to be drawn over it. @see pipe-glass
   */
  window?: number;
  glass?: number | null;
  /** A band painted round a straight run's middle: an AI line's violet, a sewer's brown. */
  band?: number | null;
  /** The small parts, left off far away: an outlet's valve wheel, the frames round a window. */
  valve?: boolean;
  frames?: boolean;
  /**
   * OVER A ROAD, the way it runs: a frame's legs then stand at its two edges,
   * clear of the traffic, its beam spanning between them under the tube.
   */
  verges?: "u" | "v" | null;
  /**
   * WHERE THE TRAFFIC IS, the pieces drawn apart from the rest: what stands
   * behind it (a frame's far leg) into `back`, under the movers; and the
   * length nearest the camera — past {@link NEAR_SPLIT} into the next band —
   * into `near`, over the next band's movers too, whose tails run under it.
   */
  back?: PipeMesh;
  near?: PipeMesh;
};

/**
 * Where a road main's length goes into the next band's mesh, tiles toward the
 * camera from its middle: past where a car filed in the next band reaches
 * back under it, and clear of a building beside the road in that band, whose
 * corner stands right at the middle's column on the screen.
 */
export const NEAR_SPLIT = 0.22;

/** What can stand at a main's loose end. @see MAIN_END */
export type Fitting = "cap" | "intake" | "pump" | "outlet" | "drain" | "outfall" | "drop";

/** The fittings' paint. */
export const FITTING = {
  cap: 0xc0392b, grate: 0x3d4a57, pumpWall: 0x6f8fae, pumpRoof: 0xe0a23a, pumpDoor: 0x3e5872,
  wheel: 0x2b3440, valve: 0xb8463a, slop: 0x7a5230, mouth: 0x5a4030, bore: 0x1a120c,
} as const;
/** A window's frame and a painted band: how much wider than the tube, and how long, tiles. */
const FRAME_R = 1.12, FRAME_T = 0.0175, BAND_R = 1.05, BAND_T = 0.045;

/**
 * A PORT'S OUTLET: its plate on the wall, half its size in tube radii, and
 * how thick, tiles; how far out from the wall its flange's face is, tiles.
 * A main joined to it ends PORT_JOINT out, its own flange against that one.
 */
const PLATE = 2.1, PLATE_T = 0.016, PLATE_COLOUR = 0x5b636c;
export const SPIGOT = 0.1;

/** A pump house's walls, half their length in u and in v; its height at least, half steps. */
const PUMP_U = 0.11, PUMP_V = 0.09, PUMP_TALL = 1.3;
/** An intake's box, half its width, tiles. */
const INTAKE = 0.06;

/** A flange: how much wider than the tube, how thick, tiles; how many bolts round it. */
export const FLANGE_R = 1.4, FLANGE_T = 0.025, BOLTS = 6;
/** The gasket's line between a flange's two rings, tiles; a cap's dome, how wide and how far out, in tube radii. */
export const GASKET = 0.005, DOME_R = 0.8, DOME_OUT = 0.45;
/** A reducer, where a wide length meets a slim one: how long its taper is, tiles. */
export const REDUCER = 0.12;
export const PORT_JOINT = SPIGOT + FLANGE_T / 2;
/** A bend's radius to its middle line, tiles: most of the half tile, so it reads as a sweep. */
export const BEND_R = 0.35;
/** A tee's weld collar: how much wider than the tube, and where along the stub, in tube radii. */
const COLLAR_R = 1.14, COLLAR_FROM = 0.85, COLLAR_TO = 1.2;
/** A drop's collar where it goes into the ground: how much wider than the tube, and how tall, in tube radii. */
const DROP_COLLAR = COLLAR_R * 1.15, DROP_LIP = 0.6;

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
 * A DOME standing out of a face at (cu, cv, ch) along the unit axis (du, dv,
 * dh): `r` across at its foot, `out` high at its crown. Rings from the foot
 * in to the crown, the far ones first. For a face toward the camera.
 */
export function dome(m: PipeMesh, s: number, cu: number, cv: number, ch: number, du: number, dv: number, dh: number, r: number, out: number, colour: number, sides: number) {
  const { e1u, e1v, e2u, e2v, e2h } = across3(du, dv, dh), rings = 3;
  room(m, rings * sides + 1, rings * sides * 6);
  const first = m.nv;
  for (let q = 0; q < rings; q++) {
    const t = (q / rings) * (Math.PI / 2), rad = Math.cos(t) * r, up = Math.sin(t) * out, k0 = Math.cos(t), k1 = Math.sin(t);
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      const ru = e1u * c + e2u * sn, rv = e1v * c + e2v * sn, rh = e2h * sn;
      vert(m, s, cu + ru * rad + du * up, cv + rv * rad + dv * up, ch + rh * rad + dh * up, ru * k0 + du * k1, rv * k0 + dv * k1, rh * k0 + dh * k1, colour);
    }
  }
  const crown = vert(m, s, cu + du * out, cv + dv * out, ch + dh * out, du, dv, dh, colour);
  for (let q = 0; q < rings; q++) {
    for (let k = 0; k < sides; k++) {
      const a = first + q * sides + k, b = first + q * sides + ((k + 1) % sides);
      if (q === rings - 1) { tri(m, a, b, crown); continue; }
      tri(m, a, b, b + sides);
      tri(m, a, b + sides, a + sides);
    }
  }
}

/**
 * A TAPER from radius `ra` at (au, av, ah) to `rb` at (bu, bv, bh): the half
 * of it the camera sees. A reducer, where the bore changes. Plain.
 */
export function taper(
  m: PipeMesh, s: number, au: number, av: number, ah: number, bu: number, bv: number, bh: number,
  ra: number, rb: number, colour: number, sides: number,
) {
  const du = bu - au, dv = bv - av, dh = bh - ah;
  if (du === 0 && dv === 0 && dh === 0) return;
  const half = sides >> 1, first = m.nv;
  room(m, (half + 1) * 2, half * 6);
  const n = halfRing(du, dv, dh, half);
  for (let k = 0; k <= half; k++) {
    const nu = n[k * 3], nv = n[k * 3 + 1], nh = n[k * 3 + 2];
    vert(m, s, au + nu * ra, av + nv * ra, ah + nh * ra, nu, nv, nh, colour);
    vert(m, s, bu + nu * rb, bv + nv * rb, bh + nh * rb, nu, nv, nh, colour);
  }
  for (let k = 0; k < half; k++) {
    const a0 = first + k * 2, a1 = a0 + 1, b0 = a0 + 2, b1 = a0 + 3;
    tri(m, a0, a1, b1);
    tri(m, a0, b1, b0);
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
  // A PAIR OF RINGS bolted face to face, and the dark line of the gasket squeezed between them. Plain, whatever the tube is.
  made(MATERIAL.plain, () => {
    tube(m, s, cu - du * half, cv - dv * half, ch - dh * half, fu, fv, fh, R, c, sides);
    const gk = GASKET / 2;
    tube(m, s, cu - du * gk, cv - dv * gk, ch - dh * gk, cu + du * gk, cv + dv * gk, ch + dh * gk, R * 1.004, solid(darker(colour, 0.45)), sides);
  });
  disc(m, s, fu, fv, fh, du, dv, blind ? 0 : r, R, c, sides, dh);
  // A BLIND ONE IS DOMED: the cap's crown, standing out of its face.
  if (blind && facing(du, dv, dh) > 0) dome(m, s, fu, fv, fh, du, dv, dh, r * DOME_R, r * DOME_OUT, solid(darker(colour, 0.88)), sides);
  if (!bolts || facing(du, dv, dh) <= 0) return;
  // THE BOLTS: on the face, between the bore and the rim — round the whole face of a blind one.
  const at = blind ? R * 0.72 : (r + R) / 2, size = Math.max(0.003, (R - r) * 0.36);
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
  // WHERE ALONG ITS RUN each ring is: from its first point's place on the map, by the path's own length after.
  const d0 = [path[1][0] - path[0][0], path[1][1] - path[0][1], path[1][2] - path[0][2]], l0 = Math.hypot(d0[0], d0[1], d0[2]) || 1;
  const way = forward(d0[0], d0[1], d0[2]);
  let run = ((path[0][0] * d0[0] + path[0][1] * d0[1] + path[0][2] * d0[2]) / l0) * way;
  for (let p = 0; p < n; p++) {
    const a = path[Math.max(0, p - 1)], b = path[Math.min(n - 1, p + 1)];
    const end = ends && (p === 0 ? ends[0] : p === n - 1 ? ends[1] : null);
    const ring = end ? halfRing(end[0], end[1], end[2], half) : halfRing(b[0] - a[0], b[1] - a[1], b[2] - a[2], half);
    if (p > 0) run += Math.hypot(path[p][0] - path[p - 1][0], path[p][1] - path[p - 1][1], path[p][2] - path[p - 1][2]) * way;
    for (let k = 0; k <= half; k++) {
      const nu = ring[k * 3], nv = ring[k * 3 + 1], nh = ring[k * 3 + 2];
      vert(m, s, path[p][0] + nu * r, path[p][1] + nv * r, path[p][2] + nh * r, nu, nv, nh, colour, material ? run : undefined, k / half);
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
 * A SWEEP CUT IN TWO by how near the camera it is: what lies more than
 * `NEAR_SPLIT` toward it from (x, y)'s middle into `near`, the rest into `m`.
 * The ring at each cut is the same from either side, so the two meet.
 */
function sweepSplit(
  m: PipeMesh, near: PipeMesh, x: number, y: number, s: number, path: readonly Pt[], r: number, colour: number, sides: number,
  ends?: readonly [readonly number[] | null, readonly number[] | null],
) {
  const d0 = x + y + NEAR_SPLIT, dep = (p: readonly number[]) => p[0] + p[1] - d0;
  let cur: Pt[] = [path[0]], inNear = dep(path[0]) > 0, from: readonly number[] | null = ends?.[0] ?? null;
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1], b = path[k], da = dep(a), db = dep(b);
    if (db > 0 !== inNear) {
      const t = da / (da - db), dir = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const cut: Pt = [a[0] + dir[0] * t, a[1] + dir[1] * t, a[2] + dir[2] * t];
      cur.push(cut);
      sweep(inNear ? near : m, s, cur, r, colour, sides, [from, dir]);
      cur = [cut];
      from = dir;
      inNear = !inNear;
    }
    cur.push(b);
  }
  sweep(inNear ? near : m, s, cur, r, colour, sides, [from, ends?.[1] ?? null]);
}

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
const SADDLE = 0.07, LEG = 0.04, BEAM = 0.04;
/**
 * STANDING ON THE GROUND. A support's FOOTING: a slab a little wider than
 * what stands on it, and so thick. And the CONTACT under it: a thin dark rim
 * on the ground where the concrete meets it, so a pipe is seen to stand and
 * not to hover. Only under footings — a dark line under the length of a tube
 * would be the shadow that was taken out. Its strength is this one number,
 * nought to one: nought, and there is none.
 */
export const FOOTING = 0.03, FOOTING_T = 0.022, CONTACT_OUT = 0.022;
export const CONTACT = 0.3;
const CONTACT_DARK = 0x16170f;
/** A saddle's strap: steel, a little prouder than the tube, so long; and how far a saddle's cheeks stand out past the tube. */
const STRAP = 0x4a5058, STRAP_R = 1.07, STRAP_T = 0.022, CHEEK = 1.22;

/** One flat face, its four corners in order round it, all facing `n`. */
function quad(m: PipeMesh, s: number, q: readonly Pt[], nu: number, nv: number, nh: number, colour: number) {
  room(m, 4, 6);
  // A WALL'S MARKS go by its height and its place along it; a top has none.
  const mark = (p: Pt): [number | undefined, number] => (material && nh === 0 ? [p[2], nu !== 0 ? p[1] : p[0]] : [undefined, 0]);
  const a = vert(m, s, q[0][0], q[0][1], q[0][2], nu, nv, nh, colour, ...mark(q[0]));
  for (let k = 1; k < 4; k++) vert(m, s, q[k][0], q[k][1], q[k][2], nu, nv, nh, colour, ...mark(q[k]));
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

/** The box, by a name a cell's own `box` — the same, in concrete — does not hide. */
const solidBox = box;

/**
 * A FOOTING under what stands on (u0, v0)–(u1, v1) at ground `g`: the dark
 * rim of its contact with the ground, flat, and the slab on it, concrete.
 * Returns the slab's top, where what it carries starts. @see CONTACT
 */
export function footing(m: PipeMesh, s: number, u0: number, v0: number, u1: number, v1: number, g: number): number {
  const a = FOOTING, c = a + CONTACT_OUT, z = g + 0.0008;
  if (CONTACT > 0) quad(m, s, [[u0 - c, v0 - c, z], [u1 + c, v0 - c, z], [u1 + c, v1 + c, z], [u0 - c, v1 + c, z]], 0, 0, 1, rgba(CONTACT_DARK, CONTACT));
  made(MATERIAL.concrete, () => box(m, s, u0 - a, v0 - a, g, u1 + a, v1 + a, g + FOOTING_T, solid(CONCRETE)));
  return g + FOOTING_T;
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
  // Across the tube it stands out past it either side: the cheeks of its cradle.
  const du = at.along === "u" ? SADDLE / 2 : r * CHEEK, dv = at.along === "v" ? SADDLE / 2 : r * CHEEK;
  return [at.u - du, at.v - dv, at.u + du, at.v + dv];
}

/** A frame's two legs over a road running along `road`, far one first: at its edges, clear of the traffic. */
function vergeLegs(at: { u: number; v: number }, x: number, y: number, road: "u" | "v"): [number, number, number, number][] {
  // In from the edge by its footing and the rim round that: all of it on this tile.
  const half = LEG / 2, off = 0.5 - half - FOOTING - CONTACT_OUT;
  return [-1, 1].map((k) => {
    const cu = road === "u" ? at.u : x + off * k, cv = road === "u" ? y + off * k : at.v;
    return [cu - half, cv - half, cu + half, cv + half];
  });
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
  // INTO A PORT, the main stops at its outlet's flange: nothing of it nearer the wall than that.
  const walls = limbs.filter((l) => l.wall !== undefined);
  const stopOf = (l: Limb) => 0.5 + (l.reach ?? 0) - PORT_JOINT;
  const short = (path: readonly Pt[]): readonly Pt[] => !walls.length ? path : path.map((p): Pt => {
    let [u, v] = p;
    for (const l of walls) {
      const along = (u - x) * l.dx + (v - y) * l.dy, stop = stopOf(l);
      if (along > stop) { u -= l.dx * (along - stop); v -= l.dy * (along - stop); }
    }
    return [u, v, p[2]];
  });
  // Over a road, the length nearest the camera into the next band's mesh. @see PipeLook.near
  // THE TUBE ITSELF is of the main's material; what is fitted to it — collars, flanges, frames, bands — is plain.
  const mat = look.material ?? MATERIAL.plain;
  const sw = (path: readonly Pt[], ends?: readonly [readonly number[] | null, readonly number[] | null]) => made(mat, () =>
    look.near ? sweepSplit(m, look.near, x, y, s, short(path), r, c, sides, ends) : sweep(m, s, short(path), r, c, sides, ends));
  const len = (au: number, av: number, ah: number, bu: number, bv: number, bh: number, colour = c) =>
    made(mat, () => tube(m, s, au, av, ah, bu, bv, bh, r, colour, sides));
  // A REDUCER, where this length is the wider of the two that meet at a face: a collar at
  // its own bore, tapering over the last of the tile down to the slimmer one's.
  const reducer = (l: Limb) => {
    if (l.meets === undefined || l.meets >= r - 1e-6 || l.wall !== undefined) return;
    const [fu, fv, fh] = face(l), k = REDUCER, slope = faceSlope(l, z);
    const bu = fu - l.dx * k, bv = fv - l.dy * k, bh = fh - slope * k * 0.5, cu = fu - l.dx * k * 1.35, cv = fv - l.dy * k * 1.35, ch = fh - slope * k * 0.675;
    const dark = solid(darker(look.colour, 0.8));
    const cone = () => taper(m, s, bu, bv, bh, fu, fv, fh, r * 1.12, l.meets! * 1.04, dark, sides);
    const band = () => { tube(m, s, cu, cv, ch, bu, bv, bh, r * 1.12, dark, sides); disc(m, s, cu, cv, ch, -l.dx, -l.dy, r, r * 1.12, dark, sides); };
    if (far(l)) { cone(); band(); } else { band(); cone(); }
  };
  // A LIMB ALONE, from `from` out of the middle — level there — to its face.
  const length = (l: Limb, from = 0) => {
    const { path, out } = halfPath(x, y, z, l, from, 0, sides);
    if (far(l)) sw(path.reverse(), [out.map((k) => -k), null]);
    else sw(path, [null, out]);
  };
  // A STUB'S COLLAR, where it is welded to the run.
  const collar = (l: Limb) => {
    tube(m, s, x + l.dx * r * COLLAR_FROM, y + l.dy * r * COLLAR_FROM, h, x + l.dx * r * COLLAR_TO, y + l.dy * r * COLLAR_TO, h, r * COLLAR_R, c, sides);
    disc(m, s, x + l.dx * r * COLLAR_TO, y + l.dy * r * COLLAR_TO, h, l.dx, l.dy, r, r * COLLAR_R, c, sides);
  };
  const stub = (l: Limb) => {
    if (far(l)) { length(l, r * COLLAR_TO); collar(l); } else { collar(l); length(l, r * COLLAR_TO); }
  };

  // INTO A PORT: the main's own flange, bolted to its outlet's — and, where
  // that stands back past the cell's face, a straight length on to it. @see outlet
  const wall = (l: Limb) => {
    const stop = stopOf(l), h = l.zf * ZT;
    const end = () => flange(m, s, x + l.dx * stop, y + l.dy * stop, h, -l.dx, -l.dy, r, look.colour, sides, look.bolts !== false, false);
    if (stop <= 0.5) { end(); return; }
    const on = () => len(x + l.dx * 0.5, y + l.dy * 0.5, h, x + l.dx * stop, y + l.dy * stop, h);
    if (far(l)) { end(); on(); } else { on(); end(); }
  };
  for (const l of limbs) {
    if (!far(l)) continue;
    if (l.wall !== undefined) { wall(l); continue; }
    if (look.flanges === false) continue;
    const [fu, fv, fh] = face(l);
    // Square to the tube there: tilted with it where it climbs.
    flange(m, s, fu, fv, fh, -l.dx, -l.dy, r, look.colour, sides, look.bolts !== false, false, -faceSlope(l, z));
  }

  for (const l of limbs) if (far(l)) reducer(l);

  // WHAT IT STANDS ON: a saddle up to its underside; or the far leg and the beam of a frame, its near leg after the tube.
  const support = look.support ?? "none", g = (look.floor ?? 0) * ZT, concrete = solid(CONCRETE);
  const at = supportAt(x, y, h, limbs);
  const box = (mm: PipeMesh, ss: number, u0: number, v0: number, h0: number, u1: number, v1: number, h1: number, colour: number) =>
    made(MATERIAL.concrete, () => solidBox(mm, ss, u0, v0, h0, u1, v1, h1, colour));
  let nearLeg: [number, number, number, number] | null = null;
  // A saddle's STRAP goes over the tube, so after it. @see below
  let strap = false;
  if (support === "saddle" && limbs.length) {
    // A SADDLE: a footing, and on it a block the tube lies in — its cheeks up either side of the tube, which is drawn over its middle.
    const [u0, v0, u1, v1] = saddle(at, r), top = footing(m, s, u0, v0, u1, v1, g);
    box(m, s, u0, v0, top, u1, v1, Math.max(top, h - r * 0.15), concrete);
    // None over a window: the glass there is written over it each frame, and a band would show through it.
    strap = at.along !== null && h - r > top && !(look.window ?? 0) && look.strap !== false;
  } else if (support === "frame" && limbs.length && look.verges) {
    // OVER A ROAD: a leg at either edge of it, the beam right across under the
    // tube — under its lowest point, where it climbs. The far leg behind the traffic.
    const road = look.verges, under = Math.min(h, ...limbs.map((l) => l.zf * ZT)) - r, top = under - BEAM;
    const [farLeg, near] = vergeLegs(at, x, y, road);
    box(look.back ?? m, s, farLeg[0], farLeg[1], footing(look.back ?? m, s, farLeg[0], farLeg[1], farLeg[2], farLeg[3], g), farLeg[2], farLeg[3], top, concrete);
    const span = 0.5 - FOOTING - CONTACT_OUT;
    const [du, dv] = road === "u" ? [BEAM / 2, span] : [span, BEAM / 2];
    const [bu, bv] = road === "u" ? [at.u, y] : [x, at.v];
    box(m, s, bu - du, bv - dv, top, bu + du, bv + dv, under, concrete);
    nearLeg = near;
  } else if (support === "frame" && limbs.length) {
    const [farLeg, near] = legs(at, r), top = h - r - BEAM;
    box(m, s, farLeg[0], farLeg[1], footing(m, s, farLeg[0], farLeg[1], farLeg[2], farLeg[3], g), farLeg[2], farLeg[3], top, concrete);
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
  } else if (limbs.length === 1 && kind === "drop") {
    // A DROP: one sweep in along the limb, round a quarter circle and straight down into its collar.
    const l = limbs[0], lip = r * DROP_LIP, R = r * DROP_COLLAR, foot = g + lip;
    const br = Math.max(r * 1.2, Math.min(BEND_R, (h - foot) * 0.85));
    const lead = halfPath(x, y, z, l, br, 0, sides);
    const path: Pt[] = lead.path.reverse();
    const steps = arcSteps(sides);
    for (let k = 1; k <= steps; k++) {
      const t = (k / steps) * (Math.PI / 2), along = br * (1 - Math.sin(t));
      path.push([x + l.dx * along, y + l.dy * along, h - br + br * Math.cos(t)]);
    }
    if (h - br > foot) path.push([x, y, foot]);
    // The collar's top first, so the pipe stands in front of its far half; its band after, in front of all.
    const collar = solid(darker(look.colour, 0.7));
    hring(m, s, x, y, foot, r, R, collar, sides);
    sw(path, [lead.out.map((k) => -k), [0, 0, -1]]);
    tube(m, s, x, y, foot, x, y, g, R, collar, sides);
  } else if (limbs.length === 1) {
    // A LOOSE END: its fitting, facing out the way the main ends — the length reaching only to a house's wall — or a dome.
    const l = limbs[0];
    const wall = kind === "pump" ? (l.dx ? PUMP_U : PUMP_V) : kind === "intake" ? INTAKE : 0;
    const end = () => kind ? fitting(m, s, kind, x, y, h, g, -l.dx, -l.dy, look) : ball(m, s, x, y, h, r, c, sides);
    if (far(l)) { length(l, wall); end(); } else { end(); length(l, wall); }
    if (kind === "outlet" && look.valve !== false) valve(m, s, x, y, h, r);
  } else if (bend) {
    const { path, ends } = bendPath(x, y, z, run[0], run[1], arcSteps(sides));
    sw(path, ends);
  } else {
    for (const l of stubs) if (far(l)) stub(l);
    const [a, b] = [face(run[0]), face(run[1])];
    const win = look.window ?? 0;
    if (win > 0 && run.length === 2 && !stubs.length) {
      // A WINDOW: steel to its far frame, glass between its frames, steel on; then the frames round the joins.
      const [w0, w1] = windowSpan(x, y, z, run[0], run[1], win);
      len(a[0], a[1], a[2], w0[0], w0[1], w0[2]);
      if (look.glass !== null) tube(m, s, w0[0], w0[1], w0[2], w1[0], w1[1], w1[2], r, solid(look.glass ?? 0xcfe6f2), sides);
      if (look.near) sw([w1, b], [[b[0] - w1[0], b[1] - w1[1], b[2] - w1[2]], [b[0] - w1[0], b[1] - w1[1], b[2] - w1[2]]]);
      else len(w1[0], w1[1], w1[2], b[0], b[1], b[2]);
      const du = w1[0] - w0[0], dv = w1[1] - w0[1], dh = w1[2] - w0[2];
      if (look.frames !== false) for (const p of [w0, w1]) hoop(m, s, p, du, dv, r, r * FRAME_R, FRAME_T, c, sides, dh);
    } else {
      // The run as one sweep, far face to near, curving where it changes slope.
      const { path, ends } = runPath(x, y, z, run[0], run[1], sides);
      sw(path, ends);
      const slope = midSlope(z, run[0], 0.5, run[1], 0.5);
      if (look.band != null) hoop(m, s, [x, y, h], -run[0].dx, -run[0].dy, r, r * BAND_R, BAND_T, solid(look.band), sides, slope);
    }
    for (const l of stubs) if (!far(l)) stub(l);
  }
  for (const l of limbs) if (l.wall !== undefined && !far(l)) wall(l);
  for (const l of limbs) if (!far(l)) reducer(l);
  if (nearLeg) {
    const top = look.verges ? Math.min(h, ...limbs.map((l) => l.zf * ZT)) - r - BEAM : h - r - BEAM;
    box(m, s, nearLeg[0], nearLeg[1], footing(m, s, nearLeg[0], nearLeg[1], nearLeg[2], nearLeg[3], g), nearLeg[2], nearLeg[3], top, concrete);
  }
  // THE STRAP over a saddled tube: a steel band round it, holding it down in its cradle.
  if (strap) {
    const run0 = shape(limbs).run[0];
    hoop(m, s, [at.u, at.v, h], run0.dx, run0.dy, r, r * STRAP_R, STRAP_T, solid(STRAP), sides, midSlopeOf(limbs, z));
  }
}

/** How a cell's run slopes through its middle: nought for a bend or a loose end. */
function midSlopeOf(limbs: readonly Limb[], z: number): number {
  const { bend, run } = shape(limbs);
  return !bend && run.length === 2 ? midSlope(z, run[0], 0.5, run[1], 0.5) : 0;
}

/**
 * A HOOP round a tube at `p`, the tube running along (du, dv, dh): a
 * short wider length, and its face on the camera's side. A window's frame,
 * a painted band.
 */
export function hoop(m: PipeMesh, s: number, p: readonly number[], du0: number, dv0: number, r: number, rr: number, len: number, colour: number, sides: number, dh0 = 0) {
  const { du, dv, dh } = across3(du0, dv0, dh0), half = len / 2;
  tube(m, s, p[0] - du * half, p[1] - dv * half, p[2] - dh * half, p[0] + du * half, p[1] + dv * half, p[2] + dh * half, rr, colour, sides);
  // One of the two faces is toward the camera; disc draws only that one.
  for (const k of [1, -1]) disc(m, s, p[0] + du * half * k, p[1] + dv * half * k, p[2] + dh * half * k, du * k, dv * k, r, rr, colour, sides, dh * k);
}

/** A FLAT RING lying level, (cu, cv, ch), from `rIn` to `rOut` — a handwheel, seen from above. */
export function hring(m: PipeMesh, s: number, cu: number, cv: number, ch: number, rIn: number, rOut: number, colour: number, sides: number) {
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

/** A window's frame, half its length, tiles: what the glass keeps clear of, either end. */
export const FRAME_HALF = FRAME_T / 2;

/** A valve's body, in tube radii. */
export const VALVE_BODY = 1.28;
/** AN OUTLET'S VALVE: its body round the tube, the bonnet on it, a stem up out of that, and a red handwheel. */
export function valve(m: PipeMesh, s: number, x: number, y: number, h: number, r: number) {
  const top = h + r + 0.035, steel = solid(FITTING.wheel), red = solid(FITTING.valve);
  // ITS BODY: a bulge round the tube where the gate is, and the bonnet bolted on top of it.
  ball(m, s, x, y, h, r * VALVE_BODY, solid(darker(FITTING.valve, 0.75)), 14);
  box(m, s, x - r * 0.55, y - r * 0.55, h + r * 0.75, x + r * 0.55, y + r * 0.55, h + r * 1.12, steel);
  box(m, s, x - 0.006, y - 0.006, h + r * 0.8, x + 0.006, y + 0.006, top, steel);
  hring(m, s, x, y, top, 0.0225, 0.031, red, 16);
  box(m, s, x - 0.009, y - 0.009, top, x + 0.009, y + 0.009, top + 0.005, red);
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
 * - an outfall over the bank: a flared mouth, dark inside, on a post down to the water;
 * - a drop, a lateral over a sewer manhole: the knuckle, and the tube turned down into the cover.
 */
function fitting(m: PipeMesh, s: number, kind: Fitting, x: number, y: number, h: number, g: number, ou: number, ov: number, look: PipeLook) {
  const { r, sides } = look, bolts = look.bolts !== false, concrete = solid(CONCRETE);
  switch (kind) {
    case "cap":
      flange(m, s, x, y, h, ou, ov, r, FITTING.cap, sides, bolts, true);
      return;
    case "drop": {
      // Alone, joined to nothing: a downpipe into its collar. Joined, it is a sweep. @see pipeCell
      const c = solid(look.colour), collar = solid(darker(look.colour, 0.7)), R = r * DROP_COLLAR, foot = g + r * DROP_LIP;
      hring(m, s, x, y, foot, r, R, collar, sides);
      tube(m, s, x, y, h, x, y, foot, r, c, sides);
      ball(m, s, x, y, h, r, c, sides);
      tube(m, s, x, y, foot, x, y, g, R, collar, sides);
      return;
    }
    case "outlet":
    case "drain":
      ball(m, s, x, y, h, r, solid(look.colour), sides);
      return;
    case "outfall": {
      box(m, s, x - 0.015, y - 0.015, g - 0.06, x + 0.015, y + 0.015, h - r, concrete);
      flange(m, s, x, y, h, ou, ov, r * 1.05, FITTING.mouth, sides, false, false);
      const lip = FLANGE_T / 2 + 0.002;
      disc(m, s, x + ou * lip, y + ov * lip, h, ou, ov, 0, r * 1.05, solid(FITTING.bore), sides);
      return;
    }
    case "intake": {
      const top = h + r * 0.9, grate = solid(FITTING.grate), bar = solid(look.colour);
      box(m, s, x - INTAKE, y - INTAKE, g - 0.05, x + INTAKE, y + INTAKE, top, concrete);
      const i = INTAKE - 0.0125;
      box(m, s, x - i, y - i, top, x + i, y + i, top + 0.002, grate);
      for (const k of [-0.5, 0, 0.5]) box(m, s, x - i, y + k * i - 0.004, top + 0.002, x + i, y + k * i + 0.004, top + 0.006, bar);
      return;
    }
    case "pump": {
      const top = Math.max(h + r * 2, g + PUMP_TALL * ZT), o = 0.015;
      box(m, s, x - PUMP_U, y - PUMP_V, g, x + PUMP_U, y + PUMP_V, top, solid(FITTING.pumpWall));
      // Its door, on the +v wall; its wheel, on the +u.
      box(m, s, x - 0.03, y + PUMP_V, g, x + 0.03, y + PUMP_V + 0.003, g + (top - g) * 0.6, solid(FITTING.pumpDoor));
      const mid = (g + top) / 2, wheel = solid(FITTING.wheel);
      disc(m, s, x + PUMP_U + 0.002, y, mid, 1, 0, 0.0225, 0.0325, wheel, 16);
      disc(m, s, x + PUMP_U + 0.002, y, mid, 1, 0, 0, 0.008, wheel, 8);
      box(m, s, x - PUMP_U - o, y - PUMP_V - o, top, x + PUMP_U + o, y + PUMP_V + o, top + 0.035, solid(FITTING.pumpRoof));
      return;
    }
  }
}

/**
 * A BUILDING'S PORT, an OUTLET on its wall, at the cell (x, y) in front of
 * it — the building on the far side, along (−dx, −dy): a square plate on the
 * wall, a short spigot out of it in the main's own metal, and a flange at its
 * end in the fluid's colour, bolted at the corners and round. Open, the
 * flange shows its dark bore; joined, a main's flange is bolted to it, the
 * main ending `PORT_JOINT` out from the wall. The wall stands `setback` in
 * past the cell's face: an AI building's own, or an entry's at the edge of
 * the plot (0). Part of the building, joined to or not. @see pipeCell, portSetback
 */
export function outlet(
  m: PipeMesh, s: number, x: number, y: number, z: number, dx: number, dy: number,
  r: number, fluid: number, metal: number, sides: number, joined = false, bolts = true, setback = 0,
) {
  const h = z * ZT, wu = x - dx * (0.5 + setback), wv = y - dy * (0.5 + setback), P = r * PLATE;
  // Out from the wall: along u for a wall facing u, else along v; across the other, and up.
  const at = (k: number) => [wu + dx * k, wv + dy * k] as const;
  const plate = () => {
    const [au, av] = at(0), [bu, bv] = at(PLATE_T);
    const u0 = dx ? Math.min(au, bu) : wu - P, u1 = dx ? Math.max(au, bu) : wu + P;
    const v0 = dy ? Math.min(av, bv) : wv - P, v1 = dy ? Math.max(av, bv) : wv + P;
    box(m, s, u0, v0, h - P, u1, v1, h + P, solid(PLATE_COLOUR));
    if (!bolts || facing(dx, dy, 0) <= 0) return;
    // Its four bolts, in from the corners.
    const [fu, fv] = at(PLATE_T + 0.001), k = P * 0.72, head = solid(darker(PLATE_COLOUR, 0.6));
    for (const [a, b] of [[-k, -k], [k, -k], [-k, k], [k, k]]) {
      disc(m, s, fu + (dx ? 0 : a), fv + (dy ? 0 : a), h + b, dx, dy, 0, P * 0.09, head, 6);
    }
  };
  const [su, sv] = at(PLATE_T), [eu, ev] = at(SPIGOT - FLANGE_T), [cu, cv] = at(SPIGOT - FLANGE_T / 2);
  const spigot = () => tube(m, s, su, sv, h, eu, ev, h, r, solid(metal), sides);
  const end = () => {
    flange(m, s, cu, cv, h, dx, dy, r, fluid, sides, bolts, false);
    if (joined) return;
    const o = FLANGE_T / 2 + 0.002;
    disc(m, s, cu + dx * o, cv + dy * o, h, dx, dy, 0, r * 0.8, solid(FITTING.bore), sides);
  };
  // Nearer draws over farther.
  if (facing(dx, dy, 0) > 0) { plate(); spigot(); end(); } else { end(); spigot(); plate(); }
}

/** `0xRRGGBB`, opaque, as a vertex word. */
export const solid = (colour: number) => rgba(colour, 1);
