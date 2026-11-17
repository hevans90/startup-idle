/**
 * World v2 — THE FOUNDER'S GARAGE, in detail: what is on its breeze-block
 * box and round it, and the yard beside it. The box itself — its walls, its
 * courses, its parapet — is the mass the site raised (@see models massTris);
 * this is everything a first look at a first office should find: the roller
 * door half up on a lit workshop, the hand-painted sign, panels and plant on
 * the roof, a back garden gone to seed, and a builder's yard of gravel, tin
 * and timber with the lorry under its lean-to. @see dev/bake-landmarks.ts
 *
 * In metres, as the model is: `x` to the lower right, `y` to the lower left.
 */
import type { Mat } from "../agents/cars/models";
import { face, type V3 } from "../agents/cars/raster";
import { lathe } from "../props/models";
import type { Mass } from "../structures/projects/model";
import { X, Y, Z, cb, fence, pallet, parked, tinted, tubeX, type Out } from "./models";
import { HOUSE_PLOT, YARD_PLOT } from "./models";
import { YARD_GATE, YARD_STACK } from "./yard";

const JOINT = 0xb9b3a5, STEELC = 0x6f7880, GREEN = 0x2f6d4f, CREAM = 0xf3eed8, TIMBER = 0x9a7a52;

/** A sloped or odd face of one colour: `pts` round it, `inside` a point behind it. */
function slab(o: Out, pts: V3[], inside: V3, colour: number, mat: Mat = "roofing") { tinted(o, colour, () => face(pts, mat, inside, o)); }
/** Something round and upright: a profile of (radius, height) turned about (`x`, `y`). */
function turned(o: Out, x: number, y: number, prof: [number, number][], colour: number, mat: Mat = "iron", n = 12, cap = true) { tinted(o, colour, () => lathe(x, y, prof, mat, o, n, cap)); }
/** A shrub, or the head of a tree: a rounded mound of leaves. */
function bush(o: Out, x: number, y: number, z: number, r: number, h: number, colour: number) {
  turned(o, x, y, [[r * 0.75, z], [r, z + h * 0.35], [r * 0.82, z + h * 0.7], [r * 0.4, z + h * 0.95], [0, z + h]], colour, "hedge", 10, false);
}
function tree(o: Out, x: number, y: number, z: number, h: number, r: number, colour: number) {
  turned(o, x, y, [[0.22, z], [0.15, z + h * 0.5], [0.1, z + h * 0.62]], 0x6b4f35, "bark", 7);
  bush(o, x, y, z + h * 0.42, r, h * 0.6, colour);
  bush(o, x + r * 0.45, y - r * 0.3, z + h * 0.38, r * 0.7, h * 0.42, colour - 0x0a0c06);
  bush(o, x - r * 0.4, y + r * 0.35, z + h * 0.36, r * 0.66, h * 0.4, colour + 0x060a04);
}
/** A plant in a pot. */
function potted(o: Out, x: number, y: number, z: number, s = 1) {
  turned(o, x, y, [[0.26 * s, z], [0.34 * s, z + 0.5 * s], [0.3 * s, z + 0.5 * s]], 0xb5694a, "brick", 9);
  bush(o, x, y, z + 0.42 * s, 0.42 * s, 0.85 * s, 0x4f7a3f);
}
/** A road cone; a drum of oil or of water. */
function cone(o: Out, x: number, y: number, z: number) {
  cb(o, x - 0.2, x + 0.2, y - 0.2, y + 0.2, z, z + 0.04, 0x1f2226, "tyre");
  turned(o, x, y, [[0.15, z + 0.04], [0.09, z + 0.32]], 0xf06a1e, "sign", 8, false);
  turned(o, x, y, [[0.09, z + 0.32], [0.065, z + 0.46]], 0xf4f4ee, "linen", 8, false);
  turned(o, x, y, [[0.065, z + 0.46], [0.03, z + 0.68]], 0xf06a1e, "sign", 8);
}
function drum(o: Out, x: number, y: number, z: number, colour: number) {
  turned(o, x, y, [[0.3, z], [0.3, z + 0.88], [0.27, z + 0.9]], colour, "paint", 12);
  for (const zz of [0.28, 0.6]) turned(o, x, y, [[0.315, z + zz], [0.315, z + zz + 0.04]], colour - 0x101010, "paint", 12, false);
}
/** A cable drum, lying on its flange: two discs and the wound cable between. */
function cableDrum(o: Out, x: number, y: number, z: number) {
  turned(o, x, y, [[0.75, z], [0.75, z + 0.07]], TIMBER, "timber", 14);
  turned(o, x, y, [[0.5, z + 0.07], [0.5, z + 0.62]], 0x23262b, "tyre", 14, false);
  turned(o, x, y, [[0.75, z + 0.62], [0.75, z + 0.7]], TIMBER, "timber", 14);
  turned(o, x, y, [[0.12, z + 0.7], [0.12, z + 0.74]], STEELC, "iron", 8);
}
/** A bulk bag of sand or stone: a white sack, its four loops, what is in it showing at the top. */
function bulkBag(o: Out, x: number, y: number, z: number, fill: number) {
  cb(o, x - 0.46, x + 0.46, y - 0.46, y + 0.46, z, z + 0.86, 0xe9e6dc, "linen");
  cb(o, x - 0.4, x + 0.4, y - 0.4, y + 0.4, z + 0.86, z + 0.92, fill, "gravel");
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) cb(o, x + dx * 0.42 - 0.04, x + dx * 0.42 + 0.04, y + dy * 0.42 - 0.04, y + dy * 0.42 + 0.04, z + 0.86, z + 1.06, 0x3a6fb8, "paint");
}
/** A pallet of bags, laid in rows; and a stack of sawn timber in its bands. */
function bags(o: Out, x: number, y: number, z: number, rows: number, colour: number) {
  cb(o, x - 0.6, x + 0.6, y - 0.5, y + 0.5, z, z + 0.14, TIMBER, "timber");
  for (let r = 0; r < rows; r++) for (let k = 0; k < 2; k++) for (let q = 0; q < 2; q++) {
    const turn = r % 2 === 0, bx = x + (turn ? (k - 0.5) * 0.58 : (q - 0.5) * 0.52), by = y + (turn ? (q - 0.5) * 0.46 : (k - 0.5) * 0.5);
    cb(o, bx - (turn ? 0.27 : 0.24), bx + (turn ? 0.27 : 0.24), by - (turn ? 0.21 : 0.23), by + (turn ? 0.21 : 0.23), z + 0.14 + r * 0.17, z + 0.14 + r * 0.17 + 0.15, colour + ((r + k + q) % 2 ? 0x060606 : 0), "linen");
  }
}
function planks(o: Out, x: number, y: number, z: number, len: number, layers: number) {
  for (const a of [-len / 2 + 0.5, len / 2 - 0.5]) cb(o, x - 0.6, x + 0.6, y + a - 0.06, y + a + 0.06, z, z + 0.1, 0x7a5a3a, "timberDark");
  for (let l = 0; l < layers; l++) for (let k = 0; k < 5; k++) cb(o, x - 0.56 + k * 0.225, x - 0.56 + k * 0.225 + 0.2, y - len / 2 + (l % 2) * 0.12, y + len / 2 - ((l + k) % 3) * 0.1, z + 0.1 + l * 0.065, z + 0.1 + l * 0.065 + 0.055, [0xcaa56c, 0xd3b17a, 0xbf9a62][(l + k) % 3], "timberLight");
  for (const a of [-len / 4, len / 4]) cb(o, x - 0.58, x + 0.58, y + a - 0.02, y + a + 0.02, z + 0.1, z + 0.1 + layers * 0.065 + 0.01, 0x2f6fbf, "paint");
}
/** A window in a wall: on the lit face (`on` "y", at `y = at`) or the shaded one (`on` "x"): its frame, panes between glazing bars, a sill. */
function win(o: Out, on: "x" | "y", at: number, a0: number, a1: number, z0: number, z1: number, cols: number, o2: { bars?: boolean; frame?: number; glass?: number } = {}) {
  const put = (b0: number, b1: number, zz0: number, zz1: number, d: number, colour: number, mat: Mat = "linen") =>
    on === "y" ? cb(o, b0, b1, at, at + d, zz0, zz1, colour, mat) : cb(o, at, at + d, b0, b1, zz0, zz1, colour, mat);
  const fr = o2.frame ?? 0xeceae2;
  put(a0 - 0.1, a1 + 0.1, z0 - 0.1, z1 + 0.1, 0.07, fr);
  put(a0, a1, z0, z1, 0.09, o2.glass ?? 0x6f93a8, "pane");
  for (let k = 1; k < cols; k++) { const a = a0 + ((a1 - a0) * k) / cols; put(a - 0.035, a + 0.035, z0, z1, 0.12, fr); }
  put(a0, a1, (z0 + z1) / 2 - 0.03, (z0 + z1) / 2 + 0.03, 0.12, fr);
  put(a0 - 0.18, a1 + 0.18, z0 - 0.22, z0 - 0.1, 0.2, 0xa7a39b, "stone");
  if (o2.bars) for (let a = a0 + 0.18; a < a1 - 0.05; a += 0.22) put(a - 0.015, a + 0.015, z0, z1, 0.16, 0x2a2e33, "iron");
}

/**
 * THE BUILDING'S OWN: on the box `m` the site raised, standing on a plinth `level` high.
 */
export function garageBuilding(o: Out, m: Mass, level: number) {
  const x0 = X(m.u0), x1 = X(m.u1), y0 = Y(m.v0), front = Y(m.v1), g = Z(m.z0), top = Z(m.z1), mid = (x0 + x1) / 2;
  const px0 = X(0) + 0.9, px1 = X(HOUSE_PLOT.w) + 0.4, py0 = Y(0) + 0.9, py1 = Y(HOUSE_PLOT.h) - 0.9;

  // ── ITS BLOCKWORK: the upright joints, broken bond, a course at a time; a concrete ring beam under the parapet ──
  for (let k = 0, z = g + 0.5; z < top - 0.7; z += 0.43, k++) {
    for (let a = x0 + 0.45 + (k % 2) * 0.45; a < x1 - 0.2; a += 0.9) cb(o, a - 0.012, a + 0.012, front, front + 0.02, z, z + 0.43, JOINT);
    for (let a = y0 + 0.45 + (k % 2) * 0.45; a < front - 0.2; a += 0.9) cb(o, x1, x1 + 0.02, a - 0.012, a + 0.012, z, z + 0.43, JOINT);
  }
  cb(o, x0 - 0.06, x1 + 0.06, y0 - 0.06, front + 0.06, top - 0.62, top - 0.3, 0xb7b2a6, "stone");
  // (Weather on it: a stain under each end of the beam, a darker foot where the rain splashes.)
  for (const a of [x0 + 1.6, x1 - 2.4, mid + 6.2]) cb(o, a, a + 0.5, front, front + 0.015, top - 2.2, top - 0.62, 0xc4bdaf);
  cb(o, x0, x1, front, front + 0.018, g + 0.45, g + 0.75, 0xc9c3b5);
  // ── THE GUTTER along the eave and a downpipe at each end, into a gully ──
  cb(o, x0 - 0.1, x1 + 0.1, front + 0.06, front + 0.26, top - 0.34, top - 0.2, 0x4a5058, "iron");
  for (const a of [x0 + 0.35, x1 - 0.35]) {
    cb(o, a - 0.07, a + 0.07, front + 0.06, front + 0.2, g, top - 0.34, 0x4a5058, "iron");
    for (const z of [g + 1.2, g + 3.0]) cb(o, a - 0.1, a + 0.1, front + 0.02, front + 0.22, z, z + 0.06, 0x363b42, "iron");
    cb(o, a - 0.22, a + 0.22, front + 0.02, front + 0.46, g - 0.02, g + 0.03, 0x4a4f55, "iron");
  }

  // ── THE ROLLER DOOR, half up on the lit workshop ──
  const dw = 9.2, dh = 3.7, d0 = mid - dw / 2 + 0.6, d1 = d0 + dw;
  cb(o, d0 - 0.3, d1 + 0.3, front, front + 0.14, g, g + dh + 0.4, 0x8a9198, "chrome");
  // (The room behind it: a dark wall, a lit floor, and what a company starts with.)
  cb(o, d0, d1, front, front + 0.16, g, g + 2.25, 0x3d3327, "interior");
  cb(o, d0, d1, front, front + 0.17, g, g + 0.12, 0x8d8474, "pave");
  // A bench along the back: its top, its legs, a vice; two monitors and a lamp on it, a tower under it.
  cb(o, d0 + 0.5, d0 + 4.3, front, front + 0.2, g + 0.86, g + 0.96, 0xa98660, "timber");
  for (const a of [d0 + 0.6, d0 + 2.35, d0 + 4.1]) cb(o, a, a + 0.1, front, front + 0.19, g + 0.12, g + 0.86, 0x5d4a35, "timberDark");
  for (const a of [d0 + 1.0, d0 + 1.95]) { cb(o, a, a + 0.8, front, front + 0.22, g + 1.1, g + 1.62, 0x9fd3ff, "light"); cb(o, a + 0.34, a + 0.46, front, front + 0.21, g + 0.96, g + 1.1, 0x23262b, "trim"); }
  cb(o, d0 + 3.2, d0 + 3.5, front, front + 0.21, g + 0.96, g + 1.45, 0xffd27a, "lamp");
  cb(o, d0 + 2.9, d0 + 3.25, front, front + 0.2, g + 0.14, g + 0.72, 0x23262b, "trim");
  cb(o, d0 + 3.0, d0 + 3.06, front, front + 0.21, g + 0.5, g + 0.56, 0x3fe07a, "light");
  // Shelving up the middle: uprights, three shelves, boxes and tins on them.
  for (const a of [d0 + 4.9, d0 + 6.9]) cb(o, a, a + 0.07, front, front + 0.2, g + 0.12, g + 2.25, 0x7a838c, "chrome");
  for (let s2 = 0; s2 < 3; s2++) {
    const z = g + 0.5 + s2 * 0.62;
    cb(o, d0 + 4.9, d0 + 6.97, front, front + 0.2, z, z + 0.05, 0x7a838c, "chrome");
    for (let k = 0; k < 4; k++) cb(o, d0 + 5.02 + k * 0.48, d0 + 5.02 + k * 0.48 + 0.4, front, front + 0.21, z + 0.05, z + 0.05 + 0.24 + ((k + s2) % 3) * 0.1, [0xb98a4e, 0x3f6b9a, 0xc84a3a, 0xd9c7a0][(k + s2 * 2) % 4], "paint");
  }
  // A rack of kit on the right, its lights; a whiteboard beside it.
  cb(o, d1 - 1.6, d1 - 0.7, front, front + 0.2, g + 0.12, g + 2.0, 0x1c1f24, "trim");
  for (let r = 0; r < 7; r++) for (let k = 0; k < 3; k++) cb(o, d1 - 1.5 + k * 0.26, d1 - 1.5 + k * 0.26 + 0.07, front, front + 0.215, g + 0.4 + r * 0.22, g + 0.44 + r * 0.22, (r * 3 + k) % 4 === 0 ? 0xffb347 : 0x3fe07a, "light");
  cb(o, d1 - 0.55, d1 - 0.1, front, front + 0.19, g + 0.9, g + 2.0, 0xf2f2ec, "linen");
  // (The lamplight falling out of it onto the apron.)
  cb(o, d0 + 0.3, d1 - 0.3, front + 0.2, front + 2.6, level, level + 0.012, 0xd8cdb2, "pave");
  // THE DOOR ITSELF, rolled half up: its slats, the bar at its foot, the box it rolls into and its guides.
  for (let z = g + 2.25; z < g + dh - 0.05; z += 0.2) cb(o, d0, d1, front, front + 0.2 + ((Math.round(z * 5) % 2) * 0.02), z, z + 0.17, 0xa9b1b9, "chrome");
  cb(o, d0, d1, front, front + 0.26, g + 2.17, g + 2.27, 0x5d656d, "iron");
  cb(o, d0 - 0.2, d1 + 0.2, front, front + 0.42, g + dh, g + dh + 0.42, 0x7a838c, "chrome");
  for (const a of [d0 - 0.16, d1 + 0.04]) cb(o, a, a + 0.12, front, front + 0.24, g, g + dh, 0x5d656d, "iron");
  // (A yellow line across its threshold, and a bollard to each side of it.)
  cb(o, d0, d1, front + 0.3, front + 0.5, level, level + 0.014, 0xe9c01b, "sign");
  for (const a of [d0 - 0.7, d1 + 0.7]) { turned(o, a, front + 0.9, [[0.13, g], [0.13, g + 0.95], [0.05, g + 1.02]], 0xe9c01b, "livery", 9); turned(o, a, front + 0.9, [[0.135, g + 0.55], [0.135, g + 0.72]], 0x1f2226, "trim", 9, false); }

  // ── THE SIGN over it, hand-painted on boards: a green ground, a cream band and a lighter block for the name; lamps on arms over it ──
  const sz = g + dh + 0.55;
  cb(o, d0 - 0.1, d1 + 0.1, front, front + 0.16, sz, sz + 0.95, GREEN, "paint");
  cb(o, d0 - 0.16, d1 + 0.16, front, front + 0.2, sz - 0.07, sz, 0x23533c, "paint");
  cb(o, d0 - 0.16, d1 + 0.16, front, front + 0.2, sz + 0.95, sz + 1.02, 0x23533c, "paint");
  cb(o, d0 + 0.6, d1 - 2.9, front + 0.16, front + 0.19, sz + 0.32, sz + 0.62, CREAM, "linen");
  for (let k = 0; k < 9; k++) cb(o, d0 + 0.75 + k * 0.6, d0 + 0.75 + k * 0.6 + 0.4, front + 0.19, front + 0.2, sz + 0.38, sz + 0.56, GREEN, "paint");
  cb(o, d1 - 2.4, d1 - 0.5, front + 0.16, front + 0.19, sz + 0.18, sz + 0.78, 0xe9a71b, "sign");
  cb(o, d1 - 2.15, d1 - 0.75, front + 0.19, front + 0.2, sz + 0.4, sz + 0.56, GREEN, "paint");
  for (const a of [d0 + 1.6, mid + 0.6, d1 - 1.6]) {
    cb(o, a - 0.03, a + 0.03, front, front + 0.95, sz + 1.2, sz + 1.26, 0x2a2e33, "iron");
    cb(o, a - 0.2, a + 0.2, front + 0.72, front + 1.02, sz + 1.06, sz + 1.2, 0x2a2e33, "iron");
    cb(o, a - 0.15, a + 0.15, front + 0.76, front + 0.98, sz + 1.02, sz + 1.06, 0xfff1c4, "lamp");
  }

  // ── TO ITS LEFT: the way in for people — a door with a light over it and a step — and a barred window ──
  const pd = x0 + 1.5;
  cb(o, pd - 0.12, pd + 1.22, front, front + 0.1, g, g + 2.45, 0xeceae2, "linen");
  cb(o, pd, pd + 1.1, front, front + 0.13, g + 0.05, g + 2.1, 0x35604a, "paint");
  cb(o, pd + 0.15, pd + 0.95, front, front + 0.15, g + 1.25, g + 1.9, 0x6f93a8, "pane");
  cb(o, pd + 0.92, pd + 1.0, front, front + 0.19, g + 1.0, g + 1.08, 0xc9c4b8, "chrome");
  cb(o, pd, pd + 1.1, front, front + 0.14, g + 2.14, g + 2.38, 0x6f93a8, "pane");
  cb(o, pd - 0.3, pd + 1.4, front, front + 0.8, g - 0.02, g + 0.1, 0xa7a39b, "stone");
  cb(o, pd - 0.25, pd + 1.35, front, front + 0.75, g + 2.6, g + 2.68, 0x4a5058, "iron");
  cb(o, pd + 0.35, pd + 0.75, front + 0.3, front + 0.55, g + 2.5, g + 2.6, 0xfff1c4, "lamp");
  cb(o, pd + 1.45, pd + 1.75, front, front + 0.08, g + 1.2, g + 1.6, 0xc84a3a, "paint");
  win(o, "y", front, pd + 2.3, pd + 3.9, g + 1.35, g + 2.5, 2, { bars: true });
  // ── TO ITS RIGHT: the office window, a blind half down in it, an awning over it and a bench under it ──
  const w0 = d1 + 1.3, w1 = x1 - 1.1;
  win(o, "y", front, w0, w1, g + 1.0, g + 2.6, 3);
  cb(o, w0, w1, front + 0.09, front + 0.1, g + 2.05, g + 2.6, 0xe8dfc8, "linen");
  slab(o, [[w0 - 0.3, front, g + 3.15], [w1 + 0.3, front, g + 3.15], [w1 + 0.3, front + 1.25, g + 2.75], [w0 - 0.3, front + 1.25, g + 2.75]], [mid, front, g], GREEN, "canvas");
  slab(o, [[w0 - 0.3, front + 1.25, g + 2.75], [w1 + 0.3, front + 1.25, g + 2.75], [w1 + 0.3, front + 1.25, g + 2.5], [w0 - 0.3, front + 1.25, g + 2.5]], [mid, front, g + 2.6], CREAM, "canvas");
  for (let a = w0 - 0.3; a < w1 + 0.2; a += 0.56) slab(o, [[a, front + 0.001, g + 3.152], [a + 0.28, front + 0.001, g + 3.152], [a + 0.28, front + 1.251, g + 2.752], [a, front + 1.251, g + 2.752]], [mid, front, g], CREAM, "canvas");
  cb(o, w0 + 0.1, w1 - 0.1, front + 0.25, front + 0.75, g + 0.42, g + 0.5, 0x8a6a44, "timber");
  for (const a of [w0 + 0.2, w1 - 0.3]) cb(o, a, a + 0.1, front + 0.25, front + 0.75, g, g + 0.42, 0x3a3f45, "iron");
  cb(o, w0 + 0.1, w1 - 0.1, front + 0.2, front + 0.28, g + 0.5, g + 0.95, 0x8a6a44, "timber");
  potted(o, w1 + 0.55, front + 0.6, g, 1.1);
  potted(o, d1 + 0.75, front + 2.2, g, 0.8);
  // (The post, a number, a camera at the corner, a hose on a reel.)
  cb(o, d0 - 1.45, d0 - 0.85, front, front + 0.3, g + 1.1, g + 1.5, 0xc84a3a, "paint");
  cb(o, x1 - 0.5, x1 - 0.1, front, front + 0.06, g + 2.2, g + 2.6, 0x1f2226, "trim");
  cb(o, x1 - 0.4, x1 - 0.2, front + 0.06, front + 0.07, g + 2.3, g + 2.5, 0xf2f2ec, "linen");
  cb(o, x1 - 0.25, x1 - 0.05, front, front + 0.45, top - 1.1, top - 0.95, 0xe8e6e0, "linen");
  cb(o, x1 - 0.22, x1 - 0.08, front + 0.42, front + 0.5, top - 1.12, top - 0.93, 0x16181b, "trim");
  turned(o, x0 + 0.9, front + 0.16, [[0.0, g + 0.9], [0.3, g + 0.9], [0.3, g + 1.0], [0, g + 1.0]], 0x3f8a4a, "paint", 10);

  // ── THE SHADED WALL: a side door under a little roof, a barred window, a meter box, an extractor, a condenser and its pipes ──
  const sd = front - 3.6;
  cb(o, x1, x1 + 0.1, sd - 0.12, sd + 1.22, g, g + 2.4, 0xeceae2, "linen");
  cb(o, x1, x1 + 0.13, sd, sd + 1.1, g + 0.05, g + 2.1, 0x35604a, "paint");
  cb(o, x1, x1 + 0.17, sd + 0.1, sd + 0.2, g + 1.0, g + 1.1, 0xc9c4b8, "chrome");
  cb(o, x1, x1 + 0.9, sd - 0.3, sd + 1.4, g - 0.02, g + 0.1, 0xa7a39b, "stone");
  slab(o, [[x1, sd - 0.35, g + 2.75], [x1, sd + 1.45, g + 2.75], [x1 + 0.95, sd + 1.45, g + 2.5], [x1 + 0.95, sd - 0.35, g + 2.5]], [x1, sd, g], 0x5a626b, "roofing");
  win(o, "x", x1, y0 + 1.6, y0 + 4.4, g + 1.4, g + 2.7, 3, { bars: true });
  cb(o, x1, x1 + 0.22, front - 1.5, front - 0.75, g + 0.9, g + 1.9, 0xd9d6cc, "linen");
  cb(o, x1 + 0.22, x1 + 0.23, front - 1.4, front - 0.85, g + 1.45, g + 1.75, 0x2a2e33, "trim");
  cb(o, x1, x1 + 0.1, y0 + 5.6, y0 + 6.5, g + 2.9, g + 3.8, 0x8a9198, "chrome");
  for (let z = g + 2.98; z < g + 3.75; z += 0.14) cb(o, x1, x1 + 0.13, y0 + 5.66, y0 + 6.44, z, z + 0.07, 0x5d656d, "iron");
  cb(o, x1, x1 + 0.55, y0 + 0.5, y0 + 1.4, g + 0.3, g + 1.05, 0xe2e0d8, "linen");
  turned(o, x1 + 0.56, y0 + 0.95, [[0, g + 0.4], [0.28, g + 0.4]], 0x2a2e33, "iron", 10);
  cb(o, x1, x1 + 0.6, y0 + 0.45, y0 + 1.45, g + 0.2, g + 0.3, 0x4a5058, "iron");
  cb(o, x1, x1 + 0.07, y0 + 0.9, y0 + 0.98, g + 1.05, top - 0.3, 0xe2e0d8, "linen");
  cb(o, x1, x1 + 0.06, y0 + 2.9, y0 + 2.95, g, top - 0.3, 0x2a2e33, "iron");
  // (A ladder up it to the roof, hooped at the top.)
  const ly = front - 5.6;
  for (const a of [ly, ly + 0.5]) cb(o, x1 + 0.12, x1 + 0.18, a, a + 0.05, g + 0.4, top + 1.1, 0x9aa3ab, "chrome");
  for (let z = g + 0.6; z < top + 0.9; z += 0.3) cb(o, x1 + 0.13, x1 + 0.17, ly, ly + 0.55, z, z + 0.04, 0x9aa3ab, "chrome");

  // ── THE ROOF: stone on its felt, lights in it, six panels to the sun, a condenser, a tank on a stand, a dish and an aerial ──
  const rz = top + 0.04, rx0 = x0 + 0.7, rx1 = x1 - 0.7, ry0 = y0 + 0.7, ry1 = front - 0.7;
  for (let k = 0; k < 26; k++) { const a = rx0 + ((k * 7.3) % (rx1 - rx0 - 1)), b = ry0 + ((k * 4.7) % (ry1 - ry0 - 0.8)); cb(o, a, a + 0.7 + (k % 3) * 0.3, b, b + 0.5 + (k % 2) * 0.3, rz, rz + 0.012, k % 2 ? 0x5a6068 : 0x4b5158, "roofing"); }
  for (let a = rx0 + 3.6; a < rx1 - 1; a += 7.2) cb(o, a, a + 0.06, ry0, ry1, rz, rz + 0.02, 0x3d4248, "iron");
  for (const a of [rx0 + 8.6, rx0 + 13.4]) {
    cb(o, a, a + 2.2, ry0 + 1.0, ry0 + 2.6, rz, rz + 0.22, 0x8a9198, "chrome");
    slab(o, [[a + 0.1, ry0 + 1.1, rz + 0.22], [a + 2.1, ry0 + 1.1, rz + 0.22], [a + 2.1, ry0 + 1.85, rz + 0.5], [a + 0.1, ry0 + 1.85, rz + 0.5]], [a + 1, ry0 + 1.8, rz], 0x9cc4d8, "pane");
    slab(o, [[a + 0.1, ry0 + 2.5, rz + 0.22], [a + 2.1, ry0 + 2.5, rz + 0.22], [a + 2.1, ry0 + 1.85, rz + 0.5], [a + 0.1, ry0 + 1.85, rz + 0.5]], [a + 1, ry0 + 1.8, rz], 0xb4d6e6, "pane");
  }
  // (The panels: tilted to the lit side on frames, three and three.)
  for (let r = 0; r < 2; r++) for (let k = 0; k < 3; k++) {
    const a = rx0 + 8.2 + k * 2.15, b = ry0 + 4.6 + r * 2.6;
    slab(o, [[a, b, rz + 1.05], [a + 2.0, b, rz + 1.05], [a + 2.0, b + 1.9, rz + 0.28], [a, b + 1.9, rz + 0.28]], [a + 1, b + 1, rz - 2], 0x1c2b4a, "pane");
    for (const q of [0.5, 1.0, 1.5]) slab(o, [[a + q - 0.015, b + 0.001, rz + 1.052], [a + q + 0.015, b + 0.001, rz + 1.052], [a + q + 0.015, b + 1.9, rz + 0.282], [a + q - 0.015, b + 1.9, rz + 0.282]], [a + 1, b + 1, rz - 2], 0x8fa3c4, "chrome");
    slab(o, [[a, b + 0.95, rz + 0.668], [a + 2.0, b + 0.95, rz + 0.668], [a + 2.0, b + 0.98, rz + 0.656], [a, b + 0.98, rz + 0.656]], [a + 1, b + 1, rz - 2], 0x8fa3c4, "chrome");
    for (const q of [0.15, 1.85]) { cb(o, a + q - 0.03, a + q + 0.03, b + 0.05, b + 0.11, rz, rz + 1.02, 0x9aa3ab, "chrome"); cb(o, a + q - 0.03, a + q + 0.03, b + 1.8, b + 1.86, rz, rz + 0.3, 0x9aa3ab, "chrome"); }
  }
  // (A condenser with its fan; ducts from it to a cowl.)
  cb(o, rx1 - 4.2, rx1 - 2.2, ry0 + 0.9, ry0 + 2.3, rz + 0.12, rz + 1.1, 0xb9c1c8, "chrome");
  for (const a of [rx1 - 4.1, rx1 - 2.4]) cb(o, a, a + 0.1, ry0 + 1.0, ry0 + 2.2, rz, rz + 0.12, 0x4a5058, "iron");
  turned(o, rx1 - 3.2, ry0 + 1.6, [[0.55, rz + 1.1], [0.55, rz + 1.16], [0.5, rz + 1.16], [0, rz + 1.13]], 0x2a2e33, "iron", 14);
  for (let z = rz + 0.25; z < rz + 1.0; z += 0.13) cb(o, rx1 - 4.1, rx1 - 2.3, ry0 + 2.3, ry0 + 2.33, z, z + 0.06, 0x7a838c, "iron");
  cb(o, rx1 - 2.2, rx1 - 0.6, ry0 + 1.3, ry0 + 1.7, rz + 0.3, rz + 0.6, 0xc9d1d7, "chrome");
  turned(o, rx1 - 0.6, ry0 + 1.5, [[0.22, rz], [0.22, rz + 0.9], [0.4, rz + 1.0], [0.4, rz + 1.12], [0, rz + 1.3]], 0x9aa3ab, "chrome", 10);
  for (const a of [rx0 + 5.8, rx0 + 6.6]) turned(o, a, ry1 - 1.2, [[0.09, rz], [0.09, rz + 0.55], [0.16, rz + 0.6], [0, rz + 0.72]], 0x7a838c, "chrome", 8);
  // (The tank: timber staves in iron hoops on a braced steel stand, a conical lid.)
  const tx = rx0 + 2.6, ty = ry0 + 2.2;
  for (const [dx, dy] of [[-0.75, -0.75], [0.75, -0.75], [-0.75, 0.75], [0.75, 0.75]]) cb(o, tx + dx - 0.06, tx + dx + 0.06, ty + dy - 0.06, ty + dy + 0.06, rz, rz + 1.3, 0x3a3f45, "iron");
  cb(o, tx - 0.85, tx + 0.85, ty - 0.85, ty + 0.85, rz + 1.22, rz + 1.34, 0x3a3f45, "iron");
  cb(o, tx - 0.8, tx + 0.8, ty + 0.72, ty + 0.78, rz + 0.55, rz + 0.62, 0x3a3f45, "iron");
  cb(o, tx + 0.72, tx + 0.78, ty - 0.8, ty + 0.8, rz + 0.55, rz + 0.62, 0x3a3f45, "iron");
  turned(o, tx, ty, [[1.0, rz + 1.34], [1.05, rz + 2.3], [1.0, rz + 3.2]], 0x8a5a36, "timber", 16, false);
  for (const z of [1.55, 2.3, 3.0]) turned(o, tx, ty, [[1.07, rz + z], [1.07, rz + z + 0.07]], 0x2a2e33, "iron", 16, false);
  turned(o, tx, ty, [[1.08, rz + 3.2], [0.5, rz + 3.65], [0, rz + 3.8]], 0x6b4f35, "timberDark", 16);
  cb(o, tx + 1.0, tx + 1.08, ty - 0.05, ty + 0.05, rz, rz + 1.6, 0x4a5058, "iron");
  // (A dish on a pole, an aerial with its elements, a hatch with a rail.)
  turned(o, rx0 + 0.9, ry1 - 0.9, [[0.05, rz], [0.05, rz + 1.3]], 0x9aa3ab, "chrome", 6);
  turned(o, rx0 + 0.9, ry1 - 0.75, [[0, rz + 1.25], [0.32, rz + 1.36], [0.5, rz + 1.6]], 0xe8e6e0, "linen", 12, false);
  turned(o, rx1 - 0.9, ry1 - 0.8, [[0.04, rz], [0.03, rz + 3.4]], 0x9aa3ab, "chrome", 6);
  for (let k = 0; k < 5; k++) cb(o, rx1 - 0.9 - 0.5 + k * 0.05, rx1 - 0.9 + 0.5 - k * 0.05, ry1 - 0.82, ry1 - 0.78, rz + 2.3 + k * 0.24, rz + 2.33 + k * 0.24, 0x9aa3ab, "chrome");
  cb(o, rx0 + 4.4, rx0 + 5.5, ry1 - 2.0, ry1 - 0.9, rz, rz + 0.3, 0x7a838c, "chrome");
  cb(o, rx0 + 4.42, rx0 + 5.48, ry1 - 1.98, ry1 - 0.92, rz + 0.3, rz + 0.34, 0x5d656d, "iron");
  for (const a of [ry0 + 0.1, ry1 - 0.1]) cb(o, rx1 + 0.3, rx1 + 0.36, a, a + 0.05, rz, rz + 0.01, 0x3d4248, "iron");

  // ── THE APRON: cast in bays, a joint between each; worn where the cars turn, oil where they stand; two spaces lined out ──
  for (let a = px0 + 4.1; a < px1 - 1; a += 4.1) cb(o, a, a + 0.05, front + 0.3, py1, level, level + 0.012, 0x9d998f, "pave");
  for (const b of [front + 4.3]) cb(o, px0, px1, b, b + 0.05, level, level + 0.012, 0x9d998f, "pave");
  for (const [a, b, w, h] of [[mid - 5.4, front + 4.9, 1.7, 1.1], [mid + 2.2, front + 3.1, 1.2, 0.8], [x1 + 4.2, front - 0.6, 1.5, 1.0], [x1 + 4.6, y0 + 2.8, 1.1, 1.3]]) {
    turned(o, a, b, [[0, level + 0.013], [Math.min(w, h) * 0.5, level + 0.013]], 0x8f8b82, "pave", 10);
    turned(o, a + 0.15, b + 0.1, [[0, level + 0.016], [Math.min(w, h) * 0.26, level + 0.016]], 0x6f6b63, "pave", 9);
  }
  const bx = x1 + 1.3;
  for (let k = 0; k < 3; k++) cb(o, bx + k * 3.0, bx + k * 3.0 + 0.1, y0 + 1.2, y0 + 6.6, level, level + 0.013, 0xf2f0e6, "linen");
  cb(o, bx, bx + 6.1, y0 + 1.2, y0 + 1.3, level, level + 0.013, 0xf2f0e6, "linen");
  // THE FOUNDER'S CAR in the first of them; a bike in a hoop by the wall.
  parked(o, "hatchback", bx + 1.55, y0 + 3.9, level, -Math.PI / 2, 0xc84a3a);
  for (const a of [front - 1.9, front - 1.2]) { cb(o, x1 + 0.5, x1 + 0.56, a, a + 0.05, level, level + 0.8, 0x9aa3ab, "chrome"); cb(o, x1 + 1.3, x1 + 1.36, a, a + 0.05, level, level + 0.8, 0x9aa3ab, "chrome"); cb(o, x1 + 0.5, x1 + 1.36, a, a + 0.05, level + 0.78, level + 0.84, 0x9aa3ab, "chrome"); }
  // The bins by the door, lids and wheels; flattened boxes on a pallet; a sandwich board out front.
  for (const [k, colour] of [[0, 0x3f6b4a], [1, 0x2e4f7a], [2, 0x3a3f45]] as const) {
    const a = d1 + 0.9 + k * 0.95;
    cb(o, a, a + 0.8, front + 0.2, front + 1.0, g + 0.08, g + 1.1, colour, "paint");
    slab(o, [[a - 0.03, front + 0.17, g + 1.2], [a + 0.83, front + 0.17, g + 1.2], [a + 0.83, front + 1.05, g + 1.1], [a - 0.03, front + 1.05, g + 1.1]], [a + 0.4, front + 0.6, g], colour - 0x0a0a0a, "paint");
    for (const q of [0.12, 0.68]) turned(o, a + q, front + 0.28, [[0, g + 0.09], [0.09, g + 0.09]], 0x16181b, "tyre", 7);
  }
  pallet(o, d0 - 1.4, front + 2.4, g, 0.5, 0xb98a4e);
  cb(o, d0 - 1.85, d0 - 0.95, front + 2.0, front + 2.8, g + 0.64, g + 0.9, 0xc9a66a, "timberLight");
  slab(o, [[mid + 5.0, front + 6.2, g], [mid + 5.8, front + 6.2, g], [mid + 5.8, front + 6.55, g + 1.05], [mid + 5.0, front + 6.55, g + 1.05]], [mid + 5.4, front + 6.9, g], 0x23262b, "trim");
  slab(o, [[mid + 5.0, front + 6.9, g], [mid + 5.8, front + 6.9, g], [mid + 5.8, front + 6.55, g + 1.05], [mid + 5.0, front + 6.55, g + 1.05]], [mid + 5.4, front + 6.2, g], 0x2f6d4f, "paint");
  cb(o, mid + 5.1, mid + 5.7, front + 6.86, front + 6.9, g + 0.3, g + 0.8, CREAM, "linen");

  // ── BEHIND IT, a garden nobody has time for: rough grass, two trees, a hedge to the boundary, a picnic table, a line of washing ──
  cb(o, px0 + 0.2, x1 + 0.6, py0 + 0.2, y0 - 1.3, level, level + 0.05, 0x6f9a4a, "hedge");
  for (let k = 0; k < 40; k++) { const a = px0 + 0.6 + ((k * 5.1) % (x1 - px0 - 0.6)), b = py0 + 0.6 + ((k * 3.3) % (y0 - py0 - 2.6)); cb(o, a, a + 0.5 + (k % 3) * 0.2, b, b + 0.4, level + 0.05, level + 0.06 + (k % 2) * 0.03, k % 3 ? 0x7aa653 : 0x64904a, "hedge"); }
  for (let a = px0 + 0.2; a < x1 + 0.2; a += 1.6) bush(o, a + 0.8, py0 + 0.7, level, 0.95, 1.5 + ((a * 7) % 3) * 0.12, 0x3f6f38);
  for (let b = py0 + 1.9; b < py1 - 0.6; b += 1.6) bush(o, px0 + 0.5, b, level, 0.9, 1.45 + ((b * 5) % 3) * 0.1, 0x3f6f38);
  tree(o, px0 + 4.2, py0 + 5.2, level, 7.2, 2.6, 0x4f8a45);
  tree(o, x1 - 2.5, py0 + 4.0, level, 5.6, 2.0, 0x5a9448);
  const tb = x0 + 11.5, tby = py0 + 6.4;
  cb(o, tb - 1.0, tb + 1.0, tby - 0.42, tby + 0.42, level + 0.72, level + 0.78, 0xa98660, "timber");
  for (const sg of [-1, 1]) { cb(o, tb - 1.0, tb + 1.0, tby + sg * 0.85 - 0.15, tby + sg * 0.85 + 0.15, level + 0.42, level + 0.47, 0xa98660, "timber"); for (const a of [-0.75, 0.75]) cb(o, tb + a - 0.04, tb + a + 0.04, tby + sg * 0.2, tby + sg * 0.95, level, level + 0.72, 0x7a5a3a, "timberDark"); }
  for (const a of [x0 + 15.5, x0 + 20.5]) turned(o, a, py0 + 3.0, [[0.05, level], [0.04, level + 2.1]], 0x9aa3ab, "chrome", 6);
  cb(o, x0 + 15.5, x0 + 20.5, py0 + 2.99, py0 + 3.01, level + 2.0, level + 2.02, 0xe8e6e0, "linen");
  for (const [k, colour] of [[0, 0xc84a3a], [1, 0xf2f2ec], [2, 0x3f6b9a], [3, 0xe9c01b]] as const) cb(o, x0 + 16.1 + k * 1.05, x0 + 16.1 + k * 1.05 + 0.7, py0 + 2.98, py0 + 3.02, level + 1.25 + (k % 2) * 0.15, level + 2.0, colour, "canvas");
  // (A path of slabs round the back door's side to it; a water butt under the far downpipe.)
  for (let k = 0; k < 5; k++) cb(o, x1 + 0.7, x1 + 1.3, y0 - 0.9 + k * 0.78, y0 - 0.2 + k * 0.78, level + 0.05, level + 0.075, 0xb9b5ab, "pave");
  turned(o, x0 - 0.45, front - 0.5, [[0.36, level], [0.42, level + 0.6], [0.36, level + 1.15], [0, level + 1.18]], 0x3f6b4a, "paint", 12);
}

/**
 * THE GARAGE'S YARD: gravel, rutted where the lorry goes; a five-bar gate hung open on the road; a lean-to of tin
 * on timber with the lorry under it, its shelves and its bench; a cabin, a tank in its bund, a lamp; and along
 * the fence what a builder keeps — blocks, bags, timber, sand in sacks, drums, a mixer, a skip. Clear between the
 * stack and the gate: the crane's ground, and the loading bay's. @see yard, line-works
 */
export function garageYard(o: Out, z: number) {
  const x0 = X(HOUSE_PLOT.w) + 0.4, x1 = X(YARD_PLOT.w) - 0.5, y0 = Y(0) + 0.5, y1 = Y(YARD_PLOT.h) - 0.5, gate = X(YARD_GATE.u), g0 = gate - 3.4, g1 = gate + 3.4;
  // ── THE GROUND: gravel in two tones, the lorry's ruts through it from the lean-to to the gate, a concrete pad at the stack and the bay ──
  cb(o, x0, x1, y0, y1, 0, z, 0x9c968a, "gravel");
  for (let k = 0; k < 120; k++) { const a = x0 + 0.3 + ((k * 6.37) % (x1 - x0 - 1.4)), b = y0 + 0.3 + ((k * 9.11) % (y1 - y0 - 1.2)); cb(o, a, a + 0.5 + (k % 4) * 0.25, b, b + 0.35 + (k % 3) * 0.2, z, z + 0.012, [0xa8a296, 0x918b7f, 0xa39d90, 0x8c867a][k % 4], "gravel"); }
  for (const dx of [-0.85, 0.85]) cb(o, gate + dx - 0.3, gate + dx + 0.3, y0 + 9.5, y1, z, z + 0.014, 0x857f73, "gravel");
  cb(o, X(YARD_STACK.u) - 2.6, X(YARD_STACK.u) + 2.6, Y(YARD_STACK.v) - 3.4, Y(YARD_STACK.v) + 3.2, z, z + 0.03, 0xb4b0a6, "pave");
  for (const b of [Y(YARD_STACK.v) - 1.2, Y(YARD_STACK.v) + 1.0]) cb(o, X(YARD_STACK.u) - 2.6, X(YARD_STACK.u) + 2.6, b, b + 0.04, z + 0.03, z + 0.034, 0x9d998f, "pave");
  // (The chocks the pipe is stacked on: the pipe itself is the game's own. @see line-works)
  for (const v of [YARD_STACK.v - 0.16, YARD_STACK.v + 0.16]) cb(o, X(YARD_STACK.u) - 1.9, X(YARD_STACK.u) + 1.9, Y(v) - 0.1, Y(v) + 0.1, z + 0.03, z + 0.15, 0x8a6a44, "timber");
  // THE RAMP down the front to the road, at the gate.
  slab(o, [[g0, y1, z], [g1, y1, z], [g1, y1 + 0.45, 0.02], [g0, y1 + 0.45, 0.02]], [gate, y1, -1], 0x8f897d, "gravel");
  slab(o, [[g1, y1, 0], [g1, y1, z], [g1, y1 + 0.45, 0.02]], [gate, y1, 0], 0x857f73, "gravel");
  slab(o, [[g0, y1, 0], [g0, y1, z], [g0, y1 + 0.45, 0.02]], [gate, y1, 0], 0x857f73, "gravel");
  // (A low kerb of old sleepers round it, under the fence.)
  for (const [a0, a1, b0, b1] of [[x0, x1, y0, y0 + 0.22], [x1 - 0.22, x1, y0, y1], [x0, g0, y1 - 0.22, y1], [g1, x1, y1 - 0.22, y1]]) cb(o, a0, a1, b0, b1, z, z + 0.16, 0x6b5440, "timberDark");

  // ── THE FENCE, post and rail; THE GATE, five bars and a brace, swung in and open; its posts, a sign on one, a lamp on the other ──
  fence(o, "x", y0 + 0.11, x0, x1, z + 0.16, 0);
  fence(o, "y", x1 - 0.11, y0, y1, z + 0.16, 0);
  fence(o, "x", y1 - 0.11, x0, g0, z + 0.16, 0);
  fence(o, "x", y1 - 0.11, g1, x1, z + 0.16, 0);
  for (const a of [g0, g1]) { cb(o, a - 0.13, a + 0.13, y1 - 0.24, y1 + 0.02, z, z + 1.75, 0x7a5a3a, "timberDark"); cb(o, a - 0.16, a + 0.16, y1 - 0.27, y1 + 0.05, z + 1.75, z + 1.83, 0x5d4a35, "timberDark"); }
  for (const zz of [0.3, 0.58, 0.86, 1.14, 1.42]) cb(o, g0 + 0.04, g0 + 0.1, y1 - 6.9, y1 - 0.2, z + zz, z + zz + 0.09, 0x9a7a52, "timber");
  for (const b of [y1 - 6.9, y1 - 3.55, y1 - 0.28]) cb(o, g0 + 0.02, g0 + 0.12, b, b + 0.09, z + 0.2, z + 1.56, 0x8a6a44, "timber");
  slab(o, [[g0 + 0.03, y1 - 6.85, z + 0.32], [g0 + 0.03, y1 - 6.76, z + 0.32], [g0 + 0.03, y1 - 0.3, z + 1.5], [g0 + 0.03, y1 - 0.39, z + 1.5]], [g0 + 3, y1 - 3, z + 1], 0x8a6a44, "timber");
  slab(o, [[g0 + 0.11, y1 - 6.85, z + 0.32], [g0 + 0.11, y1 - 6.76, z + 0.32], [g0 + 0.11, y1 - 0.3, z + 1.5], [g0 + 0.11, y1 - 0.39, z + 1.5]], [g0 - 3, y1 - 3, z + 1], 0x8a6a44, "timber");
  cb(o, g1 - 0.45, g1 + 0.45, y1 + 0.02, y1 + 0.06, z + 1.0, z + 1.6, 0xe9c01b, "sign");
  cb(o, g1 - 0.3, g1 + 0.3, y1 + 0.06, y1 + 0.07, z + 1.2, z + 1.4, 0x1f2226, "trim");

  // ── THE LEAN-TO across the back: timber posts, a tin roof falling to the back — every rib of it — tin behind and at its end ──
  const sx1 = x1 - 0.8, sx0 = sx1 - 9.4, sy0 = y0 + 0.75, sy1 = sy0 + 8.2, eave = 3.5, ridge = 4.25;
  for (const a of [sx0, (sx0 + sx1) / 2, sx1]) {
    cb(o, a - 0.11, a + 0.11, sy1 - 0.11, sy1 + 0.11, z, z + ridge - 0.12, 0x7a5a3a, "timberDark");
    cb(o, a - 0.1, a + 0.1, sy0 - 0.1, sy0 + 0.1, z, z + eave - 0.1, 0x7a5a3a, "timberDark");
    slab(o, [[a - 0.07, sy0, z + eave - 0.28], [a + 0.07, sy0, z + eave - 0.28], [a + 0.07, sy1, z + ridge - 0.3], [a - 0.07, sy1, z + ridge - 0.3]], [a, (sy0 + sy1) / 2, z + 20], 0x8a6a44, "timber");
    slab(o, [[a - 0.05, sy1 - 1.1, z + ridge - 0.25], [a + 0.05, sy1 - 1.1, z + ridge - 0.25], [a + 0.05, sy1, z + ridge - 1.2], [a - 0.05, sy1, z + ridge - 1.2]], [a, sy0, z], 0x8a6a44, "timber");
  }
  cb(o, sx0 - 0.1, sx1 + 0.1, sy1 - 0.09, sy1 + 0.09, z + ridge - 0.3, z + ridge - 0.1, 0x8a6a44, "timber");
  cb(o, sx0 - 0.1, sx1 + 0.1, sy0 - 0.08, sy0, z + 0.2, z + eave - 0.1, 0x8f9aa3, "chrome");
  for (let a = sx0; a < sx1; a += 0.34) cb(o, a, a + 0.1, sy0, sy0 + 0.035, z + 0.2, z + eave - 0.1, 0x7d8891, "chrome");
  cb(o, sx1, sx1 + 0.08, sy0, sy1 - 2.4, z + 0.2, z + eave + 0.2, 0x8f9aa3, "chrome");
  for (let b = sy0 + 0.1; b < sy1 - 2.5; b += 0.34) cb(o, sx1 + 0.08, sx1 + 0.115, b, b + 0.1, z + 0.2, z + eave + 0.15, 0x7d8891, "chrome");
  const rf = (a0: number, a1: number, colour: number, lift: number) => slab(o, [[a0, sy0 - 0.45, z + eave + lift], [a1, sy0 - 0.45, z + eave + lift], [a1, sy1 + 0.75, z + ridge + 0.07 + lift], [a0, sy1 + 0.75, z + ridge + 0.07 + lift]], [(a0 + a1) / 2, (sy0 + sy1) / 2, -5], colour, "chrome");
  rf(sx0 - 0.5, sx1 + 0.5, 0x8d98a1, 0);
  for (let a = sx0 - 0.5; a < sx1 + 0.4; a += 0.36) rf(a, a + 0.13, 0xa3aeb7, 0.035);
  // (Two sheets of it rusted, one patched; the gutter along its low side.)
  rf(sx0 + 2.9, sx0 + 4.3, 0x9a7458, 0.012);
  rf(sx1 - 2.6, sx1 - 1.9, 0x7f8a93, 0.014);
  slab(o, [[sx0 - 0.5, sy1 + 0.75, z + ridge - 0.12], [sx1 + 0.5, sy1 + 0.75, z + ridge - 0.12], [sx1 + 0.5, sy1 + 0.75, z + ridge + 0.07], [sx0 - 0.5, sy1 + 0.75, z + ridge + 0.07]], [gate, sy0, z], 0x6f7a83, "chrome");
  slab(o, [[sx1 + 0.5, sy0 - 0.45, z + eave - 0.14], [sx1 + 0.5, sy1 + 0.75, z + ridge - 0.12], [sx1 + 0.5, sy1 + 0.75, z + ridge + 0.07], [sx1 + 0.5, sy0 - 0.45, z + eave]], [gate, sy0, z], 0x6f7a83, "chrome");
  cb(o, sx0 - 0.5, sx1 + 0.5, sy1 + 0.4, sy1 + 0.68, z + ridge - 0.72, z + ridge - 0.24, GREEN, "paint");
  cb(o, sx0 + 0.6, sx0 + 4.4, sy1 + 0.68, sy1 + 0.7, z + ridge - 0.58, z + ridge - 0.38, CREAM, "linen");
  for (const a of [sx0 + 2.4, sx1 - 2.4]) cb(o, a - 0.3, a + 0.3, sy1 + 0.1, sy1 + 0.36, z + ridge - 0.5, z + ridge - 0.42, 0xfff1c4, "lamp");
  // UNDER IT: the lorry, nose out; shelves on the back wall — tins, coils, boxes; a bench with a vice at its end.
  parked(o, "flatbed", sx0 + 2.5, sy0 + 4.3, z, Math.PI / 2, 0x2e63b8);
  const shx = (sx0 + sx1) / 2 + 0.5;
  for (let s2 = 0; s2 < 3; s2++) {
    cb(o, shx, sx1 - 0.3, sy0 + 0.02, sy0 + 0.5, z + 0.75 + s2 * 0.75, z + 0.8 + s2 * 0.75, 0x9a7a52, "timber");
    for (let k = 0; k < 6; k++) cb(o, shx + 0.15 + k * 0.62, shx + 0.15 + k * 0.62 + 0.42, sy0 + 0.06, sy0 + 0.46, z + 0.8 + s2 * 0.75, z + 0.8 + s2 * 0.75 + 0.22 + ((k + s2) % 3) * 0.11, [0xc84a3a, 0x3f6b9a, 0xe9c01b, 0x5d656d, 0xb98a4e, 0x3f8a4a][(k * 5 + s2) % 6], "paint");
  }
  for (const a of [shx, shx + 1.9, sx1 - 0.36]) cb(o, a, a + 0.06, sy0 + 0.02, sy0 + 0.5, z, z + 2.35, 0x7a5a3a, "timberDark");
  cb(o, shx + 0.2, sx1 - 0.5, sy0 + 0.9, sy0 + 1.7, z + 0.85, z + 0.93, 0xa98660, "timber");
  for (const a of [shx + 0.3, sx1 - 0.7]) for (const b of [sy0 + 0.95, sy0 + 1.6]) cb(o, a, a + 0.08, b, b + 0.08, z, z + 0.85, 0x5d4a35, "timberDark");
  cb(o, sx1 - 1.2, sx1 - 0.85, sy0 + 1.3, sy0 + 1.6, z + 0.93, z + 1.15, 0x3a6fb8, "paint");
  drum(o, shx + 0.7, sy0 + 2.6, z, 0x2e63b8);
  drum(o, shx + 1.45, sy0 + 2.5, z, 0xc84a3a);
  // (Tyres stacked by its post, a ladder laid along the tin.)
  for (let k = 0; k < 4; k++) turned(o, sx1 - 1.0, sy1 - 1.0, [[0.25, z + k * 0.24], [0.44, z + k * 0.24 + 0.03], [0.44, z + k * 0.24 + 0.2], [0.25, z + k * 0.24 + 0.23]], 0x1b1d20, "tyre", 12, false);
  for (const dz of [0, 0.42]) cb(o, sx0 + 0.4, sx0 + 4.6, sy0 + 0.04, sy0 + 0.09, z + 2.6 + dz, z + 2.66 + dz, 0xc9a66a, "timberLight");
  for (let a = sx0 + 0.6; a < sx0 + 4.5; a += 0.32) cb(o, a, a + 0.04, sy0 + 0.04, sy0 + 0.09, z + 2.6, z + 3.08, 0xc9a66a, "timberLight");

  // ── THE CABIN: on blocks, steps to its door, two windows, a board of notices, a flue; a water butt at its corner ──
  const cx0 = x0 + 0.8, cy0 = sy0 + 0.1, cx1 = cx0 + 6.2, cy1 = cy0 + 2.8;
  for (const a of [cx0 + 0.3, cx1 - 0.6]) for (const b of [cy0 + 0.3, cy1 - 0.6]) cb(o, a, a + 0.3, b, b + 0.3, z, z + 0.3, 0xbdb8ad);
  cb(o, cx0, cx1, cy0, cy1, z + 0.3, z + 2.95, 0xe6e0cc, "paint");
  cb(o, cx0 - 0.06, cx1 + 0.06, cy0 - 0.06, cy1 + 0.06, z + 2.95, z + 3.07, 0x7a838c, "roofing");
  cb(o, cx0, cx1, cy1, cy1 + 0.02, z + 0.3, z + 0.55, 0x3f6b4a, "paint");
  cb(o, cx1, cx1 + 0.02, cy0, cy1, z + 0.3, z + 0.55, 0x3f6b4a, "paint");
  for (let a = cx0 + 0.62; a < cx1; a += 0.62) cb(o, a, a + 0.025, cy1, cy1 + 0.015, z + 0.55, z + 2.95, 0xd3ccb6);
  cb(o, cx0 + 0.5, cx0 + 1.5, cy1, cy1 + 0.05, z + 0.34, z + 2.4, 0x35604a, "paint");
  cb(o, cx0 + 0.65, cx0 + 1.35, cy1, cy1 + 0.07, z + 1.5, z + 2.2, 0x6f93a8, "pane");
  for (let k = 0; k < 2; k++) cb(o, cx0 + 0.3, cx0 + 1.7, cy1 + k * 0.35, cy1 + 0.35 + k * 0.35, z, z + 0.3 - k * 0.15, 0x9a7a52, "timber");
  win(o, "y", cy1, cx0 + 2.3, cx0 + 3.7, z + 1.35, z + 2.3, 2, { frame: 0xf2f2ec });
  win(o, "y", cy1, cx0 + 4.3, cx0 + 5.7, z + 1.35, z + 2.3, 2, { frame: 0xf2f2ec });
  win(o, "x", cx1, cy0 + 0.7, cy0 + 2.1, z + 1.35, z + 2.3, 2, { frame: 0xf2f2ec });
  cb(o, cx0 + 2.4, cx0 + 3.6, cy1, cy1 + 0.03, z + 0.65, z + 1.15, 0x8a6a44, "timber");
  for (const [k, colour] of [[0, 0xf2f2ec], [1, 0xe9c01b], [2, 0xf2f2ec]] as const) cb(o, cx0 + 2.5 + k * 0.37, cx0 + 2.5 + k * 0.37 + 0.3, cy1 + 0.03, cy1 + 0.035, z + 0.72, z + 1.08, colour, "linen");
  turned(o, cx1 - 0.8, cy0 + 0.6, [[0.09, z + 3.07], [0.09, z + 3.7], [0.16, z + 3.75], [0, z + 3.9]], 0x5d656d, "iron", 8);
  turned(o, cx1 + 0.5, cy1 + 0.4, [[0.36, z], [0.42, z + 0.6], [0.36, z + 1.15], [0, z + 1.18]], 0x2e4f7a, "paint", 12);
  // ── THE TANK, in a bund of blocks: on cradles, a filler, a pump on a post with its hose looped; a drip tray, a can ──
  const tx0 = cx0, ty0 = cy1 + 2.2;
  for (const [a0, a1, b0, b1] of [[tx0, tx0 + 5.2, ty0, ty0 + 0.22], [tx0, tx0 + 5.2, ty0 + 2.9, ty0 + 3.12], [tx0, tx0 + 0.22, ty0, ty0 + 3.12], [tx0 + 4.98, tx0 + 5.2, ty0, ty0 + 3.12]]) cb(o, a0, a1, b0, b1, z, z + 0.62, 0xbdb8ad);
  cb(o, tx0 + 0.22, tx0 + 4.98, ty0 + 0.22, ty0 + 2.9, z, z + 0.06, 0x6f6b63, "pave");
  for (const a of [tx0 + 1.1, tx0 + 3.6]) cb(o, a, a + 0.3, ty0 + 0.7, ty0 + 2.4, z + 0.06, z + 0.6, 0x4d5a63, "iron");
  tubeX(o, ty0 + 1.55, z + 1.42, tx0 + 0.55, tx0 + 4.5, 0.92, 0x3f6b4a);
  for (const a of [tx0 + 1.25, tx0 + 3.75]) turned(o, a, ty0 + 1.55, [[0.95, z + 1.35], [0.95, z + 1.5]], 0x2f5a3a, "paint", 12, false);
  turned(o, tx0 + 2.5, ty0 + 1.55, [[0.16, z + 2.3], [0.16, z + 2.5], [0.2, z + 2.52], [0, z + 2.56]], 0xc84a3a, "paint", 9);
  cb(o, tx0 + 0.9, tx0 + 3.2, ty0 + 2.36, ty0 + 2.4, z + 1.25, z + 1.6, 0xe9c01b, "sign");
  cb(o, tx0 + 5.5, tx0 + 5.62, ty0 + 1.4, ty0 + 1.52, z, z + 1.45, 0x4d5a63, "iron");
  cb(o, tx0 + 5.35, tx0 + 5.8, ty0 + 1.28, ty0 + 1.64, z + 1.0, z + 1.6, 0xc84a3a, "paint");
  turned(o, tx0 + 5.9, ty0 + 1.46, [[0.2, z + 1.05], [0.24, z + 1.1], [0.24, z + 1.2], [0.2, z + 1.25]], 0x16181b, "tyre", 9, false);
  cb(o, tx0 + 5.4, tx0 + 6.3, ty0 + 2.0, ty0 + 2.7, z, z + 0.08, 0x2a2e33, "iron");
  cb(o, tx0 + 5.6, tx0 + 5.95, ty0 + 2.15, ty0 + 2.5, z + 0.08, z + 0.5, 0x3f8a4a, "paint");

  // ── ALONG THE FAR FENCE, front to back: blocks on pallets, bags of cement, sand and stone in sacks, sawn timber, drums ──
  const fx = x1 - 1.35;
  for (let k = 0; k < 2; k++) {
    const b = y1 - 2.6 - k * 1.5;
    pallet(o, fx, b, z, 0.95 - k * 0.19, 0xbdb8ad);
    for (let c2 = 0; c2 < 4 - k; c2++) cb(o, fx - 0.56, fx + 0.56, b - 0.46, b + 0.46, z + 0.14 + c2 * 0.19 + 0.17, z + 0.14 + c2 * 0.19 + 0.185, 0x9d988d);
    for (const a of [-0.2, 0.18]) cb(o, fx + a, fx + a + 0.015, b - 0.46, b + 0.461, z + 0.14, z + 0.9 - k * 0.19, 0x9d988d);
  }
  bags(o, fx, y1 - 5.8, z, 4, 0xcfc9b8);
  bulkBag(o, fx + 0.1, y1 - 7.6, z, 0xd9c48f);
  bulkBag(o, fx + 0.1, y1 - 8.75, z, 0x8f8a80);
  planks(o, fx - 0.05, sy1 + 3.4, z, 3.6, 5);
  cableDrum(o, fx - 1.9, sy1 + 2.0, z);
  drum(o, fx - 2.0, y1 - 1.5, z, 0x2e63b8);
  drum(o, fx - 2.7, y1 - 1.35, z, 0x2e63b8);
  // ── ALONG THE FRONT, to the building's side of the stack: a mixer, a barrow, a skip of rubble, cones, a barrier ──
  const mx = x0 + 1.0, my = y1 - 2.0;
  for (const a of [-0.45, 0.45]) { cb(o, mx + a - 0.04, mx + a + 0.04, my - 0.5, my + 0.6, z + 0.3, z + 0.38, 0xe9a71b, "livery"); turned(o, mx + a, my + 0.5, [[0, z + 0.2], [0.2, z + 0.2]], 0x16181b, "tyre", 8); cb(o, mx + a - 0.04, mx + a + 0.04, my - 0.5, my - 0.42, z, z + 0.34, 0xe9a71b, "livery"); }
  turned(o, mx, my, [[0.3, z + 0.5], [0.5, z + 0.75], [0.5, z + 1.1], [0.32, z + 1.4], [0.3, z + 1.42]], 0xe9a71b, "livery", 12, false);
  turned(o, mx, my, [[0.29, z + 1.4], [0.28, z + 0.9], [0, z + 0.8]], 0x5d5a55, "gravel", 12, false);
  cb(o, mx - 0.25, mx + 0.25, my - 0.75, my - 0.45, z + 0.45, z + 0.8, 0x3a3f45, "iron");
  // (Behind the stack, clear of it and of the crane's ground.)
  const sx = x0 + 3.0, sy = y1 - 9.6;
  cb(o, sx - 1.5, sx + 1.5, sy - 0.9, sy + 0.9, z + 0.12, z + 0.26, 0xe9a71b, "livery");
  for (const [a0, a1, b0, b1] of [[-1.5, 1.5, -0.9, -0.8], [-1.5, 1.5, 0.8, 0.9], [-1.5, -1.4, -0.9, 0.9], [1.4, 1.5, -0.9, 0.9]]) cb(o, sx + a0, sx + a1, sy + b0, sy + b1, z + 0.26, z + 1.3, 0xe9a71b, "livery");
  for (const a of [-1.52, 1.4]) for (const b of [-0.5, 0.38]) cb(o, sx + a, sx + a + 0.12, sy + b, sy + b + 0.12, z + 0.8, z + 1.05, 0x3a3f45, "iron");
  cb(o, sx - 1.4, sx + 1.4, sy - 0.8, sy + 0.8, z + 0.26, z + 0.95, 0x6f5338, "gravel");
  for (const [dx, dy, w, h, colour] of [[-0.9, -0.3, 0.7, 0.5, 0xbdb8ad], [0.2, 0.2, 0.9, 0.4, 0xa4543a], [0.7, -0.5, 0.5, 0.5, 0xc9a66a], [-0.2, 0.45, 0.6, 0.3, 0x8f8a80]]) cb(o, sx + dx, sx + dx + w, sy + dy, sy + dy + h, z + 0.95, z + 1.12, colour, "brick");
  for (const [a, b] of [[g0 - 1.0, y1 - 1.3], [g0 - 1.7, y1 - 1.1], [x0 + 0.9, y1 - 4.4]]) cone(o, a, b, z);
  for (const a of [x0 + 5.0, x0 + 6.6]) { cb(o, a, a + 0.08, y1 - 12.2, y1 - 11.8, z, z + 0.06, 0x2a2e33, "iron"); cb(o, a + 0.01, a + 0.07, y1 - 12.03, y1 - 11.97, z, z + 1.0, 0x9aa3ab, "chrome"); }
  for (let k = 0; k < 6; k++) cb(o, x0 + 5.05 + k * 0.27, x0 + 5.05 + k * 0.27 + 0.27, y1 - 12.02, y1 - 11.98, z + 0.72, z + 0.98, k % 2 ? 0xf2f2ec : 0xc84a3a, "sign");
  // ── A LAMP on a pole at the corner by the gate, a camera under it; weeds along the fence's foot ──
  const lx = x1 - 0.75, ly = y1 - 0.75;
  turned(o, lx, ly, [[0.18, z], [0.1, z + 0.6], [0.07, z + 5.6]], 0x6b5440, "timberDark", 8);
  cb(o, lx - 1.1, lx + 0.1, ly - 0.04, ly + 0.04, z + 5.3, z + 5.38, 0x3a3f45, "iron");
  cb(o, lx - 1.35, lx - 0.75, ly - 0.22, ly + 0.22, z + 5.2, z + 5.32, 0x3a3f45, "iron");
  cb(o, lx - 1.3, lx - 0.8, ly - 0.17, ly + 0.17, z + 5.15, z + 5.2, 0xfff1c4, "lamp");
  cb(o, lx - 0.1, lx + 0.1, ly + 0.07, ly + 0.4, z + 4.3, z + 4.45, 0xe8e6e0, "linen");
  for (let k = 0; k < 16; k++) { const a = x0 + 0.5 + ((k * 4.9) % (x1 - x0 - 8)); bush(o, a, y0 + 0.5, z + 0.1, 0.22 + (k % 3) * 0.06, 0.3 + (k % 2) * 0.12, k % 2 ? 0x6f9a4a : 0x5a8a40); }
  for (let k = 0; k < 9; k++) bush(o, x1 - 0.5, y0 + 9.5 + ((k * 3.7) % 15), z + 0.1, 0.2 + (k % 2) * 0.08, 0.3 + (k % 3) * 0.08, k % 2 ? 0x6f9a4a : 0x5a8a40);
}
