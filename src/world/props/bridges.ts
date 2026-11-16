/**
 * World v2 — BRIDGES, as models: five kinds, each in pieces a tile long.
 * Metres; `x` along the bridge, `y` to its left, `z` up from the road's own
 * surface at 0. A tile is 11.1 m: a piece runs ±5.55 along, and the deck's
 * edge is at y = 5.55. A piece is placed a tile at a time, turned to the side
 * of the deck it is the edge of. @see render/bridge-props for what goes where
 *
 *  - `arch…`     a STONE VIADUCT: an arch a tile, coursed masonry, voussoirs
 *                and a keystone round each, a solid parapet with a coping.
 *  - `trestle…`  a TIMBER BRIDGE: board-clad crib piers with cutwaters, a deep
 *                beam under planking, a braced railing.
 *  - `girder…`   a STEEL PLATE GIRDER on concrete hammerhead piers: stiffened
 *                web between flanges, a concrete parapet and steel rail.
 *  - `truss…`    a THROUGH TRUSS in red oxide: chords, posts and diagonals
 *                either side of the road, braced across over it.
 *  - `stay…`     a CABLE-STAYED bridge: white pylons through the deck, stays
 *                fanned from them to its edges, a slim faired deck.
 *
 * Painted by the vehicles' rasteriser; a face's stone is laid course by
 * course as it is sampled, so no two blocks need a triangle of their own.
 */
import type { Mat } from "../agents/cars/models";
import { face, type Tri, type V3 } from "../agents/cars/raster";
import { limb } from "../agents/people/figures";
import { box, type Prop, type PropShadow } from "./models";

/** Half a tile, and half a step, in metres. */
export const HT = 5.55, HS = 2.268;
const NONE: PropShadow = { hl: 0, hw: 0, edge: 0, soft: 0.01, strength: 0, reach: 0 };
const hash = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

/** Everything added to `out` since `from`, laid as `paint` says. */
const laid = (out: Tri[], from: number, paint: (p: V3) => Mat) => { for (let k = from; k < out.length; k++) out[k].paint = paint; };
/** A box whose faces are laid by `paint`. */
function pbox(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: Mat, out: Tri[], paint: (p: V3) => Mat) {
  const n = out.length;
  box(x0, x1, y0, y1, z0, z1, mat, out);
  laid(out, n, paint);
}

/** COURSED STONE: blocks 0.45 m tall and twice as long, each course half a block on from the last, three tones of stone and a line of mortar round each. */
const masonry = (p: V3): Mat => {
  const u = p[0] + p[1], row = Math.floor((p[2] + 60) / 0.45), v = u + (row & 1) * 0.45 + 60;
  if ((p[2] + 60) % 0.45 < 0.04 || v % 0.9 < 0.04) return "mortar";
  const t = hash(row * 31 + Math.floor(v / 0.9) * 17);
  return t < 0.25 ? "stoneB" : t < 0.8 ? "stoneA" : "stoneC";
};
/** CAST CONCRETE: a pour line every 1.13 m up it, and the shutters' joints along it. */
const concrete = (p: V3): Mat => ((p[2] + 60) % 1.134 < 0.035 || (p[0] + p[1] + 60) % 2.4 < 0.03 ? "joint" : "concrete");
/** PLANKS across the bridge, a board every 0.28 m along it, no two quite the colour of each other. */
const planks = (p: V3): Mat => { const k = Math.floor((p[0] + 60) / 0.28); return (p[0] + 60) % 0.28 < 0.025 ? "timberDark" : hash(k) < 0.35 ? "timberLight" : "timber"; };

/** A straight member between two points, `r` across: a strut, a rail, a cable. */
const bar = (a: V3, b: V3, r: number, mat: Mat, out: Tri[], N = 6) => limb(a, b, r, r, mat, out, N, false);

// ── a stone viaduct ──────────────────────────────────────────────────────
/** Where an arch springs from, below the road; its half span; its rise. */
export const ARCH_SPRING = 6.6;
const ARCH_A = 4.55, ARCH_B = 5.1, ARCH_N = 20;
const archPt = (k: number, grow = 0): [number, number] => { const t = Math.PI - (k / ARCH_N) * Math.PI; return [Math.cos(t) * (ARCH_A + grow), -ARCH_SPRING + Math.sin(t) * (ARCH_B + grow)]; };

/** A stone parapet along the left edge: coursed, coped, a pier of it at each end of the tile. */
function stoneParapet(out: Tri[]) {
  pbox(-HT, HT, HT - 0.5, HT, 0, 1.05, "stoneA", out, masonry);
  box(-HT, HT, HT - 0.58, HT + 0.08, 1.05, 1.19, "ashlar", out);
  for (const sg of [-1, 1]) {
    const x0 = sg < 0 ? -HT : HT - 0.6, x1 = sg < 0 ? -HT + 0.6 : HT;
    pbox(x0, x1, HT - 0.62, HT + 0.12, 0, 1.32, "stoneA", out, masonry);
    box(x0 - (sg < 0 ? 0 : 0.06), x1 + (sg < 0 ? 0.06 : 0), HT - 0.7, HT + 0.2, 1.32, 1.46, "ashlar", out);
  }
}
function archSideTris(): Tri[] {
  const out: Tri[] = [], Y = HT;
  // THE SPANDREL: the wall between the arch and the road, stone by stone.
  let n = out.length;
  for (let k = 0; k < ARCH_N; k++) {
    const [x0, z0] = archPt(k), [x1, z1] = archPt(k + 1);
    face([[x0, Y, z0], [x1, Y, z1], [x1, Y, 0], [x0, Y, 0]], "stoneA", [(x0 + x1) / 2, Y - 2, -1], out);
  }
  laid(out, n, masonry);
  // The piers' heads either end of it, a hand proud of the wall.
  for (const [x0, x1] of [[-HT, -ARCH_A], [ARCH_A, HT]]) pbox(x0, x1, Y - 0.7, Y + 0.12, -ARCH_SPRING, 0, "stoneA", out, masonry);
  // THE ARCH RING: voussoirs, alternately light and lighter, and a keystone standing out of them at the crown.
  for (let k = 0; k < ARCH_N; k++) {
    const [x0, z0] = archPt(k), [x1, z1] = archPt(k + 1), [X0, Z0] = archPt(k, 0.5), [X1, Z1] = archPt(k + 1, 0.5);
    const key = k === ARCH_N / 2 - 1 || k === ARCH_N / 2, y = Y + (key ? 0.16 : 0.07);
    face([[x0, y, z0], [x1, y, z1], [X1, y, Z1], [X0, y, Z0]], key ? "ashlar" : k & 1 ? "stoneC" : "ashlar", [(x0 + x1) / 2, Y - 2, -1], out);
    // Its soffit, where the far half of the ring turns its underside to the eye.
    face([[x0, Y - 0.7, z0], [x1, Y - 0.7, z1], [x1, y, z1], [x0, y, z0]], "stoneB", [(x0 + x1) / 2, Y - 0.35, -ARCH_SPRING - 4], out);
  }
  box(-0.32, 0.32, Y - 0.1, Y + 0.2, -ARCH_SPRING + ARCH_B - 0.05, -ARCH_SPRING + ARCH_B + 0.78, "ashlar", out);
  // A string course under the parapet, and the parapet.
  box(-HT, HT, Y - 0.75, Y + 0.17, -0.3, 0, "ashlar", out);
  stoneParapet(out);
  return out;
}
function archParapetTris(): Tri[] { const out: Tri[] = []; stoneParapet(out); return out; }
/** The pier between two arches, at the tile's low end: its head, from the springing to the road. */
function archHeadTris(): Tri[] { const out: Tri[] = []; pbox(-HT - 1, -HT + 1, -HT, HT, -ARCH_SPRING, -0.4, "stoneA", out, masonry); return out; }
/** A half step of its shaft, its top at the origin: stood one on another from the water up. */
function archShaftTris(): Tri[] { const out: Tri[] = []; pbox(-HT - 1.05, -HT + 1.05, -HT, HT, -HS, 0, "stoneA", out, masonry); return out; }
/** Its footing at the waterline: a plinth, pointed up and down stream. */
function archFootTris(): Tri[] {
  const out: Tri[] = [], x0 = -HT - 1.35, x1 = -HT + 1.35;
  box(x0, x1, -HT, HT, 0, 0.75, "stoneB", out);
  box(x0 - 0.12, x1 + 0.12, -HT - 0.05, HT + 0.05, 0.6, 0.78, "ashlar", out);
  for (const sg of [-1, 1]) {
    const y0 = sg * HT, y1 = sg * (HT + 1.5), c: V3 = [-HT, sg * (HT + 0.4), 0.3];
    face([[x0, y0, 0], [-HT, y1, 0], [-HT, y1, 0.75], [x0, y0, 0.75]], "stoneB", c, out);
    face([[x1, y0, 0], [-HT, y1, 0], [-HT, y1, 0.75], [x1, y0, 0.75]], "stoneA", c, out);
    face([[x0, y0, 0.75], [x1, y0, 0.75], [-HT, y1, 0.75]], "ashlar", c, out);
  }
  return out;
}

// ── a timber bridge ──────────────────────────────────────────────────────
/** A squared timber between two points, `w` across: a brace, a rail. */
const balk = (a: V3, b: V3, w: number, mat: Mat, out: Tri[]) => limb(a, b, w * 0.7, w * 0.7, mat, out, 4, false);
/** BOARDS laid one on another up a wall: each 0.34 m, a shadow between, no two quite the colour of each other. */
const boards = (p: V3): Mat => { const z = p[2] + 60, k = Math.floor(z / 0.34); return z % 0.34 < 0.045 ? "timberDark" : hash(k * 3.7) < 0.3 ? "timberLight" : "timber"; };
/** A braced railing along the left edge: stout posts with caps, a top and a bottom rail, a brace across each bay, one way then the other. */
function fence(out: Tri[]) {
  const y = HT - 0.24, bay = (2 * HT) / 4;
  for (let k = 0; k <= 4; k++) {
    const x = -HT + k * bay, half = k === 0 || k === 4 ? 0.09 : 0.14;
    box(Math.max(-HT, x - half), Math.min(HT, x + half), y - 0.14, y + 0.14, -0.1, 1.28, "timberDark", out);
    box(Math.max(-HT, x - half - 0.04), Math.min(HT, x + half + 0.04), y - 0.18, y + 0.18, 1.28, 1.37, "timberLight", out);
    if (k === 4) continue;
    const up = k % 2 === 0;
    balk([x + 0.14, y, up ? 0.3 : 1.0], [x + bay - 0.14, y, up ? 1.0 : 0.3], 0.13, "timber", out);
  }
  box(-HT, HT, y - 0.1, y + 0.1, 1.02, 1.2, "timber", out);
  box(-HT, HT, y - 0.08, y + 0.08, 0.16, 0.32, "timber", out);
}
function trestleEdgeTris(): Tri[] {
  const out: Tri[] = [];
  // A heavy kerb timber on the planking's ends; under them a deep beam, faced, and the joists' ends along it.
  pbox(-HT, HT, HT - 0.75, HT + 0.18, -0.16, 0.02, "timber", out, planks);
  box(-HT, HT, HT - 0.62, HT - 0.4, 0.02, 0.24, "timberDark", out);
  box(-HT, HT, HT - 0.5, HT + 0.02, -1.0, -0.16, "timberDark", out);
  box(-HT, HT, HT - 0.48, HT + 0.05, -0.9, -0.26, "timber", out);
  for (let x = -HT + 0.46; x < HT; x += 0.925) box(x - 0.12, x + 0.12, HT + 0.05, HT + 0.16, -0.44, -0.18, "timberLight", out);
  for (const x of [-HT + 0.2, HT - 0.2]) box(x - 0.06, x + 0.06, HT + 0.05, HT + 0.09, -0.94, -0.22, "iron", out);
  fence(out);
  return out;
}
function trestleRailTris(): Tri[] { const out: Tri[] = []; fence(out); return out; }
/** How tall a pier is made, half steps: one model for each. @see render/bridge-props */
export const BENT_MAX = 12;
/** How far under the road a timber pier's head is: the foot of the beams it carries. */
export const BENT_UNDER = 1.0;
/**
 * A TIMBER PIER `n` half steps tall, its foot at the origin — the waterline — and its head under the beams: a crib
 * of boards between four corner posts, broader at the foot than the head, a brace let into each broad face, a
 * cap of two great timbers crossed on top, and a pointed cutwater up and down stream. One solid thing, not a
 * thicket of poles: timber as this town builds it.
 */
function cribPierTris(n: number): Tri[] {
  const out: Tri[] = [], H = n * HS, top = H - 0.75;
  // Half its size along the bridge and across it, at a height.
  const ax = (z: number) => 1.0 + 0.045 * (top - z), ay = (z: number) => 4.5 + 0.07 * (top - z);
  const c = (sx: number, sy: number, z: number): V3 => [sx * ax(z), sy * ay(z), z], mid: V3 = [0, 0, H / 2];
  let m = out.length;
  for (const [a, b] of [[[1, 1], [1, -1]], [[1, -1], [-1, -1]], [[-1, -1], [-1, 1]], [[-1, 1], [1, 1]]]) face([c(a[0], a[1], 0), c(b[0], b[1], 0), c(b[0], b[1], top), c(a[0], a[1], top)], "timber", mid, out);
  laid(out, m, boards);
  // Its corner posts, proud of the boards, an iron strap round the head of each.
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    limb(c(sx, sy, 0), c(sx, sy, top), 0.24, 0.22, "timberDark", out, 8, false);
    limb(c(sx, sy, top - 0.5), c(sx, sy, top - 0.36), 0.25, 0.25, "iron", out, 8, false);
  }
  // A brace across each broad face, foot to head, and a waling over its foot.
  if (H > 3.2) for (const sx of [-1, 1]) {
    const x = (z: number) => sx * (ax(z) + 0.1);
    balk([x(0.5), -sx * ay(0.5) * 0.92, 0.5], [x(top - 0.5), sx * ay(top - 0.5) * 0.92, top - 0.5], 0.24, "timberLight", out);
    box(Math.min(x(0.4), x(0.4) + sx * 0.14), Math.max(x(0.4), x(0.4) + sx * 0.14), -ay(0.4) - 0.1, ay(0.4) + 0.1, 0.25, 0.55, "timberDark", out);
  }
  // THE CAP: a great timber across the pier, and a shorter one each side of it under the beams.
  box(-0.45, 0.45, -HT + 0.05, HT - 0.05, top, H, "timberDark", out);
  box(-0.4, 0.4, -HT + 0.02, HT - 0.02, top + 0.07, H - 0.07, "timber", out);
  for (const y of [-HT + 0.3, HT - 0.3]) box(-1.3, 1.3, y - 0.25, y + 0.25, H - 0.32, H, "timberLight", out);
  // CUTWATERS: a prow of boards up and down stream, an iron edge to it.
  const hw = Math.min(1.9, H * 0.45);
  for (const sy of [-1, 1]) {
    const y0 = sy * ay(0), y1 = sy * (ay(0) + 1.3), k: V3 = [0, sy * (ay(0) + 0.3), hw / 2];
    m = out.length;
    face([[-ax(0), y0, 0], [0, y1, 0], [0, y1 - sy * 0.5, hw], [-ax(hw), sy * ay(hw), hw]], "timber", k, out);
    face([[ax(0), y0, 0], [0, y1, 0], [0, y1 - sy * 0.5, hw], [ax(hw), sy * ay(hw), hw]], "timber", k, out);
    laid(out, m, boards);
    limb([0, y1, 0], [0, y1 - sy * 0.5, hw], 0.07, 0.07, "iron", out, 6, false);
  }
  return out;
}

// ── a steel plate girder ─────────────────────────────────────────────────
/** A concrete parapet with a steel rail on posts along the left edge. */
function railed(out: Tri[], steel: Mat = "chrome") {
  pbox(-HT, HT, HT - 0.42, HT, 0, 0.6, "concrete", out, concrete);
  box(-HT, HT, HT - 0.48, HT + 0.05, 0.6, 0.68, "pave", out);
  for (let x = -HT + 0.925; x < HT; x += 1.85) box(x - 0.045, x + 0.045, HT - 0.27, HT - 0.18, 0.68, 1.22, "iron", out);
  for (const z of [0.95, 1.22]) bar([-HT, HT - 0.225, z], [HT, HT - 0.225, z], 0.04, steel, out);
}
function girderEdgeTris(): Tri[] {
  const out: Tri[] = [];
  // The slab's lip with a drip under it; the girder: a top flange, a web set back, stiffeners, a bottom flange.
  box(-HT, HT, HT - 0.7, HT + 0.14, -0.3, 0, "concrete", out);
  box(-HT, HT, HT - 0.02, HT + 0.14, -0.38, -0.3, "joint", out);
  box(-HT, HT, HT - 0.62, HT - 0.06, -0.42, -0.3, "steelBlueDark", out);
  box(-HT, HT, HT - 0.4, HT - 0.28, -1.72, -0.42, "steelBlue", out);
  box(-HT, HT, HT - 0.66, HT - 0.02, -1.86, -1.72, "steelBlueDark", out);
  for (let x = -HT + 0.925; x < HT; x += 1.85) box(x - 0.05, x + 0.05, HT - 0.56, HT - 0.1, -1.72, -0.42, "steelBlue", out);
  // A splice plate with its bolts, mid span; a drain's outlet through the slab.
  box(-0.45, 0.45, HT - 0.28, HT - 0.24, -1.6, -0.55, "steelBlueDark", out);
  box(2.6, 2.8, HT + 0.02, HT + 0.2, -0.75, -0.3, "iron", out);
  railed(out);
  return out;
}
function girderRailTris(): Tri[] { const out: Tri[] = []; railed(out); return out; }
/** A hammerhead pier's head, a tile across: bearings, and a crosshead deep at its middle, tapering out to its ends. */
function girderCapTris(): Tri[] {
  const out: Tri[] = [], n = out.length;
  for (const sg of [-1, 1]) {
    // The underside rises from the shaft out to the end of it.
    const y0 = sg * 2.5, y1 = sg * HT, c: V3 = [0, sg * 4, -2.6];
    for (const x of [-1.05, 1.05]) face([[x, y0, -3.5], [x, y1, -2.75], [x, y1, -2.0], [x, y0, -2.0]], "concrete", c, out);
    face([[-1.05, y0, -3.5], [1.05, y0, -3.5], [1.05, y1, -2.75], [-1.05, y1, -2.75]], "concrete", c, out);
    face([[-1.05, y1, -2.75], [1.05, y1, -2.75], [1.05, y1, -2.0], [-1.05, y1, -2.0]], "concrete", c, out);
  }
  box(-1.05, 1.05, -2.5, 2.5, -3.5, -2.0, "concrete", out);
  laid(out, n, concrete);
  box(-1.15, 1.15, -HT, HT, -2.0, -1.9, "pave", out);
  for (const y of [-4.6, -1.6, 1.6, 4.6]) box(-0.45, 0.45, y - 0.3, y + 0.3, -1.9, -1.86, "iron", out);
  return out;
}
function girderShaftTris(): Tri[] {
  const out: Tri[] = [];
  // Its corners cut: eight-sided, a recess down each broad face.
  const n = out.length, X = 0.9, Y = 2.5, c = 0.3, mid: V3 = [0, 0, -HS / 2];
  const ring: [number, number][] = [[X, Y - c], [X - c, Y], [-X + c, Y], [-X, Y - c], [-X, -Y + c], [-X + c, -Y], [X - c, -Y], [X, -Y + c]];
  ring.forEach((p, k) => { const q = ring[(k + 1) % ring.length]; face([[p[0], p[1], -HS], [q[0], q[1], -HS], [q[0], q[1], 0], [p[0], p[1], 0]], "concrete", mid, out); });
  laid(out, n, concrete);
  for (const sg of [-1, 1]) box(sg * X - 0.02, sg * X + 0.02, -1.5, 1.5, -HS, 0, "joint", out);
  return out;
}
function girderFootTris(): Tri[] {
  const out: Tri[] = [];
  pbox(-1.4, 1.4, -3.1, 3.1, 0, 0.8, "concrete", out, concrete);
  for (const sg of [-1, 1]) {
    const y0 = sg * 3.1, y1 = sg * 4.5, c: V3 = [0, sg * 3.4, 0.4];
    face([[-1.4, y0, 0], [0, y1, 0], [0, y1, 0.8], [-1.4, y0, 0.8]], "joint", c, out);
    face([[1.4, y0, 0], [0, y1, 0], [0, y1, 0.8], [1.4, y0, 0.8]], "concrete", c, out);
    face([[-1.4, y0, 0.8], [1.4, y0, 0.8], [0, y1, 0.8]], "pave", c, out);
  }
  return out;
}
/** A lighting column on the parapet, its arm in over the road. */
function lampTris(): Tri[] {
  const out: Tri[] = [], y = HT - 0.21;
  box(-0.14, 0.14, y - 0.14, y + 0.14, 0.6, 0.95, "iron", out);
  limb([0, y, 0.95], [0, y, 6.4], 0.075, 0.05, "iron", out, 8, false);
  bar([0, y, 6.4], [0, y - 1.7, 6.75], 0.045, "iron", out);
  box(-0.16, 0.16, y - 2.3, y - 1.6, 6.66, 6.8, "iron", out);
  box(-0.12, 0.12, y - 2.24, y - 1.66, 6.6, 6.66, "lamp", out);
  return out;
}

// ── a through truss ──────────────────────────────────────────────────────
/** How high its top chord stands over the road. */
const TRUSS_H = 7.2;
/** The truss over the left edge: its top chord, its posts, and two diagonals a tile, up to the middle and down again; a low rail inside it. */
function trussPanel(out: Tri[]) {
  const y = HT - 0.3, I = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: Mat = "steelRed") => box(x0, x1, y0, y1, z0, z1, m, out);
  I(-HT, HT, y - 0.24, y + 0.24, TRUSS_H - 0.5, TRUSS_H, "steelRed");
  I(-HT, HT, y - 0.3, y + 0.3, TRUSS_H, TRUSS_H + 0.06, "steelRedDark");
  // Posts: half of one at each end of the tile, a lighter one at its middle.
  for (const [x0, x1] of [[-HT, -HT + 0.2], [HT - 0.2, HT]]) I(x0, x1, y - 0.2, y + 0.2, 0, TRUSS_H - 0.5);
  I(-0.13, 0.13, y - 0.13, y + 0.13, 0, TRUSS_H - 0.5, "steelRedDark");
  for (const sg of [-1, 1]) {
    const a: V3 = [sg * (HT - 0.25), y, 0.2], b: V3 = [sg * 0.25, y, TRUSS_H - 0.6];
    bar(a, b, 0.17, "steelRed", out, 4);
    // Gussets where it meets the chords.
    I(sg * HT - (sg > 0 ? 1.1 : 0), sg * HT + (sg > 0 ? 0 : 1.1), y + 0.2, y + 0.25, 0, 0.9, "steelRedDark");
  }
  I(-0.9, 0.9, y + 0.2, y + 0.25, TRUSS_H - 1.3, TRUSS_H - 0.5, "steelRedDark");
  for (const z of [0.6, 1.0]) bar([-HT, y - 0.5, z], [HT, y - 0.5, z], 0.035, "chrome", out);
  for (let x = -HT + 0.925; x < HT; x += 1.85) box(x - 0.04, x + 0.04, y - 0.54, y - 0.46, 0, 1.0, "iron", out);
}
function trussNearTris(): Tri[] {
  const out: Tri[] = [];
  // Its bottom chord under the road's edge, the floor beams' ends through it, a walkway's edge over it.
  box(-HT, HT, HT - 0.62, HT + 0.02, -1.1, -0.1, "steelRed", out);
  box(-HT, HT, HT - 0.7, HT + 0.1, -1.24, -1.1, "steelRedDark", out);
  box(-HT, HT, HT - 0.7, HT + 0.12, -0.1, 0, "concrete", out);
  for (let x = -HT + 0.925; x < HT; x += 1.85) box(x - 0.09, x + 0.09, HT - 0.05, HT + 0.08, -0.85, -0.3, "steelRedDark", out);
  trussPanel(out);
  return out;
}
function trussFarTris(): Tri[] { const out: Tri[] = []; trussPanel(out); return out; }
/** Over the road, a tile of it across: a strut at the tile's end and one at its middle, braced corner to corner between, knees down to the posts. */
function trussTopTris(): Tri[] {
  const out: Tri[] = [], z = TRUSS_H - 0.25;
  for (const x of [-HT + 0.12, 0]) box(x - 0.12, x + 0.12, -HT, HT, z - 0.16, z + 0.16, "steelRed", out);
  bar([-HT + 0.12, -HT, z], [0, HT, z], 0.07, "steelRedDark", out, 4);
  bar([-HT + 0.12, HT, z], [0, -HT, z], 0.07, "steelRedDark", out, 4);
  bar([0, -HT, z], [HT, HT, z], 0.07, "steelRedDark", out, 4);
  bar([0, HT, z], [HT, -HT, z], 0.07, "steelRedDark", out, 4);
  return out;
}

// ── a cable-stayed bridge ────────────────────────────────────────────────
/** Where its stays leave the pylon, over the road, nearest tile first; and where one meets the deck. */
export const STAY_AT = [13.5, 17.5, 21.5], STAY_Y = HT + 0.42;
const PYLON_TOP = 24.5, TILE = 2 * HT;
/** A slim railing along the left edge: thin posts, three wires. */
function wires(out: Tri[]) {
  box(-HT, HT, HT - 0.3, HT, 0, 0.22, "pylonShade", out);
  for (let x = -HT + 0.925; x < HT; x += 1.85) box(x - 0.03, x + 0.03, HT - 0.19, HT - 0.11, 0.22, 1.2, "pylonShade", out);
  for (const z of [0.55, 0.88, 1.2]) bar([-HT, HT - 0.15, z], [HT, HT - 0.15, z], 0.025, "chrome", out, 4);
}
function stayEdgeTris(): Tri[] {
  const out: Tri[] = [];
  // The deck's faired edge: a lip, a short face, and a long soffit sloping in under it — a blade to the wind.
  const c: V3 = [0, HT - 2, -0.8];
  box(-HT, HT, HT - 0.6, HT + 0.2, -0.22, 0, "pylon", out);
  face([[-HT, HT + 0.2, -0.22], [HT, HT + 0.2, -0.22], [HT, HT + 0.75, -0.62], [-HT, HT + 0.75, -0.62]], "pylon", c, out);
  face([[-HT, HT + 0.75, -0.62], [HT, HT + 0.75, -0.62], [HT, HT + 0.75, -0.86], [-HT, HT + 0.75, -0.86]], "pylonShade", c, out);
  face([[-HT, HT + 0.75, -0.86], [HT, HT + 0.75, -0.86], [HT, HT - 2.6, -1.95], [-HT, HT - 2.6, -1.95]], "pylonShade", c, out);
  for (const x of [-HT + 0.02, 1.85, -1.85]) box(x - 0.02, x + 0.02, HT + 0.2, HT + 0.77, -0.86, -0.22, "joint", out);
  wires(out);
  return out;
}
function stayRailTris(): Tri[] { const out: Tri[] = []; wires(out); return out; }
/** A stay from the pylon `at` tiles back along the bridge (−x) for the tile `d` out: every cable that passes over this tile, and the anchor of the one that ends on it. */
function staysOver(d: number, dir: 1 | -1, out: Tri[]) {
  for (let k = d; k <= STAY_AT.length; k++) {
    // From the pylon's face at its height to the deck `k` tiles out.
    const X = k * TILE, h = STAY_AT[k - 1], zAt = (x: number) => h + (0.35 - h) * (x / X);
    const x0 = (d - 0.5) * TILE, x1 = Math.min((d + 0.5) * TILE, X);
    const loc = (x: number): V3 => [dir * (x - d * TILE), STAY_Y, zAt(x)];
    bar(loc(x0), loc(x1), 0.07, "cable", out, 6);
    if (k !== d) continue;
    // ITS ANCHOR on the deck's edge: a steel shoe, the cable into a sleeve.
    box(-0.35, 0.35, HT + 0.05, HT + 0.8, -0.2, 0.3, "pylonShade", out);
    bar(loc(X - 1.6), loc(X), 0.11, "iron", out, 6);
  }
}
const stayTris = (d: number, dir: 1 | -1) => () => { const out: Tri[] = []; staysOver(d, dir, out); return out; };
/** A pylon's leg at the left edge of its tile, from under the deck to its head: tapered, the stays' first lengths either way from it, a light on top. */
function pylonLegTris(from = -2.2): Tri[] {
  const out: Tri[] = [], y = STAY_Y, c: V3 = [0, y, 10];
  // Four faces a length, narrowing as it rises. (`from`: where it starts — under the deck on the side that shows it, at the road on the side that hides it.)
  const sec: [number, number, number][] = [[from, 1.1, 0.85], [9, 0.85, 0.7], [PYLON_TOP - 3, 0.62, 0.6], [PYLON_TOP, 0.55, 0.55]];
  for (let k = 0; k + 1 < sec.length; k++) {
    const [z0, a0, b0] = sec[k], [z1, a1, b1] = sec[k + 1];
    const q = (sx: number, sy: number, top: boolean): V3 => [sx * (top ? a1 : a0), y + sy * (top ? b1 : b0), top ? z1 : z0];
    for (const [s0, s1, m] of [[[1, 1], [1, -1], "pylon"], [[1, -1], [-1, -1], "pylonShade"], [[-1, -1], [-1, 1], "pylonShade"], [[-1, 1], [1, 1], "pylon"]] as [number[], number[], Mat][])
      face([q(s0[0], s0[1], false), q(s1[0], s1[1], false), q(s1[0], s1[1], true), q(s0[0], s0[1], true)], m, c, out);
  }
  box(-0.62, 0.62, y - 0.62, y + 0.62, PYLON_TOP, PYLON_TOP + 0.3, "pylonShade", out);
  box(-0.1, 0.1, y - 0.1, y + 0.1, PYLON_TOP + 0.3, PYLON_TOP + 0.75, "tail", out);
  // The anchor boxes down its upper length, dark slots in the white.
  for (const h of STAY_AT) box(-0.75, 0.75, y - 0.3, y + 0.3, h - 0.45, h + 0.45, "joint", out);
  // Each stay's first half tile, either way.
  for (const dir of [1, -1] as const) STAY_AT.forEach((h, k) => {
    const X = (k + 1) * TILE, zAt = (x: number) => h + (0.35 - h) * (x / X);
    bar([dir * 0.6, y, zAt(0.6)], [dir * HT, y, zAt(HT)], 0.07, "cable", out, 6);
  });
  return out;
}
/** Between a pylon's legs, a tile of it across: a beam under the stays, and one at its head. */
function pylonBeamTris(): Tri[] {
  const out: Tri[] = [];
  box(-0.55, 0.55, -HT, HT, STAY_AT[0] - 2.6, STAY_AT[0] - 1.5, "pylon", out);
  box(-0.6, 0.6, -HT, HT, STAY_AT[0] - 2.72, STAY_AT[0] - 2.6, "pylonShade", out);
  box(-0.45, 0.45, -HT, HT, PYLON_TOP - 1.6, PYLON_TOP - 0.7, "pylon", out);
  return out;
}

const P = (id: string, tris: () => Tri[]): Prop => ({ id, tris, shadow: NONE, flat: true });
export const BRIDGE: readonly Prop[] = [
  P("archSide", archSideTris), P("archParapet", archParapetTris), P("archHead", archHeadTris), P("archShaft", archShaftTris), P("archFoot", archFootTris),
  P("trestleEdge", trestleEdgeTris), P("trestleRail", trestleRailTris),
  ...Array.from({ length: BENT_MAX }, (_, k) => P(`timberPier${k + 1}`, () => cribPierTris(k + 1))),
  P("girderEdge", girderEdgeTris), P("girderRail", girderRailTris), P("girderCap", girderCapTris), P("girderShaft", girderShaftTris), P("girderFoot", girderFootTris),
  P("bridgeLamp", lampTris),
  P("trussNear", trussNearTris), P("trussFar", trussFarTris), P("trussTop", trussTopTris),
  P("stayEdge", stayEdgeTris), P("stayRail", stayRailTris), P("pylonLeg", () => pylonLegTris()), P("pylonLegFar", () => pylonLegTris(0)), P("pylonBeam", pylonBeamTris),
  P("stayA1", stayTris(1, 1)), P("stayA2", stayTris(2, 1)), P("stayA3", stayTris(3, 1)),
  P("stayB1", stayTris(1, -1)), P("stayB2", stayTris(2, -1)), P("stayB3", stayTris(3, -1)),
];
