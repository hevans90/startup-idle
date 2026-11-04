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
import { makePen, mix, tone, type Pen } from "../structures/projects/pen";
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
};

export const SHOP_LOOK: Record<ServiceId, ShopLook> = {
  takeaway: { awning: 0xd8432f, stripe: 0xf6e7c8, letters: 0xfff2d6, glow: 0xffb36b },
  bakery: { awning: 0xb9783e, stripe: 0xf7ecd6, letters: 0xfff4e0, glow: 0xffc98a },
  bar: { awning: 0x23573f, stripe: 0x23573f, letters: 0xff5fa8, neon: true, glow: 0xff5fa8 },
  club: { awning: 0x1d1a2b, stripe: 0x1d1a2b, letters: 0xd25bff, neon: true, glow: 0xd25bff },
  arcade: { awning: 0x4a2a8f, stripe: 0x4a2a8f, letters: 0x3ff0ff, neon: true, glow: 0x3ff0ff },
  cafe: { awning: 0x2f8f6b, stripe: 0xf2efe6, letters: 0xf2efe6, glow: 0xffc46b },
  kombucha: { awning: 0xe58a2b, stripe: 0xfff3dc, letters: 0x2b2f33, glow: 0xffb04a },
  coworking: { awning: 0xf2c230, stripe: 0xf2c230, letters: 0x22262b, glow: 0xfff0b0 },
  vape: { awning: 0x7a4fd0, stripe: 0x7a4fd0, letters: 0xb9f3ff, neon: true, glow: 0xa98bff },
  cinema: { awning: 0xa8242e, stripe: 0xa8242e, letters: 0xffe07a, glow: 0xffd36b },
  pharmacy: { awning: 0x2fa35a, stripe: 0xf4f6f2, letters: 0xffffff, cross: true, glow: 0x6dff9a },
  doctor: { awning: 0x2fa35a, stripe: 0xf4f6f2, letters: 0xffffff, cross: true, glow: 0x6dff9a },
  dentist: { awning: 0x4f9fd6, stripe: 0xf4f8fb, letters: 0xffffff, glow: 0xbfe6ff },
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
const GLASS_IN = 0x4a4038;
const FRAME = 0xeeebe0;

/**
 * A pen turned to a face: `a` along it from 0 to 1, `out` from its wall, `z`
 * up. On the +v face `a` is `u`; on the +u face, `v`.
 */
export type Face = {
  /** A rectangle on the wall itself, a hair proud of it. */
  on: (a0: number, a1: number, z0: number, z1: number, colour: number, alpha?: number) => void;
  /** A box standing out from the wall. */
  box: (a0: number, a1: number, o0: number, o1: number, z0: number, z1: number, colour: number, top?: number) => void;
  /** A disc at a point. */
  dot: (a: number, out: number, z: number, r: number, colour: number, alpha?: number) => void;
};

export function faceOf(p: Pen, face: "u" | "v", lo = 1 - WALL, hi = WALL): Face {
  const A = (a: number) => lo + (hi - lo) * a;
  if (face === "v") {
    return {
      on: (a0, a1, z0, z1, c, al) => p.onV(WALL + 0.004, A(a0), A(a1), z0, z1, c, al),
      box: (a0, a1, o0, o1, z0, z1, c, top) => p.box(A(a0), WALL + o0, A(a1), WALL + o1, z0, z1, c, top === undefined ? undefined : { top }),
      dot: (a, out, z, r, c, al) => p.dot(A(a), WALL + out, z, r, c, al),
    };
  }
  return {
    on: (a0, a1, z0, z1, c, al) => p.onU(WALL + 0.004, A(a0), A(a1), z0, z1, c, al),
    box: (a0, a1, o0, o1, z0, z1, c, top) => p.box(WALL + o0, A(a0), WALL + o1, A(a1), z0, z1, c, top === undefined ? undefined : { top }),
    dot: (a, out, z, r, c, al) => p.dot(WALL + out, A(a), z, r, c, al),
  };
}

/** Lettering on a sign: a few strokes of the sign's colour, of a length set by its name's. */
function letters(f: Face, a0: number, a1: number, z0: number, z1: number, colour: number, seed: number) {
  const n = 3 + (seed % 3);
  const w = (a1 - a0) / (n * 1.35);
  for (let k = 0; k < n; k++) {
    const a = a0 + k * w * 1.35;
    const tall = (seed >> k) & 1 ? 1 : 0.7;
    f.on(a, a + w, z0, z0 + (z1 - z0) * tall, colour);
  }
}

/** A green cross on a bracket, standing out from the wall at `a`. */
function cross(f: Face, a: number, z: number, colour: number) {
  f.box(a - 0.01, a + 0.01, 0, 0.16, z - 0.02, z + 0.02, 0x9aa3ad);
  f.box(a - 0.03, a + 0.03, 0.16, 0.19, z - 0.3, z + 0.3, colour);
  f.box(a - 0.1, a + 0.1, 0.16, 0.19, z - 0.09, z + 0.09, colour);
}

/** A house's ground floor, made a shop. */
export function drawShopfront(p: Pen, fr: Front) {
  const L = SHOP_LOOK[fr.sv];
  const f = faceOf(p, fr.face);
  // THE FRONT: the window and the door, framed, the house's wall round them.
  f.on(0.06, 0.94, 0.12, 1.42, FRAME);
  f.on(0.1, 0.62, 0.3, 1.36, GLASS_IN);
  f.on(0.1, 0.62, 0.3, 0.36, mix(GLASS_IN, 0xffffff, 0.35));
  f.on(0.68, 0.9, 0.12, 1.36, DARK);
  f.on(0.785, 0.795, 0.12, 1.36, mix(DARK, 0xffffff, 0.2));
  // In the window: what it sells, a row of it on the sill.
  for (let k = 0; k < 4; k++) f.box(0.13 + k * 0.12, 0.19 + k * 0.12, 0, 0.05, 0.3, 0.3 + 0.12 * (1 + (k % 2)), mix(L.awning, 0xffffff, 0.35));
  // THE AWNING, striped where the look is, the length of the front.
  const stripes = L.stripe !== L.awning;
  const n = 6;
  for (let k = 0; k < n; k++) {
    const c = stripes && k % 2 ? L.stripe : L.awning;
    f.box(k / n, (k + 1) / n, 0, 0.2, 1.48, 1.6, c, tone(c, 1.08));
  }
  f.box(0, 1, 0.2, 0.22, 1.36, 1.6, L.awning);
  // THE SIGN over it: a board in the awning's colour, its lettering on it.
  f.box(0.04, 0.96, 0, 0.025, 1.68, 2.04, L.neon ? DARK : tone(L.awning, 0.8));
  letters(f, 0.14, 0.86, 1.78, 1.95, L.letters, fr.id);
  if (L.neon) {
    // A neon tube round the board.
    f.on(0.06, 0.94, 1.7, 1.72, L.letters);
    f.on(0.06, 0.94, 2.0, 2.02, L.letters);
  }
  if (L.cross) cross(f, 0.97, 1.05, L.awning);
  PAVEMENT[fr.sv]?.(f, L, fr);
}

/** What a shop puts on the pavement, or hangs out. */
const PAVEMENT: Partial<Record<ServiceId, (f: Face, L: ShopLook, fr: Front) => void>> = {
  // A table and two chairs.
  cafe: (f) => {
    f.box(0.26, 0.36, 0.1, 0.17, 0, 0.45, 0x9a7349);
    f.box(0.16, 0.22, 0.1, 0.16, 0, 0.3, 0x333a40);
    f.box(0.4, 0.46, 0.1, 0.16, 0, 0.3, 0x333a40);
  },
  // A menu board.
  takeaway: (f) => {
    f.box(0.46, 0.6, 0.13, 0.15, 0, 0.6, 0x2b2f33);
    f.box(0.48, 0.58, 0.15, 0.155, 0.32, 0.5, 0xf2efe6);
  },
  bakery: (f) => f.box(0.44, 0.6, 0.12, 0.16, 0, 0.6, 0x2b2f33),
  // A barrel by the door.
  bar: (f) => f.box(0.48, 0.6, 0.06, 0.16, 0, 0.42, 0x7a5232, 0x5e3f26),
  // A crate of bottles.
  kombucha: (f) => {
    f.box(0.4, 0.56, 0.06, 0.16, 0, 0.26, 0xb07a44);
    for (let k = 0; k < 3; k++) f.box(0.42 + k * 0.05, 0.45 + k * 0.05, 0.09, 0.12, 0.26, 0.44, 0xe58a2b);
  },
  // A tooth, hung out over the door.
  dentist: (f, L) => {
    f.box(0.96, 0.98, 0, 0.16, 1.02, 1.06, 0x9aa3ad);
    f.dot(0.97, 0.18, 1.05, 0.09, 0xffffff);
    f.dot(0.97, 0.18, 0.92, 0.05, mix(L.awning, 0xffffff, 0.6));
  },
  // A cabinet in the window, lit.
  arcade: (f, L) => f.on(0.2, 0.34, 0.3, 1.1, mix(L.letters, DARK, 0.4)),
};

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
      // The cabinet's screen, flickering through its colours.
      const k = Math.floor(t * 3) % 3;
      f.on(0.22, 0.32, 0.75, 1.0, [L.letters, 0xff5fa8, 0xf2e94e][k]);
      return;
    }
    // Steam off the cup on the table, the oven, the brew.
    const a = fr.sv === "cafe" ? 0.31 : 0.52;
    const [u, v] = fr.face === "v" ? [1 - WALL + (2 * WALL - 1) * a, WALL + 0.13] : [WALL + 0.13, 1 - WALL + (2 * WALL - 1) * a];
    steam(p, u, v, fr.sv === "cafe" ? 0.5 : 0.7, t);
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
