/**
 * World v2 — THE HOUSES, as models: the three districts' homes, each in three
 * tiers and a landmark. In metres, `x` toward the screen's lower right, `y`
 * toward its lower left, `z` up, the middle of the plot at the origin; baked
 * by the vehicles' rasteriser into a sheet, as the props are.
 * @see dev/bake-houses.ts
 *
 * IN PARTS, because a house rises as its people move in: a ground floor, the
 * floors that stack on it (a few of them, so a tower's are not all alike) and
 * a roof. A floor is modelled standing on the ground floor and the roof
 * likewise, and the game lifts each a storey at a time.
 *
 * TWO FACES SHOW: the one toward `+y`, in the light, where the door is; and
 * the one toward `+x`, in shade. The walls are white, and tinted in the game.
 */
import type { Mat } from "../agents/cars/models";
import { face, type Tri, type V3 } from "../agents/cars/raster";
import { limb } from "../agents/people/figures";
import { box, lathe } from "../props/models";
import { HOUSE_FLOORS, HOUSE_KITS } from "./kits";

export type HouseShadow = { hl: number; hw: number; edge: number; soft: number; strength: number; reach: number };
export type House = {
  /** The kit it is: `intern.t0`, `10x_dev.landmark`. */
  id: string;
  /** How tall its ground floor is, and each floor over it, metres. */
  ground: number;
  storey: number;
  /** As many floors as it grows to, the ground floor one of them. */
  floors: number;
  /** Its parts: the ground floor; each kind of upper floor, standing on it; the roof, standing on it. */
  parts: () => { ground: Tri[]; mids: Tri[][]; roof: Tri[] };
  shadow: HouseShadow;
  /** What its walls are tinted, one to a building. */
  tints: readonly number[];
};

/** The tinted layer: the walls. */
export const houseLayerOf = (m: Mat) => (m === "wall" ? 0 : 1);

/**
 * SNOW LYING on what `tris` holds up: a coat over every face turned to the sky (a slope, a deck, a coping, a
 * chimney's cap), lifted off it a little along the way it faces. Baked with what it lies on, so what stands in
 * front of it hides it. @see dev/bake-houses
 */
export function snowOver(tris: readonly Tri[], lift = 0.09, steep = 0.42): Tri[] {
  const out: Tri[] = [];
  for (const t of tris) {
    if (t.n[2] < steep || t.mat === "pane") continue;
    const up = (q: V3): V3 => [q[0] + t.n[0] * lift, q[1] + t.n[1] * lift, q[2] + t.n[2] * lift];
    out.push({ p: [up(t.p[0]), up(t.p[1]), up(t.p[2])], mat: "snow", n: t.n, ...(t.tag ? { tag: t.tag } : {}) });
  }
  return out;
}

type Out = Tri[];
type Win = { frame?: Mat; pane?: Mat; sill?: boolean; bar?: boolean };

/** A window on the face `x = X`, `w` wide about `y = c`, from `z0` to `z1`. */
function winX(o: Out, X: number, c: number, w: number, z0: number, z1: number, k: Win = {}) {
  const f = k.frame ?? "linen";
  box(X, X + 0.06, c - w / 2 - 0.09, c + w / 2 + 0.09, z0 - 0.09, z1 + 0.09, f, o);
  box(X, X + 0.09, c - w / 2, c + w / 2, z0, z1, k.pane ?? "pane", o);
  if (k.bar !== false) box(X, X + 0.11, c - 0.035, c + 0.035, z0, z1, f, o);
  if (k.sill !== false) box(X, X + 0.16, c - w / 2 - 0.15, c + w / 2 + 0.15, z0 - 0.2, z0 - 0.09, "stone", o);
}
/** A window on the face `y = Y`, `w` wide about `x = c`. */
function winY(o: Out, Y: number, c: number, w: number, z0: number, z1: number, k: Win = {}) {
  const f = k.frame ?? "linen";
  box(c - w / 2 - 0.09, c + w / 2 + 0.09, Y, Y + 0.06, z0 - 0.09, z1 + 0.09, f, o);
  box(c - w / 2, c + w / 2, Y, Y + 0.09, z0, z1, k.pane ?? "pane", o);
  if (k.bar !== false) box(c - 0.035, c + 0.035, Y, Y + 0.11, z0, z1, f, o);
  if (k.sill !== false) box(c - w / 2 - 0.15, c + w / 2 + 0.15, Y, Y + 0.16, z0 - 0.2, z0 - 0.09, "stone", o);
}
/** `n` windows evenly along each face: `nx` on the shaded one, `ny` on the lit one; `skip` leaves a place on the lit one for a door. */
function windows(o: Out, hx: number, hy: number, nx: number, ny: number, w: number, z0: number, z1: number, k: Win = {}, skip = -1) {
  for (let i = 0; i < nx; i++) winX(o, hx, -hy + ((i + 0.5) * 2 * hy) / nx, w, z0, z1, k);
  for (let i = 0; i < ny; i++) if (i !== skip) winY(o, hy, -hx + ((i + 0.5) * 2 * hx) / ny, w, z0, z1, k);
}
/** A door on the lit face about `x = c`: its frame, the leaf, a light over it and a step. */
function door(o: Out, hy: number, c: number, mat: Mat, w = 1.0, h = 2.15, frame: Mat = "linen") {
  box(c - w / 2 - 0.1, c + w / 2 + 0.1, hy, hy + 0.07, 0, h + 0.45, frame, o);
  box(c - w / 2, c + w / 2, hy, hy + 0.1, 0.05, h, mat, o);
  box(c - w / 2, c + w / 2, hy, hy + 0.1, h + 0.08, h + 0.38, "pane", o);
  box(c - w / 2 - 0.2, c + w / 2 + 0.2, hy, hy + 0.45, 0, 0.12, "stone", o);
}
/** The walls of a floor. */
const walls = (o: Out, hx: number, hy: number, z0: number, z1: number, mat: Mat = "wall") => box(-hx, hx, -hy, hy, z0, z1, mat, o);
/** A course standing proud all round at `z`. */
const course = (o: Out, hx: number, hy: number, z: number, mat: Mat = "stone", h = 0.2, out = 0.08) =>
  box(-hx - out, hx + out, -hy - out, hy + out, z - h, z, mat, o);
/** A balcony on the lit face about `x = c`: a slab and a rail of `mat` — glass, or iron bars. */
function balconyY(o: Out, hy: number, c: number, w: number, z: number, mat: Mat = "iron", d = 0.95) {
  box(c - w / 2, c + w / 2, hy, hy + d, z - 0.12, z, "stone", o);
  if (mat === "pane") { box(c - w / 2, c + w / 2, hy + d - 0.04, hy + d, z, z + 1.0, "pane", o); box(c + w / 2 - 0.04, c + w / 2, hy, hy + d, z, z + 1.0, "pane", o); return; }
  box(c - w / 2, c + w / 2, hy + d - 0.05, hy + d, z + 0.95, z + 1.02, mat, o);
  box(c + w / 2 - 0.05, c + w / 2, hy, hy + d, z + 0.95, z + 1.02, mat, o);
  for (let x = c - w / 2; x <= c + w / 2 + 1e-6; x += w / 6) box(x - 0.025, x + 0.025, hy + d - 0.05, hy + d, z, z + 0.95, mat, o);
}
/** The same on the shaded face about `y = c`. */
function balconyX(o: Out, hx: number, c: number, w: number, z: number, mat: Mat = "iron", d = 0.95) {
  box(hx, hx + d, c - w / 2, c + w / 2, z - 0.12, z, "stone", o);
  if (mat === "pane") { box(hx + d - 0.04, hx + d, c - w / 2, c + w / 2, z, z + 1.0, "pane", o); box(hx, hx + d, c + w / 2 - 0.04, c + w / 2, z, z + 1.0, "pane", o); return; }
  box(hx + d - 0.05, hx + d, c - w / 2, c + w / 2, z + 0.95, z + 1.02, mat, o);
  box(hx, hx + d, c + w / 2 - 0.05, c + w / 2, z + 0.95, z + 1.02, mat, o);
  for (let y = c - w / 2; y <= c + w / 2 + 1e-6; y += w / 6) box(hx + d - 0.05, hx + d, y - 0.025, y + 0.025, z, z + 0.95, mat, o);
}

/** A GABLED ROOF, its ridge along `x`: two slopes over the eaves and a gable in the wall's stuff at each end. */
function gable(o: Out, hx: number, hy: number, z: number, rise: number, mat: Mat, over = 0.4, wall: Mat = "wall") {
  const X = hx + over, Y = hy + over, top = z + rise, eave = z - (rise * over) / hy, inside: V3 = [0, 0, z];
  face([[-X, -Y, eave], [X, -Y, eave], [X, 0, top], [-X, 0, top]], mat, inside, o);
  face([[-X, Y, eave], [X, Y, eave], [X, 0, top], [-X, 0, top]], mat, inside, o);
  for (const x of [-hx, hx]) face([[x, -hy, z], [x, hy, z], [x, 0, top]], wall, inside, o);
  // The roof's edge at the gable, a board under the tiles.
  for (const x of [-X, X]) { face([[x, -Y, eave - 0.14], [x, -Y, eave], [x, 0, top], [x, 0, top - 0.14]], "linen", inside, o); face([[x, Y, eave - 0.14], [x, Y, eave], [x, 0, top], [x, 0, top - 0.14]], "linen", inside, o); }
  face([[-X, Y, eave - 0.14], [X, Y, eave - 0.14], [X, Y, eave], [-X, Y, eave]], "linen", inside, o);
}
/** A HIPPED ROOF: four slopes to a ridge along `x` (the longer way), or to a point. */
function hip(o: Out, hx: number, hy: number, z: number, rise: number, mat: Mat, over = 0.4) {
  const X = hx + over, Y = hy + over, top = z + rise, inside: V3 = [0, 0, z], r = Math.max(0, X - Y);
  const a: V3 = [-r, 0, top], b: V3 = [r, 0, top];
  for (const y of [-Y, Y]) face(r ? [[-X, y, z], [X, y, z], b, a] : [[-X, y, z], [X, y, z], b], mat, inside, o);
  face([[X, -Y, z], [X, Y, z], b], mat, inside, o);
  face([[-X, -Y, z], [-X, Y, z], a], mat, inside, o);
  box(-X, X, -Y, Y, z - 0.14, z, "linen", o);
}
/** A FLAT ROOF: its covering, and a parapet in the wall's stuff with a coping. */
function flat(o: Out, hx: number, hy: number, z: number, p = 0.55, wall: Mat = "wall", cover: Mat = "roofing") {
  box(-hx, hx, -hy, hy, z, z + 0.06, cover, o);
  const t = 0.24;
  for (const [x0, x1, y0, y1] of [[-hx, hx, -hy, -hy + t], [-hx, hx, hy - t, hy], [-hx, -hx + t, -hy, hy], [hx - t, hx, -hy, hy]]) {
    box(x0, x1, y0, y1, z, z + p, wall, o);
    box(x0 - 0.05, x1 + 0.05, y0 - 0.05, y1 + 0.05, z + p, z + p + 0.08, "stone", o);
  }
}
/** A chimney: a stack of the wall's stuff, a cap and two pots. */
function chimney(o: Out, x: number, y: number, z0: number, z1: number) {
  box(x - 0.35, x + 0.35, y - 0.28, y + 0.28, z0, z1, "wall", o);
  box(x - 0.42, x + 0.42, y - 0.35, y + 0.35, z1, z1 + 0.1, "stone", o);
  for (const d of [-0.17, 0.17]) limb([x + d, y, z1 + 0.1], [x + d, y, z1 + 0.45], 0.09, 0.08, "rooftile", o, 8, false);
}
/** Roof plant: a cooling unit, its fan on top. */
function unit(o: Out, x: number, y: number, z: number, w = 0.9, h = 0.8) {
  box(x - w, x + w, y - w * 0.6, y + w * 0.6, z, z + h, "hub", o);
  lathe(x, y, [[w * 0.45, z + h], [w * 0.45, z + h + 0.05]], "trim", o, 12);
}
/** A water tank on legs: staves, a cone over it. */
function tank(o: Out, x: number, y: number, z: number, r = 0.9) {
  for (const [dx, dy] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) box(x + dx * r - 0.05, x + dx * r + 0.05, y + dy * r - 0.05, y + dy * r + 0.05, z, z + 0.8, "iron", o);
  lathe(x, y, [[r, z + 0.8], [r, z + 2.3], [r * 1.08, z + 2.3], [0.05, z + 2.95]], "wood", o, 16);
}
/** A hedge, clipped square. */
const hedge = (o: Out, x0: number, x1: number, y0: number, y1: number, h = 0.8) => box(x0, x1, y0, y1, 0, h, "hedge", o);
/** A planter with a clipped bush in it. */
function planter(o: Out, x: number, y: number, z: number, w = 0.5) {
  box(x - w, x + w, y - w, y + w, z, z + 0.45, "stone", o);
  box(x - w * 0.85, x + w * 0.85, y - w * 0.85, y + w * 0.85, z + 0.45, z + 1.0, "hedge", o);
}
/** A mast: a pole, a crosstree, a red lamp. */
function mast(o: Out, x: number, y: number, z: number, h: number) {
  limb([x, y, z], [x, y, z + h], 0.09, 0.04, "hub", o, 6, false);
  box(x - 0.5, x + 0.5, y - 0.03, y + 0.03, z + h * 0.6, z + h * 0.6 + 0.06, "hub", o);
  box(x - 0.09, x + 0.09, y - 0.09, y + 0.09, z + h, z + h + 0.18, "tail", o);
}
/**
 * A CURTAIN WALL floor: glass the length of both faces between the corners,
 * mullions every `every`, and a spandrel in the wall's stuff under the floor above.
 */
function curtain(o: Out, hx: number, hy: number, z0: number, z1: number, every = 1.25, k: { frame?: Mat; corner?: number; sill?: number; head?: number } = {}) {
  const f = k.frame ?? "chrome", c = k.corner ?? 0.3, a = z0 + (k.sill ?? 0.15), b = z1 - (k.head ?? 0.7);
  walls(o, hx, hy, z0, z1);
  box(hx, hx + 0.05, -hy + c, hy - c, a, b, "pane", o);
  box(-hx + c, hx - c, hy, hy + 0.05, a, b, "pane", o);
  for (let y = -hy + c; y <= hy - c + 1e-6; y += (2 * (hy - c)) / Math.max(1, Math.round((2 * (hy - c)) / every))) box(hx, hx + 0.1, y - 0.035, y + 0.035, a, b, f, o);
  for (let x = -hx + c; x <= hx - c + 1e-6; x += (2 * (hx - c)) / Math.max(1, Math.round((2 * (hx - c)) / every))) box(x - 0.035, x + 0.035, hy, hy + 0.1, a, b, f, o);
  box(hx, hx + 0.08, -hy + c, hy - c, a - 0.05, a, f, o); box(-hx + c, hx - c, hy, hy + 0.08, a - 0.05, a, f, o);
  box(hx, hx + 0.08, -hy + c, hy - c, b, b + 0.05, f, o); box(-hx + c, hx - c, hy, hy + 0.08, b, b + 0.05, f, o);
}
/** A paved plot, and a path's width of it out to the front. */
const plot = (o: Out, r = 5.2) => box(-r, r, -r, r, 0, 0.1, "pave", o);
/** A path from the door out to the plot's front. */
const path = (o: Out, hy: number, c: number, w = 1.2) => box(c - w / 2, c + w / 2, hy, 5.3, 0, 0.05, "pave", o);

const shadowOf = (hx: number, hy: number, strength = 0.3): HouseShadow => ({ hl: hx + 0.1, hw: hy + 0.1, edge: 0.25, soft: 0.9, strength, reach: 0.9 });
const made = (f: (o: Out) => void): Tri[] => { const o: Out = []; f(o); return o; };

/** Bricks, for the interns' streets. */
const BRICK = [0xb5563d, 0xa64b3a, 0xc46b4b, 0x9a5a45, 0xcdb48c, 0xb9674f] as const;
/** Painted render, for the vibe coders'. */
const RENDER = [0xf3dcc6, 0xecc9d6, 0xcfe4d5, 0xd4dcf0, 0xf5e4a6, 0xeab9a0, 0xf4f0e8] as const;
/** Stone and concrete, for the 10x devs'. */
const STONE = [0xdcd8cf, 0xc9cdd1, 0xb8c0c7, 0xe3ddcf, 0x8f99a3] as const;

// ─── THE INTERNS': brick, and roofs of tile and slate ────────────────────────

const internT0: House = {
  // A cottage: a door between two windows, a tiled gable, a chimney, a hedge to the street.
  id: "intern.t0", ground: 2.9, storey: 2.9, floors: HOUSE_FLOORS["intern.t0"], tints: BRICK, shadow: shadowOf(3.3, 2.7),
  parts: () => {
    const hx = 3.3, hy = 2.7, g = 2.9;
    return {
      ground: made((o) => {
        walls(o, hx, hy, 0, g);
        box(-hx - 0.04, hx + 0.04, -hy - 0.04, hy + 0.04, 0, 0.3, "stone", o);
        windows(o, hx, hy, 1, 3, 1.1, 1.0, 2.2, {}, 1);
        door(o, hy, 0, "liveryGreen");
        path(o, hy, 0);
        hedge(o, -5.1, -0.9, 4.8, 5.2); hedge(o, 0.9, 5.2, 4.8, 5.2); hedge(o, 4.8, 5.2, -5.1, 4.8);
      }),
      mids: [],
      roof: made((o) => { gable(o, hx, hy, g, 1.9, "rooftile"); chimney(o, -1.9, -0.6, g + 0.6, g + 2.7); }),
    };
  },
};

const internT1: House = {
  // A pair of houses under one slate roof: two doors, bays of windows over them.
  id: "intern.t1", ground: 2.9, storey: 2.8, floors: HOUSE_FLOORS["intern.t1"], tints: BRICK, shadow: shadowOf(3.8, 2.9),
  parts: () => {
    const hx = 3.8, hy = 2.9, g = 2.9, f = 2.8;
    return {
      ground: made((o) => {
        walls(o, hx, hy, 0, g);
        box(-hx - 0.04, hx + 0.04, -hy - 0.04, hy + 0.04, 0, 0.3, "stone", o);
        windows(o, hx, hy, 2, 4, 1.05, 1.0, 2.25, {}, -1);
        // Two of the four places are doors.
        box(-hx / 4 - 0.75, -hx / 4 + 0.75, hy, hy + 0.12, 0, 2.7, "wall", o); box(hx / 4 - 0.75, hx / 4 + 0.75, hy, hy + 0.12, 0, 2.7, "wall", o);
        door(o, hy + 0.12, -hx / 4, "liveryRed"); door(o, hy + 0.12, hx / 4, "liveryAlt");
        path(o, hy, -hx / 4); path(o, hy, hx / 4);
        hedge(o, -0.25, 0.25, hy + 0.5, 5.2, 0.7); hedge(o, 4.8, 5.2, -5.1, 5.2); hedge(o, -5.1, -5.1 + 0.4, 3, 5.2);
      }),
      mids: [made((o) => { walls(o, hx, hy, g, g + f); windows(o, hx, hy, 2, 4, 1.05, g + 0.9, g + 2.15); })],
      roof: made((o) => { hip(o, hx, hy, g, 1.9, "slate"); chimney(o, 0, -0.4, g + 0.9, g + 2.6); }),
    };
  },
};

const internT2: House = {
  // A walk-up block of flats: a stone doorway, balconies up the front, a flat roof with its tank.
  id: "intern.t2", ground: 3.2, storey: 3.0, floors: HOUSE_FLOORS["intern.t2"], tints: BRICK, shadow: shadowOf(4.2, 3.5),
  parts: () => {
    const hx = 4.2, hy = 3.5, g = 3.2, f = 3.0;
    return {
      ground: made((o) => {
        plot(o);
        walls(o, hx, hy, 0, g);
        box(-hx - 0.05, hx + 0.05, -hy - 0.05, hy + 0.05, 0.1, 0.55, "stone", o);
        windows(o, hx, hy, 3, 5, 1.0, 1.15, 2.45, {}, 2);
        box(-1.0, 1.0, hy, hy + 0.14, 0.1, 2.9, "stone", o);
        door(o, hy + 0.14, 0, "trim", 1.3, 2.25, "stone");
        box(-1.3, 1.3, hy, hy + 1.0, 2.9, 3.02, "stone", o);
        course(o, hx, hy, g);
      }),
      mids: [
        made((o) => { walls(o, hx, hy, g, g + f); windows(o, hx, hy, 3, 5, 1.0, g + 0.95, g + 2.3); balconyY(o, hy, 0, 2.6, g + 0.3); }),
        made((o) => { walls(o, hx, hy, g, g + f); windows(o, hx, hy, 3, 5, 1.0, g + 0.95, g + 2.3); balconyY(o, hy, -2.5, 1.5, g + 0.3); balconyY(o, hy, 2.5, 1.5, g + 0.3); }),
        made((o) => { walls(o, hx, hy, g, g + f); windows(o, hx, hy, 3, 5, 1.0, g + 0.95, g + 2.3); course(o, hx, hy, g + f, "stone", 0.14); }),
      ],
      roof: made((o) => { flat(o, hx, hy, g); box(-3.4, -1.6, -2.6, -0.8, g, g + 2.1, "wall", o); box(-3.5, -1.5, -2.7, -0.7, g + 2.1, g + 2.2, "roofing", o); tank(o, 1.9, -1.2, g + 0.06, 0.85); }),
    };
  },
};

const internLandmark: House = {
  // A brick tower: a stone base, balconies turn and turn about, plant and a mast on the roof.
  id: "intern.landmark", ground: 4.0, storey: 3.1, floors: HOUSE_FLOORS["intern.landmark"], tints: BRICK, shadow: shadowOf(4.0, 4.0, 0.34),
  parts: () => {
    const hx = 4.0, hy = 4.0, g = 4.0, f = 3.1;
    const floor = (o: Out) => {
      walls(o, hx, hy, g, g + f);
      // Piers at the corners and the middle, standing proud of the bays between.
      for (const c of [-hx + 0.3, 0, hx - 0.3]) box(c - 0.3, c + 0.3, hy, hy + 0.12, g, g + f, "wall", o);
      for (const c of [-hy + 0.3, 0, hy - 0.3]) box(hx, hx + 0.12, c - 0.3, c + 0.3, g, g + f, "wall", o);
      for (const c of [-2.0, 2.0]) { winY(o, hy, c, 2.2, g + 0.9, g + 2.4); winX(o, hx, c, 2.2, g + 0.9, g + 2.4); }
    };
    return {
      ground: made((o) => {
        plot(o);
        walls(o, hx, hy, 0, g, "stone");
        for (const c of [-2.0, 2.0]) winX(o, hx, c, 2.4, 0.9, 3.2, { frame: "trim", sill: false });
        winY(o, hy, -2.0, 2.4, 0.9, 3.2, { frame: "trim", sill: false });
        box(1.0, 3.0, hy, hy + 0.1, 0.1, 3.3, "trim", o); box(1.15, 2.85, hy, hy + 0.14, 0.15, 3.2, "pane", o); box(1.97, 2.03, hy, hy + 0.16, 0.15, 3.2, "trim", o);
        box(0.6, 3.4, hy, hy + 1.4, 3.3, 3.45, "trim", o);
        course(o, hx, hy, g, "stone", 0.3, 0.14);
      }),
      mids: [
        made((o) => { floor(o); }),
        made((o) => { floor(o); balconyY(o, hy, -2.0, 2.6, g + 0.25); balconyX(o, hx, 2.0, 2.6, g + 0.25); }),
        made((o) => { floor(o); balconyY(o, hy, 2.0, 2.6, g + 0.25); balconyX(o, hx, -2.0, 2.6, g + 0.25); course(o, hx, hy, g + f, "stone", 0.12, 0.14); }),
      ],
      roof: made((o) => {
        flat(o, hx, hy, g, 0.8);
        box(-2.6, 0.2, -2.8, -0.4, g, g + 2.4, "wall", o); box(-2.7, 0.3, -2.9, -0.3, g + 2.4, g + 2.52, "roofing", o);
        unit(o, 1.9, 1.6, g + 0.06); unit(o, 1.9, -0.6, g + 0.06, 0.7, 0.7);
        mast(o, -1.2, -1.6, g + 2.52, 4.2);
      }),
    };
  },
};

// ─── THE VIBE CODERS': painted render, big windows, roofs to sit out on ──────

const vibeT0: House = {
  // A studio: one big window to the street, an awning, a deck on the roof.
  id: "vibe_coder.t0", ground: 3.4, storey: 3.2, floors: HOUSE_FLOORS["vibe_coder.t0"], tints: RENDER, shadow: shadowOf(3.4, 3.0),
  parts: () => {
    const hx = 3.4, hy = 3.0, g = 3.4;
    return {
      ground: made((o) => {
        plot(o, 4.9);
        walls(o, hx, hy, 0, g);
        winY(o, hy, -1.2, 3.0, 0.7, 2.6, { frame: "trim", sill: false, bar: false }); box(-1.235, -1.165, hy, hy + 0.11, 0.7, 2.6, "trim", o);
        door(o, hy, 2.0, "sign", 1.0, 2.2, "trim");
        winX(o, hx, 0, 2.6, 0.9, 2.5, { frame: "trim" });
        // The awning over the window, striped.
        for (let k = 0; k < 6; k++) face([[-2.8 + k * 0.55, hy, 2.95], [-2.25 + k * 0.55, hy, 2.95], [-2.25 + k * 0.55, hy + 1.1, 2.6], [-2.8 + k * 0.55, hy + 1.1, 2.6]], k % 2 ? "linen" : "liveryRed", [0, 0, 0], o);
        planter(o, 3.6, 4.2, 0.1, 0.45); planter(o, -4.0, 4.2, 0.1, 0.45);
      }),
      mids: [],
      roof: made((o) => {
        flat(o, hx, hy, g, 0.5);
        box(-2.9, 1.2, -2.5, 1.6, g + 0.06, g + 0.16, "wood", o);
        planter(o, 2.3, -1.8, g + 0.06, 0.5); planter(o, 2.3, 1.6, g + 0.06, 0.5);
        // A parasol on the deck.
        limb([-0.8, -0.4, g + 0.16], [-0.8, -0.4, g + 2.3], 0.03, 0.03, "linen", o, 6, false);
        lathe(-0.8, -0.4, [[1.25, g + 2.0], [0.05, g + 2.4]], "liveryRed", o, 10, false);
      }),
    };
  },
};

const vibeT1: House = {
  // A townhouse: a tall ground floor, a glass-fronted balcony over, a pergola on the roof.
  id: "vibe_coder.t1", ground: 3.4, storey: 3.1, floors: HOUSE_FLOORS["vibe_coder.t1"], tints: RENDER, shadow: shadowOf(3.5, 3.2),
  parts: () => {
    const hx = 3.5, hy = 3.2, g = 3.4, f = 3.1;
    return {
      ground: made((o) => {
        plot(o, 4.9);
        walls(o, hx, hy, 0, g);
        box(-hx - 0.04, hx + 0.04, -hy - 0.04, hy + 0.04, 0.1, 0.5, "trim", o);
        winY(o, hy, -1.4, 2.4, 0.8, 2.7, { frame: "trim" });
        door(o, hy, 1.9, "liveryAlt", 1.05, 2.25, "trim");
        windows(o, hx, hy, 2, 0, 1.3, 0.9, 2.6, { frame: "trim" });
        planter(o, 3.7, 4.3, 0.1, 0.45);
      }),
      mids: [made((o) => {
        walls(o, hx, hy, g, g + f);
        winY(o, hy, -1.4, 2.4, g + 0.2, g + 2.4, { frame: "trim", sill: false }); winY(o, hy, 1.9, 1.2, g + 0.9, g + 2.4, { frame: "trim" });
        balconyY(o, hy, -1.4, 3.0, g + 0.12, "pane");
        windows(o, hx, hy, 2, 0, 1.3, g + 0.9, g + 2.4, { frame: "trim" });
      })],
      roof: made((o) => {
        flat(o, hx, hy, g, 0.5);
        // The pergola: four posts, beams across.
        for (const [x, y] of [[-2.6, -2.2], [0.6, -2.2], [-2.6, 1.2], [0.6, 1.2]]) box(x - 0.07, x + 0.07, y - 0.07, y + 0.07, g, g + 2.3, "wood", o);
        for (let x = -2.8; x <= 0.81; x += 0.6) box(x - 0.05, x + 0.05, -2.5, 1.5, g + 2.3, g + 2.42, "wood", o);
        planter(o, 2.2, -1.9, g + 0.06, 0.55); planter(o, 2.2, 1.7, g + 0.06, 0.55);
      }),
    };
  },
};

const vibeT2: House = {
  // Lofts: a workshop's tall steel windows floor on floor, north lights on the roof.
  id: "vibe_coder.t2", ground: 3.8, storey: 3.5, floors: HOUSE_FLOORS["vibe_coder.t2"], tints: RENDER, shadow: shadowOf(4.1, 3.6),
  parts: () => {
    const hx = 4.1, hy = 3.6, g = 3.8, f = 3.5;
    const bays = (o: Out, z0: number, z1: number, skip = -1) => {
      for (let i = 0; i < 3; i++) if (i !== skip) { const c = -hx + ((i + 0.5) * 2 * hx) / 3; winY(o, hy, c, 2.1, z0, z1, { frame: "trim", sill: false, bar: false }); for (const d of [-0.52, 0, 0.52]) box(c + d - 0.03, c + d + 0.03, hy, hy + 0.11, z0, z1, "trim", o); box(c - 1.05, c + 1.05, hy, hy + 0.11, (z0 + z1) / 2 - 0.03, (z0 + z1) / 2 + 0.03, "trim", o); }
      for (let i = 0; i < 2; i++) { const c = -hy + ((i + 0.5) * 2 * hy) / 2; winX(o, hx, c, 2.4, z0, z1, { frame: "trim", sill: false, bar: false }); for (const d of [-0.6, 0, 0.6]) box(hx, hx + 0.11, c + d - 0.03, c + d + 0.03, z0, z1, "trim", o); box(hx, hx + 0.11, c - 1.2, c + 1.2, (z0 + z1) / 2 - 0.03, (z0 + z1) / 2 + 0.03, "trim", o); }
    };
    return {
      ground: made((o) => {
        plot(o);
        walls(o, hx, hy, 0, g);
        box(-hx - 0.05, hx + 0.05, -hy - 0.05, hy + 0.05, 0.1, 0.6, "trim", o);
        bays(o, 0.9, 3.2, 1);
        // A workshop's door, rolled half up.
        box(-1.25, 1.25, hy, hy + 0.08, 0.1, 3.3, "trim", o); box(-1.1, 1.1, hy, hy + 0.12, 1.5, 3.2, "hub", o); box(-1.1, 1.1, hy, hy + 0.1, 0.1, 1.5, "interior", o);
        course(o, hx, hy, g, "trim", 0.16);
      }),
      mids: [
        made((o) => { walls(o, hx, hy, g, g + f); bays(o, g + 0.6, g + 2.9); course(o, hx, hy, g + f, "trim", 0.16); }),
        made((o) => { walls(o, hx, hy, g, g + f); bays(o, g + 0.6, g + 2.9); balconyY(o, hy, 0, 2.4, g + 0.35); course(o, hx, hy, g + f, "trim", 0.16); }),
      ],
      roof: made((o) => {
        flat(o, hx, hy, g, 0.45);
        // North lights: three saw teeth, glass to one side.
        for (let k = 0; k < 3; k++) {
          const y0 = -2.8 + k * 1.9, y1 = y0 + 1.7, in_: V3 = [0, (y0 + y1) / 2, g + 0.3];
          face([[-3.2, y1, g + 0.06], [3.2, y1, g + 0.06], [3.2, y0, g + 1.3], [-3.2, y0, g + 1.3]], "glass", in_, o);
          face([[-3.2, y0, g + 0.06], [3.2, y0, g + 0.06], [3.2, y0, g + 1.3], [-3.2, y0, g + 1.3]], "roofing", in_, o);
          for (const x of [-3.2, 3.2]) face([[x, y0, g + 0.06], [x, y1, g + 0.06], [x, y0, g + 1.3]], "wall", in_, o);
        }
      }),
    };
  },
};

const vibeLandmark: House = {
  // A painted tower: balconies stepping round it, a garden on the roof.
  id: "vibe_coder.landmark", ground: 4.2, storey: 3.2, floors: HOUSE_FLOORS["vibe_coder.landmark"], tints: RENDER, shadow: shadowOf(3.9, 3.9, 0.34),
  parts: () => {
    const hx = 3.9, hy = 3.9, g = 4.2, f = 3.2;
    const floor = (o: Out, by: number, bx: number) => {
      walls(o, hx, hy, g, g + f);
      box(-hx - 0.1, hx + 0.1, -hy - 0.1, hy + 0.1, g + f - 0.22, g + f, "linen", o);
      for (const c of [-2.0, 2.0]) { winY(o, hy, c, 2.5, g + (c === by ? 0.15 : 0.9), g + 2.5, { frame: "trim", sill: c !== by }); winX(o, hx, c, 2.5, g + (c === bx ? 0.15 : 0.9), g + 2.5, { frame: "trim", sill: c !== bx }); }
      if (by) balconyY(o, hy, by, 3.0, g + 0.1, "pane", 1.1);
      if (bx) balconyX(o, hx, bx, 3.0, g + 0.1, "pane", 1.1);
    };
    return {
      ground: made((o) => {
        plot(o);
        walls(o, hx, hy, 0, g);
        // A glass ground floor between piers.
        box(-hx + 0.5, hx - 0.5, hy, hy + 0.06, 0.2, 3.5, "pane", o); box(hx, hx + 0.06, -hy + 0.5, hy - 0.5, 0.2, 3.5, "pane", o);
        for (let x = -hx + 0.5; x <= hx - 0.49; x += 1.38) box(x - 0.05, x + 0.05, hy, hy + 0.12, 0.2, 3.5, "trim", o);
        for (let y = -hy + 0.5; y <= hy - 0.49; y += 1.38) box(hx, hx + 0.12, y - 0.05, y + 0.05, 0.2, 3.5, "trim", o);
        box(-0.9, 0.9, hy, hy + 1.3, 3.5, 3.62, "sign", o);
        box(-hx - 0.1, hx + 0.1, -hy - 0.1, hy + 0.1, g - 0.25, g, "linen", o);
        planter(o, 4.3, 4.5, 0.1, 0.4); planter(o, -4.3, 4.5, 0.1, 0.4);
      }),
      mids: [
        made((o) => floor(o, -2.0, 2.0)),
        made((o) => floor(o, 2.0, -2.0)),
        made((o) => floor(o, -2.0, 0)),
        made((o) => floor(o, 0, 2.0)),
      ],
      roof: made((o) => {
        flat(o, hx, hy, g, 0.6);
        box(-3.3, 3.3, -3.3, 3.3, g + 0.06, g + 0.14, "hedge", o);
        box(-2.4, 1.0, -2.4, 1.0, g + 0.14, g + 0.2, "wood", o);
        for (const [x, y] of [[2.6, -2.6], [2.6, 0], [2.6, 2.6], [0, 2.6], [-2.6, 2.6]]) planter(o, x, y, g + 0.06, 0.45);
        box(-3.2, -1.2, -3.2, -1.4, g, g + 2.3, "wall", o); box(-3.3, -1.1, -3.3, -1.3, g + 2.3, g + 2.42, "roofing", o);
        tank(o, -0.2, -2.3, g + 0.14, 0.7);
      }),
    };
  },
};

// ─── THE 10X DEVS': glass between stone, plant and masts on the roof ─────────

const tenT0: House = {
  // A glass block of four floors: a lobby, bands of glass, a penthouse set back.
  id: "10x_dev.t0", ground: 4.2, storey: 3.6, floors: HOUSE_FLOORS["10x_dev.t0"], tints: STONE, shadow: shadowOf(3.8, 3.4),
  parts: () => {
    const hx = 3.8, hy = 3.4, g = 4.2, f = 3.6;
    return {
      ground: made((o) => {
        plot(o);
        curtain(o, hx, hy, 0.1, g, 1.3, { sill: 0.1, head: 0.8, corner: 0.5 });
        box(-0.9, 0.9, hy, hy + 0.12, 0.1, 2.6, "chrome", o); box(-0.78, 0.78, hy, hy + 0.15, 0.15, 2.5, "pane", o); box(-0.03, 0.03, hy, hy + 0.17, 0.15, 2.5, "chrome", o);
        box(-1.5, 1.5, hy, hy + 1.3, 2.75, 2.87, "chrome", o);
      }),
      mids: [
        made((o) => curtain(o, hx, hy, g, g + f, 1.3, { corner: 0.5 })),
        made((o) => { curtain(o, hx, hy, g, g + f, 1.3, { corner: 0.5 }); box(-hx - 0.12, hx + 0.12, -hy - 0.12, hy + 0.12, g + f - 0.16, g + f, "stone", o); }),
      ],
      roof: made((o) => {
        flat(o, hx, hy, g, 0.5);
        curtain(o, 2.2, 1.9, g + 0.06, g + 2.9, 1.1, { head: 0.35, corner: 0.2 }); box(-2.5, 2.5, -2.2, 2.2, g + 2.9, g + 3.02, "roofing", o);
        unit(o, -3.0, 2.4, g + 0.06, 0.55, 0.6);
      }),
    };
  },
};

const tenT1: House = {
  // Six floors of glass between stone piers, a glass box and plant on top.
  id: "10x_dev.t1", ground: 4.4, storey: 3.6, floors: HOUSE_FLOORS["10x_dev.t1"], tints: STONE, shadow: shadowOf(3.8, 3.8, 0.34),
  parts: () => {
    const hx = 3.8, hy = 3.8, g = 4.4, f = 3.6;
    const piers = (o: Out, z0: number, z1: number) => {
      for (const c of [-hx + 0.35, 0, hx - 0.35]) box(c - 0.35, c + 0.35, hy, hy + 0.18, z0, z1, "wall", o);
      for (const c of [-hy + 0.35, 0, hy - 0.35]) box(hx, hx + 0.18, c - 0.35, c + 0.35, z0, z1, "wall", o);
    };
    return {
      ground: made((o) => {
        plot(o);
        curtain(o, hx, hy, 0.1, g, 1.2, { sill: 0.1, head: 0.7 }); piers(o, 0.1, g);
        box(1.0, 2.8, hy, hy + 1.2, 3.0, 3.12, "chrome", o);
      }),
      mids: [
        made((o) => { curtain(o, hx, hy, g, g + f, 1.2); piers(o, g, g + f); }),
        made((o) => { curtain(o, hx, hy, g, g + f, 1.2, { head: 1.0 }); piers(o, g, g + f); }),
      ],
      roof: made((o) => {
        flat(o, hx, hy, g, 0.7);
        curtain(o, 2.0, 2.0, g + 0.06, g + 3.0, 1.0, { head: 0.3, corner: 0.15, frame: "trim" }); box(-2.3, 2.3, -2.3, 2.3, g + 3.0, g + 3.14, "roofing", o);
        unit(o, 3.0, -2.6, g + 0.06, 0.5, 0.6); unit(o, -3.0, 2.8, g + 0.06, 0.5, 0.6);
        mast(o, 0, 0, g + 3.14, 3.4);
      }),
    };
  },
};

const tenT2: House = {
  // A dark-framed tower of eight: solar panels and a mast on the roof.
  id: "10x_dev.t2", ground: 4.8, storey: 3.6, floors: HOUSE_FLOORS["10x_dev.t2"], tints: STONE, shadow: shadowOf(3.6, 3.6, 0.36),
  parts: () => {
    const hx = 3.6, hy = 3.6, g = 4.8, f = 3.6;
    const fins = (o: Out, z0: number, z1: number) => {
      for (let x = -hx; x <= hx + 1e-6; x += (2 * hx) / 4) box(x - 0.1, x + 0.1, hy, hy + 0.3, z0, z1, "trim", o);
      for (let y = -hy; y <= hy + 1e-6; y += (2 * hy) / 4) box(hx, hx + 0.3, y - 0.1, y + 0.1, z0, z1, "trim", o);
    };
    return {
      ground: made((o) => {
        plot(o);
        curtain(o, hx, hy, 0.1, g, 0.9, { sill: 0.1, head: 0.6, frame: "trim", corner: 0.1 }); fins(o, 0.1, g);
        box(-1.8, 1.8, hy, hy + 1.2, 3.7, 3.82, "trim", o);
      }),
      mids: [
        made((o) => { curtain(o, hx, hy, g, g + f, 0.9, { frame: "trim", corner: 0.1 }); fins(o, g, g + f); }),
        made((o) => { curtain(o, hx, hy, g, g + f, 0.9, { frame: "trim", corner: 0.1, head: 1.1 }); fins(o, g, g + f); }),
      ],
      roof: made((o) => {
        flat(o, hx, hy, g, 0.9);
        // Solar panels in rows, tilted to the light.
        for (let r = 0; r < 3; r++) { const y0 = -2.6 + r * 1.8; face([[-2.8, y0, g + 0.9], [0.6, y0, g + 0.9], [0.6, y0 + 1.3, g + 0.3], [-2.8, y0 + 1.3, g + 0.3]], "glass", [0, y0, g], o); }
        unit(o, 2.3, -2.0, g + 0.06, 0.7, 0.8); unit(o, 2.3, 0.6, g + 0.06, 0.7, 0.8);
        mast(o, 2.6, 2.6, g + 0.06, 5.5);
      }),
    };
  },
};

const tenLandmark: House = {
  // A tower of ten, stepping in to a crown and a spire.
  id: "10x_dev.landmark", ground: 5.2, storey: 3.6, floors: HOUSE_FLOORS["10x_dev.landmark"], tints: STONE, shadow: shadowOf(4.0, 4.0, 0.38),
  parts: () => {
    const hx = 4.0, hy = 4.0, g = 5.2, f = 3.6;
    const ribs = (o: Out, z0: number, z1: number, r = hx) => {
      for (const c of [-r + 0.25, -r / 3, r / 3, r - 0.25]) { box(c - 0.16, c + 0.16, r, r + 0.24, z0, z1, "wall", o); box(r, r + 0.24, c - 0.16, c + 0.16, z0, z1, "wall", o); }
    };
    return {
      ground: made((o) => {
        plot(o);
        curtain(o, hx, hy, 0.1, g, 1.3, { sill: 0.1, head: 0.9, corner: 0.2 }); ribs(o, 0.1, g);
        box(-1.6, 1.6, hy, hy + 1.4, 3.6, 3.78, "chrome", o);
        course(o, hx, hy, g, "stone", 0.3, 0.26);
      }),
      mids: [
        made((o) => { curtain(o, hx, hy, g, g + f, 1.3, { corner: 0.2 }); ribs(o, g, g + f); }),
        made((o) => { curtain(o, hx, hy, g, g + f, 1.3, { corner: 0.2, head: 1.0 }); ribs(o, g, g + f); }),
        made((o) => { curtain(o, hx, hy, g, g + f, 1.3, { corner: 0.2 }); ribs(o, g, g + f); course(o, hx, hy, g + f, "stone", 0.16, 0.26); }),
      ],
      roof: made((o) => {
        flat(o, hx, hy, g, 0.6);
        // The crown: two floors stepping in, then the spire.
        curtain(o, 3.0, 3.0, g + 0.06, g + 3.4, 1.2, { corner: 0.2, head: 0.5 }); ribs(o, g + 0.06, g + 3.4, 3.0);
        box(-3.15, 3.15, -3.15, 3.15, g + 3.4, g + 3.6, "stone", o);
        curtain(o, 1.9, 1.9, g + 3.6, g + 6.4, 1.2, { corner: 0.15, head: 0.4 });
        box(-2.05, 2.05, -2.05, 2.05, g + 6.4, g + 6.6, "stone", o);
        lathe(0, 0, [[0.9, g + 6.6], [0.5, g + 8.2], [0.12, g + 11.5]], "chrome", o, 10, false);
        box(-0.09, 0.09, -0.09, 0.09, g + 11.5, g + 11.7, "tail", o);
      }),
    };
  },
};

const ALL: readonly House[] = [
  internT0, internT1, internT2, internLandmark,
  vibeT0, vibeT1, vibeT2, vibeLandmark,
  tenT0, tenT1, tenT2, tenLandmark,
];
/** Every kit's house, in the kits' order. */
export const HOUSES: readonly House[] = HOUSE_KITS.map((k) => ALL.find((h) => h.id === k)!);

/** A house by its kit, or undefined. */
export const houseOf = (kit: string) => HOUSES.find((h) => h.id === kit);
