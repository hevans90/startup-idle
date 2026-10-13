/**
 * World v2 — every building a project draws, as a model: masses, skins and
 * roofs, its grounds and its fit-out. @see model
 *
 * IN THE TOWN'S OWN PALETTE. The houses are sprites — stone plinths, brick and
 * render walls, sky-blue glass in pale frames, and a parapet round every flat
 * roof — and these are drawn to stand beside them: the same colours where a
 * building is ordinary, its own where it is meant to be seen from across the
 * map. Colours are the face lit from the left; the pen shades the rest.
 */
import { mix, tone, type Pen } from "./pen";
import type { Building, Footprint, Mass } from "./model";

// The town's: measured off the house sprites.
const STONE = 0xc2beac;
const STONE_TOP = 0xd3cfbd;
const BRICK = 0xb05252;
const GLASS = 0x86b7c3;
const FRAME = 0xeeebe0;
const ROOF = 0x6f767d;

const WHITE = 0xffffff;
const DARK = 0x262b31;
const LEAF = 0x5c9a46;
const TRUNK = 0x6d4a2a;
const LAWN = 0x8cc46a;
const PAVING = 0xd9d3c0;
const GRAVEL = 0xd9cfb4;

/** The plinth most buildings stand on. */
const PLINTH = { inset: 0.06, h: 0.3, colour: STONE, top: PAVING };

/** A mass `inset` in from a footprint's edges, `z0` to `z1` up. */
const inside = (f: Footprint, inset: number | [number, number, number, number], z0: number, z1: number) => {
  const [a, b, c, d] = typeof inset === "number" ? [inset, inset, inset, inset] : inset;
  return { u0: a, v0: b, u1: f.w - c, v1: f.h - d, z0, z1 };
};

/** A door on a mass's lit face, centred at `a` along it. */
function door(p: Pen, m: Mass, a: number, w: number, h: number, colour = DARK, frame = FRAME) {
  p.onV(m.v1, a - w / 2 - 0.035, a + w / 2 + 0.035, m.z0, m.z0 + h + 0.05, frame);
  p.onV(m.v1, a - w / 2, a + w / 2, m.z0, m.z0 + h, colour);
  p.onV(m.v1, a - 0.006, a + 0.006, m.z0, m.z0 + h, mix(colour, WHITE, 0.25));
}

/** A canopy over a door: a slab standing out from the lit face. */
function canopy(p: Pen, m: Mass, a: number, w: number, z: number, colour: number) {
  p.box(a - w / 2, m.v1, a + w / 2, m.v1 + 0.26, z, z + 0.1, colour);
  for (const s of [-1, 1]) {
    const u = a + s * (w / 2 - 0.04);
    p.box(u - 0.018, m.v1 + 0.2, u + 0.018, m.v1 + 0.24, m.z0, z, tone(colour, 0.85));
  }
}

/** A tree: a trunk and a round crown, shadowed underneath and lit on top, `s` its size. */
export function tree(p: Pen, u: number, v: number, z: number, s = 1) {
  p.box(u - 0.035 * s, v - 0.035 * s, u + 0.035 * s, v + 0.035 * s, z, z + 0.9 * s, TRUNK);
  const c = z + 1.45 * s;
  p.dot(u, v, c - 0.12 * s, 0.27 * s, tone(LEAF, 0.72));
  p.dot(u, v, c, 0.25 * s, LEAF);
  p.dot(u - 0.07 * s, v - 0.02 * s, c + 0.18 * s, 0.15 * s, tone(LEAF, 1.18));
  p.dot(u - 0.1 * s, v - 0.03 * s, c + 0.28 * s, 0.07 * s, tone(LEAF, 1.32));
}

/** A planter with a shrub in it. */
function planter(p: Pen, u: number, v: number, z: number) {
  p.box(u - 0.08, v - 0.08, u + 0.08, v + 0.08, z, z + 0.2, STONE);
  p.box(u - 0.07, v - 0.07, u + 0.07, v + 0.07, z + 0.2, z + 0.42, LEAF, { top: tone(LEAF, 1.2) });
}

/** A rooftop air handler: a box with a fan on top. */
function plant(p: Pen, u: number, v: number, z: number, s = 1) {
  const c = 0xa9b0b6;
  p.box(u - 0.13 * s, v - 0.1 * s, u + 0.13 * s, v + 0.1 * s, z, z + 0.32 * s, c);
  p.dot(u, v, z + 0.32 * s, 0.06 * s, tone(c, 0.6));
}

/** A sign standing on a roof: a board on legs, `h` tall, its face lit. */
function roofSign(p: Pen, u0: number, u1: number, v: number, z: number, h: number, board: number, face: number) {
  for (const u of [u0 + 0.08, u1 - 0.08]) p.box(u - 0.02, v - 0.02, u + 0.02, v + 0.02, z, z + h * 0.35, 0x4a525b);
  p.box(u0, v - 0.03, u1, v + 0.03, z + h * 0.35, z + h, board);
  p.onV(v + 0.03, u0 + 0.06, u1 - 0.06, z + h * 0.48, z + h * 0.62, face);
  p.onV(v + 0.03, u0 + 0.06, u1 - 0.12, z + h * 0.72, z + h * 0.86, face);
}

/** A flag on a pole at a point, flying toward +u. */
function flag(p: Pen, u: number, v: number, z: number, h: number, colour: number) {
  p.box(u - 0.018, v - 0.018, u + 0.018, v + 0.018, z, z + h, 0xd8dde3);
  p.onV(v + 0.005, u + 0.02, u + 0.36, z + h - 0.55, z + h - 0.08, colour);
}

/** Grounds paved edge to edge, with planters at the front corners. */
function paved(p: Pen, f: Footprint) {
  p.flat(0.02, 0.02, f.w - 0.02, f.h - 0.02, 0.004, PAVING);
}

// ─── THE BUILDINGS ──────────────────────────────────────────────────────────

/** FOUNDER'S GARAGE: a breeze-block box with a roller door and a hand-painted sign. */
export function garage(f: Footprint): Building {
  const BLOCK = 0xd8d2c4;
  const m: Mass = {
    ...inside(f, [0.16, 0.14, 0.16, 0.2], 0.15, 2.5), wall: BLOCK, storey: 2.35,
    facade: { kind: "plain", lines: tone(BLOCK, 0.88), every: 0.38 },
    roof: { kind: "parapet", deck: 0x50565d, rim: 0x8f8a80, h: 0.16, t: 0.06 },
  };
  return {
    plinth: { inset: 0.05, h: 0.15, colour: 0xa7a39b, top: 0xb9b5ab },
    masses: [m],
    crane: "none",
    grounds: (p) => {
      // A concrete apron in front of the door, and an oil stain on it.
      p.flat(0.1, m.v1, f.w - 0.1, f.h - 0.02, 0.004, 0xb9b5ab);
      p.flat(f.w / 2 - 0.2, m.v1 + 0.05, f.w / 2 + 0.1, m.v1 + 0.16, 0.006, 0x8f8a80);
    },
    details: (p) => {
      const mid = (m.u0 + m.u1) / 2, dw = Math.min(1.1, (m.u1 - m.u0) - 0.5);
      // The roller door, ribbed, in its frame.
      p.onV(m.v1, mid - dw / 2 - 0.05, mid + dw / 2 + 0.05, m.z0, m.z0 + 1.65, 0x8a9198);
      p.onV(m.v1, mid - dw / 2, mid + dw / 2, m.z0, m.z0 + 1.6, 0xa3abb3);
      for (let z = m.z0 + 0.15; z < m.z0 + 1.55; z += 0.16) p.onV(m.v1, mid - dw / 2, mid + dw / 2, z, z + 0.03, 0x858d95);
      // The sign over it, painted on a board.
      p.box(mid - dw / 2, m.v1, mid + dw / 2, m.v1 + 0.03, m.z0 + 1.78, m.z0 + 2.15, 0x2f6d4f);
      p.onV(m.v1 + 0.03, mid - dw / 2 + 0.1, mid + dw / 2 - 0.25, m.z0 + 1.9, m.z0 + 2.02, 0xf3eed8);
      // A window and a side door on the other face.
      if (m.v1 - m.v0 > 0.5) p.onU(m.u1, m.v0 + 0.2, m.v1 - 0.25, m.z0 + 0.9, m.z0 + 1.5, tone(GLASS, 0.76));
      // A vent on the roof, and a bin by the door.
      p.box(m.u0 + 0.25, m.v0 + 0.15, m.u0 + 0.4, m.v0 + 0.3, m.z1, m.z1 + 0.35, 0x9aa3ab);
      p.box(m.u1 - 0.18, m.v1 + 0.06, m.u1 - 0.04, m.v1 + 0.18, 0, 0.42, 0x3f6b4a);
    },
  };
}

/** VIBE CODER STUDIO: two floors of glass on a stone plinth, a neon sign on the roof. */
export function studio(f: Footprint): Building {
  const m: Mass = {
    ...inside(f, 0.22, PLINTH.h, PLINTH.h + 3.6), wall: 0xeceae2, storey: 1.8,
    facade: { kind: "curtain", glass: GLASS, mullion: 0xf4f3ee, every: 0.34, spandrel: 0xe2dfd4 },
    roof: { kind: "parapet", deck: ROOF, rim: 0xeceae2, h: 0.24 },
  };
  return {
    plinth: PLINTH, masses: [m], crane: "tower",
    grounds: paved,
    details: (p) => {
      const mid = (m.u0 + m.u1) / 2;
      door(p, m, mid, 0.42, 1.2, 0x2c3e48);
      canopy(p, m, mid, 0.8, m.z0 + 1.35, 0xf4f3ee);
      planter(p, mid - 0.62, m.v1 + 0.16, PLINTH.h);
      planter(p, mid + 0.62, m.v1 + 0.16, PLINTH.h);
      plant(p, m.u0 + 0.4, m.v0 + 0.35, m.z1);
      plant(p, m.u0 + 0.8, m.v0 + 0.35, m.z1);
      // THE NEON, pink, standing on the roof.
      roofSign(p, m.u1 - 1.0, m.u1 - 0.15, m.v1 - 0.35, m.z1, 1.2, 0x8c2459, 0xff6fb7);
    },
  };
}

/** COMPANY HQ: a podium of dark glass, a tower of pale glass stepped back on it, a lit sign and a mast. */
export function hq(f: Footprint): Building {
  const podium: Mass = {
    ...inside(f, 0.16, PLINTH.h, PLINTH.h + 3.4), wall: 0x3a4048, storey: 1.7,
    facade: { kind: "curtain", glass: 0x4f7d92, mullion: 0x2e3a42, every: 0.3 },
    roof: { kind: "parapet", deck: 0x5a626b, rim: 0x3a4048, h: 0.18 },
  };
  const tz = podium.z1;
  const tower: Mass = {
    ...inside(f, 0.68, tz, tz + 11.2), wall: 0xd9e3e8, storey: 1.6,
    facade: { kind: "curtain", glass: 0x8fb7cf, mullion: 0xe8f0f2, every: 0.27, spandrel: 0x6f93a8 },
    roof: { kind: "parapet", deck: ROOF, rim: 0xd9e3e8, h: 0.3 },
  };
  return {
    plinth: PLINTH, masses: [podium, tower], crane: "tower",
    grounds: paved,
    details: (p) => {
      const mid = (podium.u0 + podium.u1) / 2;
      door(p, podium, mid, 0.5, 1.25, 0x1e2a31);
      canopy(p, podium, mid, 1.0, podium.z0 + 1.45, 0xd9dde2);
      planter(p, podium.u0 + 0.3, podium.v1 + 0.2, PLINTH.h);
      planter(p, podium.u1 - 0.3, podium.v1 + 0.2, PLINTH.h);
      // The company's name across the top, gold, and a mast over the roof.
      p.box(tower.u0 + 0.12, tower.v1, tower.u1 - 0.12, tower.v1 + 0.04, tower.z1 - 1.0, tower.z1 - 0.2, 0xb97f17);
      p.onV(tower.v1 + 0.04, tower.u0 + 0.22, tower.u1 - 0.22, tower.z1 - 0.75, tower.z1 - 0.45, 0xfff1c9);
      plant(p, tower.u0 + 0.35, tower.v0 + 0.35, tower.z1, 1.2);
      const cu = (tower.u0 + tower.u1) / 2 + 0.2, cv = (tower.v0 + tower.v1) / 2;
      p.box(cu - 0.03, cv - 0.03, cu + 0.03, cv + 0.03, tower.z1, tower.z1 + 2.6, 0x9aa3ab);
      p.dot(cu, cv, tower.z1 + 2.65, 0.035, 0xff5a4f);
    },
  };
}

/** BOARDROOM TOWER: slim and tall, bronze glass ribbed in gold, on a stone podium, with a crown and a spire. */
export function boardroom(f: Footprint): Building {
  const podium: Mass = {
    ...inside(f, 0.24, PLINTH.h, PLINTH.h + 2.2), wall: STONE, storey: 2.2,
    facade: { kind: "windows", glass: 0x4f6470, frame: 0xa59c89, w: 0.22, gap: 0.16, sill: 0.35, head: 0.4 },
    roof: { kind: "parapet", deck: 0x8f897b, rim: STONE_TOP, h: 0.2 },
    cornice: { colour: STONE_TOP, h: 0.18, out: 0.04 },
  };
  const tz = podium.z1;
  const tower: Mass = {
    ...inside(f, 0.78, tz, tz + 16.8), wall: 0x6b6258, storey: 1.6,
    facade: { kind: "fins", glass: 0x4f4840, fin: 0xd8b04a, every: 0.2 },
    roof: { kind: "flat", deck: 0x3a352f },
    cornice: { colour: 0xd8b04a, h: 0.45, out: 0.03 },
  };
  const crown: Mass = {
    u0: tower.u0 + 0.22, v0: tower.v0 + 0.22, u1: tower.u1 - 0.22, v1: tower.v1 - 0.22, z0: tower.z1, z1: tower.z1 + 1.0,
    wall: 0x6b6258, storey: 1, facade: { kind: "fins", glass: 0x3a352f, fin: 0xd8b04a, every: 0.12 },
    roof: { kind: "flat", deck: 0xd8b04a },
  };
  return {
    plinth: PLINTH, masses: [podium, tower, crown], crane: "tower",
    grounds: paved,
    details: (p) => {
      const mid = (podium.u0 + podium.u1) / 2;
      door(p, podium, mid, 0.42, 1.4, 0x2a2622, 0xd8b04a);
      const cu = (crown.u0 + crown.u1) / 2, cv = (crown.v0 + crown.v1) / 2;
      p.box(cu - 0.035, cv - 0.035, cu + 0.035, cv + 0.035, crown.z1, crown.z1 + 3, 0xd8b04a);
      p.box(cu - 0.015, cv - 0.015, cu + 0.015, cv + 0.015, crown.z1 + 3, crown.z1 + 4, 0xe8c86a);
    },
  };
}

/** CAMPUS: low and white, a long block across the back and a wing down one side, roof gardens and a courtyard. */
export function campus(f: Footprint): Building {
  const split = Math.max(1.2, f.w * 0.55), mid = Math.max(1, f.h * 0.48);
  const back: Mass = {
    u0: 0.2, v0: 0.2, u1: f.w - 0.2, v1: mid, z0: PLINTH.h, z1: PLINTH.h + 4.2, wall: 0xeeeee8, storey: 2.1,
    facade: { kind: "ribbon", glass: 0x6c9fb8, frame: 0xd8d8d0, sill: 0.55, head: 0.35 },
    roof: { kind: "garden", deck: 0x7fae5c, rim: 0xeeeee8 },
  };
  const wing: Mass = {
    u0: split, v0: mid, u1: f.w - 0.2, v1: f.h - 0.2, z0: PLINTH.h, z1: PLINTH.h + 2.1, wall: 0xeeeee8, storey: 2.1,
    facade: { kind: "ribbon", glass: 0x6c9fb8, frame: 0xd8d8d0, sill: 0.55, head: 0.35 },
    roof: { kind: "garden", deck: 0x7fae5c, rim: 0xeeeee8 },
  };
  return {
    plinth: { ...PLINTH, inset: 0.08 }, masses: [back, wing], crane: "tower",
    grounds: (p) => p.flat(0.02, 0.02, f.w - 0.02, f.h - 0.02, 0.004, PAVING),
    details: (p) => {
      // THE COURTYARD in the corner the two make: lawn, a path, trees, a bench.
      const z = PLINTH.h + 0.01;
      p.flat(0.2, mid, split, f.h - 0.2, z, LAWN);
      p.flat(0.2, mid + (f.h - 0.2 - mid) / 2 - 0.08, split, mid + (f.h - 0.2 - mid) / 2 + 0.08, z + 0.004, GRAVEL);
      door(p, back, (0.2 + split) / 2, 0.4, 1.2, 0x2c3e48);
      tree(p, 0.6, mid + 0.55, z, 0.9);
      tree(p, split - 0.45, f.h - 0.55, z, 1);
      tree(p, 0.55, f.h - 0.5, z, 0.8);
      p.box(split - 0.7, mid + 0.4, split - 0.3, mid + 0.5, z, z + 0.3, 0x9a7349);
    },
  };
}

/** TOWN HALL: pale stone on steps, columns across the front under a frieze, and a clock tower. */
export function townhall(f: Footprint): Building {
  const HALL = 0xe6dfcf;
  const body: Mass = {
    ...inside(f, [0.3, 0.3, 0.3, 0.6], 0.45, 3.1), wall: HALL, storey: 2.65,
    facade: { kind: "windows", glass: 0x6c8f9e, frame: 0xf4efe2, w: 0.2, gap: 0.22, sill: 0.45, head: 0.6 },
    roof: { kind: "parapet", deck: 0x5b6670, rim: STONE_TOP, h: 0.2 },
    cornice: { colour: STONE_TOP, h: 0.2, out: 0.05 },
  };
  const cu = (body.u0 + body.u1) / 2, cv = (body.v0 + body.v1) / 2;
  const tower: Mass = {
    u0: cu - 0.22, v0: cv - 0.22, u1: cu + 0.22, v1: cv + 0.22, z0: body.z1, z1: body.z1 + 1.9, wall: HALL, storey: 1.9,
    facade: { kind: "plain" }, roof: { kind: "flat", deck: 0x5b6670 },
    cornice: { colour: STONE_TOP, h: 0.15, out: 0.04 },
  };
  return {
    plinth: { inset: 0.06, h: 0.25, colour: STONE, top: STONE_TOP },
    masses: [body, tower], crane: "tower",
    grounds: paved,
    details: (p) => {
      // A second step, then the portico: columns and the frieze over them.
      p.box(0.2, body.v1, f.w - 0.2, f.h - 0.16, 0.25, 0.45, STONE, { top: STONE_TOP });
      for (let u = body.u0 + 0.12; u < body.u1 - 0.05; u += 0.32) {
        p.box(u - 0.05, body.v1 + 0.12, u + 0.05, body.v1 + 0.22, 0.45, body.z1 - 0.35, 0xf4efe2);
      }
      p.box(body.u0 - 0.04, body.v1, body.u1 + 0.04, body.v1 + 0.28, body.z1 - 0.4, body.z1, STONE_TOP);
      p.onV(body.v1 + 0.28, body.u0 + 0.3, body.u1 - 0.3, body.z1 - 0.28, body.z1 - 0.12, 0x5b6670);
      door(p, body, cu, 0.36, 1.3, 0x4a3828, 0xd8b04a);
      // The clock, on both faces, and a cap on the tower.
      p.onV(tower.v1, cu - 0.12, cu + 0.12, tower.z0 + 0.95, tower.z0 + 1.45, 0xf4f0e2);
      p.onV(tower.v1, cu - 0.01, cu + 0.01, tower.z0 + 1.15, tower.z0 + 1.4, DARK);
      p.onU(tower.u1, cv - 0.12, cv + 0.12, tower.z0 + 0.95, tower.z0 + 1.45, tone(0xf4f0e2, 0.76));
      p.box(tower.u0 + 0.06, tower.v0 + 0.06, tower.u1 - 0.06, tower.v1 - 0.06, tower.z1, tower.z1 + 0.5, 0x4f7a6b);
      p.box(tower.u0 + 0.14, tower.v0 + 0.14, tower.u1 - 0.14, tower.v1 - 0.14, tower.z1 + 0.5, tower.z1 + 0.85, 0x4f7a6b);
      flag(p, tower.u0 + 0.22, tower.v0 + 0.22, tower.z1 + 0.85, 1.1, 0x2e6fb5);
    },
  };
}

/** HARBOUR OFFICE: red brick, two floors, white trim, and a flagpole by the door. */
export function harbour(f: Footprint): Building {
  const m: Mass = {
    ...inside(f, [0.22, 0.22, 0.4, 0.3], PLINTH.h, PLINTH.h + 3.6), wall: BRICK, storey: 1.8,
    facade: { kind: "windows", glass: GLASS, frame: FRAME, w: 0.18, gap: 0.18, sill: 0.4, head: 0.45 },
    roof: { kind: "parapet", deck: 0x3d4a57, rim: FRAME, h: 0.2 },
    cornice: { colour: FRAME, h: 0.16, out: 0.04 },
  };
  return {
    plinth: PLINTH, masses: [m], crane: "tower",
    grounds: paved,
    details: (p) => {
      door(p, m, (m.u0 + m.u1) / 2, 0.32, 1.2, 0x23415e);
      p.box(m.u0, m.v0, m.u1, m.v1, m.z0 + 1.75, m.z0 + 1.85, FRAME, { noTop: true });
      flag(p, f.w - 0.2, f.h - 0.22, PLINTH.h, 3.4, 0x2e6fb5);
      // A lifebuoy on the wall.
      p.dot(m.u0 + 0.25, m.v1 + 0.01, m.z0 + 1.1, 0.07, 0xf26b3a);
    },
  };
}

/** DATA CENTRE: long, low and windowless, louvred, cooling on the roof and status lights down its face. */
export function datacentre(f: Footprint): Building {
  const m: Mass = {
    ...inside(f, 0.2, PLINTH.h, PLINTH.h + 3), wall: 0x50565d, storey: 3,
    facade: { kind: "louvres", slat: 0x7b838b, every: 0.18 },
    roof: { kind: "parapet", deck: 0x2e3236, rim: 0x50565d, h: 0.18 },
  };
  return {
    plinth: { ...PLINTH, colour: 0x8f949a, top: 0xa9aeb4 }, masses: [m], crane: "tower",
    grounds: (p) => p.flat(0.02, 0.02, f.w - 0.02, f.h - 0.02, 0.004, 0xa9aeb4),
    details: (p) => {
      // Status lights in a strip along both faces, under the louvres.
      for (let a = m.u0 + 0.2; a < m.u1 - 0.1; a += 0.14) p.onV(m.v1, a, a + 0.05, m.z0 + 0.12, m.z0 + 0.19, 0x3fe0a8);
      for (let b = m.v0 + 0.2; b < m.v1 - 0.1; b += 0.14) p.onU(m.u1, b, b + 0.05, m.z0 + 0.12, m.z0 + 0.19, 0x3fe0a8);
      door(p, m, m.u0 + 0.45, 0.32, 1.1, 0x2e3236, 0x7b838b);
      // Cooling units in rows across the roof, a fan in each.
      for (let u = m.u0 + 0.35; u < m.u1 - 0.25; u += 0.55) {
        for (let v = m.v0 + 0.35; v < m.v1 - 0.25; v += 0.55) {
          p.box(u - 0.2, v - 0.2, u + 0.2, v + 0.2, m.z1, m.z1 + 0.42, 0x9aa3ad);
          p.dot(u, v, m.z1 + 0.42, 0.13, 0x5b636c);
          p.dot(u, v, m.z1 + 0.42, 0.04, 0x9aa3ad);
        }
      }
    },
  };
}

/** CONFERENCE CENTRE: a wide glass hall under a stepped vault, banners down its front. */
export function conference(f: Footprint): Building {
  const m: Mass = {
    ...inside(f, 0.22, PLINTH.h, PLINTH.h + 3.4), wall: 0xe8e4da, storey: 3.4,
    facade: { kind: "curtain", glass: GLASS, mullion: 0xf4f3ee, every: 0.4, spandrel: 0xe8e4da },
    roof: { kind: "flat", deck: 0xe8e4da },
    cornice: { colour: 0xf2efe6, h: 0.3, out: 0.06 },
  };
  const vault = (k: number): Mass => ({
    u0: m.u0 + 0.35 * k, v0: m.v0 + 0.35 * k, u1: m.u1 - 0.35 * k, v1: m.v1 - 0.35 * k,
    z0: m.z1 + (k - 1) * 0.32, z1: m.z1 + k * 0.32, wall: 0xe8e4da, storey: 1,
    facade: { kind: "plain" }, roof: { kind: "flat", deck: tone(0xe8e4da, 1.04) },
  });
  return {
    plinth: PLINTH, masses: [m, vault(1), vault(2), vault(3)], crane: "tower",
    grounds: paved,
    details: (p) => {
      const mid = (m.u0 + m.u1) / 2;
      canopy(p, m, mid, 1.4, m.z0 + 1.5, 0xf2efe6);
      door(p, m, mid - 0.3, 0.36, 1.3, 0x2c3e48);
      door(p, m, mid + 0.3, 0.36, 1.3, 0x2c3e48);
      // Banners down the front, in turn.
      let k = 0;
      for (let u = m.u0 + 0.3; u < m.u1 - 0.15; u += 0.55, k++) {
        if (Math.abs(u - mid) < 0.8) continue;
        p.onV(m.v1 + 0.01, u - 0.09, u + 0.09, m.z0 + 1.2, m.z1 - 0.35, k % 2 ? 0xff4fa3 : 0x2e6fb5);
      }
      for (let v = m.v0 + 0.3; v < m.v1 - 0.15; v += 0.55, k++) {
        p.onU(m.u1 + 0.01, v - 0.09, v + 0.09, m.z0 + 1.2, m.z1 - 0.35, tone(k % 2 ? 0xff4fa3 : 0x2e6fb5, 0.76));
      }
    },
  };
}

/** IPO TOWER: very tall, gold glass, a stock ticker round it near the top and a beacon on the roof. */
export function ipo(f: Footprint): Building {
  const lobby: Mass = {
    ...inside(f, 0.24, PLINTH.h, PLINTH.h + 2.2), wall: 0x2c3a44, storey: 2.2,
    facade: { kind: "curtain", glass: 0x3f6273, mullion: 0xd8b04a, every: 0.32 },
    roof: { kind: "flat", deck: 0x2c3a44 },
  };
  const tower: Mass = {
    ...inside(f, 0.55, lobby.z1, lobby.z1 + 22), wall: 0xd8b04a, storey: 2,
    facade: { kind: "curtain", glass: 0xe0bb55, mullion: 0xfff1b8, every: 0.25, spandrel: 0xb9922f },
    roof: { kind: "parapet", deck: 0x8a6d2a, rim: 0xd8b04a, h: 0.4 },
  };
  return {
    plinth: PLINTH, masses: [lobby, tower], crane: "tower",
    grounds: paved,
    details: (p) => {
      door(p, lobby, (lobby.u0 + lobby.u1) / 2, 0.5, 1.4, 0x15181c, 0xd8b04a);
      // The ticker: a dark band round the top, green figures on it.
      const z = tower.z1 - 2.6;
      p.box(tower.u0 - 0.03, tower.v0 - 0.03, tower.u1 + 0.03, tower.v1 + 0.03, z, z + 0.6, 0x15181c, { noTop: true });
      for (let a = tower.u0 + 0.08; a < tower.u1 - 0.1; a += 0.2) p.onV(tower.v1 + 0.03, a, a + 0.12, z + 0.22, z + 0.38, 0x3fe07a);
      for (let b = tower.v0 + 0.08; b < tower.v1 - 0.1; b += 0.2) p.onU(tower.u1 + 0.03, b, b + 0.12, z + 0.22, z + 0.38, tone(0x3fe07a, 0.85));
      // The beacon.
      const cu = (tower.u0 + tower.u1) / 2, cv = (tower.v0 + tower.v1) / 2;
      p.box(cu - 0.04, cv - 0.04, cu + 0.04, cv + 0.04, tower.z1, tower.z1 + 2.4, 0xa9852c);
      p.box(cu - 0.07, cv - 0.07, cu + 0.07, cv + 0.07, tower.z1 + 2.4, tower.z1 + 2.6, 0xff5a4f);
    },
  };
}

/** THE CAFÉ: a little brick shop, a striped awning over its window, a table out front. */
export function cafe(f: Footprint): Building {
  const m: Mass = {
    u0: 0.22, v0: 0.12, u1: f.w - 0.18, v1: f.h - 0.42, z0: 0.12, z1: 2.3, wall: 0xb46a4c, storey: 2.18,
    facade: { kind: "plain" },
    ground: { kind: "ribbon", glass: GLASS, frame: FRAME, sill: 0.25, head: 0.85, edge: 0.15 },
    roof: { kind: "parapet", deck: 0x4b3a33, rim: 0xe9e2d0, h: 0.16 },
    cornice: { colour: 0xe9e2d0, h: 0.12, out: 0.03 },
  };
  return {
    plinth: { inset: 0.04, h: 0.12, colour: STONE, top: PAVING }, masses: [m], crane: "none",
    grounds: paved,
    details: (p) => {
      // The awning, striped, over the window.
      let k = 0;
      for (let u = m.u0; u < m.u1 - 1e-6; u += 0.2, k++) {
        p.box(u, m.v1, Math.min(m.u1, u + 0.2), m.v1 + 0.24, 1.3, 1.45, k % 2 ? 0xf2efe6 : 0x2f8f6b);
      }
      p.box(m.u0 + 0.3, m.v1, m.u1 - 0.3, m.v1 + 0.03, 1.65, 1.95, 0x2f8f6b);
      p.onV(m.v1 + 0.03, m.u0 + 0.4, m.u1 - 0.5, 1.75, 1.85, 0xf2efe6);
      // A table and two chairs, and a menu board.
      const tu = m.u0 + 0.35, tv = f.h - 0.2;
      p.box(tu - 0.07, tv - 0.07, tu + 0.07, tv + 0.07, 0.12, 0.45, 0x9a7349);
      for (const du of [-0.17, 0.17]) p.box(tu + du - 0.045, tv - 0.045, tu + du + 0.045, tv + 0.045, 0.12, 0.32, 0x333a40);
      p.box(m.u1 - 0.25, f.h - 0.25, m.u1 - 0.15, f.h - 0.2, 0.12, 0.6, 0x2b2f33);
    },
  };
}

/** THE PARK: lawn, gravel paths crossing it, trees in three quarters and a bench and fountain in the fourth. */
export function park(f: Footprint): Building {
  return {
    plinth: { inset: 0, h: 0, colour: LAWN }, masses: [], crane: "none",
    grounds: (p) => {
      p.flat(0.04, 0.04, f.w - 0.04, f.h - 0.04, 0.03, LAWN);
      const mu = f.w / 2, mv = f.h / 2;
      p.flat(0.04, mv - 0.1, f.w - 0.04, mv + 0.1, 0.034, GRAVEL);
      p.flat(mu - 0.1, 0.04, mu + 0.1, f.h - 0.04, 0.034, GRAVEL);
      // A hedge along the back.
      p.box(0.06, 0.06, f.w - 0.06, 0.18, 0.03, 0.42, tone(LEAF, 0.9), { top: tone(LEAF, 1.1) });
      p.box(0.06, 0.18, 0.18, f.h - 0.06, 0.03, 0.42, tone(LEAF, 0.9), { top: tone(LEAF, 1.1) });
    },
    details: (p) => {
      const mu = f.w / 2, mv = f.h / 2;
      // The fountain where the paths cross.
      p.box(mu - 0.28, mv - 0.28, mu + 0.28, mv + 0.28, 0.03, 0.2, STONE, { top: 0x7fb6c9 });
      p.box(mu - 0.05, mv - 0.05, mu + 0.05, mv + 0.05, 0.2, 0.55, STONE);
      p.dot(mu, mv, 0.6, 0.06, 0xcfe8f0);
      tree(p, mu * 0.5, mv * 0.5, 0.03);
      tree(p, mu * 1.5, mv * 0.5, 0.03, 0.9);
      tree(p, mu * 0.5, mv * 1.5, 0.03, 1.05);
      const bu = mu * 1.5, bv = mv * 1.5;
      p.box(bu - 0.24, bv - 0.06, bu + 0.24, bv + 0.06, 0.03, 0.3, 0x9a7349);
      p.box(bu - 0.24, bv - 0.08, bu + 0.24, bv - 0.04, 0.3, 0.5, 0x9a7349);
    },
  };
}

/** THE GYM: a grey shed with tall windows and a dumbbell on the roof. */
export function gym(f: Footprint): Building {
  const m: Mass = {
    ...inside(f, 0.2, PLINTH.h, PLINTH.h + 2.6), wall: 0x9aa3ad, storey: 2.6,
    facade: { kind: "windows", glass: GLASS, frame: 0x7a838c, w: 0.14, gap: 0.2, sill: 0.35, head: 0.4 },
    roof: { kind: "parapet", deck: 0x4b5259, rim: 0x7a838c, h: 0.18 },
  };
  return {
    plinth: PLINTH, masses: [m], crane: "none",
    grounds: paved,
    details: (p) => {
      door(p, m, m.u0 + 0.4, 0.34, 1.2, DARK, 0xf2b43c);
      const mu = (m.u0 + m.u1) / 2, mv = (m.v0 + m.v1) / 2, z = m.z1;
      p.box(mu - 0.02, mv - 0.02, mu + 0.02, mv + 0.02, z, z + 0.8, 0x26292d);
      p.box(mu - 0.38, mv - 0.03, mu + 0.38, mv + 0.03, z + 0.8, z + 0.88, 0x9aa3ad);
      for (const du of [-0.32, 0.32]) p.box(mu + du - 0.05, mv - 0.14, mu + du + 0.05, mv + 0.14, z + 0.6, z + 1.08, 0x26292d);
      p.box(m.u0 + 0.1, m.v1, m.u1 - 0.1, m.v1 + 0.03, m.z1 - 0.5, m.z1 - 0.15, 0xf2b43c);
    },
  };
}

/** AN R&D LAB: a white block, a band of glass, and a dish on the roof. */
export function lab(f: Footprint): Building {
  const m: Mass = {
    ...inside(f, 0.2, PLINTH.h, PLINTH.h + 2.3), wall: 0xe9ecef, storey: 2.3,
    facade: { kind: "ribbon", glass: 0x6c9fb8, frame: 0xc3c9cf, sill: 0.7, head: 0.6 },
    roof: { kind: "parapet", deck: 0x6b7680, rim: 0xe9ecef, h: 0.18 },
  };
  return {
    plinth: PLINTH, masses: [m], crane: "none",
    grounds: paved,
    details: (p) => {
      door(p, m, m.u1 - 0.4, 0.3, 1.1, 0x2c3e48);
      const mu = m.u0 + 0.45, mv = m.v0 + 0.45;
      p.box(mu - 0.03, mv - 0.03, mu + 0.03, mv + 0.03, m.z1, m.z1 + 0.6, 0xa9b0b6);
      p.box(mu - 0.24, mv - 0.24, mu + 0.24, mv + 0.24, m.z1 + 0.6, m.z1 + 0.72, 0xdfe3e6);
      p.dot(mu, mv, m.z1 + 0.85, 0.03, 0xff5a4f);
      plant(p, m.u1 - 0.4, m.v0 + 0.35, m.z1);
    },
  };
}

/** A FLOOD WALL: a tile of concrete, a band of sandbags along its top. */
export function levee(f: Footprint): Building {
  const m: Mass = {
    u0: 0, v0: 0, u1: f.w, v1: f.h, z0: 0, z1: 1.3, wall: 0xa8a294, storey: 1.3,
    facade: { kind: "plain", lines: 0x958f82, every: 0.43 },
    roof: { kind: "flat", deck: 0xc9c4b8 },
  };
  return {
    plinth: { inset: 0, h: 0, colour: STONE }, masses: [m], crane: "none",
    details: (p) => {
      for (let u = 0.12; u < f.w - 0.1; u += 0.26) {
        p.box(u, 0.18, u + 0.22, f.h - 0.18, 1.3, 1.5, 0xb59a62, { top: 0xc8ae74 });
      }
    },
  };
}

/** A DERELICT BUILDING: grimy walls, boarded windows, its roof fallen in at a corner. */
export function derelict(f: Footprint): Building {
  const m: Mass = {
    ...inside(f, 0.15, 0, 2.2), wall: 0x8a8478, storey: 2.2,
    facade: { kind: "windows", glass: 0x2b2622, frame: 0x6f6a60, w: 0.22, gap: 0.3, sill: 0.6, head: 0.6 },
    roof: { kind: "parapet", deck: 0x58534b, rim: 0x6f6a60, h: 0.14 },
  };
  return {
    plinth: { inset: 0, h: 0, colour: STONE }, masses: [m], crane: "none",
    details: (p) => {
      // Boards nailed across the windows.
      for (const [a0, a1] of [[0.4, 0.66], [1.0, 1.26]]) {
        p.strut([m.u0 + a0, m.v1 + 0.01, 1.0], [m.u0 + a1, m.v1 + 0.01, 1.5], 0.05, 0x7a5a3a);
        p.strut([m.u1 + 0.01, m.v0 + a0, 1.0], [m.u1 + 0.01, m.v0 + a1, 1.5], 0.05, tone(0x7a5a3a, 0.76));
      }
      // The hole in the roof.
      p.flat(m.u0 + 0.1, m.v0 + 0.1, m.u0 + 0.75, m.v0 + 0.6, m.z1 + 0.005, 0x2b2622);
      p.flat(m.u0 + 0.1, m.v0 + 0.1, m.u0 + 0.75, m.v0 + 0.2, m.z1 + 0.006, 0x1d1a17);
      // Weeds at its foot.
      for (const u of [m.u0 + 0.3, m.u1 - 0.5]) p.box(u - 0.06, m.v1 + 0.02, u + 0.06, m.v1 + 0.12, 0, 0.25, 0x6b7a3e);
    },
  };
}

/** AN AI RACK: a dark server house, rows of status lights down its faces, cooling on the roof. */
export function rack(f: Footprint): Building {
  const m: Mass = {
    ...inside(f, 0.16, 0.15, 2.2), wall: 0x2b3038, storey: 2.05,
    facade: { kind: "louvres", slat: 0x3f4752, every: 0.16, edge: 0.1 },
    roof: { kind: "parapet", deck: 0x1f2328, rim: 0x3f4752, h: 0.14 },
  };
  return {
    plinth: { inset: 0.05, h: 0.15, colour: 0x8f949a, top: 0xa9aeb4 }, masses: [m], crane: "none",
    grounds: (p) => p.flat(0.02, 0.02, f.w - 0.02, f.h - 0.02, 0.004, 0xa9aeb4),
    details: (p) => {
      // Status lights in three rows on both faces, blue and the odd green.
      for (const [k, z] of [0.7, 1.1, 1.5].entries()) {
        for (let a = m.u0 + 0.1; a < m.u1 - 0.06; a += 0.09) {
          const c = (Math.round(a * 100) + k) % 5 === 0 ? 0x3fe0a8 : 0x6c9cff;
          p.onV(m.v1, a, a + 0.035, z, z + 0.045, c);
        }
        for (let b = m.v0 + 0.1; b < m.v1 - 0.06; b += 0.09) {
          const c = (Math.round(b * 100) + k) % 5 === 0 ? 0x3fe0a8 : 0x6c9cff;
          p.onU(m.u1, b, b + 0.035, z, z + 0.045, tone(c, 0.85));
        }
      }
      door(p, m, m.u0 + 0.25, 0.2, 0.9, 0x15181c, 0x3f4752);
      // Cooling on the roof, and the power line in.
      p.box(m.u0 + 0.15, m.v0 + 0.15, m.u1 - 0.15, m.v1 - 0.25, m.z1, m.z1 + 0.35, 0x9aa3ad);
      p.dot((m.u0 + m.u1) / 2, (m.v0 + m.v1) / 2 - 0.05, m.z1 + 0.35, 0.12, 0x5b636c);
      p.box(m.u1 - 0.12, m.v1, m.u1 - 0.04, m.v1 + 0.06, 0.15, 0.6, 0xf2c230);
    },
  };
}

/** Each building by the structure it is drawn for. */
export const LOOKS: Record<string, (f: Footprint) => Building> = {
  garage, studio, hq, boardroom, campus, townhall, harbour, datacentre, conference, ipo,
  // Offices, drawn as the buildings that first opened their kind of work.
  "office-intern": garage, "office-vibe": studio, "office-10x": hq,
  cafe, park, gym, lab, levee, derelict, rack,
};

/** The building a structure is drawn as. */
export const lookOf = (def: string, f: Footprint): Building => (LOOKS[def] ?? studio)(f);
