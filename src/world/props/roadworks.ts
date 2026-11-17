/**
 * World v2 — WHAT STANDS ROUND A ROAD BEING BUILT, as models: a cone, a
 * barrier across a road that stops; and what a line is SET OUT with — a
 * stake, a length of builder's line with a level tag on it, the peg two lengths meet at — and their bright
 * fellows, a flagged stake and a length of bunting on its pin — a
 * profile board, a hub at the centre, a level on its tripod. Metres, about the
 * origin on the ground. In the props' sheet. @see render/road-works
 */
import { face, type Tri, type V3 } from "../agents/cars/raster";
import type { Mat } from "../agents/cars/models";
import { box, type Prop, type PropShadow } from "./models";

const SMALL: PropShadow = { hl: 0.3, hw: 0.3, edge: 0.1, soft: 0.2, strength: 0.25, reach: 0.2 };

/** A tapered square post from `z0` to `z1`, `r0` half across at its foot and `r1` at its head. */
function taper(r0: number, r1: number, z0: number, z1: number, mat: Mat, out: Tri[]) {
  const c: V3 = [0, 0, (z0 + z1) / 2];
  for (const [a, b] of [[[1, 1], [1, -1]], [[1, -1], [-1, -1]], [[-1, -1], [-1, 1]], [[-1, 1], [1, 1]]])
    face([[a[0] * r0, a[1] * r0, z0], [b[0] * r0, b[1] * r0, z0], [b[0] * r1, b[1] * r1, z1], [a[0] * r1, a[1] * r1, z1]], mat, c, out);
}
/** A traffic cone, 0.75 m: a black foot, orange with a white sleeve. */
function coneTris(): Tri[] {
  const out: Tri[] = [];
  box(-0.2, 0.2, -0.2, 0.2, 0, 0.05, "tyre", out);
  taper(0.15, 0.11, 0.05, 0.32, "liveryRed", out);
  taper(0.11, 0.075, 0.32, 0.5, "liveryWhite", out);
  taper(0.075, 0.035, 0.5, 0.75, "liveryRed", out);
  box(-0.035, 0.035, -0.035, 0.035, 0.75, 0.76, "liveryRed", out);
  return out;
}
/** A barrier across the road, 3.4 m along x: two red-and-white planks between feet, a lamp on it. */
function barrierTris(): Tri[] {
  const out: Tri[] = [];
  for (const x of [-1.6, 1.6]) { box(x - 0.05, x + 0.05, -0.05, 0.05, 0, 1.05, "trim", out); box(x - 0.08, x + 0.08, -0.35, 0.35, 0, 0.08, "tyre", out); }
  for (const z of [0.45, 0.8]) for (let k = 0; k < 8; k++) box(-1.6 + k * 0.4, -1.2 + k * 0.4, -0.03, 0.03, z, z + 0.2, k % 2 ? "liveryWhite" : "liveryRed", out);
  box(-0.08, 0.08, -0.06, 0.06, 1.0, 1.18, "indicator", out);
  return out;
}
/** A straight rod between two points, `r` half across, square. */
function rod(a: V3, b: V3, r: number, mat: Mat, out: Tri[]) {
  const c: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  // Across it: level and square to its run, and what is square to both.
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], flat = Math.hypot(d[0], d[1]);
  const u: V3 = flat > 1e-6 ? [-d[1] / flat, d[0] / flat, 0] : [1, 0, 0], len = Math.hypot(...d) || 1;
  const v: V3 = [(d[1] * u[2] - d[2] * u[1]) / len, (d[2] * u[0] - d[0] * u[2]) / len, (d[0] * u[1] - d[1] * u[0]) / len];
  const at = (q: V3, su: number, sv: number): V3 => [q[0] + (u[0] * su + v[0] * sv) * r, q[1] + (u[1] * su + v[1] * sv) * r, q[2] + (u[2] * su + v[2] * sv) * r];
  for (const [[s0, t0], [s1, t1]] of [[[1, 1], [1, -1]], [[1, -1], [-1, -1]], [[-1, -1], [-1, 1]], [[-1, 1], [1, 1]]] as [number[], number[]][])
    face([at(a, s0, t0), at(a, s1, t1), at(b, s1, t1), at(b, s0, t0)], mat, c, out);
  face([at(b, 1, 1), at(b, 1, -1), at(b, -1, -1), at(b, -1, 1)], mat, c, out);
  face([at(a, 1, 1), at(a, 1, -1), at(a, -1, -1), at(a, -1, 1)], mat, c, out);
}
/**
 * A SETTING-OUT STAKE, 1.5 m: sawn timber driven in and cut to a point, its head painted white with a blue band —
 * a surveyor's mark, not a warning — and a nail in its top for the line.
 */
function stakeTris(): Tri[] {
  const out: Tri[] = [];
  box(-0.08, 0.08, -0.08, 0.08, 0, 0.9, "wood", out);
  box(-0.085, 0.085, -0.085, 0.085, 0.9, 1.3, "liveryWhite", out);
  box(-0.088, 0.088, -0.088, 0.088, 1.02, 1.14, "liveryAlt", out);
  taper(0.08, 0.02, 1.3, 1.5, "wood", out);
  box(-0.02, 0.02, -0.02, 0.02, 1.5, 1.56, "chrome", out);
  // The earth it threw up, going in.
  taper(0.2, 0.1, 0, 0.07, "load", out);
  return out;
}
/** Half a tile of line, in metres: what one length of it spans. */
export const TAPE_RUN = 0.5 / 0.09;
/**
 * A LENGTH OF BUILDER'S LINE, half a tile along x about its middle: one pale cord pulled taut from stake to peg at
 * the height the kerb will be, a twist of it tied off at each end, and a small timber LEVEL TAG hung on it at its
 * middle. Nothing bright, nothing that flaps.
 */
function tapeTris(): Tri[] {
  const out: Tri[] = [], h = TAPE_RUN / 2, z = 0.74;
  rod([-h, 0, z + 0.03], [0, 0, z], 0.028, "plate", out);
  rod([0, 0, z], [h, 0, z + 0.03], 0.028, "plate", out);
  // The tag: a slip of ply with a dark mark on it, hung from the line.
  box(-0.1, 0.1, -0.012, 0.012, z - 0.26, z - 0.02, "wood", out);
  box(-0.06, 0.06, -0.016, 0.016, z - 0.2, z - 0.1, "trim", out);
  return out;
}
/** AN OFFSET PEG where two lengths of line meet, 0.9 m: a short square timber, its top sawn to a slope and painted blue, a notch for the line. */
function pinTris(): Tri[] {
  const out: Tri[] = [];
  box(-0.065, 0.065, -0.065, 0.065, 0, 0.78, "wood", out);
  box(-0.07, 0.07, -0.07, 0.07, 0.78, 0.9, "liveryAlt", out);
  taper(0.16, 0.08, 0, 0.06, "load", out);
  return out;
}
/** A streamer tied at a point and blown along x: a ribbon in three lengths, falling away as it goes. */
function streamer(x: number, y: number, z: number, mat: Mat, out: Tri[], reach = 0.5) {
  for (let k = 0; k < 3; k++) rod([x + (reach * k) / 3, y + 0.03 * k, z - 0.07 * k * k], [x + (reach * (k + 1)) / 3, y + 0.03 * (k + 1), z - 0.07 * (k + 1) * (k + 1)], 0.055 - 0.008 * k, mat, out);
}
/**
 * A FLAGGED STAKE, 1.5 m: sawn timber driven in and cut to a point, its head banded red over white, a length of
 * flagging tied round it and blowing.
 */
function flagStakeTris(): Tri[] {
  const out: Tri[] = [];
  box(-0.08, 0.08, -0.08, 0.08, 0, 0.82, "wood", out);
  box(-0.085, 0.085, -0.085, 0.085, 0.82, 1.06, "liveryWhite", out);
  box(-0.085, 0.085, -0.085, 0.085, 1.06, 1.3, "liveryRed", out);
  taper(0.08, 0.02, 1.3, 1.5, "wood", out);
  streamer(0.08, 0, 1.24, "indicator", out, 0.4);
  // The earth it threw up, going in.
  taper(0.2, 0.1, 0, 0.07, "load", out);
  return out;
}
/**
 * A LENGTH OF TAPE, half a tile along x about its middle: red and white, slack between what holds its ends up so it
 * hangs in a curve, a pennant under it every stride — orange, yellow, white — each hanging to a point.
 */
function buntingTris(): Tri[] {
  const out: Tri[] = [], N = 8, h = TAPE_RUN / 2, top = 1.16;
  const hang = (t: number) => top - 0.26 * (1 - (2 * t - 1) ** 2);
  for (let k = 0; k < N; k++) {
    const t0 = k / N, t1 = (k + 1) / N, x0 = -h + TAPE_RUN * t0, x1 = -h + TAPE_RUN * t1, z0 = hang(t0), z1 = hang(t1);
    const c: V3 = [(x0 + x1) / 2, 0, (z0 + z1) / 2 - 0.08];
    // A band, following the curve: its two faces and its top edge.
    for (const y of [-0.025, 0.025]) face([[x0, y, z0], [x1, y, z1], [x1, y, z1 - 0.17], [x0, y, z0 - 0.17]], k % 2 ? "liveryWhite" : "liveryRed", c, out);
    face([[x0, -0.025, z0], [x1, -0.025, z1], [x1, 0.025, z1], [x0, 0.025, z0]], k % 2 ? "liveryWhite" : "liveryRed", c, out);
    if (k === 0) continue;
    // A pennant where two bands meet.
    const zp = z0 - 0.17, mat: Mat = (["indicator", "hivis", "liveryWhite"] as const)[k % 3], pc: V3 = [x0, 0, zp - 0.15];
    for (const y of [-0.02, 0.02]) face([[x0 - 0.17, y, zp], [x0 + 0.17, y, zp], [x0, y, zp - 0.42]], mat, pc, out);
  }
  return out;
}
/** A steel road pin holding the tape up between two stakes, 1.25 m: a bar with a hooked head, a yellow cap on it. */
function buntingPinTris(): Tri[] {
  const out: Tri[] = [];
  rod([0, 0, 0], [0, 0, 1.2], 0.035, "trim", out);
  rod([0, 0, 1.2], [0.12, 0, 1.26], 0.035, "trim", out);
  box(-0.06, 0.06, -0.06, 0.06, 1.14, 1.26, "hardhat", out);
  return out;
}
/**
 * A PROFILE BOARD, 2.4 m along x: two stakes and a rail nailed across their heads at the level the road is to be
 * built to, painted in bands to be sighted along — one each side of the line.
 */
function profileTris(bands: readonly Mat[] = ["liveryWhite", "liveryBlack"]): Tri[] {
  const out: Tri[] = [];
  for (const x of [-0.95, 0.95]) { box(x - 0.07, x + 0.07, -0.07, 0.07, 0, 1.55, "wood", out); box(x - 0.17, x + 0.17, -0.17, 0.17, 0, 0.05, "load", out); }
  for (let k = 0; k < 6; k++) box(-1.2 + k * 0.4, -0.8 + k * 0.4, -0.11, -0.07, 1.05, 1.36, bands[k % bands.length], out);
  // A brace down from one stake.
  rod([0.95, 0.07, 1.0], [0.95, 0.75, 0.02], 0.04, "wood", out);
  return out;
}
/** A HUB at the line's centre, 0.5 m: a short stake driven nearly home, its head painted, a flag on a wire stood by it. */
function hubTris(): Tri[] {
  const out: Tri[] = [];
  box(-0.09, 0.09, -0.09, 0.09, 0, 0.36, "wood", out);
  box(-0.095, 0.095, -0.095, 0.095, 0.36, 0.46, "hivis", out);
  rod([0.22, 0.05, 0], [0.24, 0.05, 0.95], 0.02, "chrome", out);
  box(0.24, 0.5, 0.03, 0.07, 0.72, 0.95, "liveryWhite", out);
  return out;
}
/** A LEVEL ON ITS TRIPOD, 1.6 m: three timber legs splayed from a head, the instrument on it — yellow, a dark barrel through it, a bright eyepiece. */
function tripodTris(): Tri[] {
  const out: Tri[] = [];
  for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2 + 0.5; rod([Math.cos(a) * 0.62, Math.sin(a) * 0.62, 0], [Math.cos(a) * 0.07, Math.sin(a) * 0.07, 1.3], 0.04, "wood", out); }
  box(-0.12, 0.12, -0.12, 0.12, 1.28, 1.36, "trim", out);
  box(-0.13, 0.13, -0.1, 0.1, 1.36, 1.6, "hardhat", out);
  rod([-0.26, 0, 1.5], [0.24, 0, 1.5], 0.05, "trim", out);
  box(0.24, 0.28, -0.05, 0.05, 1.45, 1.55, "chrome", out);
  return out;
}
const LONG: PropShadow = { hl: TAPE_RUN / 2, hw: 0.08, edge: 0.05, soft: 0.15, strength: 0.16, reach: 0.25 };
const P = (id: string, tris: () => Tri[]): Prop => ({ id, tris, shadow: SMALL });
export const ROADWORKS: readonly Prop[] = [
  P("cone", coneTris), P("barrier", barrierTris),
  // (Lit evenly: thin bright things, to be read from far off.)
  { ...P("stake", stakeTris), flat: true }, { id: "tape", tris: tapeTris, shadow: LONG, flat: true }, P("tapePin", pinTris),
  { id: "profile", tris: () => profileTris(), shadow: { ...SMALL, hl: 1.2, hw: 0.2 }, flat: true },
  // THE BRIGHT ONES, mixed in among the plain: a flagged stake, bunting and the pin that holds it up, a board in red, white and black.
  { ...P("stakeFlag", flagStakeTris), flat: true }, { id: "bunting", tris: buntingTris, shadow: LONG, flat: true }, P("buntingPin", buntingPinTris),
  { id: "profileRed", tris: () => profileTris(["liveryRed", "liveryWhite", "liveryBlack"]), shadow: { ...SMALL, hl: 1.2, hw: 0.2 }, flat: true }, { ...P("hub", hubTris), flat: true }, { id: "tripod", tris: tripodTris, shadow: { ...SMALL, hl: 0.6, hw: 0.6 } },
];
