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
import type { Building, FaceAt, Footprint, Live, Mass, Trace } from "./model";
import { drawLiveBase, traceOf } from "./ai-live";
import { latticeForm } from "../../../game/quests/finale";

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
    // ON ITS LANDMARK'S PLOT, a two-tile box at the back, a yard in front. @see LANDMARKS
    ...inside(f, [0.16, Math.max(0.14, f.h - 1.9), Math.max(0.16, f.w - 2.16), f.h > 1 ? 0.8 : 0.2], 0.15, 2.5), wall: BLOCK, storey: 2.35,
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
    // Three tiles of it at the back of the Campus's plot, the rest paved. @see LANDMARKS
    ...inside(f, [0.22, Math.max(0.22, f.h - 2.4), Math.max(0.22, f.w - 3.22), 0.5], PLINTH.h, PLINTH.h + 3.6), wall: 0xeceae2, storey: 1.8,
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

/** TALENT AGENCY: a glass slab in the recruiter's teal on a dark base, a big HIRING board on the roof, a queue's worth of planters. */
export function agency(f: Footprint): Building {
  const base: Mass = {
    ...inside(f, 0.18, PLINTH.h, PLINTH.h + 2.0), wall: 0x2b3238, storey: 2.0,
    facade: { kind: "curtain", glass: 0x3f6f7a, mullion: 0x1f262b, every: 0.34 },
    roof: { kind: "parapet", deck: 0x4a535b, rim: 0x2b3238, h: 0.16 },
  };
  const slab: Mass = {
    ...inside(f, 0.5, base.z1, base.z1 + 7.2), wall: 0x9fd6cf, storey: 1.5,
    facade: { kind: "curtain", glass: 0x5fb7ad, mullion: 0xd9f2ee, every: 0.24, spandrel: 0x3f8f87 },
    roof: { kind: "parapet", deck: ROOF, rim: 0x9fd6cf, h: 0.25 },
  };
  return {
    plinth: PLINTH, masses: [base, slab], crane: "tower",
    grounds: paved,
    details: (p) => {
      const mid = (base.u0 + base.u1) / 2;
      door(p, base, mid, 0.55, 1.3, 0x14191c);
      canopy(p, base, mid, 1.1, base.z0 + 1.4, 0x0f766e);
      for (let k = 0; k < 3; k++) planter(p, base.u0 + 0.35 + k * 0.5, base.v1 + 0.2, PLINTH.h);
      // THE BOARD: who they are looking for, in lights.
      roofSign(p, slab.u0 + 0.1, slab.u1 - 0.1, slab.v1 - 0.3, slab.z1, 1.4, 0x0f3d39, 0x5eead4);
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
    // THE COURTYARD in the corner the two make: lawn, a path and a bench, under
    // the wing that stands in front of it. @see Building.court
    court: (p) => {
      const z = PLINTH.h + 0.01;
      p.flat(0.2, mid, split, f.h - 0.2, z, LAWN);
      p.flat(0.2, mid + (f.h - 0.2 - mid) / 2 - 0.08, split, mid + (f.h - 0.2 - mid) / 2 + 0.08, z + 0.004, GRAVEL);
      p.box(split - 0.7, mid + 0.4, split - 0.3, mid + 0.5, z, z + 0.3, 0x9a7349);
    },
    details: (p) => {
      // Its door, and the courtyard's trees, clear of the wing.
      const z = PLINTH.h + 0.01;
      door(p, back, (0.2 + split) / 2, 0.4, 1.2, 0x2c3e48);
      tree(p, 0.6, mid + 0.55, z, 0.9);
      tree(p, split - 0.45, f.h - 0.55, z, 1);
      tree(p, 0.55, f.h - 0.5, z, 0.8);
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

/**
 * DATA CENTRE: a long graphite hall in three bays a face, pilasters between
 * them — coolant panels in the outer bays, its circuits over the inlet in the
 * middle — status lights along its foot and chillers on the roof.
 */
export function datacentre(f: Footprint): Building {
  const m: Mass = {
    ...inside(f, 0.2, PLINTH.h, PLINTH.h + 3.1), wall: 0x2a2e36, storey: 3.1,
    facade: { kind: "plain" },
    roof: { kind: "parapet", deck: 0x1d2026, rim: 0x3a3f48, h: 0.18 },
  };
  const top = m.z1 - 0.25, mid = f.w / 2, midv = f.h / 2;
  const v: FaceAt = { face: "v", at: m.v1 }, u: FaceAt = { face: "u", at: m.u1 };
  const live: Live = {
    panels: [
      { ...v, a0: m.u0 + 0.1, a1: mid - 0.38, z0: m.z0 + 1.3, z1: top, runs: 7, dir: "v" },
      { ...v, a0: mid + 0.38, a1: m.u1 - 0.1, z0: m.z0 + 0.35, z1: top, runs: 7, dir: "v" },
      { ...u, a0: m.v0 + 0.1, a1: midv - 0.38, z0: m.z0 + 0.35, z1: top, runs: 7, dir: "v" },
      { ...u, a0: midv + 0.38, a1: m.v1 - 0.1, z0: m.z0 + 0.35, z1: top, runs: 7, dir: "v" },
    ],
    traces: [
      ...circuits(v, mid - 0.24, mid + 0.24, m.z0 + 1.55, top, 3, 1),
      ...circuits(u, midv - 0.24, midv + 0.24, m.z0 + 1.55, top, 3, 2),
    ],
    fans: [0.85, f.w - 0.85].flatMap((fu) => [0.85, f.h - 0.85].map((fv) => ({ u: fu, v: fv, z: m.z1 + 0.32, r: 0.23 }))),
  };
  return {
    plinth: { ...PLINTH, colour: 0x5d626a, top: 0x737880 }, masses: [m], crane: "tower", live,
    grounds: (p) => p.flat(0.02, 0.02, f.w - 0.02, f.h - 0.02, 0.004, 0x6b7078),
    details: (p) => {
      // Pilasters between the bays, standing proud of both faces.
      for (const a of [mid - 0.31, mid + 0.31]) p.box(a - 0.035, m.v1 - 0.02, a + 0.035, m.v1 + 0.035, m.z0, m.z1 + 0.06, 0x3a3f48);
      for (const b of [midv - 0.31, midv + 0.31]) p.box(m.u1 - 0.02, b - 0.035, m.u1 + 0.035, b + 0.035, m.z0, m.z1 + 0.06, 0x3a3f48);
      // Status lights along the foot of both faces, clear of the inlets.
      for (let a = m.u0 + 0.12; a < m.u1 - 0.1; a += 0.12) if (Math.abs(a + 0.025 - mid) > 0.3) p.onV(m.v1 + 0.003, a, a + 0.05, m.z0 + 0.1, m.z0 + 0.17, 0x3fe0a8);
      for (let b = m.v0 + 0.12; b < m.v1 - 0.1; b += 0.12) if (Math.abs(b + 0.025 - midv) > 0.3) p.onU(m.u1 + 0.003, b, b + 0.05, m.z0 + 0.1, m.z0 + 0.17, 0x2fb886);
      door(p, m, m.u0 + 0.5, 0.3, 1.0, 0x16181c, 0x4a4f58);
      drawLiveBase(p, live);
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

/** HACKERSPACE: an old brick warehouse, roof lights along it, a roller door open and a neon sign over the yard. */
export function hackerspace(f: Footprint): Building {
  const m: Mass = {
    ...inside(f, [0.2, 0.2, 0.2, 0.75], 0.15, 3.1), wall: BRICK, storey: 3,
    facade: { kind: "windows", glass: 0x55707c, frame: 0x3a3f45, w: 0.32, gap: 0.2, sill: 0.9, head: 0.35 },
    roof: { kind: "parapet", deck: 0x5a5550, rim: tone(BRICK, 0.85), h: 0.22 },
    cornice: { colour: tone(BRICK, 0.8), h: 0.12, out: 0.03 },
  };
  return {
    plinth: { inset: 0.05, h: 0.15, colour: 0xa7a39b, top: 0xb9b5ab },
    masses: [m],
    crane: "tower",
    grounds: (p) => {
      // A concrete yard out front.
      p.flat(0.08, m.v1, f.w - 0.08, f.h - 0.04, 0.004, 0xb9b5ab);
    },
    details: (p) => {
      const mid = (m.u0 + m.u1) / 2;
      // Roof lights: glazed ridges along the roof, one a bay.
      for (let v = m.v0 + 0.3; v < m.v1 - 0.25; v += 0.6) {
        p.box(m.u0 + 0.25, v, m.u1 - 0.25, v + 0.3, m.z1, m.z1 + 0.32, 0x8f8a80, { top: tone(GLASS, 1.1) });
      }
      // The roller door, open, the workshop lit inside.
      p.onV(m.v1, mid - 0.55, mid + 0.55, m.z0, m.z0 + 1.75, 0x3a3f45);
      p.onV(m.v1, mid - 0.5, mid + 0.5, m.z0, m.z0 + 1.6, 0xffd27a);
      p.onV(m.v1, mid - 0.5, mid + 0.5, m.z0 + 1.35, m.z0 + 1.6, 0x8a9198);
      // The neon sign on the roof, toward the yard.
      roofSign(p, mid - 0.9, mid + 0.9, m.v1 - 0.15, m.z1, 0.9, 0x15181c, 0x3fe0a8);
      // In the yard: a shipping container, a bench, and a bike rack.
      p.box(f.w - 1.55, m.v1 + 0.15, f.w - 0.2, m.v1 + 0.6, 0.15, 0.85, 0x2e6fb5);
      for (let u = f.w - 1.45; u < f.w - 0.3; u += 0.12) p.onV(m.v1 + 0.6, u, u + 0.03, 0.2, 0.8, tone(0x2e6fb5, 0.8));
      p.box(0.35, m.v1 + 0.25, 1.05, m.v1 + 0.45, 0.15, 0.45, 0x8a5a34, { top: tone(0x8a5a34, 1.2) });
      for (let u = mid + 0.9; u < mid + 1.4 && u < f.w - 1.6; u += 0.18) p.box(u, m.v1 + 0.3, u + 0.03, m.v1 + 0.5, 0.15, 0.5, 0x4a525b);
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

// ─── THE TOWN'S OWN SERVICES ───────────────────────────────────────────────

/** A sign's lettering: a few strokes on a board's face, along `u` at `v`. */
function lettering(p: Pen, v: number, u0: number, u1: number, z0: number, z1: number, colour: number, n = 5) {
  const w = (u1 - u0) / (n * 1.35);
  for (let k = 0; k < n; k++) p.onV(v, u0 + k * w * 1.35, u0 + k * w * 1.35 + w, z0, k % 2 ? z1 : z0 + (z1 - z0) * 0.75, colour);
}

/**
 * The cinema's marquee, where its bulbs chase: the hall's sides in, its front
 * in — far enough for the marquee to stand out over it inside the plot — so
 * far out, so high. @see drawMoving
 */
export const MARQUEE = { inset: 0.2, front: 0.48, out: 0.36, z0: 1.7, z1: 2.05 };
/** The night club's height: its beams go up off the roof. @see drawMoving */
export const CLUB_TOP = PLINTH.h + 2.6;

/** THE NIGHT CLUB: a black box, no windows, a neon band round its top and a rope at the door. */
export function club(f: Footprint): Building {
  const NEON = 0xd25bff;
  const m: Mass = {
    ...inside(f, 0.2, PLINTH.h, CLUB_TOP), wall: 0x2a2633, storey: 2.3,
    facade: { kind: "plain", lines: 0x24202c, every: 0.5 },
    roof: { kind: "parapet", deck: 0x1d1a24, rim: 0x3a3546, h: 0.16 },
  };
  return {
    plinth: { ...PLINTH, top: 0x4a4752 }, masses: [m], crane: "none",
    grounds: (p) => p.flat(0.02, 0.02, f.w - 0.02, f.h - 0.02, 0.004, 0x4a4752),
    details: (p) => {
      // The neon, round the top of the two faces seen.
      p.onV(m.v1, m.u0, m.u1, m.z1 - 0.42, m.z1 - 0.34, NEON);
      p.onU(m.u1, m.v0, m.v1, m.z1 - 0.42, m.z1 - 0.34, NEON);
      // The sign, lettered in neon, over the door.
      const mid = (m.u0 + m.u1) / 2;
      p.box(mid - 0.55, m.v1, mid + 0.55, m.v1 + 0.04, m.z0 + 1.55, m.z0 + 2.0, 0x15131b);
      lettering(p, m.v1 + 0.042, mid - 0.45, mid + 0.45, m.z0 + 1.65, m.z0 + 1.9, NEON);
      door(p, m, mid, 0.36, 1.25, 0x111015, 0x6b5a7a);
      // The rope: posts and a red cord, out front.
      for (const u of [mid - 0.45, mid - 0.15, mid + 0.15]) p.box(u - 0.02, m.v1 + 0.3, u + 0.02, m.v1 + 0.34, PLINTH.h, PLINTH.h + 0.5, 0xd8c070);
      p.box(mid - 0.45, m.v1 + 0.31, mid + 0.15, m.v1 + 0.33, PLINTH.h + 0.38, PLINTH.h + 0.43, 0xb0182e);
      // The lights on the roof the beams come off. @see drawMoving
      for (const du of [-0.3, 0.3]) p.box(f.w / 2 + du - 0.07, f.h / 2 - 0.07, f.w / 2 + du + 0.07, f.h / 2 + 0.07, m.z1, m.z1 + 0.18, 0x55505f);
    },
  };
}

/** THE CINEMA: a tall red hall, posters along its front, and a marquee over the doors. */
export function cinema(f: Footprint): Building {
  const RED = 0xa8242e, CREAM = 0xf1e4c4;
  const m: Mass = {
    ...inside(f, [MARQUEE.inset, MARQUEE.inset, MARQUEE.inset, MARQUEE.front], PLINTH.h, PLINTH.h + 3.4), wall: RED, storey: 3.4,
    facade: { kind: "plain" },
    roof: { kind: "parapet", deck: 0x4b3a33, rim: CREAM, h: 0.2 },
    cornice: { colour: CREAM, h: 0.14, out: 0.03 },
  };
  return {
    plinth: PLINTH, masses: [m], crane: "none",
    grounds: paved,
    details: (p) => {
      const mid = (m.u0 + m.u1) / 2;
      // Glass doors under the marquee.
      p.onV(m.v1, mid - 0.5, mid + 0.5, m.z0, m.z0 + 1.25, FRAME);
      p.onV(m.v1, mid - 0.46, mid + 0.46, m.z0, m.z0 + 1.2, tone(GLASS, 0.6));
      for (const u of [mid - 0.16, mid + 0.16]) p.onV(m.v1, u - 0.012, u + 0.012, m.z0, m.z0 + 1.2, FRAME);
      // THE MARQUEE: a deep slab out over the doors, its board cream, lettered.
      p.box(m.u0 + 0.06, m.v1, m.u1 - 0.06, m.v1 + MARQUEE.out, MARQUEE.z0, MARQUEE.z1, 0x2b2228, { top: 0x3a2f35 });
      p.onV(m.v1 + MARQUEE.out + 0.002, m.u0 + 0.16, m.u1 - 0.16, MARQUEE.z0 + 0.06, MARQUEE.z1 - 0.12, CREAM);
      lettering(p, m.v1 + MARQUEE.out + 0.004, m.u0 + 0.3, m.u1 - 0.3, MARQUEE.z0 + 0.1, MARQUEE.z1 - 0.18, 0x2b2228, 7);
      // Posters either side, and a tall sign up the corner.
      for (const u of [m.u0 + 0.12, m.u1 - 0.36]) {
        p.onV(m.v1, u, u + 0.24, m.z0 + 0.25, m.z0 + 1.05, CREAM);
        p.onV(m.v1, u + 0.03, u + 0.21, m.z0 + 0.3, m.z0 + 1.0, u < mid ? 0x2f5f9f : 0xe0a030);
      }
      p.box(m.u1 - 0.1, m.v1, m.u1 + 0.02, m.v1 + 0.3, m.z0 + 2.2, m.z1 + 0.6, CREAM);
      for (let k = 0; k < 5; k++) p.onU(m.u1 + 0.021, m.v1 + 0.08, m.v1 + 0.22, m.z0 + 2.35 + k * 0.32, m.z0 + 2.55 + k * 0.32, RED);
    },
  };
}

/** CO-WORKING: a warehouse done up — brick, big steel windows, a yellow sign and bikes out front. */
export function coworking(f: Footprint): Building {
  const YELLOW = 0xf2c230;
  const m: Mass = {
    ...inside(f, 0.2, PLINTH.h, PLINTH.h + 3.6), wall: 0x9c5a44, storey: 1.8,
    facade: { kind: "windows", glass: GLASS, frame: 0x2b2f33, w: 0.36, gap: 0.12, sill: 0.25, head: 0.25 },
    ground: { kind: "ribbon", glass: GLASS, frame: 0x2b2f33, sill: 0.1, head: 0.3, edge: 0.12 },
    roof: { kind: "parapet", deck: ROOF, rim: 0x7e4a38, h: 0.18 },
  };
  return {
    plinth: PLINTH, masses: [m], crane: "none",
    grounds: paved,
    details: (p) => {
      const mid = (m.u0 + m.u1) / 2;
      p.box(mid - 0.6, m.v1, mid + 0.6, m.v1 + 0.04, m.z0 + 1.55, m.z0 + 1.85, YELLOW);
      lettering(p, m.v1 + 0.042, mid - 0.5, mid + 0.5, m.z0 + 1.62, m.z0 + 1.78, 0x22262b, 6);
      // A bike rack and two bikes.
      p.box(m.u0 + 0.1, m.v1 + 0.24, m.u0 + 0.7, m.v1 + 0.27, PLINTH.h, PLINTH.h + 0.3, 0x9aa3ad);
      for (const [u, c] of [[m.u0 + 0.25, 0x2f8f6b], [m.u0 + 0.5, 0xd8432f]] as const) {
        p.box(u - 0.01, m.v1 + 0.18, u + 0.01, m.v1 + 0.34, PLINTH.h + 0.12, PLINTH.h + 0.38, c);
      }
      plant(p, m.u0 + 0.45, m.v0 + 0.4, m.z1);
      planter(p, m.u1 - 0.2, m.v1 + 0.2, PLINTH.h);
    },
  };
}

/** THE DOCTOR'S: a white clinic, blue glass, a green cross out from the wall. */
export function doctor(f: Footprint): Building {
  const GREEN = 0x2fa35a;
  const m: Mass = {
    u0: 0.18, v0: 0.12, u1: f.w - 0.18, v1: f.h - 0.36, z0: 0.12, z1: 2.4, wall: 0xf1f2ee, storey: 2.28,
    facade: { kind: "ribbon", glass: 0x7fb0d6, frame: 0xdfe3e0, sill: 0.8, head: 0.4, edge: 0.15 },
    roof: { kind: "parapet", deck: 0x8a9096, rim: 0xdfe3e0, h: 0.14 },
  };
  return {
    plinth: { inset: 0.04, h: 0.12, colour: STONE, top: PAVING }, masses: [m], crane: "none",
    grounds: paved,
    details: (p) => {
      door(p, m, m.u0 + 0.35, 0.34, 1.2, 0x7fb0d6, 0xdfe3e0);
      p.box(m.u0 + 0.6, m.v1, m.u1 - 0.1, m.v1 + 0.03, m.z0 + 1.45, m.z0 + 1.75, GREEN);
      lettering(p, m.v1 + 0.032, m.u0 + 0.7, m.u1 - 0.2, m.z0 + 1.52, m.z0 + 1.66, WHITE, 5);
      // The cross, on a bracket at the corner.
      const u = m.u1 - 0.05, z = m.z1 - 0.35;
      p.box(u - 0.01, m.v1, u + 0.01, m.v1 + 0.2, z - 0.02, z + 0.02, 0x9aa3ad);
      p.box(u - 0.03, m.v1 + 0.2, u + 0.03, m.v1 + 0.23, z - 0.3, z + 0.3, GREEN);
      p.box(u - 0.1, m.v1 + 0.2, u + 0.1, m.v1 + 0.23, z - 0.09, z + 0.09, GREEN);
      // A bench out front.
      p.box(m.u0 + 0.7, f.h - 0.2, m.u0 + 1.1, f.h - 0.1, 0.12, 0.35, 0x9a7349);
    },
  };
}

/** THE CLIMBING WALL: a tall shed, its front a wall of holds in every colour, and a big window. */
export function climbing(f: Footprint): Building {
  const HOLDS = [0xe0603a, 0x3d8be0, 0xf2c230, 0x45b07a, 0xa65ad6, 0xf27aa8];
  const m: Mass = {
    ...inside(f, 0.2, PLINTH.h, PLINTH.h + 4.2), wall: 0x8f9aa5, storey: 4.2,
    facade: { kind: "plain", lines: 0x84909b, every: 0.6 },
    roof: { kind: "flat", deck: 0x5d666f },
  };
  return {
    plinth: PLINTH, masses: [m], crane: "none",
    grounds: paved,
    details: (p) => {
      // THE WALL: a grey panel up the lit face, holds dotted all over it.
      const a0 = m.u0 + 0.12, a1 = m.u0 + 0.95;
      p.onV(m.v1, a0, a1, m.z0 + 0.2, m.z1 - 0.2, 0xb7bec4);
      for (let k = 0; k < 22; k++) {
        const u = a0 + 0.05 + ((k * 37) % 19) / 19 * (a1 - a0 - 0.1);
        const z = m.z0 + 0.4 + ((k * 23) % 17) / 17 * (m.z1 - m.z0 - 0.9);
        p.dot(u, m.v1 + 0.01, z, 0.022, HOLDS[k % HOLDS.length]);
      }
      // A window on the rest of it, and the door and sign.
      p.onV(m.v1, m.u0 + 1.1, m.u1 - 0.1, m.z0 + 1.6, m.z1 - 0.4, tone(GLASS, 0.85));
      door(p, m, m.u0 + 1.35, 0.32, 1.2, DARK, 0xe0603a);
      p.box(m.u0 + 1.1, m.v1, m.u1 - 0.1, m.v1 + 0.03, m.z0 + 1.3, m.z0 + 1.5, 0xe0603a);
      // A rope hanging off the top.
      p.onV(m.v1 + 0.02, a0 + 0.4, a0 + 0.415, m.z0 + 0.5, m.z1 - 0.2, 0xf2efe6);
    },
  };
}

/** SLOP REFINERY: a squat brick works, two brown-banded tanks beside it and a stack venting on the roof. */
export function refinery(f: Footprint): Building {
  const m: Mass = {
    u0: 0.18, v0: 0.18, u1: f.w * 0.62, v1: f.h - 0.2, z0: PLINTH.h, z1: PLINTH.h + 2.2, wall: 0x8a6a52, storey: 2.2,
    facade: { kind: "windows", glass: tone(GLASS, 0.8), frame: 0x5e4636, w: 0.12, gap: 0.22, sill: 0.6, head: 0.5 },
    roof: { kind: "parapet", deck: 0x4b4038, rim: 0x5e4636, h: 0.14 },
  };
  return {
    plinth: { inset: 0.04, h: 0.2, colour: 0xa49d8f, top: 0xb7b0a2 }, masses: [m], crane: "none",
    grounds: (p) => p.flat(0.02, 0.02, f.w - 0.02, f.h - 0.02, 0.004, 0xb7b0a2),
    details: (p) => {
      door(p, m, m.u0 + 0.35, 0.36, 1.2, 0x2b2420, 0x7a5230);
      // THE TANKS: round-ish, banded in slop brown.
      for (const [u, v] of [[f.w - 0.42, 0.55], [f.w - 0.42, f.h - 0.55]]) {
        p.box(u - 0.26, v - 0.26, u + 0.26, v + 0.26, 0.2, 1.6, 0xb9b3a6);
        p.box(u - 0.27, v - 0.27, u + 0.27, v + 0.27, 0.9, 1.05, 0x7a5230);
        p.dot(u, v, 1.62, 0.2, 0x8f897e);
      }
      // THE STACK, and what comes out of it.
      const su = m.u0 + 0.4, sv = m.v0 + 0.4;
      p.box(su - 0.08, sv - 0.08, su + 0.08, sv + 0.08, m.z1, m.z1 + 1.8, 0x6e5a4a);
      p.box(su - 0.09, sv - 0.09, su + 0.09, sv + 0.09, m.z1 + 1.55, m.z1 + 1.65, 0xd9a35a);
      p.dot(su + 0.05, sv, m.z1 + 2.05, 0.14, 0xcfc6b8);
      p.dot(su + 0.15, sv - 0.05, m.z1 + 2.3, 0.1, 0xddd6ca);
      // "BEST PRACTICES", lit, on the front.
      p.box(m.u0 + 0.15, m.v1, m.u1 - 0.15, m.v1 + 0.03, m.z1 - 0.55, m.z1 - 0.2, 0x2b2420);
      p.onV(m.v1 + 0.03, m.u0 + 0.25, m.u1 - 0.3, m.z1 - 0.45, m.z1 - 0.32, 0x8ee07a);
    },
  };
}

/** TRAINING DATA PLANT: a long grey labelling hall, a row of skylights, and server cabinets humming along its side. */
export function dataplant(f: Footprint): Building {
  const m: Mass = {
    ...inside(f, [0.16, 0.2, 0.16, 0.5], PLINTH.h, PLINTH.h + 2.4), wall: 0xc9ccd1, storey: 2.4,
    facade: { kind: "ribbon", glass: 0x5a7f95, frame: 0x9aa1a8, sill: 0.9, head: 0.4 },
    roof: { kind: "parapet", deck: 0x5c636b, rim: 0x9aa1a8, h: 0.14 },
  };
  return {
    plinth: PLINTH, masses: [m], crane: "none",
    grounds: paved,
    details: (p) => {
      door(p, m, m.u1 - 0.35, 0.32, 1.15, 0x23292f, 0x6c7cff);
      // SKYLIGHTS along the roof.
      for (let u = m.u0 + 0.25; u < m.u1 - 0.2; u += 0.42) p.box(u - 0.12, m.v0 + 0.3, u + 0.12, m.v1 - 0.3, m.z1, m.z1 + 0.22, 0x9cc3d8, { top: 0xbfe0ee });
      // CABINETS out front, each with a light.
      for (let u = m.u0 + 0.2; u < m.u1 - 0.6; u += 0.3) {
        p.box(u - 0.1, m.v1 + 0.08, u + 0.1, m.v1 + 0.3, PLINTH.h, PLINTH.h + 0.7, 0x2f343a);
        p.onV(m.v1 + 0.3, u - 0.05, u + 0.05, PLINTH.h + 0.5, PLINTH.h + 0.58, 0x6c7cff);
      }
      roofSign(p, m.u0 + 0.2, m.u0 + 1.1, m.v1 - 0.15, m.z1, 0.9, 0x1f2430, 0x9fb0ff);
    },
  };
}

/** CONTENT FARM: a cheerful glass box crammed with ring lights, a billboard on top, a queue of delivery vans. */
export function contentfarm(f: Footprint): Building {
  const m: Mass = {
    ...inside(f, 0.2, PLINTH.h, PLINTH.h + 3.0), wall: 0xf1e8f4, storey: 1.5,
    facade: { kind: "curtain", glass: 0xc59ad6, mullion: 0xf7f2f8, every: 0.3, spandrel: 0xe4d4ea },
    roof: { kind: "parapet", deck: ROOF, rim: 0xf1e8f4, h: 0.2 },
  };
  return {
    plinth: PLINTH, masses: [m], crane: "none",
    grounds: paved,
    details: (p) => {
      const mid = (m.u0 + m.u1) / 2;
      door(p, m, mid, 0.42, 1.2, 0x3a2442);
      canopy(p, m, mid, 0.9, m.z0 + 1.35, 0xe25f9e);
      // RING LIGHTS in the windows.
      for (let u = m.u0 + 0.25; u < m.u1 - 0.15; u += 0.4) p.onV(m.v1, u - 0.06, u + 0.06, m.z0 + 1.9, m.z0 + 2.02, 0xfff3c4);
      // THE BILLBOARD: thought leadership, at scale.
      roofSign(p, m.u0 + 0.1, m.u1 - 0.1, m.v1 - 0.3, m.z1, 1.5, 0xe25f9e, 0xfff3fa);
      // A delivery van at the kerb.
      p.box(m.u1 - 0.55, f.h - 0.22, m.u1 - 0.1, f.h - 0.05, 0.02, 0.38, 0xf7f7f7);
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

/** A PUMP HOUSE: a little brick house by the water, a wheel on its side and a pipe out. @see PUMP */
export function pump(f: Footprint): Building {
  const m: Mass = {
    ...inside(f, 0.2, 0.2, 1.2), wall: 0x9a4e3c, storey: 1.2,
    facade: { kind: "plain" },
    roof: { kind: "parapet", deck: 0x4b5560, rim: 0x6e3528, h: 0.12 },
  };
  return {
    plinth: { inset: 0.08, h: 0.1, colour: 0x8f949a, top: 0xa9aeb4 }, masses: [m], crane: "none",
    grounds: (p) => p.flat(0.04, 0.04, f.w - 0.04, f.h - 0.04, 0.004, 0x8f949a),
    details: (p) => {
      door(p, m, m.u0 + 0.2, 0.18, 0.75, 0x2b2f36, 0x5b636c);
      // The wheel on the water side, and the pipe out the back.
      p.dot(m.u1 + 0.02, (m.v0 + m.v1) / 2, 0.55, 0.22, 0x5b636c);
      p.dot(m.u1 + 0.03, (m.v0 + m.v1) / 2, 0.55, 0.08, 0x9aa3ad);
      p.box(m.u0 - 0.12, (m.v0 + m.v1) / 2 - 0.05, m.u0, (m.v0 + m.v1) / 2 + 0.05, 0.1, 0.2, 0x6f7a86);
    },
  };
}

// ─── THE AI'S OWN ───────────────────────────────────────────────────────────
// What the company's AI puts up for itself: black glass, violet light, and no
// door anyone would use — and, on each that drinks, coolant panels on its
// walls, circuits traced across them and fans on its roof, running as its
// tank lets it. @see AI_BUILDINGS, world/ai/planner, ai-live

const AI_GLASS = 0x1b1530;
const AI_LIGHT = 0xb44aff;
const AI_WALL = 0x221d36;
const AI_METAL = 0x4a4560;

/** A row of violet light along both lit faces of a mass, at a height. */
function aiBand(p: Pen, m: Mass, z: number) {
  p.onV(m.v1 + 0.005, m.u0 + 0.04, m.u1 - 0.04, z, z + 0.06, AI_LIGHT);
  p.onU(m.u1 + 0.005, m.v0 + 0.04, m.v1 - 0.04, z, z + 0.06, tone(AI_LIGHT, 0.8));
}

/** The two faces of a mass the camera sees. */
const facesOf = (m: Mass): [FaceAt, FaceAt] => [{ face: "v", at: m.v1 }, { face: "u", at: m.u1 }];

/**
 * A board of `n` circuits across a face, `a0..a1` along it and `z0..z1` up:
 * each rising from the foot, jogging aside, and rising on to the head.
 */
function circuits(at: FaceAt, a0: number, a1: number, z0: number, z1: number, n: number, seed: number): Trace[] {
  const out: Trace[] = [];
  const r = (k: number, i: number) => { const x = Math.sin(seed * 12.9898 + k * 78.233 + i * 37.719) * 43758.5453; return x - Math.floor(x); };
  const w = (a1 - a0) / n;
  for (let k = 0; k < n; k++) {
    const a = a0 + w * (k + 0.5), zA = z0 + (z1 - z0) * (0.2 + 0.25 * r(k, 1)), zB = z0 + (z1 - z0) * (0.55 + 0.25 * r(k, 2));
    const b = Math.max(a0 + w * 0.2, Math.min(a1 - w * 0.2, a + (r(k, 3) - 0.5) * w * 1.1));
    out.push(traceOf(at, seed * 1.3 + k * 2.1, [a, z0, a, zA, b, zA, b, zB, a, zB, a, z1]));
  }
  return out;
}

/** AN AI NODE: a pod of black panels, coolant behind glass over its circuits, a fan on its cap. */
export function aiNode(f: Footprint): Building {
  const m: Mass = {
    ...inside(f, 0.17, 0.15, 2.5), wall: AI_WALL, storey: 2.35,
    facade: { kind: "plain" }, roof: { kind: "flat", deck: 0x17131f },
  };
  const cap: Mass = { ...inside(f, 0.2, m.z1, m.z1 + 0.18), wall: AI_METAL, storey: 1, facade: { kind: "plain" }, roof: { kind: "flat", deck: 0x2a2440 } };
  const [v, u] = facesOf(m);
  const live: Live = {
    panels: [v, u].map((at) => ({ ...at, a0: m.u0 + 0.05, a1: m.u1 - 0.05, z0: 1.7, z1: m.z1 - 0.05, runs: 5, dir: "v" as const })),
    traces: [v, u].flatMap((at, k) => [
      ...circuits(at, m.u0 + 0.05, f.w / 2 - 0.17, 0.35, 1.55, 1, 3 + k),
      ...circuits(at, f.w / 2 + 0.17, m.u1 - 0.05, 0.35, 1.55, 1, 5 + k),
    ]),
    fans: [{ u: f.w / 2, v: f.h / 2, z: cap.z1 + 0.22, r: 0.16 }],
  };
  return {
    plinth: { inset: 0.05, h: 0.15, colour: 0x5d5770, top: 0x6f6984 }, masses: [m, cap], crane: "none", live,
    grounds: (p) => p.flat(0.02, 0.02, f.w - 0.02, f.h - 0.02, 0.004, 0x3b3651),
    details: (p) => { aiBand(p, m, 1.6); drawLiveBase(p, live); },
  };
}

/** A GPU FARM: a long black shed of rack bays behind coolant glass, fans in a row along its roof. */
export function gpuFarm(f: Footprint): Building {
  const m: Mass = {
    ...inside(f, [0.1, 0.12, 0.1, 0.12], 0.15, 2.2), wall: AI_GLASS, storey: 2.05,
    facade: { kind: "plain" }, roof: { kind: "flat", deck: 0x110d19 },
  };
  const [v, u] = facesOf(m);
  const port = 0.5, half = (m.u1 - 0.75) / 2;
  const live: Live = {
    panels: [
      // The rack bays, down the long face clear of its inlet.
      { ...v, a0: 0.78, a1: 0.78 + half, z0: 0.35, z1: m.z1 - 0.1, runs: 6, dir: "v" },
      { ...v, a0: 0.82 + half, a1: m.u1 - 0.05, z0: 0.35, z1: m.z1 - 0.1, runs: 6, dir: "v" },
      // Over the inlet on the short face.
      { ...u, a0: m.v0 + 0.05, a1: m.v1 - 0.05, z0: 1.6, z1: m.z1 - 0.1, runs: 2, dir: "h" },
    ],
    traces: [
      ...circuits(v, m.u0 + 0.05, port - 0.17, 0.35, m.z1 - 0.15, 1, 7),
      ...circuits(v, port + 0.17, 0.72, 0.35, m.z1 - 0.15, 1, 8),
      ...circuits(u, m.v0 + 0.05, f.h / 2 - 0.17, 0.35, 1.45, 1, 9),
      ...circuits(u, f.h / 2 + 0.17, m.v1 - 0.05, 0.35, 1.45, 1, 10),
    ],
    fans: [0.5, 1.0, 1.5].map((fu) => ({ u: fu * (f.w / 2), v: f.h / 2, z: m.z1 + 0.22, r: 0.16 })),
  };
  return {
    plinth: { inset: 0.04, h: 0.15, colour: 0x5d5770, top: 0x6f6984 }, masses: [m], crane: "none", live,
    grounds: (p) => p.flat(0.02, 0.02, f.w - 0.02, f.h - 0.02, 0.004, 0x3b3651),
    details: (p) => { aiBand(p, m, m.z1 - 0.1); drawLiveBase(p, live); },
  };
}

/**
 * A COMPUTE SPIRE: a black obelisk on a podium its inlets are flanged to,
 * coolant snaking up its lower shaft, its circuits above, a fan in its crown.
 */
export function computeSpire(f: Footprint): Building {
  const podium: Mass = {
    ...inside(f, 0.18, 0.15, 1.8), wall: 0x161021, storey: 1.65,
    facade: { kind: "plain" }, roof: { kind: "flat", deck: 0x3b3358 },
  };
  const m: Mass = {
    ...inside(f, 0.28, podium.z1, 6.2), wall: AI_GLASS, storey: 4.4,
    facade: { kind: "plain" }, roof: { kind: "flat", deck: 0x17131f },
  };
  const crown: Mass = { ...inside(f, 0.25, m.z1, m.z1 + 0.25), wall: AI_METAL, storey: 1, facade: { kind: "plain" }, roof: { kind: "flat", deck: 0x2a2440 } };
  const [pv, pu] = facesOf(podium), [v, u] = facesOf(m);
  const a0 = m.u0 + 0.03, a1 = m.u1 - 0.03;
  const live: Live = {
    panels: [v, u].map((at) => ({ ...at, a0, a1, z0: m.z0 + 0.2, z1: m.z0 + 2.2, runs: 5, dir: "h" as const })),
    traces: [
      ...[v, u].flatMap((at, k) => circuits(at, a0, a1, m.z0 + 2.4, m.z1 - 0.2, 3, 11 + k)),
      ...[pv, pu].flatMap((at, k) => [
        ...circuits(at, podium.u0 + 0.04, f.w / 2 - 0.17, 0.3, podium.z1 - 0.15, 1, 13 + k),
        ...circuits(at, f.w / 2 + 0.17, podium.u1 - 0.04, 0.3, podium.z1 - 0.15, 1, 15 + k),
      ]),
    ],
    fans: [{ u: f.w / 2, v: f.h / 2, z: crown.z1 + 0.22, r: 0.15 }],
  };
  return {
    plinth: { inset: 0.12, h: 0.15, colour: 0x2a2440, top: 0x3b3358 }, masses: [podium, m, crown], crane: "none", live,
    grounds: (p) => p.flat(0.06, 0.06, f.w - 0.06, f.h - 0.06, 0.004, 0x2a2440),
    details: (p) => { aiBand(p, podium, podium.z1 - 0.12); aiBand(p, m, m.z1 - 0.12); drawLiveBase(p, live); },
  };
}

/** A DRONE HANGAR: a low vault, its door open on the dark inside. */
export function droneHangar(f: Footprint): Building {
  const m: Mass = {
    ...inside(f, 0.15, 0.15, 1.5), wall: 0x2a2440, storey: 1.35,
    facade: { kind: "plain", lines: 0x3b3358, every: 0.3 },
    roof: { kind: "flat", deck: 0x3b3358 },
  };
  const vault: Mass = { ...inside(f, 0.3, m.z1, m.z1 + 0.4), wall: 0x3b3358, storey: 1, facade: { kind: "plain" }, roof: { kind: "flat", deck: 0x463d68 } };
  return {
    plinth: { inset: 0.05, h: 0.15, colour: 0x5d5770, top: 0x6f6984 }, masses: [m, vault], crane: "none",
    grounds: (p) => p.flat(0.02, 0.02, f.w - 0.02, f.h - 0.02, 0.004, 0x3b3651),
    details: (p) => {
      const mid = (m.u0 + m.u1) / 2;
      p.onV(m.v1, mid - 0.45, mid + 0.45, m.z0, m.z0 + 1.0, 0x0b0910);
      aiBand(p, m, 1.15);
    },
  };
}

/** THE MONOLITH: a slab of nothing, taller than it is wide. */
export function monolith(f: Footprint): Building {
  const m: Mass = {
    u0: f.w / 2 - 0.12, v0: f.h / 2 - 0.3, u1: f.w / 2 + 0.12, v1: f.h / 2 + 0.3, z0: 0, z1: 4.5,
    wall: 0x050407, storey: 4.5, facade: { kind: "plain" }, roof: { kind: "flat", deck: 0x0b0910 },
  };
  return {
    plinth: { inset: 0.3, h: 0.02, colour: 0x050407, top: 0x0b0910 }, masses: [m], crane: "none",
    grounds: (p) => p.flat(0.1, 0.1, f.w - 0.1, f.h - 0.1, 0.004, 0x2a2440),
    details: () => {},
  };
}

/**
 * THE LATTICE, in the form the AI's disposition gave it: by default the black
 * vault, four columns round a lit core, braced, taller than anything near it.
 * @see game/quests/finale latticeForm
 */
export function lattice(f: Footprint): Building {
  const form = latticeForm();
  const H = 6;
  const col = (u: number, v: number, wall: number, deck: number): Mass => ({
    u0: u, v0: v, u1: u + 0.28, v1: v + 0.28, z0: 0, z1: H,
    wall, storey: H, facade: { kind: "plain" }, roof: { kind: "flat", deck },
  });
  const cols = (wall: number, deck: number) => [col(0.35, 0.35, wall, deck), col(f.w - 0.63, 0.35, wall, deck), col(0.35, f.h - 0.63, wall, deck), col(f.w - 0.63, f.h - 0.63, wall, deck)];
  /**
   * A core's coolant and circuits, stacked up both its faces: `bands` of
   * `[z0, z1, "panel" | "board"]`, kept back from the front column's corner.
   */
  const coreLive = (core: Mass, bands: [number, number, "panel" | "board"][], fan: boolean): Live => {
    const faces = facesOf(core), a0 = core.u0 + 0.05, a1 = Math.min(core.u1 - 0.05, f.w - 0.63 - 0.65);
    return {
      panels: faces.flatMap((at) => bands.filter((b) => b[2] === "panel").map(([z0, z1]) => ({ ...at, a0, a1, z0, z1, runs: 4, dir: "h" as const }))),
      traces: faces.flatMap((at, k) => bands.filter((b) => b[2] === "board").flatMap(([z0, z1], j) => circuits(at, a0, a1, z0, z1, 3, 21 + k * 5 + j))),
      fans: fan ? [{ u: (core.u0 + core.u1) / 2, v: (core.v0 + core.v1) / 2, z: core.z1 + 0.22, r: 0.26 }] : [],
    };
  };
  switch (form) {
    // A GLASS SPIRE: three stacked, narrowing towers of glass, coolant in the
    // lowest, circuits up the next, a fan in the top.
    case "spire": {
      const tiers: Mass[] = [[0.55, 0, 4], [0.85, 4, 7.5], [1.15, 7.5, 9.5]].map(([inset, z0, z1]) => ({
        ...inside(f, inset, z0, z1), wall: 0x3d4f7a, storey: 0.7,
        facade: { kind: "curtain", glass: 0x6d8fc4, mullion: 0xd6e4f5, every: 0.25, spandrel: 0x2a3556 },
        roof: { kind: "flat", deck: 0x2a3556 },
      }));
      const [t0, t1, t2] = tiers, mid = f.w / 2;
      const live: Live = {
        panels: facesOf(t0).flatMap((at) => [[t0.u0 + 0.1, mid - 0.2], [mid + 0.2, t0.u1 - 0.1]].map(([a0, a1]) => ({ ...at, a0, a1, z0: 1.9, z1: 3.7, runs: 6, dir: "v" as const }))),
        traces: facesOf(t1).flatMap((at, k) => circuits(at, t1.u0 + 0.1, t1.u1 - 0.1, 4.4, 7.2, 5, 31 + k)),
        fans: [{ u: mid, v: f.h / 2, z: t2.z1 + 0.22, r: 0.2 }],
      };
      return {
        plinth: { inset: 0.1, h: 0.2, colour: 0x2a3556, top: 0x3d4f7a }, masses: tiers, crane: "none", live,
        grounds: (p) => p.flat(0.05, 0.05, f.w - 0.05, f.h - 0.05, 0.004, 0x2a2440),
        details: (p) => { for (const t of tiers) aiBand(p, t, t.z1 - 0.3); drawLiveBase(p, live); },
      };
    }
    // A GARDEN LATTICE: pale stone columns, a core of green louvres, planted on top, a lawn round it.
    case "garden": {
      const core: Mass = {
        ...inside(f, 0.95, 0, H - 0.4), wall: 0x3f5f34, storey: 0.6,
        facade: { kind: "louvres", slat: 0x6f9a52, every: 0.2, edge: 0.08 }, roof: { kind: "garden", deck: 0x4f7a3a, rim: 0xd8d2c0 },
      };
      const live = coreLive(core, [[1.9, 3.3, "panel"], [3.6, 5.0, "panel"]], false);
      return {
        plinth: { inset: 0.1, h: 0.15, colour: 0xc9c2ae, top: 0xd8d2c0 }, masses: [core, ...cols(0xd8d2c0, 0xe6e1d2)], crane: "none", live,
        grounds: (p) => p.flat(0.05, 0.05, f.w - 0.05, f.h - 0.05, 0.004, 0x5f8a3e),
        details: (p) => drawLiveBase(p, live),
      };
    }
    // AN OPEN FRAME: white columns round a core of clear glass behind white fins, warm inside.
    case "open": {
      const core: Mass = {
        ...inside(f, 0.95, 0, H + 0.4), wall: 0xf2efe6, storey: 0.6,
        facade: { kind: "fins", glass: 0xf6e7b8, fin: 0xffffff, every: 0.18 }, roof: { kind: "flat", deck: 0xe6e1d2 },
      };
      const live = coreLive(core, [[1.9, 3.3, "panel"], [3.6, 5.2, "board"]], true);
      return {
        plinth: { inset: 0.1, h: 0.15, colour: 0xd9d5ca, top: 0xeeeae0 }, masses: [core, ...cols(0xf4f3ee, 0xffffff)], crane: "none", live,
        grounds: (p) => p.flat(0.05, 0.05, f.w - 0.05, f.h - 0.05, 0.004, 0xb9b4a6),
        details: (p) => drawLiveBase(p, live),
      };
    }
    // A RIVER-COOLED MONOLITH: a dark slab standing in a pool, banded in water-blue, coolant between the bands.
    case "river": {
      const slab: Mass = {
        u0: f.w / 2 - 0.45, v0: 0.6, u1: f.w / 2 + 0.45, v1: f.h - 0.6, z0: 0, z1: H + 1,
        wall: 0x0d1a22, storey: H + 1, facade: { kind: "plain" }, roof: { kind: "flat", deck: 0x14262f },
      };
      const [v, u] = facesOf(slab);
      const live: Live = {
        panels: [2.0, 4.2].flatMap((z0) => [
          { ...v, a0: slab.u0 + 0.06, a1: slab.u1 - 0.06, z0, z1: z0 + 0.9, runs: 3, dir: "h" as const },
          { ...u, a0: slab.v0 + 0.08, a1: slab.v1 - 0.08, z0, z1: z0 + 0.9, runs: 3, dir: "h" as const },
        ]),
        traces: [], fans: [],
      };
      return {
        plinth: { inset: 0.1, h: 0.08, colour: 0x1c3a48, top: 0x2f6f8f }, masses: [slab], crane: "none", live,
        grounds: (p) => p.flat(0.05, 0.05, f.w - 0.05, f.h - 0.05, 0.006, 0x2f6f8f),
        details: (p) => {
          for (let z = 0.8; z < slab.z1; z += 1.1) {
            p.onV(slab.v1 + 0.005, slab.u0 + 0.04, slab.u1 - 0.04, z, z + 0.08, 0x7fd3f0);
            p.onU(slab.u1 + 0.005, slab.v0 + 0.04, slab.v1 - 0.04, z, z + 0.08, 0x5fb6d6);
          }
          drawLiveBase(p, live);
        },
      };
    }
    // THE BLACK VAULT: four columns round a core of coolant and circuits, stacked to the top, a fan on it.
    default: {
      const core: Mass = {
        ...inside(f, 0.95, 0, H + 0.8), wall: AI_GLASS, storey: 0.6,
        facade: { kind: "plain" }, roof: { kind: "flat", deck: 0x17131f },
      };
      const live = coreLive(core, [[1.9, 3.1, "panel"], [3.3, 4.5, "board"], [4.7, 5.9, "panel"], [6.05, 6.65, "board"]], true);
      return {
        plinth: { inset: 0.1, h: 0.2, colour: 0x050407, top: 0x0b0910 }, masses: [core, ...cols(0x050407, 0x0b0910)], crane: "none", live,
        grounds: (p) => p.flat(0.05, 0.05, f.w - 0.05, f.h - 0.05, 0.004, 0x2a2440),
        details: (p) => { aiBand(p, core, 1.65); drawLiveBase(p, live); },
      };
    }
  }
}

/** Each building by the structure it is drawn for. */
export const LOOKS: Record<string, (f: Footprint) => Building> = {
  garage, studio, hq, boardroom, campus, agency, townhall, harbour, datacentre, conference, hackerspace, ipo,
  // Offices, drawn as the buildings that first opened their kind of work.
  "office-intern": garage, "office-vibe": studio, "office-10x": hq,
  cafe, park, gym, lab, levee, derelict, rack, pump,
  // The town's own services.
  club, coworking, cinema, doctor, climbing,
  // The slop processors. @see game/processors
  refinery, dataplant, contentfarm,
  "ai-node": aiNode, "gpu-farm": gpuFarm, "compute-spire": computeSpire, "drone-hangar": droneHangar, monolith, lattice,
};

/** The building a structure is drawn as. */
export const lookOf = (def: string, f: Footprint): Building => (LOOKS[def] ?? studio)(f);
