/**
 * World v2 — THE PORTS' CRANES, as models. In metres, `x` out toward the
 * water, `y` along the quay, `z` up from the quay's top; baked by the
 * vehicles' rasteriser into a sheet, as the fleet is. @see dev/bake-cranes.ts
 *
 * A CRANE IS BAKED IN PARTS, because it moves. What stands still is baked the
 * four ways a quay can face; what turns, at 32 headings; and each part about
 * the point it moves round, so the game has only to put it there:
 *
 *  - the SHIP-TO-SHORE GANTRY: its two side frames, its top works, the boom
 *    about its hinge, the trolley and the spreader;
 *  - the LUFFING CRANE on its portal, and the smaller HARBOUR CRANE on a
 *    pedestal: the base, the house that turns, and the jib about its foot;
 *  - the YARD GANTRY that straddles a bay of stacks;
 *  - a CONTAINER and a CRATE, which ships carry and yards hold one by one.
 *
 * A JIB IS BAKED AT ONE ANGLE and a boom lying down. Each is all but flat —
 * a lattice in one upright plane — so raising it, and turning it the few
 * degrees between two baked headings, is a shear of its picture, exact in
 * that plane; the game does that, and a jib luffs and slews smoothly on 32
 * frames. @see jibMatrix
 *
 * TWO LAYERS: the steelwork's paint, white and tinted in the game by what the
 * crane is; and everything else in its own colours. ONE MARK: its lights.
 */
import { HALF_STEPS_PER_M, TILES_PER_M, type Mat } from "../../agents/cars/models";
import { cross, norm, sub, type Tri, type V3 } from "../../agents/cars/raster";
import { limb } from "../../agents/people/figures";
import { box, lathe, type PropShadow } from "../../props/models";

/** Metres to a tile, and to a half step. */
export const M_TILE = 1 / TILES_PER_M;
export const M_STEP = 1 / HALF_STEPS_PER_M;

export const CRANE_LAYERS = 2;
export const craneLayerOf = (m: Mat) => (m === "paint" ? 0 : 1);
export const CRANE_MARKS = 1;
export const craneMarkOf = (m: Mat, _p: V3) => (m === "lamp" || m === "glass" ? 1 : 0);

/** The four ways a quay faces, as headings of the model's `x`: out toward +x, +y, −x, −y of the map. */
export const FACING_HEADINGS = [0, Math.PI / 2, Math.PI, -Math.PI / 2] as const;
/** The headings a turning part is baked at: 32 round, set off half a step so none looks straight down the camera's line. */
export const TURNS = 32;
export const TURN_HEADINGS = Array.from({ length: TURNS }, (_, k) => ((k + 0.5) / TURNS) * Math.PI * 2);
/** The headings a ship's cargo is baked at: the fleet's own, so a box on a deck lies as the deck does. @see BOAT_HEADINGS */
export const DECK_HEADINGS = Array.from({ length: TURNS }, (_, k) => (k / TURNS) * Math.PI * 2);

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const mix = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** A round member between two points. */
const tube = (a: V3, b: V3, r: number, mat: Mat, out: Tri[], n = 6) => limb(a, b, r, r, mat, out, n, false);
/** A square member between two points, `w` across. */
const bar = (a: V3, b: V3, w: number, mat: Mat, out: Tri[]) => limb(a, b, w * 0.7, w * 0.7, mat, out, 4, false);

/**
 * A LATTICE between two points: four chords at the corners of a square
 * section, `wa` half across at one end and `wb` at the other, laced in a
 * zigzag on all four sides with a batten at each panel.
 */
function lattice(a: V3, b: V3, wa: number, wb: number, panels: number, mat: Mat, out: Tri[], chord = 0.11, lace = 0.055) {
  const ax = norm(sub(b, a));
  const e1 = norm(cross(ax, Math.abs(ax[2]) < 0.95 ? [0, 0, 1] : [0, 1, 0])), e2 = norm(cross(ax, e1));
  const at = (t: number, i: number, j: number): V3 => {
    const w = wa + (wb - wa) * t;
    return add(mix(a, b, t), add(mul(e1, i * w), mul(e2, j * w)));
  };
  for (const [i, j] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) tube(at(0, i, j), at(1, i, j), chord, mat, out);
  for (let k = 0; k < panels; k++) {
    const t0 = k / panels, t1 = (k + 1) / panels, s = k % 2 ? 1 : -1;
    for (const i of [1, -1]) { tube(at(t0, i, s), at(t1, i, -s), lace, mat, out, 4); tube(at(t0, i, 1), at(t0, i, -1), lace, mat, out, 4); }
    for (const j of [1, -1]) { tube(at(t0, s, j), at(t1, -s, j), lace, mat, out, 4); tube(at(t0, 1, j), at(t0, -1, j), lace, mat, out, 4); }
  }
}

/** Black and yellow along a beam's face: `n` stripes from `x0` to `x1`. */
function hazard(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, n: number, out: Tri[], alongY = false) {
  for (let k = 0; k < n; k++) {
    const a = k / n, b = (k + 1) / n, mat: Mat = k % 2 ? "trim" : "livery";
    if (alongY) box(x0, x1, y0 + (y1 - y0) * a, y0 + (y1 - y0) * b, z0, z1, mat, out);
    else box(x0 + (x1 - x0) * a, x0 + (x1 - x0) * b, y0, y1, z0, z1, mat, out);
  }
}

/** A bogie under a leg at (x, y): a truck of wheels that runs along the quay, on its rail. */
function bogie(x: number, y: number, out: Tri[], half = 1.2) {
  box(x - 0.42, x + 0.42, y - half, y + half, 0.5, 1.15, "trim", out);
  box(x - 0.2, x + 0.2, y - 0.25, y + 0.25, 1.15, 1.6, "trim", out);
  for (const k of [-0.72, -0.24, 0.24, 0.72]) {
    const wy = y + k * (half / 0.9);
    box(x - 0.5, x + 0.5, wy - 0.26, wy + 0.26, 0.0, 0.56, "tyre", out);
    box(x - 0.52, x + 0.52, wy - 0.1, wy + 0.1, 0.18, 0.38, "hub", out);
  }
}

// ─── THE SHIP-TO-SHORE GANTRY ────────────────────────────────────────────────

/**
 * The gantry's measures, metres, from the quay's edge at its top: its legs'
 * lines back from the edge, its half-gauge along the quay, the height of its
 * top girders, the boom's hinge, the A-frame's apex, and how far the boom
 * reaches out and back. The game places things by these. @see seaport-renderer
 */
export const STS = {
  water: -1.4, land: -10.6, half: 3.3, top: 21.5,
  hinge: [-0.4, 0, 22.4] as V3, apex: [-3.4, 0, 30.5] as V3,
  boom: 15.5, back: -19, rail: 22.0,
} as const;

/** One side frame, at `y`: two legs on their bogies, a sill, a portal beam, bracing, a ladder and landings. */
function stsSide(y: number): Tri[] {
  const out: Tri[] = [], s = Math.sign(y);
  for (const x of [STS.land, STS.water]) {
    bogie(x, y, out);
    box(x - 0.42, x + 0.42, y - 0.42, y + 0.42, 1.6, STS.top, "paint", out);
  }
  // The sill between the bogies, striped; the portal beam at mid height; the top beam.
  box(STS.land, STS.water, y - 0.4, y + 0.4, 1.6, 2.5, "paint", out);
  hazard(STS.land + 0.5, STS.water - 0.5, y + s * 0.4, y + s * 0.44, 1.75, 2.35, 9, out);
  box(STS.land, STS.water, y - 0.32, y + 0.32, 11.2, 11.9, "paint", out);
  box(STS.land - 0.2, STS.water + 0.2, y - 0.42, y + 0.42, STS.top - 0.9, STS.top, "paint", out);
  // Diagonal ties, below and above the portal beam.
  const mid = (STS.land + STS.water) / 2;
  tube([STS.land, y, 2.6], [mid, y, 11.2], 0.2, "paint", out); tube([STS.water, y, 2.6], [mid, y, 11.2], 0.2, "paint", out);
  tube([STS.land, y, 20.6], [mid, y, 11.9], 0.18, "paint", out); tube([STS.water, y, 20.6], [mid, y, 11.9], 0.18, "paint", out);
  // A ladder up the landward leg, in its cage, and a landing at each beam.
  for (const k of [-0.22, 0.22]) tube([STS.land - 0.6, y + k, 2.6], [STS.land - 0.6, y + k, STS.top], 0.05, "bed", out, 4);
  for (let z = 3; z < STS.top; z += 0.9) tube([STS.land - 0.6, y - 0.22, z], [STS.land - 0.6, y + 0.22, z], 0.035, "bed", out, 4);
  for (const z of [11.9, STS.top - 0.05]) {
    box(STS.land - 1.2, STS.land + 0.5, y + s * 0.42, y + s * 1.3, z, z + 0.1, "bed", out);
    for (const x of [STS.land - 1.2, STS.land + 0.5]) tube([x, y + s * 1.3, z], [x, y + s * 1.3, z + 1], 0.04, "iron", out, 4);
    tube([STS.land - 1.2, y + s * 1.3, z + 1], [STS.land + 0.5, y + s * 1.3, z + 1], 0.04, "iron", out, 4);
  }
  return out;
}

/** The top works: the cross girders, the fixed girder back over the quay, the machinery house, the A-frame and its backstays. */
function stsTop(): Tri[] {
  const out: Tri[] = [], h = STS.half, z = STS.top;
  for (const x of [STS.land, STS.water]) box(x - 0.45, x + 0.45, -h, h, z - 0.9, z, "paint", out);
  // The landside girders the trolley runs back along, and a walkway beside them with its rail.
  for (const y of [-1.25, 1.25]) box(STS.back, STS.hinge[0], y - 0.3, y + 0.3, z + 0.5, z + 1.4, "paint", out);
  for (let x = STS.back; x < STS.hinge[0]; x += 2.2) box(x, x + 0.18, -1.25, 1.25, z + 1.05, z + 1.3, "paint", out);
  box(STS.back, STS.hinge[0], 1.55, 2.25, z + 1.3, z + 1.38, "bed", out);
  tube([STS.back, 2.25, z + 2.3], [STS.hinge[0], 2.25, z + 2.3], 0.04, "iron", out, 4);
  for (let x = STS.back; x <= STS.hinge[0]; x += 1.8) tube([x, 2.25, z + 1.38], [x, 2.25, z + 2.3], 0.04, "iron", out, 4);
  // The machinery house, over the landward legs: white, a dark door, a band of windows, vents on its roof.
  box(-14.6, -8.4, -2.4, 2.4, z + 1.4, z + 4.6, "liveryWhite", out);
  box(-14.75, -8.25, -2.55, 2.55, z + 4.6, z + 4.78, "roofWhite", out);
  box(-14.63, -8.37, -2.43, 2.43, z + 3.1, z + 3.9, "glass", out);
  for (const x of [-13.4, -11.5, -9.6]) box(x - 0.45, x + 0.45, -0.6, 0.6, z + 4.78, z + 5.2, "bed", out);
  // The A-frame: legs up from over the waterside legs, back legs from over the landward, a tie across its head.
  for (const s of [1, -1]) {
    bar([STS.water, s * 1.9, z], [STS.apex[0], s * 0.6, STS.apex[2]], 0.5, "paint", out);
    bar([-8.4, s * 1.9, z + 1.4], [STS.apex[0], s * 0.6, STS.apex[2]], 0.38, "paint", out);
    tube([STS.apex[0], s * 0.6, STS.apex[2]], [STS.back + 0.6, s * 1.25, z + 1.4], 0.11, "paint", out);
  }
  box(STS.apex[0] - 0.45, STS.apex[0] + 0.45, -0.9, 0.9, STS.apex[2] - 0.3, STS.apex[2] + 0.3, "paint", out);
  // A light at its head, and floods under the girders.
  box(STS.apex[0] - 0.16, STS.apex[0] + 0.16, -0.16, 0.16, STS.apex[2] + 0.3, STS.apex[2] + 0.62, "lamp", out);
  for (const x of [-7, -3]) for (const y of [-1.7, 1.7]) box(x - 0.2, x + 0.2, y - 0.2, y + 0.2, z + 0.25, z + 0.5, "lamp", out);
  return out;
}

/** The boom, lying down, about its hinge: twin girders out over the ship, tied across, a walkway and a light at its head. */
function stsBoom(): Tri[] {
  const out: Tri[] = [], L = STS.boom;
  for (const y of [-1.25, 1.25]) box(0, L, y - 0.3, y + 0.3, -0.4, 0.5, "paint", out);
  for (let x = 0.6; x < L; x += 2.2) box(x, x + 0.18, -1.25, 1.25, 0.15, 0.4, "paint", out);
  box(L - 0.3, L, -1.55, 1.55, -0.45, 0.55, "paint", out);
  box(0.2, L - 0.4, 1.55, 2.2, 0.4, 0.48, "bed", out);
  tube([0.2, 2.2, 1.4], [L - 0.4, 2.2, 1.4], 0.04, "iron", out, 4);
  for (let x = 0.2; x <= L; x += 1.9) tube([x, 2.2, 0.48], [x, 2.2, 1.4], 0.04, "iron", out, 4);
  // The ears its forestays are pinned to, and floods under it.
  for (const x of [L * 0.55, L - 0.6]) for (const s of [1, -1]) box(x - 0.2, x + 0.2, s * 1.25 - 0.12, s * 1.25 + 0.12, 0.5, 1.0, "paint", out);
  for (const x of [L * 0.3, L * 0.7]) for (const y of [-1.7, 1.7]) box(x - 0.2, x + 0.2, y - 0.2, y + 0.2, -0.65, -0.4, "lamp", out);
  box(L - 0.2, L + 0.12, -0.16, 0.16, 0.55, 0.9, "lamp", out);
  return out;
}

/** The trolley, about where its ropes leave it: a frame on four wheels under the girders, and the driver's cab hung below it. */
function stsTrolley(): Tri[] {
  const out: Tri[] = [];
  box(-1.5, 1.5, -1.6, 1.6, 0.0, 0.5, "trim", out);
  for (const x of [-1.2, 1.2]) for (const y of [-1.25, 1.25]) box(x - 0.3, x + 0.3, y - 0.14, y + 0.14, 0.5, 0.95, "hub", out);
  box(-0.7, 0.7, -0.7, 0.7, 0.5, 1.1, "livery", out);
  // The cab, glazed all round and through its floor, hung to one side so the driver looks down past the load.
  box(0.5, 2.3, 0.5, 2.3, -2.5, -0.1, "liveryWhite", out);
  box(0.45, 2.35, 0.45, 2.35, -2.2, -0.7, "glass", out);
  box(0.4, 2.4, 0.4, 2.4, -0.1, 0.0, "roofWhite", out);
  return out;
}

/** The spreader, about where the ropes take it: a headblock, the frame that reaches a container's four corners, and its guides. */
function stsSpreader(): Tri[] {
  const out: Tri[] = [], l = BOX.long / 2, w = BOX.wide / 2;
  box(-0.9, 0.9, -0.6, 0.6, -0.55, 0, "livery", out);
  for (const y of [-0.3, 0.3]) lathe(0, y, [[0.28, -0.2], [0.28, 0.12]], "trim", out, 8);
  box(-0.2, 0.2, -l, l, -0.95, -0.55, "livery", out);
  for (const y of [-l, l]) box(-w, w, y - 0.18, y + 0.18, -0.95, -0.62, "livery", out);
  for (const x of [-w, w]) for (const y of [-l, l]) box(x - 0.14, x + 0.14, y - 0.14, y + 0.14, -1.25, -0.6, "trim", out);
  return out;
}

// ─── THE CRANES THAT TURN ────────────────────────────────────────────────────

/**
 * A turning crane's measures, metres: how high its turntable is, where its
 * jib's foot is from its axis and how high, how long the jib is and the
 * angle it is baked at, and where the head of its mast is.
 */
export type Turning = { table: number; foot: [number, number]; jib: number; baked: number; apex: [number, number]; half: number };
export const LUFFING: Turning = { table: 8.6, foot: [1.2, 11.0], jib: 17.5, baked: (50 * Math.PI) / 180, apex: [-1.2, 17.5], half: 0.75 };
export const HARBOUR: Turning = { table: 4.2, foot: [0.8, 5.6], jib: 11.5, baked: (50 * Math.PI) / 180, apex: [-0.8, 9.6], half: 0.5 };

/** The luffing crane's portal: four legs on bogies, a deck a lorry passes under, and the tower its turntable sits on. */
function luffPortal(): Tri[] {
  const out: Tri[] = [], h = 1.9;
  for (const x of [-h, h]) for (const y of [-h, h]) { bogie(x, y, out, 0.75); bar([x, y, 1.6], [x * 0.75, y * 0.75, 5.6], 0.5, "paint", out); }
  for (const y of [-h, h]) { box(-h, h, y - 0.3, y + 0.3, 1.5, 2.1, "paint", out); hazard(-h + 0.3, h - 0.3, y + Math.sign(y) * 0.3, y + Math.sign(y) * 0.34, 1.6, 2.0, 5, out); }
  box(-2.1, 2.1, -2.1, 2.1, 5.5, 6.0, "paint", out);
  for (const [a, b] of [[-2.1, 2.1], [2.1, -2.1]]) tube([a, a, 6.0], [a, b, 6.0], 0.04, "iron", out, 4);
  lathe(0, 0, [[1.25, 6.0], [1.0, LUFFING.table - 0.25], [1.5, LUFFING.table - 0.25], [1.5, LUFFING.table]], "paint", out, 14);
  return out;
}

/** The harbour crane's pedestal: a plinth bolted to the quay and a column. */
function pedestal(): Tri[] {
  const out: Tri[] = [];
  box(-1.3, 1.3, -1.3, 1.3, 0, 0.5, "stone", out);
  lathe(0, 0, [[0.95, 0.5], [0.7, HARBOUR.table - 0.2], [1.05, HARBOUR.table - 0.2], [1.05, HARBOUR.table]], "paint", out, 12);
  return out;
}

/** What turns, but for the jib: the turntable, the machinery house and its counterweight, the cab, and the mast the jib hangs from. */
function house(t: Turning, k: number): Tri[] {
  const out: Tri[] = [], z = t.table;
  lathe(0, 0, [[1.5 * k, z], [1.5 * k, z + 0.25]], "trim", out, 14);
  box(-4.2 * k, 1.0 * k, -1.6 * k, 1.6 * k, z + 0.25, z + 3.0 * k, "paint", out);
  box(-4.3 * k, 1.1 * k, -1.7 * k, 1.7 * k, z + 3.0 * k, z + 3.0 * k + 0.14, "roofWhite", out);
  box(-3.4 * k, -0.4 * k, -1.63 * k, 1.63 * k, z + 1.5 * k, z + 2.3 * k, "trim", out);
  // The counterweight, slung behind.
  box(-5.6 * k, -4.2 * k, -1.5 * k, 1.5 * k, z + 0.1, z + 2.0 * k, "trim", out);
  hazard(-5.64 * k, -5.6 * k, -1.5 * k, 1.5 * k, z + 0.3, z + 1.0 * k, 6, out, true);
  // The cab, forward and to one side, glazed.
  box(1.0 * k, 2.6 * k, 0.2 * k, 1.7 * k, z + 0.9 * k, z + 2.9 * k, "liveryWhite", out);
  box(1.05 * k, 2.66 * k, 0.14 * k, 1.76 * k, z + 1.5 * k, z + 2.6 * k, "glass", out);
  box(0.95 * k, 2.7 * k, 0.1 * k, 1.8 * k, z + 2.9 * k, z + 3.0 * k, "roofWhite", out);
  // The mast: two legs forward, two back, to the head the luffing ropes run from.
  const head: V3 = [t.apex[0], 0, t.apex[1]];
  for (const s of [1, -1]) {
    bar([0.6 * k, s * 1.3 * k, z + 3.0 * k], add(head, [0, s * 0.35, 0]), 0.34 * k + 0.05, "paint", out);
    bar([-3.6 * k, s * 1.3 * k, z + 3.0 * k], add(head, [0, s * 0.35, 0]), 0.26 * k + 0.05, "paint", out);
  }
  box(head[0] - 0.3, head[0] + 0.3, -0.6, 0.6, head[2] - 0.25, head[2] + 0.25, "paint", out);
  box(head[0] - 0.14, head[0] + 0.14, -0.14, 0.14, head[2] + 0.25, head[2] + 0.55, "lamp", out);
  return out;
}

/** The jib, about its foot, at the angle it is baked at: a lattice, wide at the foot and narrow at the head, with its sheaves. */
function jib(t: Turning): Tri[] {
  const out: Tri[] = [], c = Math.cos(t.baked), s = Math.sin(t.baked);
  const at = (d: number, up = 0): V3 => [d * c - up * s, 0, d * s + up * c];
  lattice(at(0), at(t.jib * 0.3), t.half, t.half * 0.9, 4, "paint", out);
  lattice(at(t.jib * 0.3), at(t.jib - 0.6), t.half * 0.9, t.half * 0.4, 9, "paint", out);
  // The head: cheek plates and the sheaves the hoist rope runs over.
  const tip = at(t.jib);
  box(tip[0] - 0.5, tip[0] + 0.3, -t.half * 0.5, t.half * 0.5, tip[2] - 0.5, tip[2] + 0.3, "paint", out);
  for (const y of [-0.2, 0.2]) box(tip[0] - 0.3, tip[0] + 0.3, y - 0.07, y + 0.07, tip[2] - 0.3, tip[2] + 0.3, "trim", out);
  box(tip[0] - 0.12, tip[0] + 0.12, -0.12, 0.12, tip[2] + 0.3, tip[2] + 0.55, "lamp", out);
  return out;
}

// ─── THE YARD GANTRY ─────────────────────────────────────────────────────────

/** The yard gantry's measures, metres: its half-span along the quay, its legs' spacing along the bay, and its beam's height. */
export const RTG = { half: 4.6, wheel: 2.6, top: 11.0 } as const;

/** One side of it, at `y`: two legs on rubber tyres and the sill between them. */
function rtgSide(y: number): Tri[] {
  const out: Tri[] = [], s = Math.sign(y);
  for (const x of [-RTG.wheel, RTG.wheel]) {
    for (const k of [-0.45, 0.45]) { box(x + k - 0.34, x + k + 0.34, y - 0.3, y + 0.3, 0, 0.95, "tyre", out); box(x + k - 0.14, x + k + 0.14, y - 0.32, y + 0.32, 0.3, 0.65, "hub", out); }
    box(x - 0.28, x + 0.28, y - 0.28, y + 0.28, 0.95, RTG.top, "paint", out);
  }
  box(-RTG.wheel - 0.8, RTG.wheel + 0.8, y - 0.32, y + 0.32, 0.95, 1.55, "paint", out);
  hazard(-RTG.wheel - 0.6, RTG.wheel + 0.6, y + s * 0.32, y + s * 0.36, 1.05, 1.45, 7, out);
  box(-0.7, 0.7, y + s * 0.3, y + s * 1.3, 1.55, 3.2, "liveryWhite", out);
  return out;
}

/** Its beams across the bay, and the light on it. */
function rtgTop(): Tri[] {
  const out: Tri[] = [];
  for (const x of [-RTG.wheel, RTG.wheel]) box(x - 0.34, x + 0.34, -RTG.half, RTG.half, RTG.top - 0.8, RTG.top, "paint", out);
  for (const y of [-RTG.half, RTG.half]) box(-RTG.wheel, RTG.wheel, y - 0.3, y + 0.3, RTG.top - 0.6, RTG.top, "paint", out);
  box(-0.16, 0.16, RTG.half - 0.2, RTG.half + 0.12, RTG.top, RTG.top + 0.4, "lamp", out);
  return out;
}

// ─── WHAT IS LIFTED ──────────────────────────────────────────────────────────

/** A container's measures, metres: long, wide and high; and a crate's. */
export const BOX = { long: 5.4, wide: 2.25, tall: 2.2 } as const;
export const CRATE = { long: 1.9, wide: 1.5, tall: 1.3 } as const;

/** A container, about the middle of its floor, long along `x`: corrugated sides, its frame, doors at one end. */
function container(): Tri[] {
  const out: Tri[] = [], l = BOX.long / 2, w = BOX.wide / 2, h = BOX.tall;
  box(-l, l, -w, w, 0.06, h, "paint", out);
  // The frame: corner posts, top and bottom rails, proud of the sides.
  for (const x of [-l, l]) for (const y of [-w, w]) box(x - 0.08, x + 0.08, y - 0.08, y + 0.08, 0, h + 0.03, "seam", out);
  for (const y of [-w, w]) for (const z of [0, h - 0.08]) box(-l, l, y - 0.03, y + 0.03, z, z + 0.11, "seam", out);
  // The corrugations, as thin ribs down each long side and across the roof.
  for (let x = -l + 0.3; x < l - 0.1; x += 0.36) { for (const y of [-w, w]) box(x, x + 0.07, y - 0.025, y + 0.025, 0.12, h - 0.1, "seam", out); box(x, x + 0.07, -w + 0.05, w - 0.05, h, h + 0.02, "seam", out); }
  // The doors: a split, and their locking bars.
  box(l, l + 0.02, -0.03, 0.03, 0.1, h - 0.08, "seam", out);
  for (const y of [-w * 0.55, -w * 0.2, w * 0.2, w * 0.55]) tube([l + 0.04, y, 0.12], [l + 0.04, y, h - 0.1], 0.03, "chrome", out, 4);
  return out;
}

/** A crate on a pallet, about the middle of its floor: boarded sides, battens, a strap. */
function crateModel(): Tri[] {
  const out: Tri[] = [], l = CRATE.long / 2, w = CRATE.wide / 2, h = CRATE.tall;
  for (const x of [-l + 0.15, 0, l - 0.15]) box(x - 0.1, x + 0.1, -w, w, 0, 0.14, "bark", out);
  box(-l, l, -w, w, 0.14, h, "paint", out);
  for (const x of [-l, -l / 3, l / 3, l - 0.08]) for (const y of [-w, w]) box(x, x + 0.08, y - 0.03, y + 0.03, 0.14, h, "wood", out);
  for (const y of [-w, -w / 3, w / 3, w - 0.08]) for (const x of [-l, l]) box(x - 0.03, x + 0.03, y, y + 0.08, 0.14, h, "wood", out);
  box(-0.06, 0.06, -w - 0.01, w + 0.01, 0.14, h + 0.01, "trim", out);
  return out;
}

const NO_SHADOW: PropShadow = { hl: 0.1, hw: 0.1, edge: 0.1, soft: 0.1, strength: 0, reach: 0 };
const shadow = (hl: number, hw: number, strength = 0.22): PropShadow => ({ hl, hw, edge: 0.4, soft: 1.2, strength, reach: 0.6 });

/** A part to bake: what it is called, the headings it is baked at, its triangles and the shadow under it. */
export type CranePart = { id: string; headings: readonly number[]; tris: () => Tri[]; shadow: PropShadow };

export const CRANE_PARTS: readonly CranePart[] = [
  { id: "sts-side-a", headings: FACING_HEADINGS, tris: () => stsSide(-STS.half), shadow: shadow(5, 0.8) },
  { id: "sts-side-b", headings: FACING_HEADINGS, tris: () => stsSide(STS.half), shadow: shadow(5, 0.8) },
  { id: "sts-top", headings: FACING_HEADINGS, tris: stsTop, shadow: NO_SHADOW },
  { id: "sts-boom", headings: FACING_HEADINGS, tris: stsBoom, shadow: NO_SHADOW },
  { id: "sts-trolley", headings: FACING_HEADINGS, tris: stsTrolley, shadow: NO_SHADOW },
  { id: "sts-spreader", headings: FACING_HEADINGS, tris: stsSpreader, shadow: NO_SHADOW },
  { id: "luff-portal", headings: FACING_HEADINGS, tris: luffPortal, shadow: shadow(2.2, 2.2) },
  { id: "luff-house", headings: TURN_HEADINGS, tris: () => house(LUFFING, 1), shadow: NO_SHADOW },
  { id: "luff-jib", headings: TURN_HEADINGS, tris: () => jib(LUFFING), shadow: NO_SHADOW },
  { id: "harbour-base", headings: FACING_HEADINGS, tris: pedestal, shadow: shadow(1.3, 1.3) },
  { id: "harbour-house", headings: TURN_HEADINGS, tris: () => house(HARBOUR, 0.62), shadow: NO_SHADOW },
  { id: "harbour-jib", headings: TURN_HEADINGS, tris: () => jib(HARBOUR), shadow: NO_SHADOW },
  { id: "rtg-side-a", headings: FACING_HEADINGS, tris: () => rtgSide(-RTG.half), shadow: shadow(3.2, 0.6) },
  { id: "rtg-side-b", headings: FACING_HEADINGS, tris: () => rtgSide(RTG.half), shadow: shadow(3.2, 0.6) },
  { id: "rtg-top", headings: FACING_HEADINGS, tris: rtgTop, shadow: NO_SHADOW },
  { id: "box", headings: DECK_HEADINGS, tris: container, shadow: shadow(BOX.long / 2, BOX.wide / 2, 0.18) },
  { id: "crate", headings: DECK_HEADINGS, tris: crateModel, shadow: shadow(CRATE.long / 2, CRATE.wide / 2, 0.18) },
];
