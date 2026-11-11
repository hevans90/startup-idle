/**
 * World v2 — THE FLEET, as models: every hull that comes up a river. In
 * metres, `x` forward, `z` up from the waterline; baked by the vehicles'
 * rasteriser into a sheet at 32 headings, as the cars are. Only what stands
 * over the water is modelled. @see dev/bake-boats.ts, plans/seaports.md §4
 *
 * TWO LAYERS: the hull's paint, white and tinted in the game by its line's
 * livery; and everything else in its own colours. A hull that carries cargo
 * is baked twice, LADEN and EMPTY, as two looks — a layer of cargo hidden
 * would leave a hole where it had covered the deck.
 *
 * THREE MARKS, lit at night: cabin windows and the masthead light; the red
 * light to port; the green to starboard.
 */
import { TILES_PER_M, type Mat } from "../agents/cars/models";
import { face, type Tri, type V3 } from "../agents/cars/raster";
import { limb } from "../agents/people/figures";
import { box, lathe, type PropShadow } from "../props/models";
import { SHIP_CLASSES } from "./classes";

export type BoatModel = { id: string; cls: number; tris: () => Tri[]; shadow: PropShadow };

export const BOAT_LAYERS = 2;
export const boatLayerOf = (m: Mat) => (m === "paint" ? 0 : 1);
/** The marks: lit windows and white lights; the port light; the starboard light. */
export const BOAT_MARKS = 3;
export const boatMarkOf = (m: Mat, _p: V3) => (m === "glass" || m === "lamp" ? 1 : m === "tail" ? 2 : m === "indicator" ? 4 : 0);

/** A class's length and beam, metres. */
const sizeOf = (cls: number) => ({ L: SHIP_CLASSES[cls].length / TILES_PER_M, B: SHIP_CLASSES[cls].beam / TILES_PER_M });

/** A station of a hull: how far along, its half-beam at the deck, and how high its deck stands. */
type Station = [x: number, half: number, z: number];

/**
 * A HULL lofted through stations, stern first: its sides from the waterline
 * up to the deck — the lower part paint, a strake under the gunwale in
 * `strake` — narrower at the water than at the deck, a transom across the
 * first station if it has any beam, and the deck over it.
 */
function hull(st: readonly Station[], deck: Mat, strake: Mat, out: Tri[], tuck = 0.82) {
  const mid: V3 = [(st[0][0] + st[st.length - 1][0]) / 2, 0, st[0][2] / 2];
  for (let k = 0; k + 1 < st.length; k++) {
    const [x0, h0, z0] = st[k], [x1, h1, z1] = st[k + 1];
    for (const s of [1, -1]) {
      const low = (x: number, h: number): V3 => [x, s * h * tuck, 0];
      const belt = (x: number, h: number, z: number): V3 => [x, s * h * (tuck + (1 - tuck) * 0.72), z * 0.72];
      const top = (x: number, h: number, z: number): V3 => [x, s * h, z];
      face([low(x0, h0), low(x1, h1), belt(x1, h1, z1), belt(x0, h0, z0)], "paint", mid, out);
      face([belt(x0, h0, z0), belt(x1, h1, z1), top(x1, h1, z1), top(x0, h0, z0)], strake, mid, out);
    }
    face([[x0, -h0, z0], [x1, -h1, z1], [x1, h1, z1], [x0, h0, z0]], deck, [mid[0], 0, -5], out);
  }
  const [x0, h0, z0] = st[0];
  if (h0 > 0.01) face([[x0, -h0 * tuck, 0], [x0, h0 * tuck, 0], [x0, h0, z0], [x0, -h0, z0]], "paint", mid, out);
}

/** A hull's stations for a length and beam: a full stern, the beam carried well forward, a pointed bow rising in a sheer. */
const lines = (L: number, B: number, free: number, sheer = 0.35, stern = 0.78): Station[] => [
  [-L / 2, (B / 2) * stern, free * (1 + sheer * 0.25)],
  [-L * 0.36, (B / 2) * 0.96, free],
  [-L * 0.05, B / 2, free],
  [L * 0.2, (B / 2) * 0.94, free * (1 + sheer * 0.2)],
  [L * 0.36, (B / 2) * 0.66, free * (1 + sheer * 0.6)],
  [L * 0.46, (B / 2) * 0.28, free * (1 + sheer * 0.9)],
  [L / 2, 0, free * (1 + sheer)],
];

/** A deckhouse: walls, a roof that oversails them a little, and a band of windows round it. */
function house(x0: number, x1: number, half: number, z0: number, z1: number, out: Tri[], wall: Mat = "liveryWhite", roof: Mat = "roofWhite") {
  box(x0, x1, -half, half, z0, z1, wall, out);
  box(x0 - 0.12, x1 + 0.12, -half - 0.12, half + 0.12, z1, z1 + 0.12, roof, out);
  const w0 = z0 + (z1 - z0) * 0.45, w1 = z0 + (z1 - z0) * 0.85;
  box(x0 + 0.25, x1 - 0.25, -half - 0.03, half + 0.03, w0, w1, "glass", out);
  box(x0 - 0.03, x1 + 0.03, -half + 0.25, half - 0.25, w0, w1, "glass", out);
}

/** The lights every hull under way shows: red to port, green to starboard, on its house or its rail; and a white one up a mast. */
function lights(x: number, half: number, z: number, mastX: number, mastZ: number, out: Tri[], mastFrom = z) {
  box(x - 0.14, x + 0.14, -half - 0.1, -half + 0.06, z, z + 0.24, "tail", out);
  box(x - 0.14, x + 0.14, half - 0.06, half + 0.1, z, z + 0.24, "indicator", out);
  limb([mastX, 0, mastFrom], [mastX, 0, mastZ], 0.07, 0.05, "iron", out, 6, false);
  box(mastX - 0.13, mastX + 0.13, -0.13, 0.13, mastZ, mastZ + 0.24, "lamp", out);
}

/** A sail: a triangle seen from both sides. */
function sail(a: V3, b: V3, c: V3, out: Tri[]) {
  face([a, b, c], "linen", [a[0], a[1] + 1, a[2]], out);
  face([a, b, c], "linen", [a[0], a[1] - 1, a[2]], out);
}

/** A funnel: a raked oval stack with a dark top. */
function funnel(x: number, z0: number, h: number, r: number, mat: Mat, out: Tri[]) {
  lathe(x, 0, [[r, z0], [r * 0.92, z0 + h * 0.8]], mat, out, 12, false);
  lathe(x, 0, [[r * 0.92, z0 + h * 0.8], [r * 0.9, z0 + h]], "trim", out, 12);
}

const shadowOf = (L: number, B: number): PropShadow => ({ hl: L * 0.46, hw: B * 0.42, edge: 0.3, soft: 0.9, strength: 0.2, reach: 0.4 });

function dinghy(): Tri[] {
  const { L, B } = sizeOf(0), out: Tri[] = [];
  hull(lines(L * 0.86, B * 0.86, 0.75, 0.45), "wood", "roofWhite", out);
  // Thwarts, a mast, a mainsail and a jib.
  box(-1.6, -1.3, -B * 0.36, B * 0.36, 0.75, 0.86, "seat", out);
  box(0.9, 1.2, -B * 0.34, B * 0.34, 0.78, 0.9, "seat", out);
  limb([0.7, 0, 0.7], [0.7, 0, 8.2], 0.08, 0.05, "wood", out, 6, false);
  limb([0.7, 0, 1.5], [-3.2, 0, 1.7], 0.06, 0.05, "wood", out, 6, false);
  sail([0.62, 0, 7.9], [0.62, 0, 1.75], [-3.1, 0, 1.85], out);
  sail([0.8, 0, 7.2], [0.8, 0, 1.4], [3.5, 0, 1.2], out);
  return out;
}

function fishing(): Tri[] {
  const { L, B } = sizeOf(0), out: Tri[] = [];
  hull(lines(L, B, 1.0, 0.5), "wood", "paint", out);
  // The working deck aft, where her catch is stacked, and a net drum.
  lathe(-0.6, 0, [[0.45, 1.0], [0.45, 1.6]], "iron", out, 10);
  return out;
}
function fishingHouse(): Tri[] {
  const { B } = sizeOf(0), out: Tri[] = [];
  house(0.6, 2.6, B * 0.3, 1.05, 2.9, out);
  lights(1.6, B * 0.3, 2.3, 1.0, 5.2, out, 2.9);
  limb([0.5, 0, 2.9], [-3.6, 0, 4.4], 0.07, 0.05, "iron", out, 6, false);
  return out;
}

function ferry(): Tri[] {
  const { L, B } = sizeOf(0), out: Tri[] = [];
  hull(lines(L, B * 1.08, 0.9, 0.15, 0.92), "roofWhite", "paint", out);
  // A long saloon with windows all round, an open deck over it, a wheelhouse forward, a funnel in the line's colour.
  house(-3.4, 2.6, B * 0.42, 0.95, 2.6, out);
  for (const s of [1, -1]) box(-3.3, 2.5, s * B * 0.42 - 0.04, s * B * 0.42 + 0.04, 2.72, 3.3, "chrome", out);
  house(1.2, 2.6, B * 0.26, 2.72, 4.2, out);
  funnel(-1.6, 2.72, 1.5, 0.4, "paint", out);
  lights(1.9, B * 0.26, 3.6, 0.6, 5.6, out, 2.72);
  return out;
}

function yacht(): Tri[] {
  const { L, B } = sizeOf(0), out: Tri[] = [];
  hull(lines(L, B * 0.78, 0.85, 0.3, 0.55), "wood", "paint", out);
  // A low coachroof, a tall rig: a mainsail and a genoa.
  box(-1.4, 1.4, -B * 0.2, B * 0.2, 0.85, 1.4, "roofWhite", out);
  box(-1.2, 1.2, -B * 0.2 - 0.03, B * 0.2 + 0.03, 1.02, 1.28, "glass", out);
  limb([0.9, 0, 1.4], [0.9, 0, 11.5], 0.08, 0.04, "chrome", out, 6, false);
  limb([0.9, 0, 2.0], [-3.9, 0, 2.1], 0.06, 0.05, "chrome", out, 6, false);
  sail([0.82, 0, 11.2], [0.82, 0, 2.2], [-3.8, 0, 2.3], out);
  sail([1.0, 0, 10.2], [1.0, 0, 1.6], [4.4, 0, 1.3], out);
  box(0.77, 1.03, -0.13, 0.13, 11.5, 11.74, "lamp", out);
  return out;
}

function lighter(): Tri[] {
  const { L, B } = sizeOf(0), out: Tri[] = [];
  hull(lines(L, B, 0.8, 0.12, 0.95), "trim", "paint", out);
  // An open hold with a coaming round it. What is in it is put there a crate at a time. @see cargo
  box(-1.9, 3.2, -B * 0.38, B * 0.38, 0.8, 1.05, "iron", out);
  box(-1.75, 3.05, -B * 0.33, B * 0.33, 1.05, 1.07, "interior", out);
  return out;
}
function lighterHouse(): Tri[] {
  const { B } = sizeOf(0), out: Tri[] = [];
  house(-3.9, -2.4, B * 0.28, 0.85, 2.5, out);
  lights(-3.1, B * 0.28, 2.0, -3.1, 4.0, out, 2.5);
  return out;
}

function drone(): Tri[] {
  const { L, B } = sizeOf(0), out: Tri[] = [];
  // The Machine's: a low dark hull, no house, nobody aboard — a strip of light down it and one at the bow.
  hull(lines(L, B * 0.92, 0.7, 0.1, 0.9), "aiLoad", "paint", out);
  box(-3.2, 2.6, -B * 0.3, B * 0.3, 0.7, 1.15, "aiLoad", out);
  box(-3.0, 2.4, -0.08, 0.08, 1.15, 1.2, "violet", out);
  box(3.4, 3.7, -0.15, 0.15, 0.95, 1.25, "violet", out);
  return out;
}

function coaster(): Tri[] {
  const { L, B } = sizeOf(1), out: Tri[] = [];
  hull(lines(L, B, 1.5, 0.3, 0.9), "bed", "roofWhite", out);
  // A raised fo'c'sle with a mast and derrick; a hold amidships under hatch covers, her cargo stacked on them.
  box(L * 0.3, L * 0.44, -B * 0.3, B * 0.3, 1.6, 2.2, "paint", out);
  box(-L * 0.16, L * 0.27, -B * 0.4, B * 0.4, 1.5, 1.85, "iron", out);
  for (let k = 0; k < 3; k++) {
    const x0 = -L * 0.15 + k * L * 0.14;
    box(x0, x0 + L * 0.13, -B * 0.36, B * 0.36, 1.85, 2.0, "liveryGreen", out);
  }
  limb([L * 0.32, 0, 2.2], [L * 0.32, 0, 6.4], 0.1, 0.07, "iron", out, 6, false);
  return out;
}
function coasterHouse(): Tri[] {
  const { L, B } = sizeOf(1), out: Tri[] = [];
  house(-L * 0.44, -L * 0.22, B * 0.36, 1.55, 3.6, out);
  house(-L * 0.42, -L * 0.27, B * 0.28, 3.72, 5.5, out);
  funnel(-L * 0.37, 5.62, 1.6, 0.5, "paint", out);
  lights(-L * 0.3, B * 0.28, 4.7, -L * 0.3, 8.2, out, 5.62);
  return out;
}

function containerShip(): Tri[] {
  const { L, B } = sizeOf(2), out: Tri[] = [];
  hull(lines(L, B, 2.3, 0.22, 0.94), "bed", "paint", out);
  // A fo'c'sle and a foremast; the guides her boxes sit between. The boxes are put there one at a time. @see cargo
  box(L * 0.36, L * 0.47, -B * 0.28, B * 0.28, 2.4, 3.0, "bed", out);
  for (const x of [-4.2, 1.6, 7.5]) for (const s of [1, -1]) limb([x, s * B * 0.42, 2.3], [x, s * B * 0.42, 3.4], 0.07, 0.07, "iron", out, 5, false);
  limb([L * 0.42, 0, 3.0], [L * 0.42, 0, 7.5], 0.1, 0.07, "iron", out, 6, false);
  box(L * 0.42 - 0.13, L * 0.42 + 0.13, -0.13, 0.13, 7.5, 7.74, "lamp", out);
  return out;
}
function containerHouse(): Tri[] {
  const { L, B } = sizeOf(2), out: Tri[] = [];
  // The bridge aft, tall enough to see over the stacks.
  house(-L * 0.46, -L * 0.27, B * 0.42, 2.35, 5.0, out);
  house(-L * 0.45, -L * 0.3, B * 0.36, 5.12, 7.4, out);
  house(-L * 0.44, -L * 0.33, B * 0.48, 7.52, 9.2, out);
  funnel(-L * 0.31, 7.52, 2.6, 0.7, "paint", out);
  lights(-L * 0.38, B * 0.48, 8.4, -L * 0.38, 11.6, out, 9.32);
  return out;
}

const NO_SHADOW: PropShadow = { hl: 0.1, hw: 0.1, edge: 0.1, soft: 0.1, strength: 0, reach: 0 };

/**
 * Every look baked, with the class of ship it is. A hull that carries cargo
 * is baked bare, and its HOUSE apart as `<look>-house` — so her boxes, drawn
 * one by one, can go between the two: in front of the house when it is the
 * further from the camera, and behind it when it is the nearer.
 */
export const BOATS: readonly BoatModel[] = [
  ...[
    { id: "dinghy", cls: 0, tris: dinghy },
    { id: "fishing", cls: 0, tris: fishing },
    { id: "ferry", cls: 0, tris: ferry },
    { id: "yacht", cls: 0, tris: yacht },
    { id: "lighter", cls: 0, tris: lighter },
    { id: "drone", cls: 0, tris: drone },
    { id: "coaster", cls: 1, tris: coaster },
    { id: "container", cls: 2, tris: containerShip },
  ].map((m) => ({ ...m, shadow: shadowOf(sizeOf(m.cls).L, sizeOf(m.cls).B) })),
  ...[
    { id: "fishing-house", cls: 0, tris: fishingHouse },
    { id: "lighter-house", cls: 0, tris: lighterHouse },
    { id: "coaster-house", cls: 1, tris: coasterHouse },
    { id: "container-house", cls: 2, tris: containerHouse },
  ].map((m) => ({ ...m, shadow: NO_SHADOW })),
];

/** The liveries a line's hulls are painted in, by a ship's number. */
export const LIVERIES: readonly number[] = [0xb8463a, 0x2f5f8f, 0x2f7d5b, 0xd9a23a, 0x5d4a8a, 0x30383f, 0xc9603a, 0x1f6f7a];
/** A yacht's hull is white, or near it; the Machine's is its own violet. */
export const YACHT_HULLS: readonly number[] = [0xf4f1ea, 0xe9eef2, 0x23324a];
export const AI_HULL = 0x4b3a78;
/** A convoy's ships are all in one: navy. */
export const CONVOY_HULL = 0x1f3a5f;
