/**
 * World v2 — THE HOUSES, as models: the three districts' homes, each in three
 * tiers and a landmark. In metres, `x` toward the screen's lower right, `y`
 * toward its lower left, `z` up, the middle of the plot at the origin; baked
 * by the vehicles' rasteriser into a sheet, as the props are.
 * @see dev/bake-houses.ts
 *
 * IN PARTS, because a house rises as its people move in: a ground floor, the
 * floors that stack on it (a few of them, so a block's are not all alike) and
 * a roof. A floor is modelled standing on the ground floor and the roof
 * likewise, and the game lifts each a storey at a time.
 *
 * TWO FACES SHOW: the one toward `+y`, in the light, where the door is and a
 * shop's front goes; and the one toward `+x`, in shade. The walls are white,
 * and tinted in the game.
 *
 * TO A STREET'S SCALE: a house fills most of its plot, so a row of them is a
 * street, and only the 10x devs' landmark is a tower. WHAT THE WALLS ARE MADE
 * OF is painted into them, a sample at a time (`Tri.paint`): brick by brick in
 * its bond, render and its grooves, stone in its courses, boards, tiles and
 * slates — the walls' shades all tinted, their joints not. No hedges or paving
 * of its own: the street dresses the plot.
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
  /**
   * Half its walls' length along `x` (its +x face, in shade, stands at `hx`) and along `y` (its lit +y face at
   * `hy`), metres: where what is drawn on its walls — a shop's front, a mural — stands. @see render/shopfronts wallOf
   */
  hx: number;
  hy: number;
  /** As many floors as it grows to, the ground floor one of them. */
  floors: number;
  /** Its parts: the ground floor; each kind of upper floor, standing on it; the roof, standing on it. */
  parts: () => { ground: Tri[]; mids: Tri[][]; roof: Tri[] };
  shadow: HouseShadow;
  /** What its walls are tinted, one to a building. */
  tints: readonly number[];
};

/** The tinted layer: the walls, in all their shades. */
export const houseLayerOf = (m: Mat) => (m === "wall" || m === "wallLo" || m === "wallDk" ? 0 : 1);

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

// ─── WHAT THINGS ARE MADE OF, painted a sample at a time ─────────────────────

/** A number 0..1 from three whole numbers, the same each bake. */
function hash(a: number, b: number, c = 0): number {
  let h = (Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ Math.imul(c | 0, 83492791)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Along a wall: `y` on a face turned to ±x, else `x`. */
const along = (p: V3, n: V3) => (Math.abs(n[0]) > 0.5 ? p[1] : p[0]);
const upright = (n: V3) => Math.abs(n[2]) < 0.5;

type Skin = (p: V3, n: V3) => Mat;
/** BRICK in stretcher bond: courses, each brick a shade of the tint, the joints light mortar. */
const BRICK: Skin = (p, n) => {
  if (!upright(n)) return "wall";
  const C = 0.27, L = 0.6, J = 0.04, a = along(p, n) + 20, z = p[2] + 0.001;
  const r = Math.floor(z / C), a2 = a + ((r & 1) * L) / 2, c = Math.floor(a2 / L);
  if (z - r * C < J || a2 - c * L < J) return "stone";
  const h = hash(r, c, Math.abs(n[0]) > 0.5 ? 1 : 2);
  return h < 0.18 ? "wallDk" : h < 0.5 ? "wallLo" : "wall";
};
/** RENDER: smooth, a faint drift of shade in big patches where it has weathered. */
const RENDER: Skin = (p, n) => {
  if (!upright(n)) return "wall";
  return hash(Math.floor((along(p, n) + 20) / 1.7), Math.floor(p[2] / 1.3), 5) < 0.12 ? "wallLo" : "wall";
};
/** RENDER RUSTICATED, for a ground floor: a groove every half metre up, and joints along between. */
const RUSTIC: Skin = (p, n) => {
  if (!upright(n)) return "wall";
  const z = p[2] + 0.001, r = Math.floor(z / 0.5), a = along(p, n) + 20 + ((r & 1) * 0.9);
  return z - r * 0.5 < 0.05 || a % 1.8 < 0.04 ? "wallDk" : "wall";
};
/** ASHLAR: dressed stone in courses, the blocks staggered, a block here and there a shade off; fine joints. */
const ASHLAR: Skin = (p, n) => {
  if (!upright(n)) return "wall";
  const C = 0.55, L = 1.25, J = 0.03, z = p[2] + 0.001, r = Math.floor(z / C), a = along(p, n) + 20 + ((r & 1) * L) / 2, c = Math.floor(a / L);
  if (z - r * C < J || a - c * L < J) return "wallDk";
  return hash(r, c, 9) < 0.3 ? "wallLo" : "wall";
};
/** PANELS of precast stone a storey's height, `w` along, open-jointed. */
const panels = (w: number, hgt: number): Skin => (p, n) => {
  if (!upright(n)) return "wall";
  const z = p[2] + 0.001, a = along(p, n) + 20;
  return z % hgt < 0.05 || a % w < 0.05 ? "wallDk" : "wall";
};
/** BOARDS, timber standing on end, a dark line between each. Not tinted. */
const BOARDS: Skin = (p, n) => {
  if (!upright(n)) return "timber";
  const a = along(p, n) + 20, k = Math.floor(a / 0.16);
  return a - k * 0.16 < 0.025 ? "timberDark" : hash(k, 3) < 0.3 ? "timberLight" : "timber";
};
/** Tiles or slates down a roof's slope, course on course, a shade off here and there. */
const covering = (lit: Mat, dark: Mat, course = 0.24, w = 0.32): Skin => (p, n) => {
  if (upright(n) || n[2] > 0.97) return lit;
  const z = p[2] + 0.001, r = Math.floor(z / course), a = along(p, [Math.abs(n[0]) > Math.abs(n[1]) ? 1 : 0, 0, 0]) + 20 + ((r & 1) * w) / 2;
  if (z - r * course < course * 0.2) return dark;
  return hash(r, Math.floor(a / w), 4) < 0.16 ? dark : lit;
};
const TILES = covering("rooftile", "tileDk");
const SLATES = covering("slate", "slateDk", 0.2, 0.4);

/** Paint what was made from `k0` on with `skin`. */
function skinned(o: Out, k0: number, skin: Skin) {
  for (let i = k0; i < o.length; i++) { const t = o[i], n = t.n; t.paint = (p) => skin(p, n); }
}
/** Make something and paint it. */
function made(o: Out, skin: Skin, make: () => void) { const k = o.length; make(); skinned(o, k, skin); }

// ─── ON A FACE: what stands on the lit wall (`y`) or the shaded one (`x`) ─────

/** A wall to put things on: the face turned to +y at `y = at` (things along it by `x`), or to +x at `x = at`. */
type Side = { ax: "x" | "y"; at: number };
const lit = (hy: number): Side => ({ ax: "y", at: hy });
const shade = (hx: number): Side => ({ ax: "x", at: hx });
/** A box on a face: `a` along it, `d` out from it, `z` up. */
function fbox(o: Out, s: Side, a0: number, a1: number, d0: number, d1: number, z0: number, z1: number, mat: Mat) {
  if (s.ax === "y") box(a0, a1, s.at + d0, s.at + d1, z0, z1, mat, o);
  else box(s.at + d0, s.at + d1, a0, a1, z0, z1, mat, o);
}

type Win = {
  /** Its frame and glazing bars. */
  frame: Mat;
  /** Panes across and up. */
  bars?: [number, number];
  /** A surround standing round it: stone, or the wall's own. */
  surround?: Mat | Skin;
  /** Its sill; none for none. */
  sill?: Mat | null;
  /** A lintel or a hood over it. */
  lintel?: Mat | Skin;
  /** A balconette's rail across its foot. */
  rail?: Mat;
};
/**
 * A WINDOW on a face, `w` wide about `c`, from `z0` to `z1`: its surround and frame, and glass that reads as set
 * back — the reveal's shadow along its head and its lit side — with bars, and what is behind it, by the window: a
 * blind half down, curtains drawn back, a dark room, or the sky in it.
 */
function win(o: Out, s: Side, c: number, w: number, z0: number, z1: number, k: Win) {
  const a0 = c - w / 2, a1 = c + w / 2;
  if (k.surround) {
    const m = typeof k.surround === "string" ? k.surround : "wall", n = o.length;
    fbox(o, s, a0 - 0.17, a1 + 0.17, 0, 0.05, z0 - 0.17, z1 + 0.17, m);
    if (typeof k.surround === "function") skinned(o, n, k.surround);
  }
  fbox(o, s, a0 - 0.06, a1 + 0.06, 0, 0.07, z0 - 0.06, z1 + 0.06, k.frame);
  const kp = o.length;
  fbox(o, s, a0, a1, 0, 0.08, z0, z1, "pane");
  const [nx, ny] = k.bars ?? [2, 2], h = hash(Math.round(c * 10), Math.round(z0 * 10), Math.round(s.at * 10) + (s.ax === "x" ? 7 : 0));
  for (let i = kp; i < o.length; i++) {
    o[i].paint = (p) => {
      const a = s.ax === "y" ? p[0] : p[1], u = (a - a0) / w, v = (p[2] - z0) / (z1 - z0);
      // The reveal's shadow: along the head, and down the side away from the light.
      if (z1 - p[2] < 0.13 || (s.ax === "y" ? a - a0 < 0.08 : a1 - a < 0.08)) return "trim";
      // Bars.
      for (let q = 1; q < nx; q++) if (Math.abs(u * nx - q) * (w / nx) < 0.03) return k.frame;
      for (let q = 1; q < ny; q++) if (Math.abs(v * ny - q) * ((z1 - z0) / ny) < 0.03) return k.frame;
      if (h < 0.22) return v > 0.62 ? "linen" : "pane";
      // (Curtains and an unlit room only in a window a room's width: a wall of glass dark is a hole.)
      if (w > 2.6) return "pane";
      if (h < 0.34) return u < 0.17 || u > 0.83 ? "seat" : "pane";
      if (h < 0.4) return "interior";
      return "pane";
    };
  }
  if (k.sill !== null) fbox(o, s, a0 - 0.13, a1 + 0.13, 0, 0.17, z0 - 0.15, z0 - 0.05, k.sill ?? "stone");
  if (k.lintel) {
    const m = typeof k.lintel === "string" ? k.lintel : "wall", n = o.length;
    fbox(o, s, a0 - 0.14, a1 + 0.14, 0, 0.08, z1 + 0.06, z1 + 0.3, m);
    if (typeof k.lintel === "function") skinned(o, n, k.lintel);
  }
  if (k.rail) {
    fbox(o, s, a0 - 0.1, a1 + 0.1, 0.18, 0.24, z0 + 0.95, z0 + 1.02, k.rail);
    for (let a = a0 - 0.05; a <= a1 + 0.06; a += 0.15) fbox(o, s, a - 0.018, a + 0.018, 0.19, 0.23, z0 - 0.05, z0 + 0.95, k.rail);
  }
}
/** `n` windows evenly over a face's length `-half..half`, but those in `skip`. */
function wins(o: Out, s: Side, half: number, n: number, w: number, z0: number, z1: number, k: Win, skip: readonly number[] = []) {
  for (let i = 0; i < n; i++) if (!skip.includes(i)) win(o, s, slot(half, n, i), w, z0, z1, k);
}
/** Where the `i`th of `n` bays across `-half..half` is centred. */
const slot = (half: number, n: number, i: number) => -half + ((i + 0.5) * 2 * half) / n;

type Door = { leaf: Mat; frame?: Mat; surround?: Mat; fan?: boolean; canopy?: Mat; steps?: number; glass?: boolean };
/** A DOOR on a face about `c`: a panelled leaf (or a glass one) in its frame, a fanlight, a surround, steps, a canopy on brackets. */
function door(o: Out, s: Side, c: number, w: number, h: number, k: Door) {
  const a0 = c - w / 2, a1 = c + w / 2, top = h + (k.fan ? 0.5 : 0);
  if (k.surround) fbox(o, s, a0 - 0.28, a1 + 0.28, 0, 0.08, 0, top + 0.3, k.surround);
  fbox(o, s, a0 - 0.08, a1 + 0.08, 0, 0.1, 0, top + 0.08, k.frame ?? "linen");
  const kl = o.length;
  fbox(o, s, a0, a1, 0, 0.12, 0.05, h, k.glass ? "pane" : k.leaf);
  for (let i = kl; i < o.length; i++) {
    o[i].paint = (p) => {
      const a = s.ax === "y" ? p[0] : p[1], u = (a - a0) / w, z = p[2];
      if (h - z < 0.1 || (s.ax === "y" ? a - a0 < 0.06 : a1 - a < 0.06)) return "trim";
      if (k.glass) return Math.abs(u - 0.5) < 0.03 ? (k.frame ?? "linen") : "pane";
      // Four panels, picked out by their mouldings' shadow.
      const inPanel = (u > 0.14 && u < 0.46) || (u > 0.54 && u < 0.86);
      if (inPanel && ((z > 0.25 && z < h * 0.45) || (z > h * 0.52 && z < h - 0.25))) {
        const edge = Math.min(Math.abs(u - 0.14), Math.abs(u - 0.46), Math.abs(u - 0.54), Math.abs(u - 0.86)) * w;
        if (edge < 0.025) return "trim";
      }
      return k.leaf;
    };
  }
  if (k.fan) fbox(o, s, a0, a1, 0, 0.11, h + 0.08, top, "pane");
  for (let i = 0; i < (k.steps ?? 1); i++) fbox(o, s, a0 - 0.3 + i * 0.1, a1 + 0.3 - i * 0.1, 0, 0.45 - i * 0.18, i * 0.15, (i + 1) * 0.15, "stone");
  if (k.canopy) {
    fbox(o, s, a0 - 0.4, a1 + 0.4, 0, 0.8, top + 0.3, top + 0.42, k.canopy);
    for (const a of [a0 - 0.3, a1 + 0.3]) fbox(o, s, a - 0.04, a + 0.04, 0, 0.6, top, top + 0.3, k.canopy);
  }
}

/** A balcony off a face about `c`, `w` wide, its floor at `z`: a slab and a rail — iron bars, or glass. */
function balcony(o: Out, s: Side, c: number, w: number, z: number, rail: Mat, d = 1.0, slab: Mat = "stone") {
  const a0 = c - w / 2, a1 = c + w / 2;
  fbox(o, s, a0, a1, 0, d, z - 0.16, z, slab);
  if (rail === "pane") {
    fbox(o, s, a0, a1, d - 0.05, d, z, z + 1.05, "pane");
    fbox(o, s, s.ax === "y" ? a1 - 0.05 : a0, s.ax === "y" ? a1 : a0 + 0.05, 0, d, z, z + 1.05, "pane");
    fbox(o, s, a0, a1, d - 0.06, d + 0.01, z + 1.05, z + 1.1, "chrome");
    return;
  }
  fbox(o, s, a0, a1, d - 0.06, d, z + 0.98, z + 1.05, rail);
  for (let a = a0 + 0.05; a <= a1 - 0.04; a += 0.14) fbox(o, s, a - 0.018, a + 0.018, d - 0.05, d - 0.01, z, z + 0.98, rail);
  const e = s.ax === "y" ? a1 : a0;
  for (let q = 0.05; q < d; q += 0.14) fbox(o, s, e - 0.02, e + 0.02, q - 0.018, q + 0.018, z, z + 0.98, rail);
}

/** A BAY window off the lit face about `x = c`: a box `d` deep, windows round its three sides, a lead roof. */
function bay(o: Out, hy: number, c: number, w: number, d: number, z0: number, z1: number, skin: Skin, k: Win, roof = true) {
  made(o, skin, () => box(c - w / 2, c + w / 2, hy, hy + d, z0, z1, "wall", o));
  box(c - w / 2 - 0.05, c + w / 2 + 0.05, hy - 0.02, hy + d + 0.05, z0, z0 + 0.35, "stone", o);
  win(o, lit(hy + d), c, w - 0.7, z0 + 0.75, z1 - 0.35, { ...k, sill: "stone" });
  win(o, shade(c + w / 2), hy + d / 2, d - 0.35, z0 + 0.75, z1 - 0.35, { ...k, bars: [1, 2], sill: null });
  if (roof) {
    box(c - w / 2 - 0.08, c + w / 2 + 0.08, hy - 0.05, hy + d + 0.12, z1, z1 + 0.14, "stone", o);
    face([[c - w / 2, hy, z1 + 0.14], [c + w / 2, hy, z1 + 0.14], [c + w / 2 - 0.1, hy, z1 + 0.6], [c - w / 2 + 0.1, hy, z1 + 0.6]], "slate", [c, hy - 1, z1], o);
    face([[c - w / 2, hy + d, z1 + 0.14], [c + w / 2, hy + d, z1 + 0.14], [c + w / 2 - 0.1, hy, z1 + 0.6], [c - w / 2 + 0.1, hy, z1 + 0.6]], "slate", [c, hy, z1], o);
  }
}

// ─── WALLS, BANDS AND ROOFS ─────────────────────────────────────────────────

/** A floor's walls, in their stuff. */
const shell = (o: Out, hx: number, hy: number, z0: number, z1: number, skin: Skin) => made(o, skin, () => box(-hx, hx, -hy, hy, z0, z1, "wall", o));
/** A band standing proud all round at `z`, `h` deep, `out` out: a plinth, a string course, a cornice. */
function band(o: Out, hx: number, hy: number, z: number, h: number, out: number, mat: Mat | Skin = "stone") {
  const n = o.length;
  box(-hx - out, hx + out, -hy - out, hy + out, z - h, z, typeof mat === "string" ? mat : "wall", o);
  if (typeof mat === "function") skinned(o, n, mat);
}
/** A cornice: a band out, a deeper one over it, a thin lip on top. */
function cornice(o: Out, hx: number, hy: number, z: number, mat: Mat = "stone") {
  band(o, hx, hy, z + 0.18, 0.18, 0.1, mat); band(o, hx, hy, z + 0.42, 0.24, 0.24, mat); band(o, hx, hy, z + 0.48, 0.06, 0.3, mat);
}
/** A gutter along an eave at `y = Y` from `x0` to `x1`, at `z`. */
const gutter = (o: Out, x0: number, x1: number, Y: number, z: number) => box(x0, x1, Y - 0.02, Y + 0.14, z - 0.16, z, "iron", o);

/**
 * A GABLED ROOF, its ridge along `x`: two slopes coursed in `cover` over eaves that overhang, a gable in the wall's
 * stuff at each end with its bargeboards, a ridge, and gutters.
 */
function gable(o: Out, hx: number, hy: number, z: number, rise: number, cover: Skin, skin: Skin, over = 0.35) {
  const X = hx + over, Y = hy + over, top = z + rise, eave = z - (rise * over) / hy, inside: V3 = [0, 0, z];
  made(o, cover, () => {
    face([[-X, -Y, eave], [X, -Y, eave], [X, 0, top], [-X, 0, top]], "rooftile", inside, o);
    face([[-X, Y, eave], [X, Y, eave], [X, 0, top], [-X, 0, top]], "rooftile", inside, o);
  });
  made(o, skin, () => { for (const x of [-hx, hx]) face([[x, -hy, z], [x, hy, z], [x, 0, top]], "wall", inside, o); });
  for (const x of [-X, X]) for (const y of [-Y, Y]) face([[x, y, eave - 0.16], [x, y, eave], [x, 0, top], [x, 0, top - 0.16]], "linen", inside, o);
  box(-X - 0.02, X + 0.02, -0.1, 0.1, top - 0.06, top + 0.12, "tileDk", o);
  gutter(o, -X, X, Y, eave);
}
/** A HIPPED ROOF: four slopes to a ridge along `x`, coursed, over a soffit and gutters. */
function hip(o: Out, hx: number, hy: number, z: number, rise: number, cover: Skin, over = 0.4) {
  const X = hx + over, Y = hy + over, top = z + rise, inside: V3 = [0, 0, z], r = Math.max(0, X - Y * 0.9);
  const a: V3 = [-r, 0, top], b: V3 = [r, 0, top];
  made(o, cover, () => {
    for (const y of [-Y, Y]) face(r ? [[-X, y, z], [X, y, z], b, a] : [[-X, y, z], [X, y, z], b], "slate", inside, o);
    face([[X, -Y, z], [X, Y, z], b], "slate", inside, o);
    face([[-X, -Y, z], [-X, Y, z], a], "slate", inside, o);
  });
  box(-X, X, -Y, Y, z - 0.16, z, "linen", o);
  if (r) box(-r, r, -0.08, 0.08, top - 0.05, top + 0.1, "slateDk", o);
  gutter(o, -X, X, Y, z); box(X - 0.02, X + 0.14, -Y, Y, z - 0.16, z, "iron", o);
}
/**
 * A MANSARD: steep slopes `rise` up and `inset` in from the walls' tops, a flat top over them, a cornice under
 * it; its dormers set in the slopes by the caller.
 */
function mansard(o: Out, hx: number, hy: number, z: number, rise: number, inset: number, cover: Skin) {
  const ix = hx - inset, iy = hy - inset, top = z + rise, inside: V3 = [0, 0, z];
  made(o, cover, () => {
    face([[-hx, hy, z], [hx, hy, z], [ix, iy, top], [-ix, iy, top]], "slate", inside, o);
    face([[hx, -hy, z], [hx, hy, z], [ix, iy, top], [ix, -iy, top]], "slate", inside, o);
    face([[-hx, -hy, z], [hx, -hy, z], [ix, -iy, top], [-ix, -iy, top]], "slate", inside, o);
    face([[-hx, -hy, z], [-hx, hy, z], [-ix, iy, top], [-ix, -iy, top]], "slate", inside, o);
  });
  box(-ix - 0.05, ix + 0.05, -iy - 0.05, iy + 0.05, top, top + 0.1, "roofing", o);
  box(-ix - 0.1, ix + 0.1, -iy - 0.1, iy + 0.1, top + 0.1, top + 0.2, "iron", o);
}
/** A DORMER standing out of a slope: its cheeks and front in the wall's stuff, a window, a little lead roof. */
function dormer(o: Out, s: Side, c: number, w: number, z: number, h: number, back: number, skin: Skin, k: Win) {
  const n = o.length;
  fbox(o, s, c - w / 2, c + w / 2, -back, 0, z, z + h, "wall");
  skinned(o, n, skin);
  win(o, s, c, w - 0.5, z + 0.2, z + h - 0.25, { ...k, sill: null });
  fbox(o, s, c - w / 2 - 0.12, c + w / 2 + 0.12, -back - 0.1, 0.15, z + h, z + h + 0.16, "slateDk");
}
/** A FLAT ROOF: its covering, and a parapet in the wall's stuff with a coping. */
function flat(o: Out, hx: number, hy: number, z: number, p: number, skin: Skin, cover: Mat = "roofing", coping: Mat = "stone") {
  box(-hx, hx, -hy, hy, z, z + 0.06, cover, o);
  const t = 0.26;
  made(o, skin, () => { for (const [x0, x1, y0, y1] of [[-hx, hx, -hy, -hy + t], [-hx, hx, hy - t, hy], [-hx, -hx + t, -hy, hy], [hx - t, hx, -hy, hy]]) box(x0, x1, y0, y1, z, z + p, "wall", o); });
  for (const [x0, x1, y0, y1] of [[-hx, hx, -hy, -hy + t], [-hx, hx, hy - t, hy], [-hx, -hx + t, -hy, hy], [hx - t, hx, -hy, hy]]) box(x0 - 0.06, x1 + 0.06, y0 - 0.06, y1 + 0.06, z + p, z + p + 0.1, coping, o);
}
/** A rail round a roof's edge, `in` in from it, iron or glass. */
function roofRail(o: Out, hx: number, hy: number, z: number, mat: Mat, inset = 0.3) {
  const X = hx - inset, Y = hy - inset;
  if (mat === "pane") { box(-X, X, Y - 0.04, Y, z, z + 1.0, "pane", o); box(X - 0.04, X, -Y, Y, z, z + 1.0, "pane", o); return; }
  box(-X, X, Y - 0.04, Y, z + 0.95, z + 1.02, mat, o); box(X - 0.04, X, -Y, Y, z + 0.95, z + 1.02, mat, o);
  for (let x = -X; x <= X; x += 0.5) box(x - 0.02, x + 0.02, Y - 0.04, Y, z, z + 0.95, mat, o);
  for (let y = -Y; y <= Y; y += 0.5) box(X - 0.04, X, y - 0.02, y + 0.02, z, z + 0.95, mat, o);
}
/** A chimney: a stack of the wall's stuff, a stone cap and pots. */
function chimney(o: Out, x: number, y: number, z0: number, z1: number, skin: Skin, pots = 2) {
  made(o, skin, () => box(x - 0.42, x + 0.42, y - 0.32, y + 0.32, z0, z1, "wall", o));
  box(x - 0.5, x + 0.5, y - 0.4, y + 0.4, z1, z1 + 0.12, "stone", o);
  for (let k = 0; k < pots; k++) { const d = pots === 1 ? 0 : -0.2 + (0.4 * k) / (pots - 1); limb([x + d, y, z1 + 0.12], [x + d, y, z1 + 0.5], 0.1, 0.085, "rooftile", o, 8, false); }
}
/** Roof plant: a cooling unit, its fan on top. */
function unit(o: Out, x: number, y: number, z: number, w = 0.8, h = 0.8) {
  box(x - w, x + w, y - w * 0.6, y + w * 0.6, z, z + h, "hub", o);
  lathe(x, y, [[w * 0.42, z + h], [w * 0.42, z + h + 0.05]], "trim", o, 12);
}
/** A water tank on legs: staves, a cone over it. */
function tank(o: Out, x: number, y: number, z: number, r = 0.9) {
  for (const [dx, dy] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) box(x + dx * r - 0.05, x + dx * r + 0.05, y + dy * r - 0.05, y + dy * r + 0.05, z, z + 1.0, "iron", o);
  lathe(x, y, [[r, z + 1.0], [r, z + 2.5], [r * 1.08, z + 2.5], [0.05, z + 3.15]], "wood", o, 16);
}
/** A rooflight: a glazed hump on a kerb. */
function rooflight(o: Out, x: number, y: number, z: number, w: number, d: number) {
  box(x - w / 2, x + w / 2, y - d / 2, y + d / 2, z, z + 0.3, "linen", o);
  face([[x - w / 2, y + d / 2, z + 0.3], [x + w / 2, y + d / 2, z + 0.3], [x + w / 2, y, z + 0.6], [x - w / 2, y, z + 0.6]], "pane", [x, y, z], o);
  face([[x - w / 2, y - d / 2, z + 0.3], [x + w / 2, y - d / 2, z + 0.3], [x + w / 2, y, z + 0.6], [x - w / 2, y, z + 0.6]], "pane", [x, y, z], o);
}
/** Solar panels in a row, tilted to the sun. */
function solar(o: Out, x0: number, x1: number, y: number, z: number) {
  for (let x = x0; x < x1 - 0.5; x += 1.15) face([[x, y + 0.5, z + 0.25], [x + 1.05, y + 0.5, z + 0.25], [x + 1.05, y - 0.5, z + 0.75], [x, y - 0.5, z + 0.75]], "glass", [x + 0.5, y, z - 1], o);
}
/** A planter, and a bush clipped round in it. */
function planter(o: Out, x: number, y: number, z: number, w = 0.45) {
  box(x - w, x + w, y - w, y + w, z, z + 0.45, "stone", o);
  lathe(x, y, [[w * 0.95, z + 0.45], [w * 1.05, z + 0.75], [w * 0.75, z + 1.05], [0.05, z + 1.15]], "hedge", o, 10);
}
/** A small tree in a tub, for a roof garden. */
function tub(o: Out, x: number, y: number, z: number) {
  box(x - 0.4, x + 0.4, y - 0.4, y + 0.4, z, z + 0.5, "timberDark", o);
  limb([x, y, z + 0.5], [x, y, z + 1.6], 0.07, 0.05, "bark", o, 6, false);
  lathe(x, y, [[0.05, z + 1.2], [0.8, z + 1.6], [0.85, z + 2.2], [0.5, z + 2.7], [0.05, z + 2.85]], "hedge", o, 12);
}
/** A pergola: posts, beams, battens. */
function pergola(o: Out, x0: number, x1: number, y0: number, y1: number, z: number) {
  for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) box(x - 0.07, x + 0.07, y - 0.07, y + 0.07, z, z + 2.3, "timber", o);
  for (const y of [y0, y1]) box(x0 - 0.2, x1 + 0.2, y - 0.06, y + 0.06, z + 2.3, z + 2.5, "timber", o);
  for (let x = x0; x <= x1 + 1e-6; x += (x1 - x0) / 6) box(x - 0.04, x + 0.04, y0 - 0.3, y1 + 0.3, z + 2.5, z + 2.6, "timberLight", o);
}
/** A mast: a pole, a crosstree, a red lamp. */
function mast(o: Out, x: number, y: number, z: number, h: number) {
  limb([x, y, z], [x, y, z + h], 0.09, 0.04, "hub", o, 6, false);
  box(x - 0.5, x + 0.5, y - 0.03, y + 0.03, z + h * 0.6, z + h * 0.6 + 0.06, "hub", o);
  box(x - 0.09, x + 0.09, y - 0.09, y + 0.09, z + h, z + h + 0.18, "tail", o);
}
/** A plant room on a roof: a box of the wall's stuff with a door and louvres. */
function plantRoom(o: Out, x0: number, x1: number, y0: number, y1: number, z: number, h: number, skin: Skin) {
  made(o, skin, () => box(x0, x1, y0, y1, z, z + h, "wall", o));
  box(x0 - 0.08, x1 + 0.08, y0 - 0.08, y1 + 0.08, z + h, z + h + 0.12, "stone", o);
  const c = (x0 + x1) / 2;
  fbox(o, lit(y1), c - 0.45, c + 0.45, 0, 0.06, z, z + 2.0, "hub");
  for (let k = 0; k < 4; k++) fbox(o, shade(x1), y0 + 0.4, y1 - 0.4, 0, 0.06, z + 0.5 + k * 0.25, z + 0.6 + k * 0.25, "trim");
}
/**
 * A FRAME of piers and spandrels over a floor's two seen faces — the wall's stuff, `n` bays along each — with glass
 * set back between: a stone-and-glass block's, or a curtain wall's fins.
 */
function frame(o: Out, hx: number, hy: number, z0: number, z1: number, nx: number, ny: number, pier: number, spandrel: number, skin: Skin, glass: Win, out = 0.16) {
  // Its body, dark behind the glass, standing on the wall's own plane: where a shop's front goes. @see House.hx
  box(-hx, hx, -hy, hy, z0, z1, "interior", o);
  for (const [s, half, n] of [[lit(hy), hx, ny], [shade(hx), hy, nx]] as const) {
    for (let i = 0; i <= n; i++) {
      const a = -half + (i * 2 * half) / n, k = o.length;
      fbox(o, s, a - pier / 2, a + pier / 2, -0.05, out, z0, z1, "wall");
      skinned(o, k, skin);
    }
    const k = o.length;
    fbox(o, s, -half, half, -0.05, out - 0.04, z1 - spandrel, z1, "wall");
    skinned(o, k, skin);
    for (let i = 0; i < n; i++) {
      const a0 = -half + (i * 2 * half) / n + pier / 2, a1 = -half + ((i + 1) * 2 * half) / n - pier / 2;
      win(o, s, (a0 + a1) / 2, a1 - a0 - 0.08, z0 + 0.05, z1 - spandrel - 0.05, { ...glass, sill: null });
    }
  }
}

const shadowOf = (hx: number, hy: number, strength = 0.3): HouseShadow => ({ hl: hx + 0.15, hw: hy + 0.15, edge: 0.25, soft: 1.0, strength, reach: 1.0 });
const make = (f: (o: Out) => void): Tri[] => { const o: Out = []; f(o); return o; };

/** A KIT: its size and storeys, and how its parts are made from them. */
type Spec = Omit<House, "parts" | "shadow" | "floors"> & { strength?: number; parts: (h: Spec) => ReturnType<House["parts"]> };
const kit = (s: Spec): House => ({ ...s, floors: HOUSE_FLOORS[s.id], shadow: shadowOf(s.hx, s.hy, s.strength), parts: () => s.parts(s) });

/** Bricks, for the interns' streets. */
const BRICKS = [0xb5563d, 0xa64b3a, 0xc46b4b, 0x9a5a45, 0xcdb48c, 0xb9674f] as const;
/** Painted render, for the vibe coders'. */
const RENDERS = [0xf3dcc6, 0xecc9d6, 0xcfe4d5, 0xd4dcf0, 0xf5e4a6, 0xeab9a0, 0xf4f0e8] as const;
/** Stone and concrete, for the 10x devs'. */
const STONES = [0xdcd8cf, 0xc9cdd1, 0xb8c0c7, 0xe3ddcf, 0xcfc6b4] as const;

/** Sash windows in white paint, the interns' everywhere. */
const SASH: Win = { frame: "linen", bars: [2, 2], sill: "stone" };

// ─── THE INTERNS': brick, and roofs of tile and slate ────────────────────────

const internT0 = kit({
  // A cottage of a terrace: brick, a tiled gable, a door under a hood between two windows, two up, chimneys at the ends.
  id: "intern.t0", ground: 2.9, storey: 2.7, hx: 4.4, hy: 3.6, tints: BRICKS,
  parts: ({ hx, hy, ground: g, storey: f }) => ({
    ground: make((o) => {
      shell(o, hx, hy, 0, g, BRICK);
      band(o, hx, hy, 0.35, 0.35, 0.05, "stoneB");
      door(o, lit(hy), -0.4, 1.0, 2.2, { leaf: "liveryGreen", fan: true, canopy: "linen", steps: 1 });
      win(o, lit(hy), -2.75, 1.4, 0.95, 2.35, { ...SASH, lintel: "stone" });
      win(o, lit(hy), 2.2, 1.4, 0.95, 2.35, { ...SASH, lintel: "stone" });
      wins(o, shade(hx), hy, 2, 1.2, 0.95, 2.35, { ...SASH, lintel: "stone" });
    }),
    mids: [make((o) => {
      shell(o, hx, hy, g, g + f, BRICK);
      wins(o, lit(hy), hx, 3, 1.2, g + 0.6, g + 2.0, { ...SASH, lintel: "stone" });
      wins(o, shade(hx), hy, 2, 1.1, g + 0.6, g + 2.0, { ...SASH, lintel: "stone" });
    })],
    roof: make((o) => {
      gable(o, hx, hy, g, 2.5, TILES, BRICK);
      chimney(o, -hx + 0.5, 0, g + 1.6, g + 3.3, BRICK, 3); chimney(o, hx - 0.5, 0, g + 1.6, g + 3.3, BRICK, 3);
    }),
  }),
});

const internT1 = kit({
  // A Victorian pair: brick with stone bands, two doors under porches, bays on the ground floor, a hipped slate roof with dormers.
  id: "intern.t1", ground: 3.1, storey: 2.9, hx: 4.6, hy: 3.8, tints: BRICKS,
  parts: ({ hx, hy, ground: g, storey: f }) => ({
    ground: make((o) => {
      shell(o, hx, hy, 0, g, BRICK);
      band(o, hx, hy, 0.4, 0.4, 0.05, "stoneB");
      for (const sgn of [-1, 1]) {
        door(o, lit(hy), sgn * 0.85, 1.0, 2.3, { leaf: sgn < 0 ? "liveryRed" : "liveryAlt", fan: true, steps: 2, surround: "stone" });
        bay(o, hy, sgn * 3.0, 2.2, 0.7, 0, g, BRICK, { ...SASH, bars: [2, 2] });
      }
      wins(o, shade(hx), hy, 2, 1.2, 1.0, 2.5, { ...SASH, lintel: "stone" });
      band(o, hx, hy, g, 0.22, 0.06, "stone");
    }),
    mids: [
      make((o) => {
        shell(o, hx, hy, g, g + f, BRICK);
        wins(o, lit(hy), hx, 4, 1.05, g + 0.6, g + 2.15, { ...SASH, lintel: "stone" });
        wins(o, shade(hx), hy, 2, 1.1, g + 0.6, g + 2.15, { ...SASH, lintel: "stone" });
        band(o, hx, hy, g + f, 0.18, 0.05, "stone");
      }),
      make((o) => {
        shell(o, hx, hy, g, g + f, BRICK);
        wins(o, lit(hy), hx, 4, 1.05, g + 0.6, g + 2.15, { ...SASH, lintel: BRICK, rail: "iron" });
        wins(o, shade(hx), hy, 2, 1.1, g + 0.6, g + 2.15, { ...SASH, lintel: BRICK });
        band(o, hx, hy, g + f, 0.18, 0.05, "stone");
      }),
    ],
    roof: make((o) => {
      hip(o, hx, hy, g, 2.6, SLATES);
      for (const x of [-2.4, 2.4]) dormer(o, lit(hy - 0.9), x, 1.5, g + 0.5, 1.5, 1.0, BRICK, SASH);
      chimney(o, 0, -0.6, g + 1.5, g + 3.6, BRICK, 4);
    }),
  }),
});

const internT2 = kit({
  // A mansion block: a stone ground floor, brick over it in bays with balconies, a cornice, a flat roof with its tank.
  id: "intern.t2", ground: 3.4, storey: 3.0, hx: 4.8, hy: 4.3, tints: BRICKS,
  parts: ({ hx, hy, ground: g, storey: f }) => {
    const upper = (o: Out, rails: boolean) => {
      shell(o, hx, hy, g, g + f, BRICK);
      wins(o, lit(hy), hx, 4, 1.2, g + 0.6, g + 2.3, { ...SASH, bars: [2, 3], lintel: "stone", ...(rails ? { rail: "iron" as const } : {}) });
      wins(o, shade(hx), hy, 3, 1.2, g + 0.6, g + 2.3, { ...SASH, bars: [2, 3], lintel: "stone" });
    };
    return {
      ground: make((o) => {
        made(o, (p, n) => (ASHLAR(p, n) === "wallDk" ? "mortar" : hash(Math.floor(p[2] / 0.55), Math.floor((along(p, n) + 20) / 1.25)) < 0.3 ? "stoneB" : "ashlar"), () => box(-hx, hx, -hy, hy, 0, g, "ashlar", o));
        door(o, lit(hy), 0, 1.5, 2.6, { leaf: "timberDark", fan: true, steps: 2, surround: "stoneC", canopy: "iron" });
        win(o, lit(hy), -3.1, 1.6, 0.9, 2.7, { frame: "linen", bars: [2, 2], surround: "stoneC" });
        win(o, lit(hy), 3.1, 1.6, 0.9, 2.7, { frame: "linen", bars: [2, 2], surround: "stoneC" });
        wins(o, shade(hx), hy, 3, 1.4, 0.9, 2.7, { frame: "linen", bars: [2, 2], surround: "stoneC" });
        band(o, hx, hy, g, 0.3, 0.1, "stoneC");
      }),
      mids: [
        make((o) => upper(o, false)),
        make((o) => { upper(o, false); for (const c of [slot(hx, 4, 1), slot(hx, 4, 2)]) balcony(o, lit(hy), c, 1.8, g + 0.5, "iron", 0.8); }),
        make((o) => { upper(o, true); band(o, hx, hy, g + f, 0.16, 0.05, "stone"); }),
      ],
      roof: make((o) => {
        cornice(o, hx, hy, g);
        flat(o, hx, hy, g + 0.48, 0.5, BRICK);
        tank(o, -2.4, -2.0, g + 0.54, 0.85);
        plantRoom(o, 0.6, 3.2, -3.2, -1.0, g + 0.54, 2.2, BRICK);
        chimney(o, 3.6, 2.6, g + 0.54, g + 2.0, BRICK, 3);
      }),
    };
  },
});

const internLandmark = kit({
  // A warehouse made flats: brick, arched loading bays down the shaded side with a hoist over them, iron windows of many panes, a water tower on top.
  id: "intern.landmark", ground: 4.0, storey: 3.2, hx: 5.0, hy: 4.6, tints: BRICKS, strength: 0.34,
  parts: ({ hx, hy, ground: g, storey: f }) => {
    const IRON: Win = { frame: "trim", bars: [3, 3], sill: "stone", lintel: BRICK };
    const upper = (o: Out, doors: boolean) => {
      shell(o, hx, hy, g, g + f, BRICK);
      wins(o, lit(hy), hx, 4, 1.5, g + 0.5, g + 2.5, IRON);
      wins(o, shade(hx), hy, 4, 1.5, g + 0.5, g + 2.5, IRON, doors ? [1] : []);
      if (doors) {
        // A loading door, its leaves open, a rail across it.
        const c = slot(hy, 4, 1);
        win(o, shade(hx), c, 1.6, g + 0.05, g + 2.6, { frame: "timberDark", bars: [1, 1], sill: null, lintel: BRICK, rail: "iron" });
      }
      for (const [s, half] of [[lit(hy), hx], [shade(hx), hy]] as const) for (const a of [-half, half]) fbox(o, s, a - (a < 0 ? 0 : 0.5), a + (a < 0 ? 0.5 : 0), 0, 0.12, g, g + f, "wallDk");
    };
    return {
      ground: make((o) => {
        shell(o, hx, hy, 0, g, BRICK);
        band(o, hx, hy, 0.5, 0.5, 0.06, "concrete");
        // Arched bays, glazed, on both faces; a pair of doors in one.
        for (const [s, half] of [[lit(hy), hx], [shade(hx), hy]] as const) for (let i = 0; i < 3; i++) {
          const c = slot(half, 3, i);
          win(o, s, c, 2.0, 0.6, 3.1, { frame: "trim", bars: [4, 3], sill: null, surround: BRICK });
          for (let k = 0; k < 7; k++) { const t = (k / 6) * Math.PI, a = c + Math.cos(t) * 1.15, z = 3.25 + Math.sin(t) * 0.45; fbox(o, s, a - 0.14, a + 0.14, 0, 0.1, z - 0.12, z + 0.12, "wallDk"); }
        }
        door(o, lit(hy), slot(hx, 3, 1), 1.7, 2.4, { leaf: "pane", glass: true, frame: "trim", steps: 1 });
        band(o, hx, hy, g, 0.25, 0.06, "concrete");
      }),
      mids: [
        make((o) => upper(o, true)),
        make((o) => upper(o, false)),
        make((o) => { upper(o, true); band(o, hx, hy, g + f, 0.14, 0.05, BRICK); }),
      ],
      roof: make((o) => {
        band(o, hx, hy, g + 0.35, 0.35, 0.12, BRICK); band(o, hx, hy, g + 0.45, 0.1, 0.18, "concrete");
        flat(o, hx, hy, g + 0.45, 0.6, BRICK);
        tank(o, -2.6, -2.2, g + 0.5, 1.1);
        // The hoist's beam out over the loading doors.
        box(hx - 0.4, hx + 0.5, slot(hy, 4, 1) - 0.1, slot(hy, 4, 1) + 0.1, g - 0.3, g - 0.05, "iron", o);
        // A glasshouse on the roof.
        box(0.2, 3.6, 0.2, 3.0, g + 0.5, g + 0.6, "trim", o);
        box(0.3, 3.5, 0.3, 2.9, g + 0.6, g + 2.4, "pane", o);
        face([[0.3, 2.9, g + 2.4], [3.5, 2.9, g + 2.4], [3.5, 1.6, g + 3.2], [0.3, 1.6, g + 3.2]], "pane", [1.9, 1.6, g], o);
        face([[0.3, 0.3, g + 2.4], [3.5, 0.3, g + 2.4], [3.5, 1.6, g + 3.2], [0.3, 1.6, g + 3.2]], "pane", [1.9, 1.6, g], o);
        for (let x = 0.3; x <= 3.51; x += 0.8) box(x - 0.03, x + 0.03, 2.86, 2.92, g + 0.6, g + 2.4, "trim", o);
      }),
    };
  },
});

// ─── THE VIBE CODERS': painted render, timber, terraces and gardens ──────────

/** Modern windows in dark frames, the vibe coders' everywhere. */
const DARK: Win = { frame: "trim", bars: [2, 1], sill: "linen" };

const vibeT0 = kit({
  // A pastel townhouse: render, a rusticated ground floor, a timber-clad door bay, big windows; a roof terrace under a pergola.
  id: "vibe_coder.t0", ground: 3.3, storey: 3.0, hx: 4.2, hy: 3.8, tints: RENDERS,
  parts: ({ hx, hy, ground: g, storey: f }) => ({
    ground: make((o) => {
      shell(o, hx, hy, 0, g, RUSTIC);
      made(o, BOARDS, () => fbox(o, lit(hy), -3.8, -1.6, 0, 0.1, 0, g, "timber"));
      door(o, lit(hy), -2.7, 1.1, 2.4, { leaf: "liveryBlack", frame: "trim", steps: 1, canopy: "trim" });
      win(o, lit(hy), 1.2, 3.2, 0.7, 2.6, { ...DARK, bars: [3, 1] });
      wins(o, shade(hx), hy, 2, 1.5, 0.8, 2.6, DARK);
    }),
    mids: [make((o) => {
      shell(o, hx, hy, g, g + f, RENDER);
      win(o, lit(hy), -2.2, 1.6, g + 0.3, g + 2.5, { ...DARK, rail: "trim" });
      win(o, lit(hy), 1.6, 2.6, g + 0.7, g + 2.3, DARK);
      wins(o, shade(hx), hy, 2, 1.5, g + 0.7, g + 2.3, DARK);
      band(o, hx, hy, g + 0.1, 0.1, 0.03, "linen");
    })],
    roof: make((o) => {
      flat(o, hx, hy, g, 0.3, RENDER, "pave", "linen");
      roofRail(o, hx, hy, g + 0.4, "pane", 0.15);
      pergola(o, -3.2, 0.2, -2.6, 1.2, g + 0.06);
      planter(o, 2.6, 2.4, g + 0.06); planter(o, 3.4, -2.6, g + 0.06, 0.4);
      made(o, RENDER, () => box(1.2, 3.8, -3.6, -1.2, g, g + 2.4, "wall", o));
      box(1.1, 3.9, -3.7, -1.1, g + 2.4, g + 2.5, "linen", o);
      fbox(o, lit(-1.2), 2.0, 3.0, 0, 0.06, g + 0.06, g + 2.2, "trim");
    }),
  }),
});

const vibeT1 = kit({
  // A deco mansard: render banded at every floor, black steel windows, a slate mansard with dormers.
  id: "vibe_coder.t1", ground: 3.4, storey: 3.0, hx: 4.5, hy: 4.1, tints: RENDERS,
  parts: ({ hx, hy, ground: g, storey: f }) => {
    const STEEL: Win = { frame: "trim", bars: [3, 3], sill: "linen" };
    return {
      ground: make((o) => {
        shell(o, hx, hy, 0, g, RUSTIC);
        door(o, lit(hy), 0, 1.6, 2.5, { leaf: "pane", glass: true, frame: "trim", steps: 1, canopy: "linen" });
        win(o, lit(hy), -2.9, 2.0, 0.7, 2.6, STEEL); win(o, lit(hy), 2.9, 2.0, 0.7, 2.6, STEEL);
        wins(o, shade(hx), hy, 3, 1.5, 0.7, 2.6, STEEL);
        band(o, hx, hy, g + 0.1, 0.3, 0.08, "linen");
      }),
      mids: [
        make((o) => {
          shell(o, hx, hy, g, g + f, RENDER);
          wins(o, lit(hy), hx, 3, 1.9, g + 0.6, g + 2.4, STEEL);
          wins(o, shade(hx), hy, 3, 1.5, g + 0.6, g + 2.4, STEEL);
          band(o, hx, hy, g + f, 0.12, 0.05, "linen");
        }),
        make((o) => {
          shell(o, hx, hy, g, g + f, RENDER);
          wins(o, lit(hy), hx, 3, 1.9, g + 0.6, g + 2.4, STEEL, [1]);
          // A curved-fronted balcony in the middle: a slab and rail of white.
          win(o, lit(hy), 0, 1.5, g + 0.1, g + 2.4, { frame: "trim", bars: [2, 1], sill: null });
          balcony(o, lit(hy), 0, 2.6, g + 0.1, "linen", 0.75, "linen");
          wins(o, shade(hx), hy, 3, 1.5, g + 0.6, g + 2.4, STEEL);
          band(o, hx, hy, g + f, 0.12, 0.05, "linen");
        }),
      ],
      roof: make((o) => {
        band(o, hx, hy, g + 0.25, 0.25, 0.14, "linen");
        mansard(o, hx + 0.05, hy + 0.05, g + 0.25, 2.7, 0.9, SLATES);
        for (const x of [-2.4, 0, 2.4]) dormer(o, lit(hy - 0.35), x, 1.3, g + 0.6, 1.6, 0.6, RENDER, { frame: "trim", bars: [2, 1] });
        for (const y of [-1.4, 1.4]) dormer(o, shade(hx - 0.35), y, 1.3, g + 0.6, 1.6, 0.6, RENDER, { frame: "trim", bars: [2, 1] });
        chimney(o, -1.6, -1.6, g + 2.9, g + 4.1, RENDER, 2);
      }),
    };
  },
});

const vibeT2 = kit({
  // A modern block: render and vertical timber, deep balconies with glass rails, a green roof with solar panels.
  id: "vibe_coder.t2", ground: 3.6, storey: 3.1, hx: 4.7, hy: 4.2, tints: RENDERS,
  parts: ({ hx, hy, ground: g, storey: f }) => {
    const upper = (o: Out, by: number) => {
      shell(o, hx, hy, g, g + f, RENDER);
      made(o, BOARDS, () => { fbox(o, lit(hy), by - 1.6, by + 1.6, 0, 0.08, g, g + f, "timber"); fbox(o, shade(hx), -hy, -hy + 2.6, 0, 0.08, g, g + f, "timber"); });
      win(o, lit(hy + 0.08), by, 2.4, g + 0.1, g + 2.5, { frame: "trim", bars: [3, 1], sill: null });
      balcony(o, lit(hy + 0.08), by, 3.2, g + 0.1, "pane", 1.0, "linen");
      win(o, lit(hy), -by, 2.2, g + 0.6, g + 2.4, DARK);
      win(o, shade(hx + 0.08), -hy + 1.3, 1.6, g + 0.6, g + 2.4, DARK);
      wins(o, shade(hx), 1.6, 2, 1.3, g + 0.6, g + 2.4, DARK);
    };
    return {
      ground: make((o) => {
        shell(o, hx, hy, 0, g, RENDER);
        made(o, BOARDS, () => fbox(o, lit(hy), 0.2, 4.7, 0, 0.08, 0, g, "timber"));
        door(o, lit(hy + 0.08), 2.4, 1.6, 2.5, { leaf: "pane", glass: true, frame: "trim", steps: 1 });
        win(o, lit(hy), -2.4, 3.6, 0.6, 2.8, { ...DARK, bars: [3, 1] });
        wins(o, shade(hx), hy, 3, 1.6, 0.7, 2.8, DARK);
        band(o, hx, hy, g + 0.08, 0.16, 0.12, "linen");
      }),
      mids: [make((o) => upper(o, 2.3)), make((o) => upper(o, -2.3))],
      roof: make((o) => {
        flat(o, hx, hy, g, 0.45, RENDER, "hedge", "linen");
        solar(o, -3.8, 1.2, -2.2, g + 0.06);
        made(o, BOARDS, () => box(1.6, 4.0, -3.6, -1.0, g, g + 2.5, "timber", o));
        box(1.5, 4.1, -3.7, -0.9, g + 2.5, g + 2.62, "trim", o);
        planter(o, -2.8, 2.6, g + 0.06, 0.5); planter(o, 0.6, 2.8, g + 0.06, 0.4); planter(o, 3.4, 2.5, g + 0.06, 0.45);
      }),
    };
  },
});

const vibeLandmark = kit({
  // A garden block: render in horizontal bands of window, every floor's balconies planted along their fronts, a roof garden of trees.
  id: "vibe_coder.landmark", ground: 4.0, storey: 3.1, hx: 4.9, hy: 4.4, tints: RENDERS, strength: 0.34,
  parts: ({ hx, hy, ground: g, storey: f }) => {
    const upper = (o: Out, k: number) => {
      shell(o, hx, hy, g, g + f, RENDER);
      for (const [s, half] of [[lit(hy), hx], [shade(hx), hy]] as const) win(o, s, 0, 2 * half - 1.2, g + 0.5, g + 2.5, { frame: "trim", bars: [5, 1], sill: null });
      // Planted balconies, turn and turn about along the faces.
      for (const [s, half] of [[lit(hy), hx], [shade(hx), hy]] as const) {
        const c = (k % 2 ? 1 : -1) * half * 0.45;
        balcony(o, s, c, half, g + 0.1, "pane", 0.62, "linen");
        fbox(o, s, c - half / 2, c + half / 2, 0.32, 0.62, g + 0.1, g + 0.5, "linen");
        fbox(o, s, c - half / 2 + 0.05, c + half / 2 - 0.05, 0.35, 0.6, g + 0.5, g + 0.9, "hedge");
      }
      band(o, hx, hy, g + f, 0.35, 0.08, "linen");
    };
    return {
      ground: make((o) => {
        shell(o, hx, hy, 0, g, RUSTIC);
        win(o, lit(hy), -1.0, 6.4, 0.4, 3.2, { frame: "trim", bars: [5, 1], sill: null });
        door(o, lit(hy), 3.5, 1.6, 2.6, { leaf: "pane", glass: true, frame: "trim", steps: 1, canopy: "trim" });
        win(o, shade(hx), 0, 7.2, 0.4, 3.2, { frame: "trim", bars: [5, 1], sill: null });
        band(o, hx, hy, g, 0.35, 0.12, "linen");
      }),
      mids: [make((o) => upper(o, 0)), make((o) => upper(o, 1))],
      roof: make((o) => {
        flat(o, hx, hy, g, 0.4, RENDER, "hedge", "linen");
        roofRail(o, hx, hy, g + 0.5, "pane", 0.1);
        tub(o, -3.0, 2.6, g + 0.06); tub(o, 2.8, 2.9, g + 0.06); tub(o, 3.2, -1.8, g + 0.06);
        pergola(o, -3.6, -0.4, -3.4, -0.6, g + 0.06);
        plantRoom(o, 0.4, 2.8, -3.8, -1.6, g + 0.06, 2.4, RENDER);
      }),
    };
  },
});

// ─── THE 10x DEVS': stone, and glass ────────────────────────────────────────

/** Tall windows in stone surrounds, the stone houses'. */
const STONE_WIN: Win = { frame: "linen", bars: [2, 3], sill: "stoneC", surround: ASHLAR };

const tenT0 = kit({
  // A stone townhouse: ashlar, a pillared porch to a black door, tall windows in surrounds, a cornice and a balustrade.
  id: "10x_dev.t0", ground: 3.8, storey: 3.3, hx: 4.3, hy: 4.0, tints: STONES,
  parts: ({ hx, hy, ground: g, storey: f }) => ({
    ground: make((o) => {
      shell(o, hx, hy, 0, g, RUSTIC);
      band(o, hx, hy, 0.55, 0.55, 0.06, "stoneC");
      door(o, lit(hy), -1.6, 1.3, 2.7, { leaf: "liveryBlack", fan: true, steps: 3 });
      // The porch: two columns and an entablature.
      for (const x of [-2.6, -0.6]) lathe(x, hy + 0.9, [[0.2, 0.45], [0.2, 3.0], [0.26, 3.1]], "linen", o, 12);
      box(-3.0, -0.2, hy, hy + 1.2, 3.1, 3.5, "linen", o);
      box(-3.05, -0.15, hy - 0.02, hy + 1.25, 0.3, 0.45, "stoneC", o);
      win(o, lit(hy), 1.8, 1.6, 0.9, 3.0, { frame: "linen", bars: [2, 3], sill: "stoneC" });
      wins(o, shade(hx), hy, 2, 1.4, 0.9, 3.0, { frame: "linen", bars: [2, 3], sill: "stoneC" });
      band(o, hx, hy, g, 0.25, 0.08, "stoneC");
    }),
    mids: [
      make((o) => {
        shell(o, hx, hy, g, g + f, ASHLAR);
        wins(o, lit(hy), hx, 3, 1.2, g + 0.5, g + 2.7, { ...STONE_WIN, rail: "iron" });
        wins(o, shade(hx), hy, 2, 1.2, g + 0.5, g + 2.7, STONE_WIN);
      }),
      make((o) => {
        shell(o, hx, hy, g, g + f, ASHLAR);
        wins(o, lit(hy), hx, 3, 1.2, g + 0.7, g + 2.5, { ...STONE_WIN, lintel: "stoneC" });
        wins(o, shade(hx), hy, 2, 1.2, g + 0.7, g + 2.5, { ...STONE_WIN, lintel: "stoneC" });
      }),
    ],
    roof: make((o) => {
      cornice(o, hx, hy, g, "stoneC");
      box(-hx, hx, -hy, hy, g + 0.48, g + 0.54, "roofing", o);
      // A balustrade: a plinth, balusters, a rail.
      for (const s of [lit(hy - 0.15), shade(hx - 0.15)]) {
        const half = s.ax === "y" ? hx : hy;
        fbox(o, s, -half, half, -0.25, 0.05, g + 0.48, g + 0.66, "stoneC");
        for (let a = -half + 0.2; a < half - 0.1; a += 0.3) lathe(s.ax === "y" ? a : s.at - 0.1, s.ax === "y" ? s.at - 0.1 : a, [[0.07, g + 0.66], [0.12, g + 0.85], [0.06, g + 1.1], [0.08, g + 1.18]], "stoneC", o, 6);
        fbox(o, s, -half, half, -0.27, 0.07, g + 1.18, g + 1.32, "stoneC");
      }
      chimney(o, -2.6, -2.2, g + 0.54, g + 2.4, ASHLAR, 3);
      rooflight(o, 0.8, -1.2, g + 0.54, 2.0, 1.6);
    }),
  }),
});

const tenT1 = kit({
  // A stone-and-glass block: a frame of stone piers and spandrels, glass set back in it, a glazed lobby under a canopy, a penthouse set back.
  id: "10x_dev.t1", ground: 4.4, storey: 3.4, hx: 4.7, hy: 4.4, tints: STONES, strength: 0.34,
  parts: ({ hx, hy, ground: g, storey: f }) => {
    const GLASS: Win = { frame: "trim", bars: [1, 1] };
    return {
      ground: make((o) => {
        frame(o, hx, hy, 0, g, 3, 3, 0.55, 0.6, ASHLAR, { frame: "trim", bars: [2, 1] }, 0.12);
        door(o, lit(hy + 0.12), slot(hx, 3, 1), 2.0, 2.8, { leaf: "pane", glass: true, frame: "chrome", steps: 1 });
        fbox(o, lit(hy), -hx + 0.3, hx - 0.3, 0, 1.0, 3.3, 3.45, "trim");
        band(o, hx, hy, 0.3, 0.3, 0.15, "stoneC");
      }),
      mids: [
        make((o) => frame(o, hx, hy, g, g + f, 4, 4, 0.4, 0.7, ASHLAR, GLASS)),
        make((o) => { frame(o, hx, hy, g, g + f, 4, 4, 0.4, 0.7, ASHLAR, GLASS); balcony(o, lit(hy + 0.16), slot(hx, 4, 3), 2.0, g + 0.1, "pane", 0.9, "stoneC"); }),
      ],
      roof: make((o) => {
        band(o, hx, hy, g + 0.3, 0.3, 0.2, "stoneC");
        box(-hx, hx, -hy, hy, g + 0.3, g + 0.36, "roofing", o);
        roofRail(o, hx, hy, g + 0.36, "pane", 0.1);
        // The penthouse, glass, set back under a thin roof.
        box(-3.4, 2.4, -3.6, 1.6, g + 0.36, g + 3.0, "interior", o);
        win(o, lit(1.6), -0.5, 5.6, g + 0.4, g + 2.9, { frame: "trim", bars: [4, 1], sill: null });
        win(o, shade(2.4), -1.0, 5.0, g + 0.4, g + 2.9, { frame: "trim", bars: [3, 1], sill: null });
        box(-3.7, 2.9, -3.9, 2.2, g + 3.0, g + 3.2, "roofing", o); box(-3.75, 2.95, 2.15, 2.25, g + 2.98, g + 3.22, "trim", o);
        unit(o, -2.6, 3.2, g + 0.36, 0.6, 0.7);
      }),
    };
  },
});

const tenT2 = kit({
  // A curtain wall: glass the height of each floor behind deep fins of stone, a stone podium, a crown of louvres over the plant.
  id: "10x_dev.t2", ground: 4.6, storey: 3.5, hx: 4.8, hy: 4.5, tints: STONES, strength: 0.36,
  parts: ({ hx, hy, ground: g, storey: f }) => {
    const fins = (o: Out, z0: number, z1: number) => frame(o, hx, hy, z0, z1, 6, 6, 0.18, 0.35, panels(9, 50), { frame: "chrome", bars: [1, 1] }, 0.45);
    return {
      ground: make((o) => {
        shell(o, hx, hy, 0, g, ASHLAR);
        win(o, lit(hy), -1.4, 5.2, 0.4, 3.6, { frame: "chrome", bars: [4, 1], sill: null });
        door(o, lit(hy), 3.0, 1.8, 3.0, { leaf: "pane", glass: true, frame: "chrome", steps: 1, canopy: "chrome" });
        win(o, shade(hx), 0, 6.6, 0.4, 3.6, { frame: "chrome", bars: [4, 1], sill: null });
        band(o, hx, hy, g, 0.4, 0.15, "stoneC");
      }),
      mids: [make((o) => fins(o, g, g + f))],
      roof: make((o) => {
        band(o, hx, hy, g + 0.2, 0.2, 0.45, "stoneC");
        box(-hx, hx, -hy, hy, g + 0.2, g + 0.26, "roofing", o);
        // The louvred crown over the plant.
        box(-3.6, 3.6, -3.4, 3.4, g + 0.26, g + 2.6, "interior", o);
        for (const s of [lit(3.4), shade(3.6)]) for (let z = g + 0.4; z < g + 2.5; z += 0.22) fbox(o, s, s.ax === "y" ? -3.6 : -3.4, s.ax === "y" ? 3.6 : 3.4, 0, 0.08, z, z + 0.1, "chrome");
        box(-3.7, 3.7, -3.5, 3.5, g + 2.6, g + 2.8, "stoneC", o);
        mast(o, -2.0, -2.0, g + 2.8, 3.0);
      }),
    };
  },
});

const tenLandmark = kit({
  // The tower: a stone podium, glass in a stone grid, every other floor a wrap of glass balconies; a stepped crown and a spire.
  id: "10x_dev.landmark", ground: 5.2, storey: 3.5, hx: 4.6, hy: 4.6, tints: STONES, strength: 0.38,
  parts: ({ hx, hy, ground: g, storey: f }) => {
    const GRID: Win = { frame: "chrome", bars: [1, 1] };
    return {
      ground: make((o) => {
        shell(o, hx, hy, 0, g, ASHLAR);
        win(o, lit(hy), -0.6, 6.2, 0.4, 4.2, { frame: "chrome", bars: [5, 2], sill: null });
        door(o, lit(hy), -0.6, 2.2, 3.2, { leaf: "pane", glass: true, frame: "chrome", steps: 1 });
        fbox(o, lit(hy), -3.8, 2.6, 0, 0.9, 4.3, 4.5, "chrome");
        win(o, shade(hx), 0, 6.8, 0.4, 4.2, { frame: "chrome", bars: [5, 2], sill: null });
        band(o, hx, hy, g, 0.5, 0.2, "stoneC");
      }),
      mids: [
        make((o) => frame(o, hx, hy, g, g + f, 4, 4, 0.5, 0.8, ASHLAR, GRID, 0.2)),
        make((o) => {
          frame(o, hx, hy, g, g + f, 4, 4, 0.5, 0.8, ASHLAR, GRID, 0.2);
          for (const [s, half] of [[lit(hy + 0.2), hx], [shade(hx + 0.2), hy]] as const) balcony(o, s, 0, 2 * half, g + 0.1, "pane", 0.7, "stoneC");
        }),
      ],
      roof: make((o) => {
        band(o, hx, hy, g + 0.3, 0.3, 0.3, "stoneC");
        box(-hx, hx, -hy, hy, g + 0.3, g + 0.36, "roofing", o);
        // The crown: two floors stepping in, then the spire.
        frame(o, 3.4, 3.4, g + 0.36, g + 3.6, 3, 3, 0.4, 0.6, ASHLAR, GRID, 0.15);
        box(-3.6, 3.6, -3.6, 3.6, g + 3.6, g + 3.85, "stoneC", o);
        frame(o, 2.2, 2.2, g + 3.85, g + 6.6, 2, 2, 0.35, 0.5, ASHLAR, GRID, 0.12);
        box(-2.4, 2.4, -2.4, 2.4, g + 6.6, g + 6.85, "stoneC", o);
        lathe(0, 0, [[1.0, g + 6.85], [0.5, g + 8.4], [0.1, g + 12.0]], "chrome", o, 12, false);
        box(-0.09, 0.09, -0.09, 0.09, g + 12.0, g + 12.2, "tail", o);
      }),
    };
  },
});

const ALL: readonly House[] = [
  internT0, internT1, internT2, internLandmark,
  vibeT0, vibeT1, vibeT2, vibeLandmark,
  tenT0, tenT1, tenT2, tenLandmark,
];
/** Every kit's house, in the kits' order. */
export const HOUSES: readonly House[] = HOUSE_KITS.map((k) => ALL.find((h) => h.id === k)!);

/** A house by its kit, or undefined. */
export const houseOf = (kit: string) => HOUSES.find((h) => h.id === kit);
