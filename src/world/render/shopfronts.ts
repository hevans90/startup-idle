/**
 * World v2 — THE TOWN'S SHOPS, SEEN: a shop in a house's ground floor gets
 * its front — a window, a door, an awning in its own colour, a sign over it
 * and something on the pavement — on the face of the house toward its
 * street, or the lit face where its street is behind it. And what moves:
 * steam off a café's cup, a club's lights, a cinema's marquee chasing.
 * @see SHOP_LOOK, plans/services-overhaul.md §3
 *
 * DRAWN AS THE CULTURE PROPS ARE: a Graphics a band among the movers of the
 * band, over the house's own sprites, redrawn only when the map changes. The
 * moving parts a Graphics a band of their own, redrawn a few times a second
 * and only on screen: a Graphics redrawn in the band's own group rebuilds the
 * chunk's draw list. @see createCultureProps, render-group rebuilds
 */
import { Graphics } from "pixi.js";

import { idx, inBounds, type Grid } from "../grid";
import { isPaved } from "../roads/mask";
import { bandOf } from "../iso";
import type { BandLayer } from "./bands";
import { RIGHT, makePen, mix, tone, type Pen } from "../structures/projects/pen";
import { CLUB_TOP, MARQUEE } from "../structures/projects/looks";
import { serviceDef, serviceOf, type ServiceId } from "../agents/needs";

/** A service's colours: its awning (and its sign's board), the stripe, and its light at night. */
export type ShopLook = {
  awning: number;
  stripe: number;
  /** The sign's lettering, or its neon. */
  letters: number;
  /** A neon sign: lit, and lit brighter at night. */
  neon?: boolean;
  /** A green cross hung by the door. */
  cross?: boolean;
  /** The glow it throws at night. @see lightsOf */
  glow: number;
  /** The front's own paint: its joinery, pilasters and door. Else the awning's, deepened. */
  paint?: number;
};

export const SHOP_LOOK: Record<ServiceId, ShopLook> = {
  takeaway: { paint: 0x7a1d18, awning: 0xd8432f, stripe: 0xf6e7c8, letters: 0xfff2d6, glow: 0xffb36b },
  bakery: { paint: 0x5a3a24, awning: 0xb9783e, stripe: 0xf7ecd6, letters: 0xfff4e0, glow: 0xffc98a },
  bar: { paint: 0x1f3d2e, awning: 0x23573f, stripe: 0x23573f, letters: 0xff5fa8, neon: true, glow: 0xff5fa8 },
  club: { awning: 0x1d1a2b, stripe: 0x1d1a2b, letters: 0xd25bff, neon: true, glow: 0xd25bff },
  arcade: { paint: 0x1d1430, awning: 0x4a2a8f, stripe: 0x4a2a8f, letters: 0x3ff0ff, neon: true, glow: 0x3ff0ff },
  cafe: { paint: 0x234d3f, awning: 0x2f8f6b, stripe: 0xf2efe6, letters: 0xf2efe6, glow: 0xffc46b },
  kombucha: { paint: 0x2f4a5a, awning: 0xe58a2b, stripe: 0xfff3dc, letters: 0x2b2f33, glow: 0xffb04a },
  coworking: { awning: 0xf2c230, stripe: 0xf2c230, letters: 0x22262b, glow: 0xfff0b0 },
  vape: { paint: 0x231a38, awning: 0x7a4fd0, stripe: 0x7a4fd0, letters: 0xb9f3ff, neon: true, glow: 0xa98bff },
  cinema: { awning: 0xa8242e, stripe: 0xa8242e, letters: 0xffe07a, glow: 0xffd36b },
  pharmacy: { paint: 0xe9ece6, awning: 0x2fa35a, stripe: 0xf4f6f2, letters: 0xffffff, cross: true, glow: 0x6dff9a },
  doctor: { awning: 0x2fa35a, stripe: 0xf4f6f2, letters: 0xffffff, cross: true, glow: 0x6dff9a },
  dentist: { paint: 0xdfe8ef, awning: 0x4f9fd6, stripe: 0xf4f8fb, letters: 0xffffff, glow: 0xbfe6ff },
  gym: { awning: 0xf2b43c, stripe: 0xf2b43c, letters: 0x22262b, glow: 0xffe2a0 },
  climbing: { awning: 0xe0603a, stripe: 0xe0603a, letters: 0xffffff, glow: 0xffc08a },
  park: { awning: 0x5c9a46, stripe: 0x5c9a46, letters: 0xffffff, glow: 0xffe2a0 },
};

/** Where a shop's front is: the house's front tile, and the face it is on. */
export type Front = { id: number; sv: ServiceId; x: number; y: number; face: "u" | "v" };

/** A building of its own that moves: its service and its footprint. */
export type Moving = { id: number; sv: ServiceId; x: number; y: number; w: number; h: number; front?: Front };

/** The services that move, and what of them. */
const MOVES = new Set<ServiceId>(["cafe", "bakery", "kombucha", "club", "cinema", "arcade"]);

/**
 * Every shop's front: which face of its house, toward its street — the lit
 * (+v) face, or the darker (+u) one — or the lit one where its street is on
 * a side the camera cannot see. Pure, for tests.
 */
export function shopfrontsOf(g: Grid): Front[] {
  const out: Front[] = [];
  for (const s of g.structures.values()) {
    if (!s.shop || s.build || !serviceDef(s.shop)?.shop) continue;
    const x = s.x + s.w - 1, y = s.y + s.h - 1;
    const face = !isPaved(g, x, y + 1) && isPaved(g, x + 1, y) ? "u" : "v";
    out.push({ id: s.id, sv: s.shop as ServiceId, x, y, face });
  }
  return out;
}

/** What moves on the map: the shops that do, and the buildings of their own. Pure, for tests. */
export function movingOf(g: Grid, fronts: readonly Front[] = shopfrontsOf(g)): Moving[] {
  const out: Moving[] = [];
  for (const f of fronts) if (MOVES.has(f.sv)) out.push({ id: f.id, sv: f.sv, x: f.x, y: f.y, w: 1, h: 1, front: f });
  for (const s of g.structures.values()) {
    const sv = !s.build && serviceOf(s.def);
    if (sv && MOVES.has(sv)) out.push({ id: s.id, sv, x: s.x, y: s.y, w: s.w, h: s.h });
  }
  return out;
}

/**
 * How far into its tile a house's front walls stand, its back walls as far in
 * from the back: measured off the kits' ground frames, a block 97 px across
 * a 132 px tile, standing in its middle.
 */
const WALL = 0.87;

const DARK = 0x262b31;
const GLASS_IN = 0x34302c;
const CREAM = 0xeeebe0;
const BRASS = 0xc9a24a;
const IRON = 0x2b2f33;
const STONE = 0xc2beac;

/** A point in a face's own terms: `a` along it, `out` from the wall, `z` up. */
export type FacePt = readonly [a: number, out: number, z: number];

/**
 * A pen turned to a face: `a` along it from 0 to 1, `out` from its wall, `z`
 * up. On the +v face `a` is `u`; on the +u face, `v`. What is drawn flat on
 * the wall is shaded for the face it is on; boxes shade themselves.
 */
export type Face = {
  /** A rectangle on the wall itself, a hair proud of it. */
  on: (a0: number, a1: number, z0: number, z1: number, colour: number, alpha?: number) => void;
  /** A box standing out from the wall. */
  box: (a0: number, a1: number, o0: number, o1: number, z0: number, z1: number, colour: number, top?: number) => void;
  /** A disc at a point. */
  dot: (a: number, out: number, z: number, r: number, colour: number, alpha?: number) => void;
  /** A polygon through points, its colour as given. */
  poly: (pts: readonly FacePt[], colour: number, alpha?: number) => void;
  /** A rectangle on a board standing square off the wall at `a`: the side of it the camera sees. */
  side: (a: number, o0: number, o1: number, z0: number, z1: number, colour: number, alpha?: number) => void;
  /** A point in the pen's own (u, v, z), for struts. */
  pt3: (a: number, out: number, z: number) => [number, number, number];
  /** A colour as the wall shows it. */
  wall: (c: number) => number;
  /** A colour as a plane square to the wall shows it. */
  across: (c: number) => number;
};

export function faceOf(p: Pen, face: "u" | "v", lo = 1 - WALL, hi = WALL): Face {
  const A = (a: number) => lo + (hi - lo) * a;
  if (face === "v") {
    const pt = (a: number, o: number, z: number) => p.P(A(a), WALL + o, z);
    return {
      on: (a0, a1, z0, z1, c, al) => p.onV(WALL + 0.004, A(a0), A(a1), z0, z1, c, al),
      box: (a0, a1, o0, o1, z0, z1, c, top) => p.box(A(a0), WALL + o0, A(a1), WALL + o1, z0, z1, c, top === undefined ? undefined : { top }),
      dot: (a, out, z, r, c, al) => p.dot(A(a), WALL + out, z, r, c, al),
      poly: (pts, c, al) => p.poly(pts.map(([a, o, z]) => pt(a, o, z)), c, al),
      side: (a, o0, o1, z0, z1, c, al) => p.onU(A(a), WALL + o0, WALL + o1, z0, z1, tone(c, RIGHT), al),
      pt3: (a, o, z) => [A(a), WALL + o, z],
      wall: (c) => c,
      across: (c) => tone(c, RIGHT),
    };
  }
  const pt = (a: number, o: number, z: number) => p.P(WALL + o, A(a), z);
  return {
    on: (a0, a1, z0, z1, c, al) => p.onU(WALL + 0.004, A(a0), A(a1), z0, z1, tone(c, RIGHT), al),
    box: (a0, a1, o0, o1, z0, z1, c, top) => p.box(WALL + o0, A(a0), WALL + o1, A(a1), z0, z1, c, top === undefined ? undefined : { top }),
    dot: (a, out, z, r, c, al) => p.dot(WALL + out, A(a), z, r, c, al),
    poly: (pts, c, al) => p.poly(pts.map(([a, o, z]) => pt(a, o, z)), c, al),
    side: (a, o0, o1, z0, z1, c, al) => p.onV(A(a), WALL + o0, WALL + o1, z0, z1, c, al),
    pt3: (a, o, z) => [WALL + o, A(a), z],
    wall: (c) => tone(c, RIGHT),
    across: (c) => c,
  };
}

/**
 * Lettering on a sign: words of strokes in the sign's colour, the name's
 * length set by the shop's id, a shadow under it where the sign is painted.
 */
function letters(f: Face, a0: number, a1: number, z0: number, z1: number, colour: number, seed: number, shadow?: number) {
  const words = 1 + (seed % 2);
  const n = 4 + (seed % 3) + words;
  const w = (a1 - a0) / (n * 1.3);
  let a = a0 + ((a1 - a0) - (n * 1.3 - 0.3) * w) / 2;
  for (let k = 0; k < n; k++) {
    if (words === 2 && k === Math.floor(n / 2)) { a += w * 1.3; continue; }
    const cap = k === 0 || (words === 2 && k === Math.floor(n / 2) + 1);
    const top = z0 + (z1 - z0) * (cap ? 1 : (seed >> k) & 1 ? 0.78 : 0.66);
    if (shadow !== undefined) f.on(a + w * 0.15, a + w * 1.15, z0 - 0.025, top - 0.025, shadow);
    f.on(a, a + w, z0, top, colour);
    a += w * 1.3;
  }
}

/** A green cross on a bracket, standing out from the wall at `a`. */
function cross(f: Face, a: number, z: number, colour: number) {
  f.box(a - 0.01, a + 0.01, 0, 0.16, z - 0.02, z + 0.02, 0x9aa3ad);
  f.box(a - 0.03, a + 0.03, 0.16, 0.19, z - 0.3, z + 0.3, colour);
  f.box(a - 0.1, a + 0.1, 0.16, 0.19, z - 0.09, z + 0.09, colour);
}

/** How a shop's front is done: under a striped awning, painted in the old way, or in neon. */
type FrontKind = "awning" | "painted" | "neon";
const KIND_OF: Partial<Record<ServiceId, FrontKind>> = {
  takeaway: "awning", bakery: "awning", cafe: "awning", kombucha: "awning", pharmacy: "awning", dentist: "awning",
  bar: "painted", arcade: "neon", vape: "neon",
};

/** The spans of a front: the door's and the window's, the door to one end by the shop's id. */
export function spansOf(fr: Front): { door: [number, number]; win: [number, number] } {
  return fr.id % 2 ? { door: [0.08, 0.3], win: [0.36, 0.92] } : { door: [0.7, 0.92], win: [0.08, 0.64] };
}

/** The awning's depth off the wall, and its heights at the wall and at its edge. */
const AWNING = { out: 0.24, z0: 1.6, z1: 1.36, drop: 0.09 };
/** The fascia, where the name is, and the cornice over it. */
const FASCIA = { z0: 1.62, z1: 1.98 };

/** A house's ground floor, made a shop. */
export function drawShopfront(p: Pen, fr: Front) {
  const L = SHOP_LOOK[fr.sv];
  const f = faceOf(p, fr.face);
  const kind = KIND_OF[fr.sv] ?? "awning";
  const paint = L.paint ?? tone(L.awning, 0.78);
  const { door: [d0, d1], win: [w0, w1] } = spansOf(fr);
  // THE FRONT, painted, the joinery round the door and the window.
  f.on(0, 1, 0, FASCIA.z0, f.wall(paint));
  // A stall riser under the window, in two panels, and its sill.
  f.on(w0, w1, 0.03, 0.34, f.wall(tone(paint, 0.82)));
  for (const [x0, x1] of [[w0, (w0 + w1) / 2], [(w0 + w1) / 2, w1]]) {
    f.on(x0 + 0.03, x1 - 0.03, 0.08, 0.29, f.wall(tone(paint, 1.14)));
    f.on(x0 + 0.04, x1 - 0.04, 0.09, 0.28, f.wall(tone(paint, 0.94)));
  }
  // THE WINDOW: dark in its depth, warm low down where the display is lit.
  f.on(w0, w1, 0.38, 1.5, f.wall(GLASS_IN));
  f.on(w0, w1, 0.38, 0.95, f.wall(mix(GLASS_IN, L.glow, 0.22)));
  DISPLAY[fr.sv]?.(f, w0, w1, L, fr);
  // Its bars: a transom across, mullions down; the lights over the transom paler.
  f.on(w0, w1, 1.21, 1.5, f.wall(mix(GLASS_IN, 0xbfd8e0, 0.28)));
  f.on(w0, w1, 1.17, 1.21, f.wall(paint));
  for (const m of [1, 2]) {
    const a = w0 + ((w1 - w0) * m) / 3;
    f.on(a - 0.008, a + 0.008, 0.38, 1.5, f.wall(paint));
  }
  // Light off the glass, a slanted streak.
  f.poly([[w0 + 0.06, 0.006, 0.42], [w0 + 0.13, 0.006, 0.42], [w0 + 0.3, 0.006, 1.14], [w0 + 0.23, 0.006, 1.14]], 0xffffff, 0.1);
  // THE DOOR, in its reveal: the leaf, its glass, a kick plate and handle, a fanlight over it.
  f.on(d0, d1, 0, 1.5, f.wall(0x15171b));
  f.on(d0 + 0.025, d1 - 0.025, 0.03, 1.26, f.wall(tone(paint, 0.9)));
  f.on(d0 + 0.05, d1 - 0.05, 0.6, 1.18, f.wall(mix(GLASS_IN, L.glow, 0.32)));
  f.on(d0 + 0.035, d1 - 0.035, 0.05, 0.15, f.wall(BRASS));
  const hd = fr.id % 2 ? d1 - 0.055 : d0 + 0.04;
  f.on(hd, hd + 0.015, 0.5, 0.62, f.wall(BRASS));
  f.on(d0 + 0.025, d1 - 0.025, 1.3, 1.46, f.wall(mix(GLASS_IN, 0xffffff, 0.3)));
  f.box(d0 - 0.02, d1 + 0.02, 0, 0.07, 0, 0.05, STONE, tone(STONE, 1.08));
  // PILASTERS at either end, their consoles carrying the fascia.
  for (const a of [0, 0.955]) {
    f.box(a, a + 0.045, 0, 0.03, 0, FASCIA.z0, tone(paint, 1.25));
    f.box(a - 0.008, a + 0.053, 0, 0.055, FASCIA.z0 - 0.08, FASCIA.z1 + 0.02, tone(paint, 1.1));
  }
  // THE FASCIA, the name on it, a cornice over it.
  const board = kind === "neon" ? 0x16171d : kind === "painted" ? paint : tone(L.awning, 0.82);
  f.box(0.05, 0.95, 0, 0.035, FASCIA.z0, FASCIA.z1, board);
  f.box(-0.015, 1.015, 0, 0.075, FASCIA.z1, FASCIA.z1 + 0.07, CREAM, tone(CREAM, 1.04));
  if (kind === "painted") {
    // Gold leaf, lined round, shadowed.
    f.on(0.08, 0.92, FASCIA.z0 + 0.04, FASCIA.z0 + 0.055, f.wall(BRASS));
    f.on(0.08, 0.92, FASCIA.z1 - 0.055, FASCIA.z1 - 0.04, f.wall(BRASS));
  }
  const letterAt = kind === "neon" ? 0.0 : 0.037;
  const lf: Face = { ...f, on: (a0, a1, z0, z1, c, al) => f.poly([[a0, letterAt, z0], [a1, letterAt, z0], [a1, letterAt, z1], [a0, letterAt, z1]], f.wall(c), al) };
  letters(lf, 0.16, 0.84, FASCIA.z0 + 0.1, FASCIA.z1 - 0.1, kind === "painted" ? 0xe8c060 : L.letters, fr.id, kind === "painted" ? tone(paint, 0.6) : undefined);
  if (kind === "neon") {
    // A tube round the board, and one along under it.
    for (const z of [FASCIA.z0 + 0.03, FASCIA.z1 - 0.045]) f.poly([[0.07, 0.04, z], [0.93, 0.04, z], [0.93, 0.04, z + 0.018], [0.07, 0.04, z + 0.018]], L.letters);
    f.poly([[0.03, 0.035, FASCIA.z0 - 0.06], [0.97, 0.035, FASCIA.z0 - 0.06], [0.97, 0.035, FASCIA.z0 - 0.04], [0.03, 0.035, FASCIA.z0 - 0.04]], mix(L.letters, 0xffffff, 0.3));
  } else {
    // Two lamps on swan necks over the board.
    for (const a of [0.25, 0.75]) {
      p.strut(f.pt3(a, 0.02, FASCIA.z1 + 0.07), f.pt3(a, 0.12, FASCIA.z1 + 0.15), 0.01, IRON);
      f.box(a - 0.03, a + 0.03, 0.09, 0.15, FASCIA.z1 + 0.08, FASCIA.z1 + 0.13, IRON);
      f.dot(a, 0.12, FASCIA.z1 + 0.075, 0.018, 0xfff1c4);
    }
  }
  // What it puts out on the pavement, under the awning.
  PAVEMENT[fr.sv]?.(f, L, fr, p);
  if (kind === "awning") awning(f, L, fr);
  if (kind === "painted") baskets(f, p);
  // THE BLADE: a sign hung square off the wall at the end away from the door.
  const ba = fr.id % 2 ? 0.985 : 0.015;
  if (L.cross) cross(f, ba, 1.05, L.awning);
  else blade(f, p, ba, L, fr.sv, kind);
}

/** THE AWNING: canvas sloping out from under the fascia, striped, a scalloped valance, its cheek at the end. */
function awning(f: Face, L: ShopLook, fr: Front) {
  const { out, z0, z1, drop } = AWNING;
  const stripes = L.stripe !== L.awning;
  const n = 7;
  // The roller's box under the fascia.
  f.box(0.02, 0.98, 0, 0.05, z0 - 0.02, z0 + 0.03, tone(L.awning, 0.7));
  for (let k = 0; k < n; k++) {
    const a0 = 0.02 + (0.96 * k) / n, a1 = 0.02 + (0.96 * (k + 1)) / n;
    const c = stripes && k % 2 ? L.stripe : L.awning;
    // The canvas, lit from above, shaded a little toward the wall.
    f.poly([[a0, 0.05, z0], [a1, 0.05, z0], [a1, out, z1], [a0, out, z1]], fr.face === "v" ? tone(c, 1.02) : tone(c, 0.88));
    f.poly([[a0, 0.05, z0], [a1, 0.05, z0], [a1, 0.12, z0 - 0.07], [a0, 0.12, z0 - 0.07]], 0x000000, 0.08);
    // The valance: a scallop hanging off the edge, the stripe's own colour.
    const m = (a0 + a1) / 2;
    f.poly([[a0, out, z1], [a1, out, z1], [a1, out, z1 - drop * 0.55], [m, out, z1 - drop], [a0, out, z1 - drop * 0.55]], f.wall(tone(c, 0.92)));
  }
  // The edge's binding, and the cheek at the end the camera sees.
  f.poly([[0.02, out, z1], [0.98, out, z1], [0.98, out, z1 + 0.018], [0.02, out, z1 + 0.018]], f.wall(tone(L.awning, 0.7)));
  f.poly([[0.98, 0.05, z0], [0.98, out, z1], [0.98, out, z1 - drop * 0.55], [0.98, 0.05, z1 - 0.02]], f.across(tone(L.awning, 0.86)));
}

/** Hanging baskets either side of a painted front: a bracket, the basket, flowers spilling. */
function baskets(f: Face, p: Pen) {
  for (const a of [0.02, 0.98]) {
    p.strut(f.pt3(a, 0.0, 1.55), f.pt3(a, 0.17, 1.55), 0.01, IRON);
    p.strut(f.pt3(a, 0.17, 1.55), f.pt3(a, 0.17, 1.4), 0.006, IRON);
    f.dot(a, 0.17, 1.3, 0.075, 0x5a7d3a);
    f.dot(a, 0.17, 1.27, 0.06, 0x3c5a28);
    for (const [da, dz, c] of [[-0.03, 1.36, 0xf27aa8], [0.03, 1.34, 0xf2efe6], [0, 1.25, 0xe0533d], [-0.04, 1.25, 0x9b6bd6], [0.04, 1.24, 0xf2c230]] as const) {
      f.dot(a + da, 0.17 + 0.06, dz, 0.022, c);
    }
  }
}

/** THE BLADE SIGN: a board on a bracket square off the wall, its trade's sign painted on the side the camera sees. */
function blade(f: Face, p: Pen, a: number, L: ShopLook, sv: ServiceId, kind: FrontKind) {
  const o0 = 0.09, o1 = 0.33, z0 = 1.62, z1 = 1.98;
  p.strut(f.pt3(a, 0, z1 + 0.06), f.pt3(a, o1 + 0.02, z1 + 0.06), 0.012, IRON);
  for (const o of [o0 + 0.03, o1 - 0.03]) p.strut(f.pt3(a, o, z1 + 0.06), f.pt3(a, o, z1), 0.005, IRON);
  const board = kind === "neon" ? 0x16171d : kind === "painted" ? (L.paint ?? L.awning) : L.awning;
  f.box(a - 0.012, a + 0.012, o0, o1, z0, z1, board);
  const s = (o: number, z: number) => [a + 0.0125, o0 + (o1 - o0) * o, z0 + (z1 - z0) * z] as const;
  const rect = (x0: number, x1: number, y0: number, y1: number, c: number, al?: number) => {
    const [aa, oa, za] = s(x0, y0), [, ob, zb] = s(x1, y1);
    f.side(aa, oa, ob, za, zb, c, al);
  };
  const dot = (x: number, y: number, r: number, c: number) => { const [aa, o, z] = s(x, y); f.dot(aa, o, z, r, c); };
  // Its border.
  rect(0.05, 0.95, 0.06, 0.1, kind === "painted" ? BRASS : L.letters);
  rect(0.05, 0.95, 0.9, 0.94, kind === "painted" ? BRASS : L.letters);
  ICON[sv]?.(rect, dot, L);
}

type Rect = (x0: number, x1: number, y0: number, y1: number, c: number, al?: number) => void;
type Dot = (x: number, y: number, r: number, c: number) => void;
/** Each trade's sign, on its blade, in the blade's own terms: 0–1 across it and up it. */
const ICON: Partial<Record<ServiceId, (r: Rect, d: Dot, L: ShopLook) => void>> = {
  // A burger.
  takeaway: (r) => { r(0.25, 0.75, 0.6, 0.75, 0xe0a050); r(0.22, 0.78, 0.5, 0.58, 0x6b3a22); r(0.24, 0.76, 0.46, 0.5, 0x6cbf4a); r(0.25, 0.75, 0.3, 0.44, 0xe0a050); },
  // A loaf, scored.
  bakery: (r) => { r(0.2, 0.8, 0.32, 0.62, 0xd99a50); for (const x of [0.32, 0.5, 0.68]) r(x - 0.03, x + 0.03, 0.42, 0.58, 0xa8652a); },
  // A pint, its head.
  bar: (r) => { r(0.32, 0.68, 0.25, 0.65, 0xd9922a); r(0.3, 0.7, 0.65, 0.76, 0xfff4dc); },
  // A joystick.
  arcade: (r, d) => { r(0.25, 0.75, 0.25, 0.4, 0x3ff0ff); r(0.47, 0.53, 0.4, 0.65, 0xd8dde3); d(0.5, 0.7, 0.035, 0xff4f6a); },
  // A cup on its saucer, steaming.
  cafe: (r) => { r(0.3, 0.62, 0.3, 0.58, 0xf2efe6); r(0.62, 0.7, 0.38, 0.5, 0xf2efe6); r(0.22, 0.74, 0.25, 0.3, 0xf2efe6); r(0.4, 0.44, 0.64, 0.8, 0xf2efe6, 0.6); r(0.5, 0.54, 0.62, 0.78, 0xf2efe6, 0.6); },
  // A bottle.
  kombucha: (r) => { r(0.38, 0.62, 0.22, 0.6, 0x7a4a1a); r(0.45, 0.55, 0.6, 0.78, 0x7a4a1a); r(0.38, 0.62, 0.36, 0.48, 0xfff3dc); },
  // A cloud, in neon.
  vape: (_r, d, L) => { d(0.35, 0.5, 0.05, L.letters); d(0.55, 0.55, 0.06, L.letters); d(0.68, 0.46, 0.045, L.letters); d(0.5, 0.42, 0.045, L.letters); },
  // A tooth.
  dentist: (r) => { r(0.3, 0.7, 0.45, 0.75, 0xffffff); r(0.3, 0.45, 0.25, 0.45, 0xffffff); r(0.55, 0.7, 0.25, 0.45, 0xffffff); },
};

/** What a shop shows in its window, `w0..w1` along the front. */
const DISPLAY: Partial<Record<ServiceId, (f: Face, w0: number, w1: number, L: ShopLook, fr: Front) => void>> = {
  // An OPEN sign in neon, and the menu lit over the counter.
  takeaway: (f, w0, w1) => {
    for (let k = 0; k < 3; k++) f.on(w0 + 0.04 + k * ((w1 - w0 - 0.08) / 3), w0 + 0.02 + (k + 1) * ((w1 - w0 - 0.08) / 3), 0.98, 1.13, f.wall(k === 1 ? 0xfff2c4 : 0xf6e2b0));
    f.on(w0 + 0.05, w1 - 0.05, 0.38, 0.55, f.wall(0x8a8f96));
    const m = (w0 + w1) / 2;
    f.on(m - 0.1, m + 0.1, 0.68, 0.8, f.wall(0xff4f6a));
    f.on(m - 0.085, m + 0.085, 0.695, 0.785, f.wall(0x3a1018));
    for (let k = 0; k < 4; k++) f.on(m - 0.07 + k * 0.038, m - 0.045 + k * 0.038, 0.71, 0.77, f.wall(0xff8fa2));
  },
  // Shelves of loaves and cakes.
  bakery: (f, w0, w1) => {
    for (const z of [0.55, 0.85]) {
      f.on(w0 + 0.02, w1 - 0.02, z - 0.02, z, f.wall(0xd9cfb4));
      for (let a = w0 + 0.06; a < w1 - 0.04; a += 0.075) {
        const k = Math.round(a * 100 + z * 10) % 3;
        if (k === 2) { f.on(a - 0.025, a + 0.025, z, z + 0.07, f.wall(0xf6d2dc)); f.on(a - 0.025, a + 0.025, z + 0.06, z + 0.075, f.wall(0xfffaf2)); }
        else f.dot(a, 0.006, z + 0.035, 0.032, k ? 0xc98a46 : 0xa8652a);
      }
    }
  },
  // Etched glass below, bottles lit behind the bar above.
  bar: (f, w0, w1) => {
    f.on(w0, w1, 0.38, 0.92, f.wall(mix(GLASS_IN, 0xd8dccc, 0.45)));
    for (let a = w0 + 0.05; a < w1 - 0.03; a += 0.06) f.on(a, a + 0.012, 0.42, 0.88, f.wall(mix(GLASS_IN, 0xffffff, 0.6)), 0.5);
    for (let a = w0 + 0.04; a < w1 - 0.03; a += 0.035) f.on(a, a + 0.018, 0.98, 1.1 - (Math.round(a * 97) % 3) * 0.02, f.wall([0x4f8a3a, 0xc9822a, 0x8a2a3a][Math.round(a * 53) % 3]));
  },
  // Two cabinets, their screens lit. @see drawMoving
  arcade: (f, w0, w1, L) => {
    for (const [x0, x1] of cabinetsOf(w0, w1)) {
      f.on(x0, x1, 0.38, 1.16, f.wall(0x1d1430));
      f.on(x0 + 0.015, x1 - 0.015, 0.78, 1.0, f.wall(mix(L.letters, DARK, 0.3)));
      f.on(x0, x1, 1.08, 1.16, f.wall(0xff4f6a));
    }
    f.on(w0, w1, 1.44, 1.5, f.wall(L.letters));
  },
  // The counter, the machine on it, pendants over it.
  cafe: (f, w0, w1) => {
    f.on(w0 + 0.03, w1 - 0.03, 0.38, 0.62, f.wall(0x8a5a32));
    f.on(w0 + 0.08, w0 + 0.2, 0.62, 0.8, f.wall(0xc9ced4));
    for (let a = w0 + 0.26; a < w1 - 0.06; a += 0.05) f.on(a, a + 0.025, 0.62, 0.67, f.wall(0xf2efe6));
    for (let a = w0 + 0.1; a < w1 - 0.05; a += 0.16) { f.on(a - 0.002, a + 0.002, 1.0, 1.17, f.wall(IRON)); f.dot(a, 0.006, 0.98, 0.025, 0xffd27a); }
  },
  // Shelves of bottles, every flavour.
  kombucha: (f, w0, w1) => {
    for (const z of [0.5, 0.8]) {
      f.on(w0 + 0.02, w1 - 0.02, z - 0.02, z, f.wall(0xb07a44));
      for (let a = w0 + 0.05; a < w1 - 0.03; a += 0.04) {
        const c = [0xe58a2b, 0x6cbf4a, 0xf27aa8, 0xf2c230][Math.round(a * 71 + z * 3) % 4];
        f.on(a, a + 0.022, z, z + 0.13, f.wall(c));
        f.on(a + 0.006, a + 0.016, z + 0.13, z + 0.17, f.wall(c));
      }
    }
  },
  // A cloud in neon, a lit case under it.
  vape: (f, w0, w1, L) => {
    const m = (w0 + w1) / 2;
    for (const [da, dz, r] of [[-0.08, 0.95, 0.06], [0.0, 1.0, 0.075], [0.08, 0.94, 0.055]] as const) f.dot(m + da, 0.006, dz, r, L.letters, 0.85);
    for (const [da, dz, r] of [[-0.08, 0.95, 0.045], [0.0, 1.0, 0.06], [0.08, 0.94, 0.04]] as const) f.dot(m + da, 0.007, dz, r, 0x1a1530);
    f.on(w0 + 0.04, w1 - 0.04, 0.38, 0.62, f.wall(0x2a2040));
    for (let a = w0 + 0.07; a < w1 - 0.06; a += 0.06) f.on(a, a + 0.03, 0.55, 0.6, f.wall(mix(L.letters, 0xffffff, 0.4)));
  },
  // Shelves of boxes, a cross on the glass.
  pharmacy: (f, w0, w1) => {
    for (const z of [0.48, 0.74]) {
      f.on(w0 + 0.02, w1 - 0.02, z - 0.02, z, f.wall(0xf2f4f0));
      for (let a = w0 + 0.04; a < w1 - 0.03; a += 0.045) f.on(a, a + 0.035, z, z + 0.1 + (Math.round(a * 89) % 2) * 0.04, f.wall([0xf2f4f0, 0x6dbf8a, 0x4f9fd6, 0xf27aa8][Math.round(a * 37) % 4]));
    }
    const m = (w0 + w1) / 2;
    f.on(m - 0.015, m + 0.015, 0.95, 1.13, f.wall(0x2fa35a));
    f.on(m - 0.05, m + 0.05, 1.025, 1.055, f.wall(0x2fa35a));
  },
  // A smile on a poster, and a plant.
  dentist: (f, w0, w1) => {
    f.on(w0 + 0.06, w0 + 0.26, 0.6, 1.1, f.wall(0xf4f8fb));
    f.on(w0 + 0.1, w0 + 0.22, 0.75, 0.82, f.wall(0xe57a8a));
    f.on(w0 + 0.11, w0 + 0.21, 0.78, 0.81, f.wall(0xffffff));
    f.dot(w1 - 0.1, 0.006, 0.6, 0.07, 0x5c9a46);
    f.on(w1 - 0.13, w1 - 0.07, 0.38, 0.5, f.wall(0xe8e2d4));
  },
};

/** The arcade's two cabinets in its window. */
const cabinetsOf = (w0: number, w1: number): [number, number][] => {
  const w = (w1 - w0 - 0.12) / 2;
  return [[w0 + 0.04, w0 + 0.04 + w], [w1 - 0.04 - w, w1 - 0.04]];
};

/** Where a café's cup, a bakery's crate, a kombucha bar's tasting barrel stand: what steams. */
export function steamOf(fr: Front): FacePt | null {
  const { win: [w0, w1] } = spansOf(fr);
  if (fr.sv === "cafe") return [w0 + 0.18, 0.16, 0.5];
  if (fr.sv === "bakery") return [(w0 + w1) / 2, 0.14, 0.42];
  if (fr.sv === "kombucha") return [w1 - 0.12, 0.16, 0.5];
  return null;
}

/** What a shop puts on the pavement, or hangs out. */
const PAVEMENT: Partial<Record<ServiceId, (f: Face, L: ShopLook, fr: Front, p: Pen) => void>> = {
  // Two bistro tables and their chairs, a chalkboard by the door.
  cafe: (f, _L, fr) => {
    const { win: [w0, w1] } = spansOf(fr);
    for (const a of [w0 + 0.18, w1 - 0.16]) {
      for (const s of [-1, 1]) {
        f.box(a + s * 0.09 - 0.02, a + s * 0.09 + 0.02, 0.12, 0.17, 0, 0.18, 0x3a3f45);
        f.box(a + s * 0.09 - 0.02, a + s * 0.09 + 0.02, 0.12, 0.13, 0.18, 0.34, 0x3a3f45);
      }
      f.box(a - 0.008, a + 0.008, 0.14, 0.16, 0, 0.36, IRON);
      f.box(a - 0.055, a + 0.055, 0.1, 0.2, 0.36, 0.39, 0xe8e2d4, 0xf2efe6);
      f.box(a - 0.012, a + 0.012, 0.145, 0.165, 0.39, 0.46, 0xffffff);
    }
    chalkboard(f, fr);
  },
  // A chalkboard of the menu, and a bin.
  takeaway: (f, _L, fr) => {
    chalkboard(f, fr);
    const { win: [w0] } = spansOf(fr);
    f.box(w0 + 0.05, w0 + 0.12, 0.08, 0.15, 0, 0.36, 0x2f3a33);
    f.box(w0 + 0.045, w0 + 0.125, 0.075, 0.155, 0.36, 0.39, BRASS);
  },
  // Crates of bread by the window.
  bakery: (f, _L, fr) => {
    const { win: [w0, w1] } = spansOf(fr);
    const m = (w0 + w1) / 2;
    f.box(m - 0.14, m + 0.14, 0.06, 0.2, 0, 0.18, 0x9a7349);
    f.box(m - 0.14, m + 0.14, 0.06, 0.2, 0.18, 0.21, 0x7a5a38);
    for (let k = 0; k < 5; k++) f.dot(m - 0.1 + k * 0.05, 0.13, 0.25, 0.03, k % 2 ? 0xc98a46 : 0xa8652a);
  },
  // A barrel for a table, two stools.
  bar: (f, _L, fr) => {
    const { win: [w0, w1] } = spansOf(fr);
    const m = (w0 + w1) / 2;
    f.box(m - 0.06, m + 0.06, 0.08, 0.2, 0, 0.46, 0x7a5232, 0x5e3f26);
    for (const z of [0.08, 0.36]) f.box(m - 0.062, m + 0.062, 0.078, 0.202, z, z + 0.03, IRON);
    for (const s of [-1, 1]) {
      f.box(m + s * 0.15 - 0.012, m + s * 0.15 + 0.012, 0.13, 0.15, 0, 0.32, IRON);
      f.box(m + s * 0.15 - 0.04, m + s * 0.15 + 0.04, 0.1, 0.18, 0.32, 0.35, 0x7a5232);
    }
  },
  // Crates of bottles, a tasting barrel, a fig in a pot.
  kombucha: (f, _L, fr) => {
    const { win: [w0, w1] } = spansOf(fr);
    f.box(w0 + 0.04, w0 + 0.2, 0.06, 0.18, 0, 0.18, 0xb07a44);
    for (let k = 0; k < 3; k++) f.box(w0 + 0.06 + k * 0.05, w0 + 0.09 + k * 0.05, 0.1, 0.13, 0.18, 0.32, [0xe58a2b, 0x6cbf4a, 0xf27aa8][k]);
    f.box(w1 - 0.18, w1 - 0.06, 0.1, 0.22, 0, 0.42, 0x8a5a32, 0x6b4426);
    f.box(w1 - 0.025, w1 + 0.025, 0.1, 0.16, 0, 0.16, 0xb9b3a4);
    f.dot(w1, 0.13, 0.3, 0.07, 0x4f8a3a);
  },
  // A sandwich board, in neon's colour.
  vape: (f, L, fr) => {
    const { win: [w0] } = spansOf(fr);
    f.box(w0 + 0.06, w0 + 0.18, 0.13, 0.15, 0, 0.5, 0x2a2040);
    f.box(w0 + 0.075, w0 + 0.165, 0.15, 0.155, 0.26, 0.44, mix(L.letters, 0xffffff, 0.2));
  },
};

/** A chalkboard on the pavement by the door, the day's menu on it. */
function chalkboard(f: Face, fr: Front) {
  const { door: [d0, d1] } = spansOf(fr);
  const a = fr.id % 2 ? d1 + 0.08 : d0 - 0.08;
  f.box(a - 0.06, a + 0.06, 0.16, 0.19, 0, 0.5, 0x9a7349);
  f.box(a - 0.05, a + 0.05, 0.19, 0.195, 0.1, 0.46, 0x2b302c);
  for (let k = 0; k < 4; k++) f.box(a - 0.035, a + 0.035 - (k % 2) * 0.02, 0.195, 0.197, 0.38 - k * 0.07, 0.395 - k * 0.07, 0xf2efe6);
}

// ─── WHAT MOVES ─────────────────────────────────────────────────────────────

/** A few puffs of steam rising off a point, at time `t`. */
function steam(p: Pen, u: number, v: number, z: number, t: number) {
  for (let k = 0; k < 3; k++) {
    const k1 = (t * 0.45 + k / 3) % 1;
    p.dot(u + Math.sin((t + k) * 2.3) * 0.03, v, z + k1 * 1.1, 0.03 + k1 * 0.05, 0xffffff, 0.55 * (1 - k1));
  }
}

/** The cinema's marquee bulbs, chasing; the club's beams, swinging; steam off a café's cup. */
export function drawMoving(p: Pen, m: Moving, t: number) {
  const L = SHOP_LOOK[m.sv];
  if (m.front) {
    const fr = m.front, f = faceOf(p, fr.face);
    if (fr.sv === "arcade") {
      // The cabinets' screens, flickering through their colours, out of step.
      const { win: [w0, w1] } = spansOf(fr);
      cabinetsOf(w0, w1).forEach(([x0, x1], j) => {
        const k = (Math.floor(t * 3) + j) % 3;
        f.on(x0 + 0.015, x1 - 0.015, 0.78, 1.0, f.wall([L.letters, 0xff5fa8, 0xf2e94e][k]));
        // A sprite crossing it.
        const x = x0 + 0.03 + ((t * 0.6 + j * 0.37) % 1) * (x1 - x0 - 0.08);
        f.on(x, x + 0.02, 0.84, 0.88, f.wall(0xffffff));
      });
      return;
    }
    // Steam off the cup on the table, the bread, the brew.
    const at = steamOf(fr);
    if (!at) return;
    const [u, v, z] = f.pt3(at[0], at[1], at[2]);
    steam(p, u, v, z, t);
    return;
  }
  if (m.sv === "cinema") {
    // The marquee's bulbs, along its top and bottom, every third lit, chasing along.
    const u0 = MARQUEE.inset + 0.1, u1 = m.w - MARQUEE.inset - 0.1, v = m.h - MARQUEE.front + MARQUEE.out + 0.006;
    const n = 16, lit = Math.floor(t * 8) % 3;
    for (const [z, d] of [[MARQUEE.z1 - 0.05, 0], [MARQUEE.z0 + 0.03, 1]] as const) {
      for (let k = 0; k < n; k++) {
        const on = (k + d) % 3 === lit;
        p.dot(u0 + ((k + 0.5) / n) * (u1 - u0), v, z, 0.022, on ? 0xfff2b0 : 0x8a6a2a, on ? 1 : 0.8);
      }
    }
    return;
  }
  if (m.sv === "club") {
    // Two beams off the roof, swinging, in turn magenta and cyan.
    const cu = m.w / 2, cv = m.h / 2, z = CLUB_TOP + 0.18;
    for (const [k, c] of [[0, L.letters], [1, 0x3ff0ff]] as const) {
      const a = Math.sin(t * 1.3 + k * 2.1) * 0.9;
      p.strut([cu - 0.3 + k * 0.6, cv, z], [cu - 0.3 + k * 0.6 + Math.sin(a) * 1.4, cv - 0.4, z + 4.5], 0.12, c, 0.35);
    }
    return;
  }
  if (m.sv === "cafe") steam(p, 0.2 + 0.35, m.h - 0.2, 0.5, t);
}

export type Shopfronts = {
  /** Draw the shops' fronts where the map says, if it has changed. */
  sync: (g: Grid, rev: number, scale: number) => void;
  /** Move what moves, at `t` seconds, in the bands on screen. */
  tick: (t: number) => void;
  destroy: () => void;
};

/** How many times a second what moves is drawn again. */
const MOVE_HZ = 12;

export function createShopfronts(bands: BandLayer): Shopfronts {
  let drawn: Graphics[] = [];
  let key = "";
  let moving: { m: Moving; gr: Graphics; band: number; ground: number }[] = [];
  let scale = 1;
  let last = -1;
  const clear = () => {
    for (const gr of drawn) { gr.parent?.removeChild(gr); gr.destroy(); }
    drawn = [];
    moving = [];
  };
  const graphicsIn = (b: number, of: Map<number, Graphics>) => {
    let gr = of.get(b);
    if (gr) return gr;
    const band = bands.dynamicOf[b];
    if (!band) return null;
    gr = new Graphics();
    gr.eventMode = "none";
    gr.zIndex = 0;
    band.addChild(gr);
    drawn.push(gr);
    of.set(b, gr);
    return gr;
  };
  return {
    sync(g, rev, sc) {
      const k = `${rev}|${sc}|${g.w}`;
      if (k === key) return;
      key = k;
      scale = sc;
      last = -1;
      clear();
      const fronts = shopfrontsOf(g);
      const still = new Map<number, Graphics>();
      for (const fr of fronts) {
        const gr = graphicsIn(bandOf(fr.x, fr.y), still);
        if (gr) drawShopfront(makePen(gr, fr.x - 0.5, fr.y - 0.5, g.height[idx(g, fr.x, fr.y)], sc, null), fr);
      }
      // What moves: a Graphics each, after the fronts in their band, so over them.
      for (const m of movingOf(g, fronts)) {
        const band = bandOf(m.x + m.w - 1, m.y + m.h - 1);
        const gr = graphicsIn(band, new Map());
        if (gr) moving.push({ m, gr, band, ground: inBounds(g, m.x, m.y) ? g.height[idx(g, m.x, m.y)] : 0 });
      }
    },
    tick(t) {
      if (!moving.length) return;
      const step = Math.floor(t * MOVE_HZ);
      if (step === last) return;
      last = step;
      for (const { m, gr, band, ground } of moving) {
        if (band < bands.visibleLo || band > bands.visibleHi) continue;
        gr.clear();
        drawMoving(makePen(gr, m.x - 0.5, m.y - 0.5, ground, scale, null), m, t);
      }
    },
    destroy: clear,
  };
}
