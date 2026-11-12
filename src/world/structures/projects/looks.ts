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
import { RIGHT, TOP, mix, tone, type Pen, type Pt } from "./pen";
import { hash, type Beacon, type Building, type Fan, type FaceAt, type Footprint, type Live, type Mass, type PropPlace, type Trace } from "./model";
import { bakedProps } from "../../props/props-sheet";
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

/**
 * A DRUM: an upright cylinder `r` across at `(u, v)`, `z0` to `z1` up, its
 * side shaded round from the lit +v to the darker +u. Drawn whole by the
 * tile its middle is in, so it must stand inside one.
 */
function drum(p: Pen, u: number, v: number, r: number, z0: number, z1: number, colour: number, o: { noTop?: boolean; top?: number } = {}) {
  if (u < p.cu0 || u >= p.cu1 || v < p.cv0 || v >= p.cv1) return;
  const N = 16, at = (a: number, z: number) => p.P(u + Math.cos(a) * r, v + Math.sin(a) * r, z);
  // The half the camera sees: from the far right edge (-45°) round the front to the far left (135°).
  for (let k = 0; k < N; k++) {
    const a0 = -Math.PI / 4 + (k / N) * Math.PI, a1 = -Math.PI / 4 + ((k + 1) / N) * Math.PI;
    const lit = RIGHT + (1 - RIGHT) * ((k + 0.5) / N);
    p.poly([at(a0, z1), at(a1, z1), at(a1, z0), at(a0, z0)], tone(colour, lit));
  }
  if (o.noTop) return;
  const top: Pt[] = [];
  for (let k = 0; k < N * 2; k++) top.push(at((k / (N * 2)) * Math.PI * 2, z1));
  p.poly(top, o.top ?? tone(colour, TOP));
}

/** A door on a mass's lit face, centred at `a` along it: a frame, two leaves and their handles. */
function door(p: Pen, m: Mass, a: number, w: number, h: number, colour = DARK, frame = FRAME) {
  p.onV(m.v1, a - w / 2 - 0.035, a + w / 2 + 0.035, m.z0, m.z0 + h + 0.05, frame);
  p.onV(m.v1, a - w / 2, a + w / 2, m.z0, m.z0 + h, colour);
  // Light off the glass in the top of each leaf, and the meeting stile between them.
  p.onV(m.v1, a - w / 2 + 0.02, a + w / 2 - 0.02, m.z0 + h * 0.62, m.z0 + h - 0.04, mix(colour, WHITE, 0.18));
  p.onV(m.v1, a - 0.006, a + 0.006, m.z0, m.z0 + h, mix(colour, WHITE, 0.3));
  for (const s of [-1, 1]) p.onV(m.v1 + 0.003, a + s * 0.03 - 0.006, a + s * 0.03 + 0.006, m.z0 + h * 0.4, m.z0 + h * 0.55, 0xd8dde3);
}

/** A side door on a mass's +u face, at `b` along it. */
function sideDoor(p: Pen, m: Mass, b: number, w: number, h: number, colour = DARK, frame = FRAME) {
  p.onU(m.u1, b - w / 2 - 0.03, b + w / 2 + 0.03, m.z0, m.z0 + h + 0.04, tone(frame, RIGHT));
  p.onU(m.u1, b - w / 2, b + w / 2, m.z0, m.z0 + h, tone(colour, RIGHT));
  p.onU(m.u1 + 0.003, b + w / 2 - 0.05, b + w / 2 - 0.035, m.z0 + h * 0.42, m.z0 + h * 0.5, 0xb9bec4);
}

/** A canopy over a door: a slab standing out from the lit face on two posts, lit underneath. */
function canopy(p: Pen, m: Mass, a: number, w: number, z: number, colour: number) {
  for (const s of [-1, 1]) {
    const u = a + s * (w / 2 - 0.04);
    p.box(u - 0.018, m.v1 + 0.2, u + 0.018, m.v1 + 0.24, m.z0, z, tone(colour, 0.85));
  }
  p.box(a - w / 2, m.v1, a + w / 2, m.v1 + 0.26, z, z + 0.1, colour);
  p.onV(m.v1 + 0.26, a - w / 2 + 0.04, a + w / 2 - 0.04, z + 0.02, z + 0.05, 0xfff3c4, 0.85);
}

/** Steps up to a door, `n` of them, out from the lit face. */
function steps(p: Pen, m: Mass, a: number, w: number, n: number, z0: number, colour = STONE) {
  const rise = (m.z0 - z0) / n;
  for (let k = 0; k < n; k++) {
    const out = 0.09 * (n - k);
    p.box(a - w / 2, m.v1, a + w / 2, m.v1 + out, z0 + rise * k, z0 + rise * (k + 1), colour, { top: tone(colour, 1.1) });
  }
}

/** A tree: a trunk and a round crown, shadowed underneath and lit on top, `s` its size. */
export function tree(p: Pen, u: number, v: number, z: number, s = 1) {
  p.flat(u - 0.2 * s, v - 0.12 * s, u + 0.22 * s, v + 0.16 * s, z + 0.003, 0x000000, 0.12);
  p.box(u - 0.035 * s, v - 0.035 * s, u + 0.035 * s, v + 0.035 * s, z, z + 0.9 * s, TRUNK);
  const c = z + 1.45 * s;
  p.dot(u, v, c - 0.12 * s, 0.27 * s, tone(LEAF, 0.72));
  p.dot(u, v, c, 0.25 * s, LEAF);
  p.dot(u + 0.08 * s, v + 0.02 * s, c - 0.02 * s, 0.13 * s, tone(LEAF, 0.86));
  p.dot(u - 0.07 * s, v - 0.02 * s, c + 0.18 * s, 0.15 * s, tone(LEAF, 1.18));
  p.dot(u - 0.1 * s, v - 0.03 * s, c + 0.28 * s, 0.07 * s, tone(LEAF, 1.32));
}

/** A planter with a shrub in it, flowers in it if `bloom`. */
function planter(p: Pen, u: number, v: number, z: number, bloom?: number) {
  p.box(u - 0.08, v - 0.08, u + 0.08, v + 0.08, z, z + 0.2, STONE, { top: tone(STONE, 0.7) });
  p.dot(u, v, z + 0.32, 0.075, tone(LEAF, 0.85));
  p.dot(u - 0.02, v, z + 0.37, 0.05, tone(LEAF, 1.15));
  if (bloom !== undefined) for (const [du, dz] of [[-0.04, 0.38], [0.03, 0.42], [0.02, 0.3]]) p.dot(u + du, v, z + dz, 0.016, bloom);
}

const PLANT = 0xb4bbc1;
/** A ROOFTOP UNIT: a louvred box, its fan turning on top. Its fan, for the building's live layer. */
function unit(p: Pen, u: number, v: number, z: number, s = 1): Fan {
  const w = 0.15 * s, d = 0.12 * s, h = 0.22;
  p.box(u - w, v - d, u + w, v + d, z, z + h, PLANT, { top: tone(PLANT, 0.9) });
  for (let k = 1; k < 4; k++) p.onV(v + d + 0.002, u - w + 0.03, u + w - 0.03, z + (h * k) / 4.5, z + (h * k) / 4.5 + 0.02, tone(PLANT, 0.72));
  return { u, v, z: z + h + 0.12, r: Math.min(w, d) * 0.85, housing: tone(PLANT, 0.82) };
}

/** A rooftop air handler: a long louvred box, two fans on top. */
function plant(p: Pen, u: number, v: number, z: number, s = 1): Fan[] {
  const w = 0.24 * s, d = 0.12 * s, h = 0.3 * s;
  p.box(u - w, v - d, u + w, v + d, z, z + h, PLANT, { top: tone(PLANT, 0.92) });
  for (let a = u - w + 0.04; a < u + w - 0.03; a += 0.05) p.onV(v + d + 0.002, a, a + 0.02, z + 0.04, z + h - 0.04, tone(PLANT, 0.74));
  p.onU(u + w + 0.002, v - d + 0.03, v + d - 0.03, z + 0.05, z + h - 0.05, tone(PLANT, 0.6));
  return plantFans(u, v, z, s);
}
/** A plant's two fans, for a live layer made before it is drawn. */
const plantFans = (u: number, v: number, z: number, s = 1): Fan[] =>
  [-1, 1].map((k) => ({ u: u + k * 0.12 * s, v, z: z + 0.3 * s + 0.2, r: 0.09 * s, housing: tone(PLANT, 0.82) }));

/** A WATER TANK on a roof: a timber drum on a steel stand, banded, its cap pointed. Inside one tile. */
function waterTank(p: Pen, u: number, v: number, z: number, s = 1) {
  const r = 0.17 * s, leg = 0.45 * s, h = 0.55 * s;
  for (const [du, dv] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const lu = u + du * r * 0.6, lv = v + dv * r * 0.6;
    p.box(lu - 0.015, lv - 0.015, lu + 0.015, lv + 0.015, z, z + leg, 0x4a525b);
  }
  drum(p, u, v, r, z + leg, z + leg + h, 0x9a6a44);
  for (const k of [0.25, 0.7]) drum(p, u, v, r + 0.004, z + leg + h * k, z + leg + h * k + 0.03, 0x3a3f45, { noTop: true });
  drum(p, u, v, r * 0.66, z + leg + h, z + leg + h + 0.1, 0x6b4a32);
  drum(p, u, v, r * 0.3, z + leg + h + 0.1, z + leg + h + 0.2, 0x6b4a32);
}

/** SOLAR PANELS in rows across a roof, between `u0..u1` and `v0..v1`. */
function solar(p: Pen, u0: number, v0: number, u1: number, v1: number, z: number) {
  for (let v = v0; v < v1 - 0.16; v += 0.28) {
    p.box(u0, v, u1, v + 0.2, z, z + 0.06, 0x8f969c, { top: 0x23365a });
    for (let u = u0 + 0.16; u < u1 - 0.05; u += 0.16) p.flat(u - 0.006, v, u + 0.006, v + 0.2, z + 0.061, 0x5a6f96);
    p.flat(u0, v + 0.04, u1, v + 0.06, z + 0.062, 0x3e5684, 0.8);
  }
}

/** A MAST: a lattice of steel `h` tall at a point, a light on top. The light, for the live layer. */
function mast(p: Pen, u: number, v: number, z: number, h: number, light = 0xff3b2f): Beacon {
  const w = 0.05, c = 0x9aa3ab;
  for (const [du, dv] of [[-w, -w], [w, -w], [-w, w], [w, w]]) p.box(u + du - 0.01, v + dv - 0.01, u + du + 0.01, v + dv + 0.01, z, z + h, c);
  for (let k = 0; k < h - 0.2; k += 0.28) {
    p.strut([u - w, v + w, z + k], [u + w, v + w, z + k + 0.28], 0.012, tone(c, 0.85));
    p.strut([u + w, v - w, z + k], [u + w, v + w, z + k + 0.28], 0.012, tone(c, 0.7));
  }
  p.box(u - 0.02, v - 0.02, u + 0.02, v + 0.02, z + h, z + h + 0.35, c);
  return mastLight(u, v, z, h, light);
}
/** Where a mast's light is, for a building's live layer before it is drawn. */
const mastLight = (u: number, v: number, z: number, h: number, colour = 0xff3b2f): Beacon => ({ u, v, z: z + h + 0.4, colour });

/** A LAMP POST: a dark pole, an arm, and a lamp lit warm. */
function lamp(p: Pen, u: number, v: number, z: number) {
  p.box(u - 0.016, v - 0.016, u + 0.016, v + 0.016, z, z + 1.25, 0x3a3f45);
  p.box(u - 0.016, v - 0.016, u + 0.12, v + 0.016, z + 1.2, z + 1.25, 0x3a3f45);
  p.box(u + 0.07, v - 0.03, u + 0.15, v + 0.03, z + 1.12, z + 1.2, 0x3a3f45, { top: 0x2b2f33 });
  p.dot(u + 0.11, v, z + 1.1, 0.03, 0xfff1c4);
}

/** A BENCH along `u` (or along `v`), timber on dark legs. */
function bench(p: Pen, u: number, v: number, z: number, along: "u" | "v" = "u", colour = 0x9a7349) {
  const [hu, hv] = along === "u" ? [0.22, 0.06] : [0.06, 0.22];
  for (const k of [-0.8, 0.8]) {
    const lu = u + (along === "u" ? hu * k : 0), lv = v + (along === "v" ? hv * k : 0);
    p.box(lu - 0.02, lv - 0.02, lu + 0.02, lv + 0.02, z, z + 0.2, 0x3a3f45);
  }
  p.box(u - hu, v - hv, u + hu, v + hv, z + 0.2, z + 0.26, colour);
  if (along === "u") p.box(u - hu, v - hv, u + hu, v - hv + 0.03, z + 0.26, z + 0.48, colour);
  else p.box(u - hu, v - hv, u - hu + 0.03, v + hv, z + 0.26, z + 0.48, colour);
}

/** A CAR parked along `u` (or `v`): body, cabin, glass and wheels. */
function car(p: Pen, u: number, v: number, z: number, colour: number, along: "u" | "v" = "u") {
  const L = 0.3, W = 0.13;
  const [hu, hv] = along === "u" ? [L, W] : [W, L];
  p.flat(u - hu - 0.03, v - hv + 0.02, u + hu + 0.04, v + hv + 0.06, z + 0.002, 0x000000, 0.18);
  p.box(u - hu, v - hv, u + hu, v + hv, z + 0.08, z + 0.34, colour);
  const [cu, cv] = along === "u" ? [hu * 0.55, hv * 0.92] : [hu * 0.92, hv * 0.55];
  p.box(u - cu, v - cv, u + cu, v + cv, z + 0.34, z + 0.56, 0x2a3540, { top: colour });
  if (along === "u") p.onV(v + cv + 0.002, u - cu + 0.03, u + cu - 0.03, z + 0.38, z + 0.52, 0x8fb7cf);
  else p.onU(u + cu + 0.002, v - cv + 0.03, v + cv - 0.03, z + 0.38, z + 0.52, tone(0x8fb7cf, RIGHT));
  for (const k of [-0.6, 0.6]) {
    if (along === "u") p.onV(v + hv + 0.002, u + hu * k - 0.05, u + hu * k + 0.05, z, z + 0.12, 0x1c1f23);
    else p.onU(u + hu + 0.002, v + hv * k - 0.05, v + hv * k + 0.05, z, z + 0.12, 0x1c1f23);
  }
}

/** A BIKE RACK and the bikes in it, along `u`. */
function bikes(p: Pen, u0: number, u1: number, v: number, z: number, colours: number[]) {
  p.box(u0, v - 0.015, u1, v + 0.015, z, z + 0.28, 0x9aa3ad, { noTop: true });
  colours.forEach((c, k) => {
    const u = u0 + 0.08 + k * ((u1 - u0 - 0.16) / Math.max(1, colours.length - 1));
    p.dot(u, v + 0.08, z + 0.12, 0.05, 0x23272b);
    p.dot(u, v - 0.08, z + 0.12, 0.05, 0x23272b);
    p.strut([u, v - 0.08, z + 0.13], [u, v + 0.08, z + 0.24], 0.02, c);
  });
}

/** A sign standing on a roof: a board on legs, `h` tall, its face lit, its lettering lit brighter. */
function roofSign(p: Pen, u0: number, u1: number, v: number, z: number, h: number, board: number, face: number) {
  for (const u of [u0 + 0.08, u1 - 0.08]) {
    p.box(u - 0.02, v - 0.02, u + 0.02, v + 0.02, z, z + h * 0.35, 0x4a525b);
    p.strut([u, v - 0.12, z], [u, v, z + h * 0.35], 0.012, 0x4a525b);
  }
  p.box(u0, v - 0.03, u1, v + 0.03, z + h * 0.35, z + h, board);
  p.onV(v + 0.03, u0 + 0.03, u1 - 0.03, z + h * 0.38, z + h - 0.03, tone(board, 1.25));
  p.onV(v + 0.031, u0 + 0.06, u1 - 0.06, z + h * 0.48, z + h * 0.62, face);
  p.onV(v + 0.031, u0 + 0.06, u1 - 0.12, z + h * 0.72, z + h * 0.86, face);
  p.onV(v + 0.032, u0 + 0.06, u1 - 0.06, z + h * 0.48, z + h * 0.86, face, 0.18);
}

/** A flag on a pole at a point, flying toward +u, a ball on the pole. */
function flag(p: Pen, u: number, v: number, z: number, h: number, colour: number) {
  p.box(u - 0.018, v - 0.018, u + 0.018, v + 0.018, z, z + h, 0xd8dde3);
  p.dot(u, v, z + h + 0.03, 0.025, 0xd8b04a);
  p.onV(v + 0.005, u + 0.02, u + 0.36, z + h - 0.55, z + h - 0.08, colour);
  p.onV(v + 0.006, u + 0.2, u + 0.36, z + h - 0.55, z + h - 0.08, tone(colour, 0.88));
}

/** Grounds paved edge to edge, slabs scored in a grid, and a kerb round the edge. */
function paved(p: Pen, f: Footprint) {
  p.flat(0.02, 0.02, f.w - 0.02, f.h - 0.02, 0.004, PAVING);
  for (let u = 0.5; u < f.w - 0.1; u += 0.5) p.flat(u - 0.006, 0.02, u + 0.006, f.h - 0.02, 0.005, tone(PAVING, 0.93));
  for (let v = 0.5; v < f.h - 0.1; v += 0.5) p.flat(0.02, v - 0.006, f.w - 0.02, v + 0.006, 0.005, tone(PAVING, 0.93));
}

/**
 * A raised flower bed: a stone kerb round dark soil, planted in rows of leafy
 * clumps, each drift of them one colour, back to front.
 */
function flowerBed(p: Pen, u0: number, v0: number, u1: number, v1: number, blooms: readonly number[]) {
  const z = 0.03, top = 0.075, KERB = 0.03, GAP = 0.05;
  p.box(u0, v0, u1, v1, z, top, 0xa9a493, { top: STONE_TOP });
  p.flat(u0 + KERB, v0 + KERB, u1 - KERB, v1 - KERB, top + 0.001, 0x3f2d22);
  const plants: { u: number; v: number; k: number }[] = [];
  let k = 0;
  for (let v = v0 + KERB + GAP / 2; v < v1 - KERB; v += GAP)
    for (let u = u0 + KERB + GAP / 2; u < u1 - KERB; u += GAP) {
      plants.push({ u: u + (hash(k * 2.3) - 0.5) * 0.035, v: v + (hash(k * 4.1) - 0.5) * 0.035, k });
      k++;
    }
  plants.sort((a, b) => a.u + a.v - (b.u + b.v));
  for (const { u, v, k } of plants) {
    // Drifts run across the bed on the diagonal, so it reads as planted.
    const drift = Math.floor((u - u0 - (v - v0) + 1 + 0.06 * Math.sin((u + v) * 9)) / 0.22);
    const bloom = blooms[((drift % blooms.length) + blooms.length) % blooms.length];
    const h = top + 0.03 + hash(k * 6.7) * 0.02;
    p.dot(u, v, h, 0.028 + hash(k * 5.1) * 0.01, tone(0x4f7f3a, 0.85 + hash(k * 1.9) * 0.3));
    p.dot(u - 0.007, v - 0.007, h + 0.012, 0.02, tone(0x6a9b48, 0.9 + hash(k * 3.3) * 0.2));
    for (const [du, dv, dz] of [[-0.012, 0.006, 0.03], [0.012, -0.004, 0.034], [0.002, 0.013, 0.022], [-0.004, -0.01, 0.038]])
      p.dot(u + du, v + dv, h + dz, 0.009, tone(bloom, 0.92 + hash(k * 8.9 + du) * 0.16));
  }
}

/** A level disc on the ground, cut to the tile being drawn like a `flat`. */
function disc(p: Pen, u: number, v: number, r: number, z: number, colour: number) {
  let pts: [number, number][] = Array.from({ length: 24 }, (_, k) => {
    const a = (k / 24) * Math.PI * 2;
    return [u + Math.cos(a) * r, v + Math.sin(a) * r];
  });
  // Cut to each side of the tile in turn.
  const sides: [0 | 1, number, 1 | -1][] = [[0, p.cu0, 1], [0, p.cu1, -1], [1, p.cv0, 1], [1, p.cv1, -1]];
  for (const [ax, at, dir] of sides) {
    const out: [number, number][] = [];
    const inside = (q: [number, number]) => (q[ax] - at) * dir >= 0;
    pts.forEach((a, k) => {
      const b = pts[(k + 1) % pts.length];
      if (inside(a)) out.push(a);
      if (inside(a) !== inside(b)) {
        const t = (at - a[ax]) / (b[ax] - a[ax]);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    });
    pts = out;
    if (pts.length < 3) return;
  }
  p.poly(pts.map(([a, b]) => p.P(a, b, z)), colour);
}

/** A low hedge, clipped square, `u0..u1` by `v0..v1`. */
function hedge(p: Pen, u0: number, v0: number, u1: number, v1: number, z: number, h = 0.32) {
  p.box(u0, v0, u1, v1, z, z + h, tone(LEAF, 0.86), { top: tone(LEAF, 1.12) });
}

/** A live layer of just fans and lights: what turns and blinks on an ordinary building. */
const turning = (fans: Fan[], beacons: Beacon[] = []): Live => ({ panels: [], traces: [], fans, beacons });

// ─── THE BUILDINGS ──────────────────────────────────────────────────────────

/** FOUNDER'S GARAGE: a breeze-block box, a roller door half up on a lit workshop, a hand-painted sign and the founder's car on the apron. */
export function garage(f: Footprint): Building {
  const BLOCK = 0xd8d2c4;
  const m: Mass = {
    // ON ITS LANDMARK'S PLOT, a two-tile box at the back, a yard in front. @see LANDMARKS
    ...inside(f, [0.16, Math.max(0.14, f.h - 1.9), Math.max(0.16, f.w - 2.16), f.h > 1 ? 0.8 : 0.2], 0.15, 2.5), wall: BLOCK, storey: 2.35,
    facade: { kind: "plain", lines: tone(BLOCK, 0.88), every: 0.38 },
    roof: { kind: "parapet", deck: 0x50565d, rim: 0x8f8a80, h: 0.16 },
    base: { colour: 0xa7a39b, h: 0.2 },
  };
  const mid = (m.u0 + m.u1) / 2, dw = Math.min(1.1, (m.u1 - m.u0) - 0.5);
  const live = turning([{ u: m.u0 + 0.45, v: m.v0 + 0.35, z: m.z1 + 0.34, r: 0.1, housing: tone(PLANT, 0.82) }]);
  return {
    plinth: { inset: 0.05, h: 0.15, colour: 0xa7a39b, top: 0xb9b5ab },
    masses: [m],
    crane: "none", live,
    grounds: (p) => {
      // A concrete apron in front of the door, cracked, an oil stain on it.
      p.flat(0.1, m.v1, f.w - 0.1, f.h - 0.02, 0.004, 0xb9b5ab);
      p.flat(mid - 0.2, m.v1 + 0.05, mid + 0.1, m.v1 + 0.16, 0.006, 0x8f8a80);
      p.strut([0.3, f.h - 0.1, 0.006], [0.8, m.v1 + 0.1, 0.006], 0.01, 0x9a968c);
    },
    details: (p) => {
      // The roller door, half up, the workshop lit behind it: a bench, a monitor's glow.
      p.onV(m.v1, mid - dw / 2 - 0.05, mid + dw / 2 + 0.05, m.z0, m.z0 + 1.65, 0x8a9198);
      p.onV(m.v1, mid - dw / 2, mid + dw / 2, m.z0, m.z0 + 0.95, 0x3a3226);
      p.onV(m.v1, mid - dw / 2 + 0.1, mid + dw / 2 - 0.1, m.z0 + 0.35, m.z0 + 0.45, 0x8a6a44);
      p.onV(m.v1, mid - 0.2, mid + 0.05, m.z0 + 0.5, m.z0 + 0.75, 0x9fd3ff);
      p.onV(m.v1, mid - dw / 2, mid + dw / 2, m.z0, m.z0 + 0.95, 0xffd27a, 0.12);
      p.onV(m.v1, mid - dw / 2, mid + dw / 2, m.z0 + 0.95, m.z0 + 1.6, 0xa3abb3);
      for (let z = m.z0 + 1.05; z < m.z0 + 1.55; z += 0.12) p.onV(m.v1, mid - dw / 2, mid + dw / 2, z, z + 0.03, 0x858d95);
      // The sign over it, painted on a board, a lamp over the sign.
      p.box(mid - dw / 2, m.v1, mid + dw / 2, m.v1 + 0.03, m.z0 + 1.78, m.z0 + 2.15, 0x2f6d4f);
      p.onV(m.v1 + 0.03, mid - dw / 2 + 0.1, mid + dw / 2 - 0.25, m.z0 + 1.9, m.z0 + 2.02, 0xf3eed8);
      p.box(mid - 0.04, m.v1, mid + 0.04, m.v1 + 0.12, m.z0 + 2.2, m.z0 + 2.26, 0x3a3f45);
      p.dot(mid, m.v1 + 0.11, m.z0 + 2.17, 0.025, 0xfff1c4);
      // A window and a side door on the other face; a downpipe at the corner.
      if (m.v1 - m.v0 > 0.9) {
        p.onU(m.u1, m.v0 + 0.2, m.v0 + 0.62, m.z0 + 0.9, m.z0 + 1.5, tone(FRAME, RIGHT));
        p.onU(m.u1, m.v0 + 0.23, m.v0 + 0.59, m.z0 + 0.93, m.z0 + 1.47, tone(GLASS, 0.7));
        sideDoor(p, m, m.v1 - 0.3, 0.26, 1.15, 0x3f6b4a, 0x8a9198);
      }
      p.box(m.u1 - 0.04, m.v1 - 0.02, m.u1 + 0.02, m.v1 + 0.04, m.z0, m.z1, 0x8f8a80);
      // A vent and a fan on the roof, the bins by the door.
      p.box(m.u1 - 0.4, m.v0 + 0.15, m.u1 - 0.25, m.v0 + 0.3, m.z1, m.z1 + 0.35, 0x9aa3ab);
      p.box(m.u1 - 0.42, m.v0 + 0.13, m.u1 - 0.23, m.v0 + 0.32, m.z1 + 0.35, m.z1 + 0.4, 0x7a838c);
      p.box(m.u1 - 0.2, m.v1 + 0.06, m.u1 - 0.04, m.v1 + 0.2, 0.15, 0.5, 0x3f6b4a, { top: 0x2f5a3a });
      p.box(m.u1 - 0.38, m.v1 + 0.06, m.u1 - 0.22, m.v1 + 0.2, 0.15, 0.5, 0x2e4f7a, { top: 0x243f63 });
      // THE FOUNDER'S CAR, on the apron beside it, where there is room.
      if (f.w - m.u1 > 0.6 && f.h - m.v1 > 0.3) car(p, (m.u1 + f.w) / 2, m.v1 - 0.4, 0.004, 0xc84a3a, "v");
      drawLiveBase(p, live);
    },
  };
}

/** VIBE CODER STUDIO: a shopfront of glass, a floor of curtain over it between white piers, a deck on the roof and the neon. */
export function studio(f: Footprint): Building {
  const m: Mass = {
    // Three tiles of it at the back of the Campus's plot, the rest paved. @see LANDMARKS
    ...inside(f, [0.22, Math.max(0.22, f.h - 2.4), Math.max(0.22, f.w - 3.22), 0.5], PLINTH.h, PLINTH.h + 3.6), wall: 0xeceae2, storey: 1.8,
    facade: { kind: "curtain", glass: GLASS, mullion: 0xf4f3ee, every: 0.34, spandrel: 0xe2dfd4 },
    ground: { kind: "ribbon", glass: tone(GLASS, 0.9), frame: 0x3a3f45, sill: 0.06, head: 0.3, edge: 0.08 },
    roof: { kind: "parapet", deck: ROOF, rim: 0xeceae2, h: 0.24 },
    piers: { colour: 0xf8f7f2, every: 0.7, w: 0.06 },
    base: { colour: 0x8f949a, h: 0.12 },
  };
  // THE SERVICE WING, where its slop goes out: a storey of the same block, flush
  // with the side wall, standing wherever the main block leaves the outlet's
  // place bare — past its front corner on a small plot, behind its back one on
  // the Campus's. The outlet is flanged to the wall the two make. @see entries, SLOP_OUT
  const out = Math.min(1, f.h - 1) + 0.5, WING = 0.3, WING_IN = 0.34;
  const wing = (v0: number, v1: number): Mass => ({
    u0: m.u1 - WING_IN, v0, u1: m.u1, v1, z0: PLINTH.h, z1: PLINTH.h + 1.8, wall: 0xeceae2, storey: 1.8,
    facade: { kind: "louvres", slat: 0xd3d0c6, every: 0.3, edge: 0.06 },
    roof: { kind: "parapet", deck: ROOF, rim: 0xeceae2, h: 0.12 },
    base: { colour: 0x8f949a, h: 0.12 },
  });
  const wings: Mass[] = [];
  if (out + WING > m.v1 + 0.02) wings.push(wing(Math.max(m.v1, out - WING), out + WING));
  if (out - WING < m.v0 - 0.02) wings.push(wing(out - WING, Math.min(m.v0, out + WING)));
  const mid = (m.u0 + m.u1) / 2;
  const fans = (dp: Pen) => [unit(dp, m.u0 + 0.35, m.v0 + 0.3, m.z1), unit(dp, m.u0 + 0.75, m.v0 + 0.3, m.z1)];
  const live = turning([
    { u: m.u0 + 0.35, v: m.v0 + 0.3, z: m.z1 + 0.34, r: 0.1, housing: tone(PLANT, 0.82) },
    { u: m.u0 + 0.75, v: m.v0 + 0.3, z: m.z1 + 0.34, r: 0.1, housing: tone(PLANT, 0.82) },
  ]);
  const deep = f.h - m.v1 > 0.3 || m.v0 > 0.8;
  return {
    plinth: PLINTH, masses: [m, ...wings], crane: "tower", live,
    grounds: paved,
    details: (p) => {
      door(p, m, mid, 0.42, 1.2, 0x2c3e48);
      canopy(p, m, mid, 0.8, m.z0 + 1.35, 0xf4f3ee);
      planter(p, mid - 0.62, m.v1 + 0.16, PLINTH.h, 0xff6fb7);
      // The other planter, where the service wing does not stand.
      if (!wings.some((w) => w.v0 < m.v1 + 0.3 && w.v1 > m.v1 && w.u0 < mid + 0.72)) planter(p, mid + 0.62, m.v1 + 0.16, PLINTH.h, 0xff6fb7);
      fans(p);
      // THE DECK on the roof: timber, a parasol and a table.
      const du0 = m.u0 + 1.0, dv0 = m.v0 + 0.15;
      if (m.u1 - du0 > 1.2) {
        p.flat(du0, dv0, du0 + 0.8, m.v1 - 0.6, m.z1 + 0.01, 0xa47a50);
        for (let u = du0 + 0.1; u < du0 + 0.8; u += 0.1) p.flat(u - 0.004, dv0, u + 0.004, m.v1 - 0.6, m.z1 + 0.012, 0x8a6440);
        const pu = du0 + 0.4, pv = (dv0 + m.v1 - 0.6) / 2;
        p.box(pu - 0.012, pv - 0.012, pu + 0.012, pv + 0.012, m.z1, m.z1 + 0.75, 0xd8dde3);
        p.dot(pu, pv, m.z1 + 0.78, 0.2, 0xf27aa8);
        p.dot(pu - 0.04, pv, m.z1 + 0.82, 0.1, 0xf6a0c4);
      }
      // THE NEON, pink, standing on the roof.
      roofSign(p, m.u1 - 1.0, m.u1 - 0.15, m.v1 - 0.35, m.z1, 1.2, 0x8c2459, 0xff6fb7);
      // Out the back, where there is a yard: the team's bikes and a tree.
      if (deep && m.v0 > 0.8) {
        bikes(p, 0.4, 1.3, 0.45, PLINTH.h, [0x2f8f6b, 0xd8432f, 0x2e6fb5, 0xf2c230]);
        tree(p, f.w - 0.6, 0.55, PLINTH.h, 0.9);
        car(p, 2.0, 0.5, PLINTH.h, 0x3a4d63);
      }
      drawLiveBase(p, live);
    },
  };
}

/** COMPANY HQ: a podium of dark glass on granite, a tower of pale glass stepped back on it between white piers, a plant floor on top, the name in gold and a mast. */
export function hq(f: Footprint): Building {
  const podium: Mass = {
    ...inside(f, 0.16, PLINTH.h, PLINTH.h + 3.4), wall: 0x3a4048, storey: 1.7,
    facade: { kind: "curtain", glass: 0x4f7d92, mullion: 0x2e3a42, every: 0.3 },
    roof: { kind: "parapet", deck: 0x5a626b, rim: 0x3a4048, h: 0.18 },
    base: { colour: 0x2a2e33, h: 0.25 },
    piers: { colour: 0x2a3036, every: 0.65 },
  };
  const tz = podium.z1;
  const tower: Mass = {
    ...inside(f, 0.68, tz, tz + 11.2), wall: 0xd9e3e8, storey: 1.6,
    facade: { kind: "curtain", glass: 0x8fb7cf, mullion: 0xe8f0f2, every: 0.27, spandrel: 0x6f93a8 },
    roof: { kind: "flat", deck: ROOF },
    piers: { colour: 0xf4f8fa, every: 0.55, w: 0.05 },
  };
  // The plant floor: louvred, set back, the roof's machinery behind it.
  const crown: Mass = {
    u0: tower.u0 + 0.12, v0: tower.v0 + 0.12, u1: tower.u1 - 0.12, v1: tower.v1 - 0.12, z0: tower.z1, z1: tower.z1 + 0.8,
    wall: 0x9aa7b0, storey: 0.8, facade: { kind: "louvres", slat: 0xc9d3da, every: 0.12, edge: 0.06 },
    roof: { kind: "parapet", deck: ROOF, rim: 0x9aa7b0, h: 0.12 },
  };
  const cu = (tower.u0 + tower.u1) / 2 + 0.15, cv = (tower.v0 + tower.v1) / 2;
  const live = turning(
    [{ u: crown.u0 + 0.22, v: crown.v0 + 0.2, z: crown.z1 + 0.3, r: 0.12, housing: tone(PLANT, 0.82) }],
    [{ u: cu, v: cv, z: crown.z1 + 3.05, colour: 0xff3b2f, period: 1.8 }],
  );
  return {
    plinth: PLINTH, masses: [podium, tower, crown], crane: "tower", live,
    grounds: paved,
    details: (p) => {
      const mid = (podium.u0 + podium.u1) / 2;
      door(p, podium, mid, 0.5, 1.25, 0x1e2a31);
      canopy(p, podium, mid, 1.0, podium.z0 + 1.45, 0xd9dde2);
      planter(p, podium.u0 + 0.3, podium.v1 + 0.2, PLINTH.h);
      planter(p, podium.u1 - 0.3, podium.v1 + 0.2, PLINTH.h);
      // On the podium's roof round the tower: planters and a bench.
      for (const u of [podium.u0 + 0.25, podium.u1 - 0.25]) planter(p, u, podium.v1 - 0.25, podium.z1);
      bench(p, mid, podium.v1 - 0.25, podium.z1);
      // The company's name across the top, gold, lit.
      p.box(tower.u0 + 0.12, tower.v1, tower.u1 - 0.12, tower.v1 + 0.04, tower.z1 - 1.0, tower.z1 - 0.2, 0xb97f17);
      p.onV(tower.v1 + 0.04, tower.u0 + 0.22, tower.u1 - 0.22, tower.z1 - 0.75, tower.z1 - 0.45, 0xfff1c9);
      // The mast, off the plant floor.
      mast(p, cu, cv, crown.z1, 2.6);
      drawLiveBase(p, live);
    },
  };
}

/** BOARDROOM TOWER: slim and tall, bronze glass ribbed in gold, on a stone podium of pilasters, a sky lobby halfway, a crown and a spire. */
export function boardroom(f: Footprint): Building {
  const podium: Mass = {
    ...inside(f, 0.24, PLINTH.h, PLINTH.h + 2.2), wall: STONE, storey: 2.2,
    facade: { kind: "windows", glass: 0x4f6470, frame: 0xa59c89, w: 0.22, gap: 0.16, sill: 0.35, head: 0.4 },
    roof: { kind: "parapet", deck: 0x8f897b, rim: STONE_TOP, h: 0.2 },
    cornice: { colour: STONE_TOP, h: 0.18, out: 0.04 },
    base: { colour: 0x8f897b, h: 0.3 },
    piers: { colour: STONE_TOP, every: 0.38, w: 0.06 },
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
  const cu = (crown.u0 + crown.u1) / 2, cv = (crown.v0 + crown.v1) / 2;
  const live = turning([], [{ u: cu, v: cv, z: crown.z1 + 4.1, colour: 0xff3b2f, period: 2.2 }]);
  return {
    plinth: PLINTH, masses: [podium, tower, crown], crane: "tower", live,
    grounds: paved,
    details: (p) => {
      const mid = (podium.u0 + podium.u1) / 2;
      steps(p, podium, mid, 0.8, 2, 0.12);
      door(p, podium, mid, 0.42, 1.4, 0x2a2622, 0xd8b04a);
      // Brass lamps either side of the door.
      for (const s of [-1, 1]) {
        p.box(mid + s * 0.36 - 0.03, podium.v1, mid + s * 0.36 + 0.03, podium.v1 + 0.06, podium.z0 + 1.0, podium.z0 + 1.25, 0xb98a2f);
        p.dot(mid + s * 0.36, podium.v1 + 0.06, podium.z0 + 1.12, 0.02, 0xfff1c4);
      }
      // THE SKY LOBBY: a band of gold and clear glass halfway up.
      const sz = tower.z0 + 8;
      p.box(tower.u0 - 0.02, tower.v0 - 0.02, tower.u1 + 0.02, tower.v1 + 0.02, sz, sz + 0.12, 0xd8b04a, { noTop: true });
      p.onV(tower.v1 + 0.021, tower.u0 + 0.02, tower.u1 - 0.02, sz + 0.12, sz + 0.75, 0xc9d8de);
      p.onU(tower.u1 + 0.021, tower.v0 + 0.02, tower.v1 - 0.02, sz + 0.12, sz + 0.75, tone(0xc9d8de, RIGHT));
      p.box(tower.u0 - 0.02, tower.v0 - 0.02, tower.u1 + 0.02, tower.v1 + 0.02, sz + 0.75, sz + 0.87, 0xd8b04a, { noTop: true });
      // Trees in planters on the podium's roof.
      for (const u of [podium.u0 + 0.2, podium.u1 - 0.2]) {
        p.box(u - 0.1, podium.v1 - 0.3, u + 0.1, podium.v1 - 0.1, podium.z1, podium.z1 + 0.2, STONE_TOP);
        tree(p, u, podium.v1 - 0.2, podium.z1 + 0.2, 0.5);
      }
      // The spire.
      p.box(cu - 0.035, cv - 0.035, cu + 0.035, cv + 0.035, crown.z1, crown.z1 + 3, 0xd8b04a);
      p.box(cu - 0.015, cv - 0.015, cu + 0.015, cv + 0.015, crown.z1 + 3, crown.z1 + 4, 0xe8c86a);
      drawLiveBase(p, live);
    },
  };
}

/** TALENT AGENCY: a glass slab in the recruiter's teal on a dark base, a big HIRING board on the roof in chasing bulbs, a queue's worth of planters and a bus stop. */
export function agency(f: Footprint): Building {
  const base: Mass = {
    ...inside(f, 0.18, PLINTH.h, PLINTH.h + 2.0), wall: 0x2b3238, storey: 2.0,
    facade: { kind: "curtain", glass: 0x3f6f7a, mullion: 0x1f262b, every: 0.34 },
    roof: { kind: "parapet", deck: 0x4a535b, rim: 0x2b3238, h: 0.16 },
    base: { colour: 0x1f262b, h: 0.2 },
  };
  const slab: Mass = {
    ...inside(f, 0.5, base.z1, base.z1 + 7.2), wall: 0x9fd6cf, storey: 1.5,
    facade: { kind: "curtain", glass: 0x5fb7ad, mullion: 0xd9f2ee, every: 0.24, spandrel: 0x3f8f87 },
    roof: { kind: "parapet", deck: ROOF, rim: 0x9fd6cf, h: 0.25 },
    piers: { colour: 0xd9f2ee, every: 0.75, w: 0.05 },
  };
  // THE BOARD's bulbs, round its edge, chasing.
  const bu0 = slab.u0 + 0.1, bu1 = slab.u1 - 0.1, bv = slab.v1 - 0.3 + 0.035, bz = slab.z1 + 1.4 * 0.35;
  const bulbs: Beacon[] = [];
  const n = Math.round((bu1 - bu0) / 0.16);
  for (let k = 0; k <= n; k++) {
    const u = bu0 + ((bu1 - bu0) * k) / n;
    bulbs.push({ u, v: bv, z: bz + 0.04, colour: 0xfff3a0, period: 1.2, phase: k * 0.15 }, { u, v: bv, z: slab.z1 + 1.4 - 0.04, colour: 0xfff3a0, period: 1.2, phase: 0.6 - k * 0.15 });
  }
  const fans = [{ u: slab.u0 + 0.35, v: slab.v0 + 0.35, z: slab.z1 + 0.34, r: 0.1, housing: tone(PLANT, 0.82) }, ...plantFans(base.u1 - 0.38, base.v0 + 0.3, base.z1)];
  const live = turning(fans, bulbs);
  return {
    plinth: PLINTH, masses: [base, slab], crane: "tower", live,
    grounds: paved,
    details: (p) => {
      const mid = (base.u0 + base.u1) / 2;
      door(p, base, mid, 0.55, 1.3, 0x14191c);
      canopy(p, base, mid, 1.1, base.z0 + 1.4, 0x0f766e);
      for (let k = 0; k < 3; k++) planter(p, base.u0 + 0.35 + k * 0.5, base.v1 + 0.2, PLINTH.h, 0x5eead4);
      // The queue's rail, posts and a rope, out of the door.
      for (let u = mid + 0.45; u < base.u1 - 0.1; u += 0.3) p.box(u - 0.015, base.v1 + 0.3, u + 0.015, base.v1 + 0.33, PLINTH.h, PLINTH.h + 0.45, 0xb9bec4);
      p.box(mid + 0.45, base.v1 + 0.305, base.u1 - 0.15, base.v1 + 0.325, PLINTH.h + 0.36, PLINTH.h + 0.4, 0x0f766e);
      // A bus stop at the kerb.
      const su = base.u1 - 0.3, sv = f.h - 0.12;
      p.box(su - 0.3, sv - 0.03, su + 0.3, sv, PLINTH.h, PLINTH.h + 0.9, 0x9fd6cf, { alpha: 0.5 });
      p.box(su - 0.32, sv - 0.2, su + 0.32, sv, PLINTH.h + 0.9, PLINTH.h + 0.96, 0x2b3238);
      // Round the slab's foot on the base's roof: plant and a fan.
      unit(p, slab.u0 + 0.35, slab.v0 + 0.35, slab.z1);
      plant(p, base.u1 - 0.38, base.v0 + 0.3, base.z1);
      // THE BOARD: who they are looking for, in lights.
      roofSign(p, bu0, bu1, slab.v1 - 0.3, slab.z1, 1.4, 0x0f3d39, 0x5eead4);
      drawLiveBase(p, live);
    },
  };
}

/**
 * CAMPUS: a tech company's grounds. The main building steps back in three
 * terraces of timber fins and glass, gardens on every one; beside it a slim
 * charcoal studio block, ribbed in the company's coral, its name lit on the
 * roof; in front a glass café under a floating roof, and a landscape of lawn,
 * a pond with a deck, timber seating steps and trees.
 *
 * Masses are cut at the terraces' levels so that each level paints back to
 * front: the studio block in three, beside the terraces. @see sortMasses
 */
export function campus(f: Footprint): Building {
  const TIMBER = 0xc08a55, CHAR = 0x30353b, CORAL = 0xff6b4a, SLAB = 0xf1efe8;
  const L1 = PLINTH.h + 2.2, L2 = L1 + 2.0, L3 = L2 + 1.8;
  const front = f.h - 1.55;
  const fins = { kind: "fins" as const, glass: 0x5f8f92, fin: TIMBER, every: 0.17 };
  const garden = (deck: number) => ({ kind: "garden" as const, deck, rim: SLAB });
  // THE MAIN BUILDING, in terraces stepping back from the front corner.
  const t1: Mass = {
    u0: 0.2, v0: 0.2, u1: f.w - 1.3, v1: front - 0.15, z0: PLINTH.h, z1: L1, wall: TIMBER, storey: 2.2,
    facade: { kind: "curtain", glass: 0x6fa3a8, mullion: 0x3a3f45, every: 0.3 },
    roof: garden(0x7fae5c), bands: { colour: SLAB, h: 0.12 }, base: { colour: 0x3a3f45, h: 0.12 },
  };
  const t2: Mass = {
    u0: 0.2, v0: 0.2, u1: t1.u1 - 0.5, v1: t1.v1 - 0.55, z0: L1, z1: L2, wall: TIMBER, storey: 2.0,
    facade: fins, roof: garden(0x86b862), bands: { colour: SLAB, h: 0.12 },
  };
  const t3: Mass = {
    u0: 0.2, v0: 0.2, u1: t2.u1 - 0.5, v1: t2.v1 - 0.5, z0: L2, z1: L3, wall: TIMBER, storey: 1.8,
    facade: fins, roof: { kind: "parapet", deck: 0x8f969c, rim: SLAB, h: 0.12 }, bands: { colour: SLAB, h: 0.12 },
  };
  // THE STUDIO BLOCK: charcoal, coral fins, cut at each terrace's level.
  const su0 = f.w - 1.0, su1 = f.w - 0.2, sv0 = 0.25, sv1 = front - 0.5;
  const studio = (z0: number, z1: number, top: boolean): Mass => ({
    u0: su0, v0: sv0, u1: su1, v1: sv1, z0, z1, wall: CHAR, storey: 1.1,
    facade: { kind: "fins", glass: 0x3d4a52, fin: CORAL, every: 0.2 },
    roof: top ? { kind: "parapet", deck: 0x4a5058, rim: CHAR, h: 0.14 } : { kind: "flat", deck: CHAR },
    bands: { colour: 0x22262b, h: 0.1 },
  });
  const s1 = studio(PLINTH.h, L1, false), s2 = studio(L1, L2, false), s3 = studio(L2, L3 + 1.2, true);
  // The pavilion's floating roof, out front.
  const pu0 = f.w - 1.15, pu1 = f.w - 0.12, pv0 = front + 0.05, pv1 = f.h - 0.12, pz = PLINTH.h + 1.45;
  const sz = s3.z1;
  const fans = [
    ...plantFans((su0 + su1) / 2, sv0 + 0.3, sz),
    { u: t3.u0 + 0.35, v: t3.v0 + 0.3, z: t3.z1 + 0.34, r: 0.1, housing: tone(PLANT, 0.82) },
  ];
  // Festoon lights along the first terrace's front edge, warm, breathing.
  const festoon: Beacon[] = [];
  for (let u = 0.35, k = 0; u < t2.u1 - 0.1; u += 0.28, k++) {
    festoon.push({ u, v: t1.v1 - 0.06, z: L1 + 0.55 - (k % 2) * 0.06, colour: 0xffd27a, period: 3.2, phase: k * 0.4 });
  }
  const live = turning(fans, festoon);
  return {
    plinth: { ...PLINTH, inset: 0.08 }, masses: [t1, s1, t2, s2, t3, s3], crane: "tower", live,
    grounds: paved,
    // THE LANDSCAPE in front, on the plinth: lawn, the pond and its deck, a path to the door.
    court: (p) => {
      const z = PLINTH.h + 0.01;
      p.flat(0.15, front, f.w - 1.25, f.h - 0.15, z, LAWN);
      // A path from the front edge up to the main door, gravel edged in stone.
      const du = (t1.u0 + t1.u1) / 2 + 0.3;
      p.flat(du - 0.2, t1.v1, du + 0.2, f.h - 0.15, z + 0.003, STONE);
      p.flat(du - 0.16, t1.v1, du + 0.16, f.h - 0.15, z + 0.004, GRAVEL);
      // THE POND, a stone edge and the water, ripples lit.
      const ou0 = 0.3, ou1 = du - 0.35, ov0 = front + 0.25, ov1 = f.h - 0.35;
      p.flat(ou0 - 0.05, ov0 - 0.05, ou1 + 0.05, ov1 + 0.05, z + 0.003, STONE_TOP);
      p.flat(ou0, ov0, ou1, ov1, z + 0.004, 0x4f93b0);
      p.flat(ou0 + 0.04, ov0 + 0.04, ou1 - 0.04, ov0 + 0.14, z + 0.005, 0x3b7a96);
      for (const [a, b, w] of [[0.3, 0.45, 0.25], [0.55, 0.7, 0.18], [0.2, 0.8, 0.12]]) {
        const u = ou0 + (ou1 - ou0) * a, v = ov0 + (ov1 - ov0) * b;
        p.flat(u - w / 2, v - 0.008, u + w / 2, v + 0.008, z + 0.006, 0xbfe3ef, 0.8);
      }
      // A timber deck along its back, boards scored.
      p.flat(ou0, front + 0.02, ou1, ov0 - 0.06, z + 0.005, TIMBER);
      for (let u = ou0 + 0.1; u < ou1; u += 0.1) p.flat(u - 0.004, front + 0.02, u + 0.004, ov0 - 0.06, z + 0.006, tone(TIMBER, 0.8));
      // The café's terrace, paved under its roof.
      p.flat(pu0, pv0, pu1, pv1, z + 0.003, 0xe6e1d3);
    },
    details: (p) => {
      const z = PLINTH.h + 0.01;
      const du = (t1.u0 + t1.u1) / 2 + 0.3;
      // The main door, a deep coral canopy over it.
      door(p, t1, du, 0.5, 1.3, 0x1f262b);
      canopy(p, t1, du, 0.7, t1.z0 + 1.45, CORAL);
      // The studio's door on its lit face.
      door(p, s1, (su0 + su1) / 2, 0.36, 1.25, 0x14181c, CORAL);
      // THE TERRACES' GARDENS: planters and small trees along each front edge,
      // kept clear of the studio block beside them.
      for (let u = 0.45; u < t2.u1 - 0.2; u += 0.7) {
        planter(p, u, t1.v1 - 0.2, L1, 0xffb4a2);
        tree(p, u + 0.35, t1.v1 - 0.3, L1, 0.42);
      }
      bench(p, t2.u1 - 0.35, t1.v1 - 0.25, L1, "u", TIMBER);
      for (let u = 0.45; u < t3.u1 - 0.1; u += 0.6) tree(p, u, t2.v1 - 0.22, L2, 0.36);
      // The festoon's wire, posts at either end.
      for (const u of [0.25, t2.u1 - 0.1]) p.box(u - 0.012, t1.v1 - 0.07, u + 0.012, t1.v1 - 0.05, L1, L1 + 0.62, 0x3a3f45);
      for (let u = 0.25; u < t2.u1 - 0.1; u += 0.14) {
        const sag = 0.06 * Math.sin(((u - 0.25) / 0.28) * Math.PI) ** 2;
        p.strut([u, t1.v1 - 0.06, L1 + 0.6 - sag], [Math.min(t2.u1 - 0.1, u + 0.14), t1.v1 - 0.06, L1 + 0.6 - sag], 0.008, 0x2a2e33);
      }
      // The top terrace's roof: solar, and its unit.
      solar(p, t3.u0 + 0.7, t3.v0 + 0.15, t3.u1 - 0.15, t3.v1 - 0.12, t3.z1);
      unit(p, t3.u0 + 0.35, t3.v0 + 0.3, t3.z1);
      // The studio's roof: plant, and the company's name, lit coral.
      plant(p, (su0 + su1) / 2, sv0 + 0.3, sz);
      roofSign(p, su0 + 0.05, su1 - 0.05, sv1 - 0.2, sz, 0.9, CHAR, CORAL);
      // THE CAFÉ: a glass box under a white roof floating on slim columns.
      const gu0 = pu0 + 0.15, gu1 = pu1 - 0.2, gv0 = pv0 + 0.1, gv1 = pv1 - 0.25;
      p.box(gu0, gv0, gu1, gv1, PLINTH.h, PLINTH.h + 0.06, 0x3a3f45);
      p.box(gu0, gv0, gu1, gv1, PLINTH.h + 0.06, pz - 0.05, 0xffe2b0, { noTop: true });
      p.box(gu0 + 0.03, gv0 + 0.03, gu1 - 0.03, gv1 - 0.03, PLINTH.h + 0.06, pz - 0.05, 0x9cc6cf, { noTop: true, alpha: 0.45 });
      for (let a = gu0 + 0.2; a < gu1 - 0.05; a += 0.2) p.onV(gv1 + 0.002, a - 0.01, a + 0.01, PLINTH.h + 0.06, pz - 0.05, 0x2a2e33);
      for (let b = gv0 + 0.2; b < gv1 - 0.05; b += 0.2) p.onU(gu1 + 0.002, b - 0.01, b + 0.01, PLINTH.h + 0.06, pz - 0.05, 0x1f2226);
      // Inside: the counter's warm light, and a pendant or two.
      p.onV(gv1 + 0.003, gu0 + 0.08, gu1 - 0.08, PLINTH.h + 0.06, PLINTH.h + 0.4, 0xd99a5a, 0.6);
      for (const [cu, cv] of [[pu0 + 0.06, pv0 + 0.06], [pu1 - 0.06, pv0 + 0.06], [pu0 + 0.06, pv1 - 0.06], [pu1 - 0.06, pv1 - 0.06]]) {
        p.box(cu - 0.02, cv - 0.02, cu + 0.02, cv + 0.02, PLINTH.h, pz, 0xe8e6df);
      }
      // Its roof: a white slab, planted with sedum, lit along its soffit.
      p.box(pu0, pv0, pu1, pv1, pz, pz + 0.1, 0xf6f4ee, { top: 0xf6f4ee });
      p.flat(pu0 + 0.06, pv0 + 0.06, pu1 - 0.06, pv1 - 0.06, pz + 0.101, 0x8fb86a);
      for (let k = 0; k < 9; k++) p.dot(pu0 + 0.15 + hash(k * 3.1) * (pu1 - pu0 - 0.3), pv0 + 0.15 + hash(k * 7.7) * (pv1 - pv0 - 0.3), pz + 0.13, 0.03, k % 3 ? 0x6f9a50 : 0xd9a0c4);
      p.onV(pv1 + 0.001, pu0 + 0.02, pu1 - 0.02, pz + 0.01, pz + 0.035, 0xfff3c4, 0.8);
      // Tables out front of it, coral parasols.
      for (const u of [gu0 + 0.15, gu1 - 0.15]) {
        const v = pv1 - 0.1;
        p.box(u - 0.01, v - 0.01, u + 0.01, v + 0.01, PLINTH.h, PLINTH.h + 0.6, 0xe8e6df);
        p.box(u - 0.06, v - 0.06, u + 0.06, v + 0.06, PLINTH.h + 0.24, PLINTH.h + 0.27, 0xe8e6df);
      }
      // THE SEATING STEPS facing the pond: timber, three deep.
      const ou1 = du - 0.35;
      for (let k = 0; k < 3; k++) {
        p.box(du + 0.28 + k * 0.18, front + 0.1, du + 0.46 + k * 0.18, f.h - 0.3, z, z + 0.15 * (k + 1), TIMBER, { top: tone(TIMBER, 1.12) });
      }
      // Trees round the lawn, and beanbags in the company's colours.
      tree(p, 0.22, f.h - 0.2, z, 0.85);
      tree(p, ou1 - 0.1, front + 0.15, z, 0.7);
      for (const [u, v, c] of [[0.95, f.h - 0.22, 0x3b82f6], [1.25, f.h - 0.24, 0xf2c230]] as const) {
        p.dot(u, v, z + 0.07, 0.07, tone(c, 0.8));
        p.dot(u - 0.01, v, z + 0.1, 0.055, c);
      }
      lamp(p, du + 0.25, f.h - 0.2, z);
      bikes(p, su0 + 0.05, su1 - 0.05, sv1 + 0.18, PLINTH.h, [0x2f8f6b, CORAL, 0x2e6fb5, 0xf2c230]);
      drawLiveBase(p, live);
    },
  };
}

/** TOWN HALL: pale stone on steps, rusticated below, pilasters above, columns across the front under a frieze and pediment, and a clock tower with a copper cap. */
export function townhall(f: Footprint): Building {
  const HALL = 0xe6dfcf;
  const body: Mass = {
    ...inside(f, [0.3, 0.3, 0.3, 0.6], 0.45, 3.1), wall: HALL, storey: 2.65,
    facade: { kind: "windows", glass: 0x6c8f9e, frame: 0xf4efe2, w: 0.2, gap: 0.22, sill: 0.45, head: 0.6 },
    roof: { kind: "parapet", deck: 0x5b6670, rim: STONE_TOP, h: 0.2 },
    cornice: { colour: STONE_TOP, h: 0.2, out: 0.05 },
    base: { colour: tone(STONE, 0.92), h: 0.55 },
    piers: { colour: 0xf4efe2, every: 0.42, w: 0.06 },
  };
  const cu = (body.u0 + body.u1) / 2, cv = (body.v0 + body.v1) / 2;
  const tower: Mass = {
    u0: cu - 0.22, v0: cv - 0.22, u1: cu + 0.22, v1: cv + 0.22, z0: body.z1, z1: body.z1 + 1.9, wall: HALL, storey: 1.9,
    facade: { kind: "plain" }, roof: { kind: "flat", deck: 0x5b6670 },
    cornice: { colour: STONE_TOP, h: 0.15, out: 0.04 },
    piers: { colour: 0xf4efe2, every: 0.44, w: 0.05 },
  };
  const COPPER = 0x4f9a82;
  return {
    plinth: { inset: 0.06, h: 0.25, colour: STONE, top: STONE_TOP },
    masses: [body, tower], crane: "tower",
    grounds: (p, fp) => {
      paved(p, fp);
      // Flower beds either side of the steps.
      for (const u of [0.15, f.w - 0.55]) {
        p.flat(u, f.h - 0.14, u + 0.4, f.h - 0.04, 0.26, 0x6b4a32);
        for (let k = 0; k < 5; k++) p.dot(u + 0.05 + k * 0.075, f.h - 0.09, 0.3, 0.025, k % 2 ? 0xd8432f : 0xf2c230);
      }
    },
    details: (p) => {
      // A second step, then the portico: columns and the frieze over them.
      p.box(0.2, body.v1, f.w - 0.2, f.h - 0.16, 0.25, 0.45, STONE, { top: STONE_TOP });
      for (let u = body.u0 + 0.12; u < body.u1 - 0.05; u += 0.32) {
        p.box(u - 0.06, body.v1 + 0.11, u + 0.06, body.v1 + 0.23, 0.45, 0.55, STONE_TOP);
        p.box(u - 0.05, body.v1 + 0.12, u + 0.05, body.v1 + 0.22, 0.55, body.z1 - 0.45, 0xf4efe2);
        p.onV(body.v1 + 0.221, u - 0.015, u + 0.015, 0.55, body.z1 - 0.45, 0xe0d9c8);
        p.box(u - 0.065, body.v1 + 0.105, u + 0.065, body.v1 + 0.235, body.z1 - 0.45, body.z1 - 0.4, STONE_TOP);
      }
      p.box(body.u0 - 0.04, body.v1, body.u1 + 0.04, body.v1 + 0.28, body.z1 - 0.4, body.z1, STONE_TOP);
      p.onV(body.v1 + 0.28, body.u0 + 0.3, body.u1 - 0.3, body.z1 - 0.28, body.z1 - 0.12, 0x5b6670);
      // THE PEDIMENT over the frieze: a low triangle of stone in stepped courses.
      const pw = Math.min(1.1, (body.u1 - body.u0) * 0.45);
      for (let k = 0; k < 4; k++) {
        const w = pw * (1 - k / 4);
        p.box(cu - w, body.v1 + 0.04, cu + w, body.v1 + 0.27, body.z1 + k * 0.1, body.z1 + (k + 1) * 0.1, STONE_TOP);
      }
      door(p, body, cu, 0.36, 1.3, 0x4a3828, 0xd8b04a);
      for (const s of [-1, 1]) lamp(p, cu + s * 0.75 - (s > 0 ? 0.12 : 0), f.h - 0.22, 0.25);
      // THE CLOCK on both faces, its hands, and the belfry's openings over it.
      for (const [face, c0] of [["v", 0xf4f0e2], ["u", tone(0xf4f0e2, 0.76)]] as const) {
        const ring = (a0: number, a1: number, z0: number, z1: number, c: number) =>
          face === "v" ? p.onV(tower.v1, cu + a0, cu + a1, z0, z1, c) : p.onU(tower.u1, cv + a0, cv + a1, z0, z1, c);
        ring(-0.14, 0.14, tower.z0 + 0.92, tower.z0 + 1.48, 0xb98a2f);
        ring(-0.12, 0.12, tower.z0 + 0.95, tower.z0 + 1.45, c0);
        ring(-0.01, 0.01, tower.z0 + 1.15, tower.z0 + 1.4, DARK);
        ring(-0.01, 0.08, tower.z0 + 1.18, tower.z0 + 1.22, DARK);
        ring(-0.08, -0.03, tower.z0 + 1.55, tower.z1 - 0.12, 0x2b2622);
        ring(0.03, 0.08, tower.z0 + 1.55, tower.z1 - 0.12, 0x2b2622);
      }
      // The copper cap, stepped, its lantern and the flag.
      p.box(tower.u0 + 0.04, tower.v0 + 0.04, tower.u1 - 0.04, tower.v1 - 0.04, tower.z1, tower.z1 + 0.35, COPPER, { top: tone(COPPER, 1.15) });
      p.box(tower.u0 + 0.1, tower.v0 + 0.1, tower.u1 - 0.1, tower.v1 - 0.1, tower.z1 + 0.35, tower.z1 + 0.65, COPPER, { top: tone(COPPER, 1.15) });
      p.box(tower.u0 + 0.16, tower.v0 + 0.16, tower.u1 - 0.16, tower.v1 - 0.16, tower.z1 + 0.65, tower.z1 + 0.85, COPPER, { top: tone(COPPER, 1.15) });
      flag(p, tower.u0 + 0.22, tower.v0 + 0.22, tower.z1 + 0.85, 1.1, 0x2e6fb5);
    },
  };
}

/** HARBOUR OFFICE: red brick on a stone base, two floors, white trim, a harbour lantern over the door, bollards and an anchor out front. */
export function harbour(f: Footprint): Building {
  const m: Mass = {
    ...inside(f, [0.22, 0.22, 0.4, 0.3], PLINTH.h, PLINTH.h + 3.6), wall: BRICK, storey: 1.8,
    facade: { kind: "windows", glass: GLASS, frame: FRAME, w: 0.18, gap: 0.18, sill: 0.4, head: 0.45 },
    roof: { kind: "parapet", deck: 0x3d4a57, rim: FRAME, h: 0.2 },
    cornice: { colour: FRAME, h: 0.16, out: 0.04 },
    base: { colour: STONE, h: 0.35 },
    bands: { colour: FRAME, h: 0.08 },
  };
  const mid = (m.u0 + m.u1) / 2;
  const live = turning([], [{ u: mid + 0.32, v: m.v1 + 0.1, z: m.z0 + 1.5, colour: 0x3fe07a, period: 3 }]);
  return {
    plinth: PLINTH, masses: [m], crane: "tower", live,
    grounds: paved,
    details: (p) => {
      door(p, m, mid, 0.32, 1.2, 0x23415e);
      // The lantern on a bracket by the door, green for the harbour.
      p.box(mid + 0.3, m.v1, mid + 0.34, m.v1 + 0.1, m.z0 + 1.62, m.z0 + 1.66, 0x2b2f33);
      p.box(mid + 0.28, m.v1 + 0.06, mid + 0.36, m.v1 + 0.14, m.z0 + 1.4, m.z0 + 1.6, 0x2b2f33, { top: 0x1c1f23 });
      flag(p, f.w - 0.2, f.h - 0.22, PLINTH.h, 3.4, 0x2e6fb5);
      // A lifebuoy on the wall; a chimney on the roof.
      p.dot(m.u0 + 0.25, m.v1 + 0.01, m.z0 + 1.1, 0.07, 0xf26b3a);
      p.dot(m.u0 + 0.25, m.v1 + 0.012, m.z0 + 1.1, 0.035, BRICK);
      p.box(m.u0 + 0.2, m.v0 + 0.2, m.u0 + 0.38, m.v0 + 0.34, m.z1, m.z1 + 0.6, BRICK, { top: 0x3a3f45 });
      p.box(m.u0 + 0.18, m.v0 + 0.18, m.u0 + 0.4, m.v0 + 0.36, m.z1 + 0.6, m.z1 + 0.66, FRAME);
      // Bollards along the front, and an anchor laid against the wall's foot.
      for (let u = m.u0 + 0.15; u < m.u1; u += 0.35) {
        p.box(u - 0.035, f.h - 0.16, u + 0.035, f.h - 0.09, PLINTH.h, PLINTH.h + 0.22, 0x2b2f33, { top: 0x3a3f45 });
      }
      p.box(m.u1 + 0.1, m.v1 - 0.6, m.u1 + 0.14, m.v1 - 0.2, PLINTH.h, PLINTH.h + 0.06, 0x3a3f45);
      p.box(m.u1 + 0.08, m.v1 - 0.25, m.u1 + 0.16, m.v1 - 0.15, PLINTH.h, PLINTH.h + 0.1, 0x3a3f45);
      drawLiveBase(p, live);
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

/** CONFERENCE CENTRE: a wide glass hall between white fins under a stepped vault, a screen on its roof, banners down its front and flags along the kerb. */
export function conference(f: Footprint): Building {
  const m: Mass = {
    ...inside(f, 0.22, PLINTH.h, PLINTH.h + 3.4), wall: 0xe8e4da, storey: 3.4,
    facade: { kind: "curtain", glass: GLASS, mullion: 0xf4f3ee, every: 0.4, spandrel: 0xe8e4da },
    roof: { kind: "flat", deck: 0xe8e4da },
    cornice: { colour: 0xf2efe6, h: 0.3, out: 0.06 },
    piers: { colour: 0xf8f7f2, every: 0.8, w: 0.09 },
    base: { colour: 0xb9b5ab, h: 0.15 },
  };
  const vault = (k: number): Mass => ({
    u0: m.u0 + 0.35 * k, v0: m.v0 + 0.35 * k, u1: m.u1 - 0.35 * k, v1: m.v1 - 0.35 * k,
    z0: m.z1 + (k - 1) * 0.32, z1: m.z1 + k * 0.32, wall: 0xe8e4da, storey: 1,
    facade: { kind: k === 1 ? "ribbon" : "plain", glass: 0x9cc3d8, sill: 0.06, head: 0.06, edge: 0.05 } as Mass["facade"],
    roof: { kind: "flat", deck: tone(0xe8e4da, 1.04) },
  });
  const top = vault(3);
  const live = turning([0.5, 1.0].map((du) => ({ u: top.u0 + du, v: top.v0 + 0.25, z: top.z1 + 0.34, r: 0.1, housing: tone(PLANT, 0.82) })));
  return {
    plinth: PLINTH, masses: [m, vault(1), vault(2), top], crane: "tower", live,
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
        p.onV(m.v1 + 0.011, u - 0.09, u + 0.09, m.z0 + 1.2, m.z0 + 1.3, WHITE);
      }
      for (let v = m.v0 + 0.3; v < m.v1 - 0.15; v += 0.55, k++) {
        p.onU(m.u1 + 0.01, v - 0.09, v + 0.09, m.z0 + 1.2, m.z1 - 0.35, tone(k % 2 ? 0xff4fa3 : 0x2e6fb5, 0.76));
      }
      // THE SCREEN on the roof, over the doors: what is on today.
      const sv = top.v1 - 0.1;
      roofSign(p, mid - 0.7, mid + 0.7, sv, top.z1, 1.3, 0x1c2026, 0x6fc3ff);
      for (const du of [0.5, 1.0]) unit(p, top.u0 + du, top.v0 + 0.25, top.z1);
      // Flags along the kerb, and a taxi waiting.
      const colours = [0xff4fa3, 0x2e6fb5, 0xf2c230, 0x2fa35a];
      let j = 0;
      for (let u = 0.25; u < f.w - 0.4; u += 0.7, j++) if (Math.abs(u - mid) > 0.6) flag(p, u, f.h - 0.1, PLINTH.h, 2.2, colours[j % colours.length]);
      car(p, mid + 0.95, f.h - 0.12, PLINTH.h, 0xf2c230);
      drawLiveBase(p, live);
    },
  };
}

/** HACKERSPACE: an old brick warehouse on a sawtooth of roof lights, a mural down its side, a roller door open, a mast and a neon sign over the yard. */
export function hackerspace(f: Footprint): Building {
  const m: Mass = {
    ...inside(f, [0.2, 0.2, 0.2, 0.75], 0.15, 3.1), wall: BRICK, storey: 3,
    facade: { kind: "windows", glass: 0x55707c, frame: 0x3a3f45, w: 0.32, gap: 0.2, sill: 0.9, head: 0.35 },
    roof: { kind: "parapet", deck: 0x5a5550, rim: tone(BRICK, 0.85), h: 0.22 },
    cornice: { colour: tone(BRICK, 0.8), h: 0.12, out: 0.03 },
    base: { colour: 0x8f8a80, h: 0.3 },
    piers: { colour: tone(BRICK, 0.88), every: 0.52, w: 0.08 },
  };
  const mu = m.u1 - 0.45, mv = m.v0 + 0.45;
  const live = turning([], [mastLight(mu, mv, m.z1, 2.2, 0x3fe0a8)]);
  return {
    plinth: { inset: 0.05, h: 0.15, colour: 0xa7a39b, top: 0xb9b5ab },
    masses: [m],
    crane: "tower", live,
    grounds: (p) => {
      // A concrete yard out front, a painted lane across it.
      p.flat(0.08, m.v1, f.w - 0.08, f.h - 0.04, 0.004, 0xb9b5ab);
      p.flat(0.08, f.h - 0.3, f.w - 0.08, f.h - 0.26, 0.006, 0xf2c230);
    },
    details: (p) => {
      const mid = (m.u0 + m.u1) / 2;
      // THE SAWTOOTH: a row of roof lights, each a steep glazed face toward the light and a slope behind.
      for (let v = m.v0 + 0.25; v < m.v1 - 0.25; v += 0.5) {
        for (let k = 0; k < 4; k++) {
          const z = m.z1 + k * 0.1;
          p.box(m.u0 + 0.2, v + k * 0.08, m.u1 - 0.8, v + 0.36, z, z + 0.1, 0x8f8a80, { top: tone(0x8f8a80, 1.1) });
        }
        p.onV(v + 0.36, m.u0 + 0.2, m.u1 - 0.8, m.z1, m.z1 + 0.4, tone(GLASS, 1.05));
        p.onV(v + 0.361, m.u0 + 0.2, m.u1 - 0.8, m.z1 + 0.25, m.z1 + 0.4, mix(GLASS, WHITE, 0.35));
      }
      // THE MURAL down the side: shapes in loud colours over the brick.
      const b0 = m.v0 + 0.15, b1 = m.v1 - 0.15;
      p.onU(m.u1 + 0.004, b0, b1, m.z0 + 0.4, m.z1 - 0.5, tone(0x2b2f33, RIGHT));
      const C = [0xff4fa3, 0x3fe0a8, 0xf2c230, 0x6c7cff];
      for (let k = 0; k < 7; k++) {
        const b = b0 + 0.05 + ((k * 0.37) % 1) * (b1 - b0 - 0.4), z = m.z0 + 0.55 + ((k * 0.53) % 1) * (m.z1 - m.z0 - 1.4);
        p.onU(m.u1 + 0.006, b, b + 0.18 + (k % 3) * 0.08, z, z + 0.3 + (k % 2) * 0.35, tone(C[k % 4], 0.8));
      }
      // The roller door, open, the workshop lit inside: benches and a printer's glow.
      p.onV(m.v1, mid - 0.55, mid + 0.55, m.z0, m.z0 + 1.75, 0x3a3f45);
      p.onV(m.v1, mid - 0.5, mid + 0.5, m.z0, m.z0 + 1.6, 0xffd27a);
      p.onV(m.v1, mid - 0.45, mid + 0.45, m.z0 + 0.4, m.z0 + 0.5, 0x8a6a44);
      p.onV(m.v1, mid - 0.2, mid + 0.0, m.z0 + 0.5, m.z0 + 0.9, 0x3a3f45);
      p.onV(m.v1, mid - 0.16, mid - 0.04, m.z0 + 0.6, m.z0 + 0.8, 0xff8a3a);
      p.onV(m.v1, mid - 0.5, mid + 0.5, m.z0 + 1.35, m.z0 + 1.6, 0x8a9198);
      // The neon sign on the roof, toward the yard, and the mast.
      roofSign(p, m.u0 + 0.2, m.u0 + 1.6, m.v1 - 0.15, m.z1, 0.9, 0x15181c, 0x3fe0a8);
      mast(p, mu, mv, m.z1, 2.2, 0x3fe0a8);
      waterTank(p, m.u1 - 0.45, m.v1 - 0.45, m.z1);
      // In the yard: a shipping container, a bench, the bikes and a lamp.
      p.box(f.w - 1.55, m.v1 + 0.15, f.w - 0.2, m.v1 + 0.6, 0.15, 0.85, 0x2e6fb5);
      for (let u = f.w - 1.45; u < f.w - 0.3; u += 0.12) p.onV(m.v1 + 0.6, u, u + 0.03, 0.2, 0.8, tone(0x2e6fb5, 0.8));
      p.onV(m.v1 + 0.601, f.w - 1.4, f.w - 0.9, 0.45, 0.6, WHITE);
      bench(p, 0.7, m.v1 + 0.35, 0.15, "u", 0x8a5a34);
      bikes(p, mid + 0.75, Math.min(mid + 1.35, f.w - 1.65), m.v1 + 0.4, 0.15, [0xd8432f, 0x2f8f6b, 0xf2c230]);
      lamp(p, 0.2, f.h - 0.2, 0.15);
      drawLiveBase(p, live);
    },
  };
}

/** IPO TOWER: very tall gold glass between gold piers, a stock ticker round it near the top, a setback crown, a beacon — and a bronze bull in the plaza. */
export function ipo(f: Footprint): Building {
  const lobby: Mass = {
    ...inside(f, 0.24, PLINTH.h, PLINTH.h + 2.2), wall: 0x2c3a44, storey: 2.2,
    facade: { kind: "curtain", glass: 0x3f6273, mullion: 0xd8b04a, every: 0.32 },
    roof: { kind: "flat", deck: 0x2c3a44 },
    base: { colour: 0x1c252c, h: 0.2 },
  };
  const tower: Mass = {
    ...inside(f, 0.55, lobby.z1, lobby.z1 + 22), wall: 0xd8b04a, storey: 2,
    facade: { kind: "curtain", glass: 0xe0bb55, mullion: 0xfff1b8, every: 0.25, spandrel: 0xb9922f },
    roof: { kind: "flat", deck: 0x8a6d2a },
    piers: { colour: 0xb9922f, every: 0.48, w: 0.05 },
  };
  const crown: Mass = {
    ...inside(f, 0.8, tower.z1, tower.z1 + 2), wall: 0xd8b04a, storey: 1,
    facade: { kind: "fins", glass: 0xfff1b8, fin: 0xb9922f, every: 0.14 },
    roof: { kind: "parapet", deck: 0x8a6d2a, rim: 0xd8b04a, h: 0.3 },
  };
  const cu = (tower.u0 + tower.u1) / 2, cv = (tower.v0 + tower.v1) / 2;
  const live = turning([], [{ u: cu, v: cv, z: crown.z1 + 2.7, colour: 0xff3b2f, period: 1.4 }]);
  return {
    plinth: PLINTH, masses: [lobby, tower, crown], crane: "tower", live,
    grounds: paved,
    details: (p) => {
      door(p, lobby, (lobby.u0 + lobby.u1) / 2, 0.5, 1.4, 0x15181c, 0xd8b04a);
      // The ticker: a dark band round the top, green and red figures on it.
      const z = tower.z1 - 2.6;
      p.box(tower.u0 - 0.03, tower.v0 - 0.03, tower.u1 + 0.03, tower.v1 + 0.03, z, z + 0.6, 0x15181c, { noTop: true });
      for (let a = tower.u0 + 0.08; a < tower.u1 - 0.1; a += 0.2) p.onV(tower.v1 + 0.03, a, a + 0.12, z + 0.22, z + 0.38, hash(a * 9) < 0.3 ? 0xff5a4f : 0x3fe07a);
      for (let b = tower.v0 + 0.08; b < tower.v1 - 0.1; b += 0.2) p.onU(tower.u1 + 0.03, b, b + 0.12, z + 0.22, z + 0.38, tone(hash(b * 7) < 0.3 ? 0xff5a4f : 0x3fe07a, 0.85));
      // The beacon's mast.
      p.box(cu - 0.04, cv - 0.04, cu + 0.04, cv + 0.04, crown.z1, crown.z1 + 2.4, 0xa9852c);
      p.box(cu - 0.07, cv - 0.07, cu + 0.07, cv + 0.07, crown.z1 + 2.4, crown.z1 + 2.6, 0x5a4a2a);
      // THE BULL, charging across the plaza on a granite block.
      const bu = 0.6, bv = f.h - 0.3, bz = PLINTH.h;
      p.box(bu - 0.28, bv - 0.1, bu + 0.28, bv + 0.1, bz, bz + 0.15, 0x3a3f45, { top: 0x4a525b });
      const BRONZE = 0x8a5a2a;
      for (const du of [-0.17, 0.12]) for (const dv of [-0.05, 0.05]) p.box(bu + du - 0.02, bv + dv - 0.02, bu + du + 0.02, bv + dv + 0.02, bz + 0.15, bz + 0.38, BRONZE);
      p.box(bu - 0.22, bv - 0.08, bu + 0.16, bv + 0.08, bz + 0.33, bz + 0.6, BRONZE, { top: tone(BRONZE, 1.2) });
      p.box(bu + 0.14, bv - 0.06, bu + 0.26, bv + 0.06, bz + 0.3, bz + 0.5, BRONZE, { top: tone(BRONZE, 1.2) });
      for (const s of [-1, 1]) p.strut([bu + 0.22, bv + s * 0.05, bz + 0.5], [bu + 0.3, bv + s * 0.12, bz + 0.62], 0.025, 0xd8b04a);
      drawLiveBase(p, live);
    },
  };
}

/** THE CAFÉ: a little brick shop, its window in a frame, a striped awning, string lights over the tables out front and a flue on the roof. */
export function cafe(f: Footprint): Building {
  const m: Mass = {
    u0: 0.22, v0: 0.12, u1: f.w - 0.18, v1: f.h - 0.42, z0: 0.12, z1: 2.3, wall: 0xb46a4c, storey: 2.18,
    facade: { kind: "plain" },
    ground: { kind: "ribbon", glass: GLASS, frame: FRAME, sill: 0.25, head: 0.85, edge: 0.15 },
    roof: { kind: "parapet", deck: 0x4b3a33, rim: 0xe9e2d0, h: 0.16 },
    cornice: { colour: 0xe9e2d0, h: 0.12, out: 0.03 },
    base: { colour: 0x2f8f6b, h: 0.22 },
  };
  return {
    plinth: { inset: 0.04, h: 0.12, colour: STONE, top: PAVING }, masses: [m], crane: "none",
    grounds: paved,
    details: (p) => {
      // The warm inside through the window: a counter and the coffee machine.
      p.onV(m.v1 + 0.001, m.u0 + 0.2, m.u1 - 0.2, 0.37, 0.6, 0x8a6a44, 0.85);
      p.onV(m.v1 + 0.002, m.u1 - 0.55, m.u1 - 0.35, 0.6, 0.85, 0xc9ccd1);
      p.onV(m.v1 + 0.001, m.u0 + 0.15, m.u1 - 0.15, 0.37, 1.45, 0xffd27a, 0.14);
      // The awning, striped, over the window.
      let k = 0;
      for (let u = m.u0; u < m.u1 - 1e-6; u += 0.2, k++) {
        p.box(u, m.v1, Math.min(m.u1, u + 0.2), m.v1 + 0.24, 1.3, 1.45, k % 2 ? 0xf2efe6 : 0x2f8f6b);
        p.onV(m.v1 + 0.24, u, Math.min(m.u1, u + 0.2), 1.22, 1.3, k % 2 ? 0xf2efe6 : 0x2f8f6b);
      }
      p.box(m.u0 + 0.3, m.v1, m.u1 - 0.3, m.v1 + 0.03, 1.65, 1.95, 0x2f8f6b);
      p.onV(m.v1 + 0.03, m.u0 + 0.4, m.u1 - 0.5, 1.75, 1.85, 0xf2efe6);
      // Two tables, each with two chairs; the menu board.
      for (const tu of [m.u0 + 0.35, m.u0 + 0.95]) {
        const tv = f.h - 0.2;
        if (tu > m.u1 - 0.3) continue;
        p.box(tu - 0.07, tv - 0.07, tu + 0.07, tv + 0.07, 0.12, 0.45, 0x9a7349, { top: 0xf2efe6 });
        for (const du of [-0.17, 0.17]) p.box(tu + du - 0.045, tv - 0.045, tu + du + 0.045, tv + 0.045, 0.12, 0.32, 0x333a40);
      }
      p.box(m.u1 - 0.25, f.h - 0.25, m.u1 - 0.15, f.h - 0.2, 0.12, 0.6, 0x2b2f33);
      p.onV(f.h - 0.199, m.u1 - 0.24, m.u1 - 0.16, 0.3, 0.55, 0xf2efe6, 0.6);
      // STRING LIGHTS from the awning's edge out to a pole and back, bulbs along them.
      const pu = m.u1 - 0.05, pv = f.h - 0.06;
      p.box(pu - 0.012, pv - 0.012, pu + 0.012, pv + 0.012, 0.12, 1.45, 0x3a3f45);
      for (const u0 of [m.u0 + 0.05]) {
        const a: [number, number, number] = [u0, m.v1 + 0.24, 1.3], b: [number, number, number] = [pu, pv, 1.4];
        for (let s = 0; s < 8; s++) {
          const t0 = s / 8, t1 = (s + 1) / 8, sag = (t: number) => -0.18 * Math.sin(Math.PI * t);
          const at = (t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t + sag(t)];
          p.strut(at(t0), at(t1), 0.006, 0x2b2f33);
          const q = at(t1);
          if (s < 7) p.dot(q[0], q[1], q[2] - 0.02, 0.018, 0xfff1a8);
        }
      }
      // The flue on the roof.
      p.box(m.u0 + 0.25, m.v0 + 0.1, m.u0 + 0.33, m.v0 + 0.18, m.z1, m.z1 + 0.55, 0x9aa3ab);
      p.box(m.u0 + 0.22, m.v0 + 0.07, m.u0 + 0.36, m.v0 + 0.21, m.z1 + 0.55, m.z1 + 0.6, 0x7a838c);
    },
  };
}

/**
 * THE PARK: grass, gravel paths crossing it to a round plaza, a fountain in
 * the middle, trees, benches facing across the paths, a flower bed, a lamp
 * and a bin. The fountain, trees and benches come from the props sheet, the
 * grass from the ground's own shader; drawn as before without them.
 */
export function park(f: Footprint): Building {
  const mu = f.w / 2, mv = f.h / 2;
  const FLOWERS = [0xd8432f, 0xf2c230, 0xf27aa8, 0xa65ad6];
  const baked = bakedProps();
  const props: PropPlace[] = [
    { id: "oak", u: mu * 0.45, v: mv * 0.5, turn: 1, tint: 0x5f8f3e, size: 0.9 },
    { id: "lime", u: mu * 1.55, v: mv * 0.42, turn: 2, tint: 0x6f9d45, size: 0.8 },
    { id: "cherry", u: mu * 0.45, v: mv * 1.5, turn: 0, tint: 0xf2b3cb, size: 0.9 },
    { id: "birch", u: f.w - 0.22, v: mv * 1.25, turn: 3, tint: 0x8fb552, size: 0.85 },
    // Benches beside the paths, facing across them.
    { id: "bench", u: mu + 0.55, v: mv - 0.2, turn: 1 },
    { id: "bench", u: mu - 0.2, v: mv + 0.55, turn: 0 },
    { id: "fountain", u: mu, v: mv, turn: 0 },
  ];
  return {
    plinth: { inset: 0, h: 0, colour: LAWN }, masses: [], crane: "none",
    props: baked ? props : undefined,
    lawn: (p) => {
      p.flat(0.04, 0.04, f.w - 0.04, f.h - 0.04, 0.03, LAWN);
      // Mown stripes.
      for (let u = 0.04; u < f.w - 0.1; u += 0.3) p.flat(u, 0.04, u + 0.15, f.h - 0.04, 0.031, tone(LAWN, 1.05));
    },
    grounds: (p) => {
      // The paths, a plaza where they cross, stone edging along them.
      p.flat(0.04, mv - 0.09, f.w - 0.04, mv + 0.09, 0.034, GRAVEL);
      p.flat(mu - 0.09, 0.04, mu + 0.09, f.h - 0.04, 0.034, GRAVEL);
      disc(p, mu, mv, 0.3, 0.035, GRAVEL);
      for (const s of [-1, 1]) {
        p.flat(0.04, mv + s * 0.09 - 0.006, f.w - 0.04, mv + s * 0.09 + 0.006, 0.036, STONE);
        p.flat(mu + s * 0.09 - 0.006, 0.04, mu + s * 0.09 + 0.006, f.h - 0.04, 0.036, STONE);
      }
      // A hedge along the back, and a flower bed in the front corner.
      hedge(p, 0.06, 0.06, f.w - 0.06, 0.16, 0.03, 0.4);
      hedge(p, 0.06, 0.16, 0.16, f.h - 0.06, 0.03, 0.4);
    },
    details: (p) => {
      flowerBed(p, mu + 0.25, mv + 0.25, f.w - 0.15, f.h - 0.15, FLOWERS);
      lamp(p, mu + 0.18, mv + 0.18, 0.03);
      p.box(mu + 0.15, mv - 0.25, mu + 0.2, mv - 0.2, 0.03, 0.22, 0x2f5a3a, { top: 0x1c1f23 });
      if (baked) return;
      // Without the sheet: the fountain, trees and benches drawn as before.
      p.box(mu - 0.3, mv - 0.3, mu + 0.3, mv + 0.3, 0.03, 0.2, STONE, { top: STONE_TOP });
      p.flat(mu - 0.25, mv - 0.25, mu + 0.25, mv + 0.25, 0.201, 0x5fa9c4);
      p.box(mu - 0.05, mv - 0.05, mu + 0.05, mv + 0.05, 0.2, 0.55, STONE);
      p.dot(mu, mv, 0.72, 0.05, 0xcfe8f0, 0.9);
      tree(p, mu * 0.5, mv * 0.5, 0.03);
      tree(p, mu * 1.5, mv * 0.5, 0.03, 0.9);
      tree(p, mu * 0.5, mv * 1.5, 0.03, 1.05);
      bench(p, mu * 1.5, mv - 0.25, 0.03);
      bench(p, mu - 0.25, mv * 1.5, 0.03, "v");
    },
  };
}

/** THE GYM: a grey shed in ribbed cladding, tall windows full of treadmills, a yellow band and a dumbbell on the roof. */
export function gym(f: Footprint): Building {
  const m: Mass = {
    ...inside(f, 0.2, PLINTH.h, PLINTH.h + 2.6), wall: 0x9aa3ad, storey: 2.6,
    facade: { kind: "windows", glass: GLASS, frame: 0x7a838c, w: 0.14, gap: 0.2, sill: 0.35, head: 0.4 },
    roof: { kind: "parapet", deck: 0x4b5259, rim: 0x7a838c, h: 0.18 },
    base: { colour: 0x4b5259, h: 0.25 },
    piers: { colour: 0x8a939d, every: 0.17, w: 0.025 },
  };
  const live = turning([{ u: m.u1 - 0.35, v: m.v0 + 0.3, z: m.z1 + 0.34, r: 0.1, housing: tone(PLANT, 0.82) }]);
  return {
    plinth: PLINTH, masses: [m], crane: "none", live,
    grounds: paved,
    details: (p) => {
      // THE FRONT WINDOW: a wide pane, the machines inside in a row.
      const w0 = m.u0 + 0.7, w1 = m.u1 - 0.1;
      p.onV(m.v1 + 0.004, w0 - 0.03, w1 + 0.03, m.z0 + 0.3, m.z0 + 1.6, 0x2b2f33);
      p.onV(m.v1 + 0.005, w0, w1, m.z0 + 0.33, m.z0 + 1.57, 0x3a5866);
      for (let u = w0 + 0.1; u < w1 - 0.1; u += 0.22) {
        p.onV(m.v1 + 0.006, u, u + 0.14, m.z0 + 0.33, m.z0 + 0.5, 0x1c1f23);
        p.onV(m.v1 + 0.006, u + 0.1, u + 0.13, m.z0 + 0.5, m.z0 + 0.85, 0x1c1f23);
        p.onV(m.v1 + 0.006, u + 0.08, u + 0.14, m.z0 + 0.82, m.z0 + 0.88, 0xf2b43c);
      }
      p.onV(m.v1 + 0.007, w0, w1, m.z0 + 1.1, m.z0 + 1.57, mix(GLASS, WHITE, 0.3), 0.4);
      door(p, m, m.u0 + 0.4, 0.34, 1.2, DARK, 0xf2b43c);
      const mu = (m.u0 + m.u1) / 2, mv = (m.v0 + m.v1) / 2, z = m.z1;
      p.box(mu - 0.02, mv - 0.02, mu + 0.02, mv + 0.02, z, z + 0.8, 0x26292d);
      p.box(mu - 0.38, mv - 0.03, mu + 0.38, mv + 0.03, z + 0.8, z + 0.88, 0x9aa3ad);
      for (const du of [-0.32, 0.32]) p.box(mu + du - 0.05, mv - 0.14, mu + du + 0.05, mv + 0.14, z + 0.6, z + 1.08, 0x26292d);
      p.box(m.u0 + 0.1, m.v1, m.u1 - 0.1, m.v1 + 0.03, m.z1 - 0.5, m.z1 - 0.15, 0xf2b43c);
      lettering(p, m.v1 + 0.031, m.u0 + 0.25, m.u1 - 0.25, m.z1 - 0.43, m.z1 - 0.22, DARK, 4);
      unit(p, m.u1 - 0.35, m.v0 + 0.3, m.z1);
      drawLiveBase(p, live);
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

/** THE NIGHT CLUB: a black box, no windows, neon round its top and up its corner, speakers on the roof and a rope at the door. */
export function club(f: Footprint): Building {
  const NEON = 0xd25bff, NEON2 = 0x3fd8ff;
  const m: Mass = {
    ...inside(f, 0.2, PLINTH.h, CLUB_TOP), wall: 0x2a2633, storey: 2.3,
    facade: { kind: "plain", lines: 0x24202c, every: 0.5 },
    roof: { kind: "parapet", deck: 0x1d1a24, rim: 0x3a3546, h: 0.16 },
    base: { colour: 0x15131b, h: 0.2 },
  };
  const mid = (m.u0 + m.u1) / 2;
  // The bulbs round the sign, chasing.
  const bulbs: Beacon[] = [];
  for (let k = 0; k <= 8; k++) bulbs.push({ u: mid - 0.55 + k * 0.1375, v: m.v1 + 0.045, z: m.z0 + 2.02, colour: NEON2, period: 0.9, phase: k * 0.11 });
  const live = turning([], bulbs);
  return {
    plinth: { ...PLINTH, top: 0x4a4752 }, masses: [m], crane: "none", live,
    grounds: (p) => p.flat(0.02, 0.02, f.w - 0.02, f.h - 0.02, 0.004, 0x4a4752),
    details: (p) => {
      // The neon, round the top of the two faces seen, and up the corner.
      p.onV(m.v1, m.u0, m.u1, m.z1 - 0.42, m.z1 - 0.34, NEON);
      p.onU(m.u1, m.v0, m.v1, m.z1 - 0.42, m.z1 - 0.34, NEON);
      p.onV(m.v1 + 0.002, m.u0, m.u1, m.z1 - 0.5, m.z1 - 0.26, NEON, 0.2);
      p.onV(m.v1 + 0.003, m.u1 - 0.1, m.u1 - 0.06, m.z0 + 0.2, m.z1 - 0.5, NEON2);
      p.onU(m.u1 + 0.003, m.v1 - 0.1, m.v1 - 0.06, m.z0 + 0.2, m.z1 - 0.5, NEON2);
      // The sign, lettered in neon, over the door.
      p.box(mid - 0.55, m.v1, mid + 0.55, m.v1 + 0.04, m.z0 + 1.55, m.z0 + 2.0, 0x15131b);
      lettering(p, m.v1 + 0.042, mid - 0.45, mid + 0.45, m.z0 + 1.65, m.z0 + 1.9, NEON);
      door(p, m, mid, 0.36, 1.25, 0x111015, 0x6b5a7a);
      // The rope: posts and a red cord, out front.
      for (const u of [mid - 0.45, mid - 0.15, mid + 0.15]) p.box(u - 0.02, m.v1 + 0.3, u + 0.02, m.v1 + 0.34, PLINTH.h, PLINTH.h + 0.5, 0xd8c070);
      p.box(mid - 0.45, m.v1 + 0.31, mid + 0.15, m.v1 + 0.33, PLINTH.h + 0.38, PLINTH.h + 0.43, 0xb0182e);
      // The lights on the roof the beams come off, and the speakers stacked at its back. @see drawMoving
      for (const du of [-0.3, 0.3]) p.box(f.w / 2 + du - 0.07, f.h / 2 - 0.07, f.w / 2 + du + 0.07, f.h / 2 + 0.07, m.z1, m.z1 + 0.18, 0x55505f);
      for (const u of [m.u0 + 0.25, m.u1 - 0.25]) {
        p.box(u - 0.1, m.v0 + 0.15, u + 0.1, m.v0 + 0.32, m.z1, m.z1 + 0.42, 0x15131b);
        p.dot(u, m.v0 + 0.33, m.z1 + 0.28, 0.05, 0x3a3546);
        p.dot(u, m.v0 + 0.33, m.z1 + 0.12, 0.035, 0x3a3546);
      }
      drawLiveBase(p, live);
    },
  };
}

/** THE CINEMA: a tall red hall on a dark base, cream pilasters, posters lit along its front, and a marquee over the doors. */
export function cinema(f: Footprint): Building {
  const RED = 0xa8242e, CREAM = 0xf1e4c4;
  const m: Mass = {
    ...inside(f, [MARQUEE.inset, MARQUEE.inset, MARQUEE.inset, MARQUEE.front], PLINTH.h, PLINTH.h + 3.4), wall: RED, storey: 3.4,
    facade: { kind: "plain" },
    roof: { kind: "parapet", deck: 0x4b3a33, rim: CREAM, h: 0.2 },
    cornice: { colour: CREAM, h: 0.14, out: 0.03 },
    base: { colour: 0x2b2228, h: 0.25 },
    piers: { colour: tone(RED, 0.85), every: 0.4, w: 0.05 },
  };
  const live = turning([{ u: m.u0 + 0.4, v: m.v0 + 0.35, z: m.z1 + 0.34, r: 0.1, housing: tone(PLANT, 0.82) }]);
  return {
    plinth: PLINTH, masses: [m], crane: "none", live,
    grounds: paved,
    details: (p) => {
      const mid = (m.u0 + m.u1) / 2;
      // Glass doors under the marquee, lit from inside.
      p.onV(m.v1, mid - 0.5, mid + 0.5, m.z0, m.z0 + 1.25, FRAME);
      p.onV(m.v1, mid - 0.46, mid + 0.46, m.z0, m.z0 + 1.2, tone(GLASS, 0.6));
      p.onV(m.v1 + 0.001, mid - 0.46, mid + 0.46, m.z0, m.z0 + 1.2, 0xffd27a, 0.25);
      for (const u of [mid - 0.16, mid + 0.16]) p.onV(m.v1, u - 0.012, u + 0.012, m.z0, m.z0 + 1.2, FRAME);
      // THE MARQUEE: a deep slab out over the doors, its board cream, lettered.
      p.box(m.u0 + 0.06, m.v1, m.u1 - 0.06, m.v1 + MARQUEE.out, MARQUEE.z0, MARQUEE.z1, 0x2b2228, { top: 0x3a2f35 });
      p.onV(m.v1 + MARQUEE.out + 0.002, m.u0 + 0.16, m.u1 - 0.16, MARQUEE.z0 + 0.06, MARQUEE.z1 - 0.12, CREAM);
      lettering(p, m.v1 + MARQUEE.out + 0.004, m.u0 + 0.3, m.u1 - 0.3, MARQUEE.z0 + 0.1, MARQUEE.z1 - 0.18, 0x2b2228, 7);
      // Posters either side in lit frames, and a tall sign up the corner.
      for (const u of [m.u0 + 0.12, m.u1 - 0.36]) {
        p.onV(m.v1, u - 0.02, u + 0.26, m.z0 + 0.22, m.z0 + 1.08, 0xd8b04a);
        p.onV(m.v1, u, u + 0.24, m.z0 + 0.25, m.z0 + 1.05, CREAM);
        p.onV(m.v1, u + 0.03, u + 0.21, m.z0 + 0.3, m.z0 + 1.0, u < mid ? 0x2f5f9f : 0xe0a030);
        p.onV(m.v1, u + 0.06, u + 0.18, m.z0 + 0.55, m.z0 + 0.75, u < mid ? 0xf2efe6 : 0x2b2228, 0.7);
      }
      p.box(m.u1 - 0.1, m.v1, m.u1 + 0.02, m.v1 + 0.3, m.z0 + 2.2, m.z1 + 0.6, CREAM);
      for (let k = 0; k < 5; k++) p.onU(m.u1 + 0.021, m.v1 + 0.08, m.v1 + 0.22, m.z0 + 2.35 + k * 0.32, m.z0 + 2.55 + k * 0.32, RED);
      unit(p, m.u0 + 0.4, m.v0 + 0.35, m.z1);
      drawLiveBase(p, live);
    },
  };
}

/** CO-WORKING: a warehouse done up — brick, big steel windows, a yellow sign, a roof terrace under string lights and bikes out front. */
export function coworking(f: Footprint): Building {
  const YELLOW = 0xf2c230;
  const m: Mass = {
    ...inside(f, 0.2, PLINTH.h, PLINTH.h + 3.6), wall: 0x9c5a44, storey: 1.8,
    facade: { kind: "windows", glass: GLASS, frame: 0x2b2f33, w: 0.36, gap: 0.12, sill: 0.25, head: 0.25 },
    ground: { kind: "ribbon", glass: GLASS, frame: 0x2b2f33, sill: 0.1, head: 0.3, edge: 0.12 },
    roof: { kind: "parapet", deck: ROOF, rim: 0x7e4a38, h: 0.18 },
    base: { colour: 0x5a5550, h: 0.12 },
    bands: { colour: 0x7e4a38, h: 0.08 },
  };
  const live = turning([{ u: m.u0 + 0.35, v: m.v0 + 0.3, z: m.z1 + 0.34, r: 0.1, housing: tone(PLANT, 0.82) }]);
  return {
    plinth: PLINTH, masses: [m], crane: "none", live,
    grounds: paved,
    details: (p) => {
      const mid = (m.u0 + m.u1) / 2;
      p.box(mid - 0.6, m.v1, mid + 0.6, m.v1 + 0.04, m.z0 + 1.55, m.z0 + 1.85, YELLOW);
      lettering(p, m.v1 + 0.042, mid - 0.5, mid + 0.5, m.z0 + 1.62, m.z0 + 1.78, 0x22262b, 6);
      bikes(p, m.u0 + 0.1, m.u0 + 0.75, m.v1 + 0.26, PLINTH.h, [0x2f8f6b, 0xd8432f, 0x2e6fb5]);
      planter(p, m.u1 - 0.2, m.v1 + 0.2, PLINTH.h, YELLOW);
      // THE ROOF TERRACE: decking, a table, string lights between posts.
      unit(p, m.u0 + 0.35, m.v0 + 0.3, m.z1);
      const t0 = m.u0 + 0.7, t1 = m.u1 - 0.15, v0 = m.v0 + 0.15, v1 = m.v1 - 0.15;
      p.flat(t0, v0, t1, v1, m.z1 + 0.01, 0xa47a50);
      for (let u = t0 + 0.1; u < t1; u += 0.1) p.flat(u - 0.004, v0, u + 0.004, v1, m.z1 + 0.012, 0x8a6440);
      p.box((t0 + t1) / 2 - 0.12, (v0 + v1) / 2 - 0.12, (t0 + t1) / 2 + 0.12, (v0 + v1) / 2 + 0.12, m.z1, m.z1 + 0.3, 0x2b2f33, { top: 0xf2efe6 });
      for (const [u, v] of [[t0, v1], [t1, v1]] as const) p.box(u - 0.012, v - 0.012, u + 0.012, v + 0.012, m.z1, m.z1 + 0.8, 0x2b2f33);
      for (let k = 0; k <= 6; k++) {
        const u = t0 + ((t1 - t0) * k) / 6, z = m.z1 + 0.78 - 0.12 * Math.sin((Math.PI * k) / 6);
        if (k < 6) p.strut([u, v1, z], [t0 + ((t1 - t0) * (k + 1)) / 6, v1, m.z1 + 0.78 - 0.12 * Math.sin((Math.PI * (k + 1)) / 6)], 0.006, 0x2b2f33);
        if (k > 0 && k < 6) p.dot(u, v1, z - 0.02, 0.018, 0xfff1a8);
      }
      drawLiveBase(p, live);
    },
  };
}

/** THE DOCTOR'S: a white clinic on a grey base, blue glass, a ramp with a rail up to the door, and a green cross out from the wall. */
export function doctor(f: Footprint): Building {
  const GREEN = 0x2fa35a;
  const m: Mass = {
    u0: 0.18, v0: 0.12, u1: f.w - 0.18, v1: f.h - 0.36, z0: 0.12, z1: 2.4, wall: 0xf1f2ee, storey: 2.28,
    facade: { kind: "ribbon", glass: 0x7fb0d6, frame: 0xdfe3e0, sill: 0.8, head: 0.4, edge: 0.15 },
    roof: { kind: "parapet", deck: 0x8a9096, rim: 0xdfe3e0, h: 0.14 },
    base: { colour: 0xb9bec4, h: 0.3 },
  };
  return {
    plinth: { inset: 0.04, h: 0.12, colour: STONE, top: PAVING }, masses: [m], crane: "none",
    grounds: paved,
    details: (p) => {
      door(p, m, m.u0 + 0.35, 0.34, 1.2, 0x7fb0d6, 0xdfe3e0);
      p.box(m.u0 + 0.6, m.v1, m.u1 - 0.1, m.v1 + 0.03, m.z0 + 1.45, m.z0 + 1.75, GREEN);
      lettering(p, m.v1 + 0.032, m.u0 + 0.7, m.u1 - 0.2, m.z0 + 1.52, m.z0 + 1.66, WHITE, 5);
      // The ramp: up to the door from the side, a rail along it.
      p.box(m.u0 + 0.55, m.v1, m.u0 + 1.15, m.v1 + 0.16, 0.12, 0.16, 0xd9d3c0, { top: 0xe6e1d2 });
      p.strut([m.u0 + 1.15, m.v1 + 0.15, 0.6], [m.u0 + 0.55, m.v1 + 0.15, 0.62], 0.018, 0x9aa3ab);
      for (const u of [m.u0 + 0.55, m.u0 + 0.85, m.u0 + 1.15]) p.box(u - 0.01, m.v1 + 0.14, u + 0.01, m.v1 + 0.16, 0.12, 0.61, 0x9aa3ab);
      // The cross, on a bracket at the corner, lit.
      const u = m.u1 - 0.05, z = m.z1 - 0.35;
      p.box(u - 0.01, m.v1, u + 0.01, m.v1 + 0.2, z - 0.02, z + 0.02, 0x9aa3ad);
      p.box(u - 0.03, m.v1 + 0.2, u + 0.03, m.v1 + 0.23, z - 0.3, z + 0.3, GREEN);
      p.box(u - 0.1, m.v1 + 0.2, u + 0.1, m.v1 + 0.23, z - 0.09, z + 0.09, GREEN);
      p.onV(m.v1 + 0.231, u - 0.015, u + 0.015, z - 0.26, z + 0.26, 0x9af0b8);
      p.onV(m.v1 + 0.231, u - 0.08, u + 0.08, z - 0.015, z + 0.015, 0x9af0b8);
      // A bench out front, a planter, and plant on the roof.
      p.box(m.u1 - 0.55, f.h - 0.2, m.u1 - 0.2, f.h - 0.1, 0.12, 0.35, 0x9a7349);
      planter(p, m.u0 + 0.12, f.h - 0.15, 0.12, 0xf2efe6);
      p.box(m.u1 - 0.5, m.v0 + 0.12, m.u1 - 0.2, m.v0 + 0.32, m.z1, m.z1 + 0.25, PLANT);
    },
  };
}

/** THE CLIMBING WALL: a tall shed in grey cladding, its front a wall of holds in every colour, a big window, and a boulder out front. */
export function climbing(f: Footprint): Building {
  const HOLDS = [0xe0603a, 0x3d8be0, 0xf2c230, 0x45b07a, 0xa65ad6, 0xf27aa8];
  const m: Mass = {
    ...inside(f, [0.2, 0.2, 0.2, 0.4], PLINTH.h, PLINTH.h + 4.2), wall: 0x8f9aa5, storey: 4.2,
    facade: { kind: "plain", lines: 0x84909b, every: 0.6 },
    roof: { kind: "flat", deck: 0x5d666f },
    base: { colour: 0x5d666f, h: 0.25 },
    piers: { colour: 0x7f8a95, every: 0.5, w: 0.04 },
  };
  const live = turning([{ u: m.u1 - 0.35, v: m.v0 + 0.3, z: m.z1 + 0.34, r: 0.1, housing: tone(PLANT, 0.82) }]);
  return {
    plinth: PLINTH, masses: [m], crane: "none", live,
    grounds: paved,
    details: (p) => {
      // THE WALL: a grey panel up the lit face, holds dotted all over it.
      const a0 = m.u0 + 0.12, a1 = m.u0 + 0.95;
      p.onV(m.v1 + 0.008, a0, a1, m.z0 + 0.2, m.z1 - 0.2, 0xb7bec4);
      for (let k = 0; k < 26; k++) {
        const u = a0 + 0.05 + ((k * 37) % 19) / 19 * (a1 - a0 - 0.1);
        const z = m.z0 + 0.4 + ((k * 23) % 17) / 17 * (m.z1 - m.z0 - 0.9);
        p.dot(u, m.v1 + 0.01, z, 0.022, HOLDS[k % HOLDS.length]);
      }
      // A window on the rest of it, and the door and sign.
      p.onV(m.v1, m.u0 + 1.1, m.u1 - 0.1, m.z0 + 1.6, m.z1 - 0.4, tone(GLASS, 0.85));
      p.onV(m.v1 + 0.001, m.u0 + 1.1, m.u1 - 0.1, m.z1 - 1.1, m.z1 - 0.4, mix(GLASS, WHITE, 0.3), 0.5);
      door(p, m, m.u0 + 1.35, 0.32, 1.2, DARK, 0xe0603a);
      p.box(m.u0 + 1.1, m.v1, m.u1 - 0.1, m.v1 + 0.03, m.z0 + 1.3, m.z0 + 1.5, 0xe0603a);
      // A rope hanging off the top.
      p.onV(m.v1 + 0.02, a0 + 0.4, a0 + 0.415, m.z0 + 0.5, m.z1 - 0.2, 0xf2efe6);
      // THE BOULDER out front: a lump of grey holds of its own, a crash mat under it.
      const bu = m.u0 + 0.5, bv = m.v1 + 0.22;
      p.flat(bu - 0.3, bv - 0.12, bu + 0.3, bv + 0.14, PLINTH.h + 0.01, 0x2e6fb5);
      p.box(bu - 0.18, bv - 0.08, bu + 0.18, bv + 0.08, PLINTH.h, PLINTH.h + 0.5, 0xa9b0b6, { top: 0xbfc5ca });
      for (let k = 0; k < 5; k++) p.dot(bu - 0.13 + k * 0.065, bv + 0.081, PLINTH.h + 0.12 + ((k * 7) % 4) * 0.08, 0.018, HOLDS[k]);
      unit(p, m.u1 - 0.35, m.v0 + 0.3, m.z1);
      drawLiveBase(p, live);
    },
  };
}

/**
 * SLOP REFINERY: a brick hall, a stack, two tanks behind, and at its front
 * corner the RECEIVING HOUSE — a concrete block banded in slop brown, both
 * its inlets flanged onto its faces, piped back to the tanks. A catwalk
 * along the tanks, a warning light on the stack.
 */
export function refinery(f: Footprint): Building {
  const m: Mass = {
    u0: 0.15, v0: 0.15, u1: f.w - 0.85, v1: f.h - 0.75, z0: PLINTH.h, z1: PLINTH.h + 2.2, wall: 0x8a6a52, storey: 2.2,
    facade: { kind: "windows", glass: tone(GLASS, 0.8), frame: 0x5e4636, w: 0.12, gap: 0.22, sill: 0.6, head: 0.5 },
    roof: { kind: "parapet", deck: 0x4b4038, rim: 0x5e4636, h: 0.14 },
    base: { colour: 0x5e4636, h: 0.25 },
    piers: { colour: tone(0x8a6a52, 0.86), every: 0.34, w: 0.05 },
  };
  const house: Mass = {
    u0: f.w - 0.78, v0: f.h - 0.7, u1: f.w - 0.14, v1: f.h - 0.14, z0: PLINTH.h, z1: PLINTH.h + 1.6, wall: 0xc9c4b8, storey: 1.6,
    facade: { kind: "plain", lines: 0xb9b4a8, every: 0.4 }, roof: { kind: "parapet", deck: 0x8f897e, rim: 0xa9a396, h: 0.1 },
  };
  const SLOP = 0x7a5230;
  const su = m.u0 + 0.4, sv = m.v0 + 0.4;
  const live = turning([], [{ u: su, v: sv, z: m.z1 + 1.72, colour: 0xff3b2f, period: 2 }]);
  return {
    plinth: { inset: 0.04, h: 0.2, colour: 0xa49d8f, top: 0xb7b0a2 }, masses: [m, house], crane: "none", live,
    grounds: (p) => {
      p.flat(0.02, 0.02, f.w - 0.02, f.h - 0.02, 0.004, 0xb7b0a2);
      // Slop spilt round the tanks' feet.
      p.flat(f.w - 0.7, 0.15, f.w - 0.25, 0.4, 0.006, SLOP, 0.35);
    },
    details: (p) => {
      door(p, m, m.u0 + 0.35, 0.36, 1.2, 0x2b2420, SLOP);
      // THE TANKS, behind the receiving house: round, banded in slop brown, each piped from it.
      const tu = (house.u0 + house.u1) / 2;
      // Each inside one tile: a drum is drawn whole by the tile its middle is in.
      // Run to the tile's edge: past it, behind the house, it would be drawn over the house's roof.
      p.box(tu - 0.035, 0.3, tu + 0.035, 0.999, 1.36, 1.44, 0x6f6a62);
      for (const v of [0.3, 0.75]) {
        drum(p, tu, v, 0.2, PLINTH.h, 1.75, 0xb9b3a6);
        drum(p, tu, v, 0.205, 0.95, 1.08, SLOP, { noTop: true });
        drum(p, tu, v, 0.205, 1.5, 1.56, 0x8f897e, { noTop: true });
        drum(p, tu, v, 0.06, 1.75, 1.85, 0x8f897e);
      }
      // The catwalk across the tanks' tops, railed.
      p.box(tu - 0.05, 0.3, tu + 0.05, 0.98, 1.85, 1.88, 0x6f6a62, { top: 0x8f897e });
      p.box(tu + 0.05, 0.3, tu + 0.06, 0.98, 1.88, 2.15, 0xd9a35a, { noTop: true, alpha: 0.9 });
      // THE RECEIVING HOUSE: its slop-brown band, a vent on its roof, a hatch on each face.
      p.box(house.u0, house.v0, house.u1 + 0.006, house.v1 + 0.006, house.z1 - 0.32, house.z1 - 0.2, SLOP, { noTop: true });
      p.box(house.u0 + 0.18, house.v0 + 0.18, house.u0 + 0.36, house.v0 + 0.36, house.z1, house.z1 + 0.3, 0x8f897e);
      p.box(house.u0 + 0.16, house.v0 + 0.16, house.u0 + 0.38, house.v0 + 0.38, house.z1 + 0.3, house.z1 + 0.36, 0x6f6a62);
      p.onV(house.v1 + 0.004, house.u0 + 0.06, house.u0 + 0.16, PLINTH.h + 0.1, PLINTH.h + 0.9, 0x6f6a62);
      p.onU(house.u1 + 0.004, house.v0 + 0.06, house.v0 + 0.16, PLINTH.h + 0.1, PLINTH.h + 0.9, 0x6f6a62);
      // THE STACK, hooped, and what comes out of it.
      p.box(su - 0.08, sv - 0.08, su + 0.08, sv + 0.08, m.z1, m.z1 + 1.8, 0x6e5a4a);
      for (const k of [0.4, 0.9, 1.3]) p.box(su - 0.085, sv - 0.085, su + 0.085, sv + 0.085, m.z1 + k, m.z1 + k + 0.04, 0x4b4038, { noTop: true });
      p.box(su - 0.09, sv - 0.09, su + 0.09, sv + 0.09, m.z1 + 1.55, m.z1 + 1.65, 0xd9a35a);
      p.dot(su + 0.05, sv, m.z1 + 2.05, 0.14, 0xcfc6b8, 0.85);
      p.dot(su + 0.15, sv - 0.05, m.z1 + 2.3, 0.1, 0xddd6ca, 0.7);
      p.dot(su + 0.24, sv - 0.08, m.z1 + 2.5, 0.07, 0xe6e0d6, 0.5);
      // "BEST PRACTICES", lit, on the front.
      p.box(m.u0 + 0.12, m.v1, m.u1 - 0.12, m.v1 + 0.03, m.z1 - 0.55, m.z1 - 0.2, 0x2b2420);
      p.onV(m.v1 + 0.03, m.u0 + 0.2, m.u1 - 0.22, m.z1 - 0.45, m.z1 - 0.32, 0x8ee07a);
      // Drums of the stuff stacked by the door.
      for (const [u, z] of [[m.u0 + 0.75, PLINTH.h], [m.u0 + 0.92, PLINTH.h]] as const) {
        p.box(u - 0.07, m.v1 + 0.1, u + 0.07, m.v1 + 0.24, z, z + 0.3, SLOP, { top: tone(SLOP, 1.2) });
        p.onV(m.v1 + 0.241, u - 0.07, u + 0.07, z + 0.12, z + 0.16, 0xd9a35a);
      }
      drawLiveBase(p, live);
    },
  };
}

/** TRAINING DATA PLANT: a long grey labelling hall between steel piers, a row of skylights, chillers on the roof and server cabinets humming along its side. */
export function dataplant(f: Footprint): Building {
  const m: Mass = {
    ...inside(f, [0.16, 0.2, 0.16, 0.3], PLINTH.h, PLINTH.h + 2.4), wall: 0xc9ccd1, storey: 2.4,
    facade: { kind: "ribbon", glass: 0x5a7f95, frame: 0x9aa1a8, sill: 0.9, head: 0.4 },
    roof: { kind: "parapet", deck: 0x5c636b, rim: 0x9aa1a8, h: 0.14 },
    base: { colour: 0x6b7178, h: 0.25 },
    piers: { colour: 0xb2b7bd, every: 0.45, w: 0.05 },
  };
  const fans = [m.u1 - 0.3].map((u) => ({ u, v: m.v1 - 0.35, z: m.z1 + 0.34, r: 0.1, housing: tone(PLANT, 0.82) }));
  const live = turning(fans, [0.86, 1.12].map((u, k) => ({ u, v: m.v1 + 0.245, z: PLINTH.h + 0.54, colour: 0x6c7cff, period: 0.7, phase: k * 0.3 })));
  return {
    plinth: PLINTH, masses: [m], crane: "none", live,
    grounds: paved,
    details: (p) => {
      // The door and the cabinets clear of the inlet, in the middle of its +u face's tile. @see SLOP_IN
      door(p, m, m.u0 + 0.35, 0.32, 1.15, 0x23292f, 0x6c7cff);
      // SKYLIGHTS along the roof.
      for (let u = m.u0 + 0.25; u < m.u1 - 0.55; u += 0.42) p.box(u - 0.12, m.v0 + 0.3, u + 0.12, m.v1 - 0.65, m.z1, m.z1 + 0.22, 0x9cc3d8, { top: 0xbfe0ee });
      // CABINETS out front, each with its lights, a cable tray back to the wall.
      for (const u of [0.86, 1.12]) {
        p.box(u - 0.1, m.v1 + 0.04, u + 0.1, m.v1 + 0.24, PLINTH.h, PLINTH.h + 0.7, 0x2f343a);
        p.onV(m.v1 + 0.24, u - 0.08, u + 0.08, PLINTH.h + 0.08, PLINTH.h + 0.45, 0x23272c);
        for (let z = PLINTH.h + 0.12; z < PLINTH.h + 0.42; z += 0.07) p.onV(m.v1 + 0.241, u - 0.06, u + 0.06, z, z + 0.02, 0x3fe0a8, 0.8);
      }
      p.box(0.76, m.v1, 1.22, m.v1 + 0.04, PLINTH.h + 0.7, PLINTH.h + 0.76, 0x9aa1a8);
      for (const fan of fans) unit(p, fan.u, fan.v, m.z1);
      roofSign(p, m.u0 + 0.2, m.u0 + 1.1, m.v1 - 0.15, m.z1, 0.9, 0x1f2430, 0x9fb0ff);
      drawLiveBase(p, live);
    },
  };
}

/** CONTENT FARM: a cheerful glass box crammed with ring lights, a billboard in chasing bulbs on top, a dish, and a queue of delivery vans. */
export function contentfarm(f: Footprint): Building {
  const m: Mass = {
    ...inside(f, 0.2, PLINTH.h, PLINTH.h + 3.0), wall: 0xf1e8f4, storey: 1.5,
    facade: { kind: "curtain", glass: 0xc59ad6, mullion: 0xf7f2f8, every: 0.3, spandrel: 0xe4d4ea },
    roof: { kind: "parapet", deck: ROOF, rim: 0xf1e8f4, h: 0.2 },
    base: { colour: 0xa8889f, h: 0.15 },
    piers: { colour: 0xffffff, every: 0.6, w: 0.05 },
  };
  const bu0 = m.u0 + 0.1, bu1 = m.u1 - 0.1, bv = m.v1 - 0.3 + 0.035;
  const bulbs: Beacon[] = [];
  const n = Math.round((bu1 - bu0) / 0.15);
  for (let k = 0; k <= n; k++) bulbs.push({ u: bu0 + ((bu1 - bu0) * k) / n, v: bv, z: m.z1 + 1.5 - 0.04, colour: 0xfff3a0, period: 1, phase: k * 0.12 });
  const live = turning([], bulbs);
  return {
    plinth: PLINTH, masses: [m], crane: "none", live,
    grounds: paved,
    details: (p) => {
      const mid = (m.u0 + m.u1) / 2;
      door(p, m, mid, 0.42, 1.2, 0x3a2442);
      canopy(p, m, mid, 0.9, m.z0 + 1.35, 0xe25f9e);
      // RING LIGHTS in the windows, both floors.
      for (const z of [m.z0 + 0.4, m.z0 + 1.9]) {
        for (let u = m.u0 + 0.25; u < m.u1 - 0.15; u += 0.4) {
          if (z < m.z0 + 1 && Math.abs(u - mid) < 0.5) continue;
          p.dot(u, m.v1 + 0.01, z + 0.25, 0.06, 0xfff3c4);
          p.dot(u, m.v1 + 0.011, z + 0.25, 0.035, 0xc59ad6);
        }
      }
      // THE DISH on the roof, toward the sky.
      const du = m.u0 + 0.4, dv = m.v0 + 0.35;
      p.box(du - 0.02, dv - 0.02, du + 0.02, dv + 0.02, m.z1, m.z1 + 0.35, 0x9aa3ab);
      p.dot(du, dv, m.z1 + 0.45, 0.17, 0xe6e9ec);
      p.dot(du + 0.02, dv, m.z1 + 0.47, 0.1, 0xc9ccd1);
      // THE BILLBOARD: thought leadership, at scale.
      roofSign(p, bu0, bu1, m.v1 - 0.3, m.z1, 1.5, 0xe25f9e, 0xfff3fa);
      // Delivery vans at the kerb.
      for (const u of [m.u1 - 0.35, m.u0 + 0.45]) {
        p.box(u - 0.25, f.h - 0.2, u + 0.25, f.h - 0.04, 0.02, 0.5, 0xf7f7f7);
        p.onV(f.h - 0.039, u + 0.12, u + 0.24, 0.28, 0.45, 0x2a3540);
        p.onV(f.h - 0.039, u - 0.2, u + 0.05, 0.2, 0.36, 0xe25f9e);
      }
      drawLiveBase(p, live);
    },
  };
}

/** AN R&D LAB: a white block on a grey base, a band of glass, fume stacks and solar on the roof, a dish with a light on it, a gas cage by the door. */
export function lab(f: Footprint): Building {
  const m: Mass = {
    ...inside(f, 0.2, PLINTH.h, PLINTH.h + 2.3), wall: 0xe9ecef, storey: 2.3,
    facade: { kind: "ribbon", glass: 0x6c9fb8, frame: 0xc3c9cf, sill: 0.7, head: 0.6 },
    roof: { kind: "parapet", deck: 0x6b7680, rim: 0xe9ecef, h: 0.18 },
    base: { colour: 0x9aa3ab, h: 0.2 },
    piers: { colour: 0xf6f7f8, every: 0.55, w: 0.06 },
  };
  const mu = m.u0 + 0.45, mv = m.v0 + 0.45;
  const live = turning([], [{ u: mu, v: mv, z: m.z1 + 0.85, colour: 0xff5a4f, period: 1.6 }]);
  return {
    plinth: PLINTH, masses: [m], crane: "none", live,
    grounds: paved,
    details: (p) => {
      door(p, m, m.u1 - 0.4, 0.3, 1.1, 0x2c3e48);
      // The dish.
      p.box(mu - 0.03, mv - 0.03, mu + 0.03, mv + 0.03, m.z1, m.z1 + 0.6, 0xa9b0b6);
      p.box(mu - 0.24, mv - 0.24, mu + 0.24, mv + 0.24, m.z1 + 0.6, m.z1 + 0.72, 0xdfe3e6);
      // FUME STACKS in a row, and solar over the rest of the roof.
      for (const u of [m.u1 - 0.55, m.u1 - 0.38, m.u1 - 0.21]) {
        p.box(u - 0.04, m.v0 + 0.25, u + 0.04, m.v0 + 0.33, m.z1, m.z1 + 0.85, 0xc3c9cf);
        p.box(u - 0.05, m.v0 + 0.24, u + 0.05, m.v0 + 0.34, m.z1 + 0.85, m.z1 + 0.9, 0x6b7680);
      }
      solar(p, m.u0 + 0.85, m.v0 + 0.55, m.u1 - 0.2, m.v1 - 0.15, m.z1);
      // The gas cage: bottles behind a mesh, by the side.
      const gu = m.u0 + 0.35, gv = m.v1 + 0.2;
      for (const du of [-0.08, 0, 0.08]) p.box(gu + du - 0.03, gv - 0.03, gu + du + 0.03, gv + 0.03, PLINTH.h, PLINTH.h + 0.45, du ? 0x2e6fb5 : 0x2fa35a, { top: 0x9aa3ab });
      p.box(gu - 0.15, gv - 0.08, gu + 0.15, gv + 0.08, PLINTH.h, PLINTH.h + 0.55, 0x9aa3ab, { alpha: 0.35 });
      planter(p, m.u1 - 0.1, m.v1 + 0.2, PLINTH.h);
      drawLiveBase(p, live);
    },
  };
}

/** A FLOOD WALL: a tile of concrete in cast panels, a band of sandbags along its top. */
export function levee(f: Footprint): Building {
  const m: Mass = {
    u0: 0, v0: 0, u1: f.w, v1: f.h, z0: 0, z1: 1.3, wall: 0xa8a294, storey: 1.3,
    facade: { kind: "plain", lines: 0x958f82, every: 0.43 },
    roof: { kind: "flat", deck: 0xc9c4b8 },
    piers: { colour: 0x9a9486, every: 0.5, w: 0.02 },
  };
  return {
    plinth: { inset: 0, h: 0, colour: STONE }, masses: [m], crane: "none",
    details: (p) => {
      // Water marks along the foot.
      p.onV(m.v1 + 0.004, 0, f.w, 0.05, 0.3, 0x5f6a5a, 0.35);
      p.onU(m.u1 + 0.004, 0, f.h, 0.05, 0.3, 0x5f6a5a, 0.35);
      // The sandbags, two courses, laid staggered.
      for (const [z, off] of [[1.3, 0], [1.5, 0.13]] as const) {
        for (let u = 0.08 + off; u < f.w - 0.1; u += 0.26) {
          const c = hash(u * 13 + z) < 0.5 ? 0xb59a62 : 0xa88e58;
          p.box(u, 0.2, Math.min(f.w - 0.06, u + 0.22), f.h - 0.2, z, z + 0.2, c, { top: tone(c, 1.12) });
        }
      }
    },
  };
}

/** A DERELICT BUILDING: grimy walls, boarded and broken windows, graffiti, its roof fallen in at a corner and the rubble at its foot. */
export function derelict(f: Footprint): Building {
  const m: Mass = {
    ...inside(f, 0.15, 0, 2.2), wall: 0x8a8478, storey: 2.2,
    facade: { kind: "windows", glass: 0x2b2622, frame: 0x6f6a60, w: 0.22, gap: 0.3, sill: 0.6, head: 0.6 },
    roof: { kind: "parapet", deck: 0x58534b, rim: 0x6f6a60, h: 0.14 },
    base: { colour: 0x6b665c, h: 0.3 },
  };
  return {
    plinth: { inset: 0, h: 0, colour: STONE }, masses: [m], crane: "none",
    details: (p) => {
      // Grime down the walls from the roof.
      for (let a = 0.1; a < m.u1 - m.u0 - 0.1; a += 0.37) p.onV(m.v1 + 0.003, m.u0 + a, m.u0 + a + 0.08, m.z1 - 0.9 - hash(a) * 0.5, m.z1, 0x3a362f, 0.25);
      // Boards nailed across the windows.
      for (const [a0, a1] of [[0.4, 0.66], [1.0, 1.26]]) {
        p.strut([m.u0 + a0, m.v1 + 0.01, 1.0], [m.u0 + a1, m.v1 + 0.01, 1.5], 0.05, 0x7a5a3a);
        p.strut([m.u0 + a0, m.v1 + 0.012, 1.5], [m.u0 + a1, m.v1 + 0.012, 1.05], 0.045, 0x6a4c30);
        p.strut([m.u1 + 0.01, m.v0 + a0, 1.0], [m.u1 + 0.01, m.v0 + a1, 1.5], 0.05, tone(0x7a5a3a, 0.76));
      }
      // GRAFFITI along the foot.
      const C = [0xd8432f, 0x3d8be0, 0xf2c230];
      for (let k = 0; k < 4; k++) p.onV(m.v1 + 0.004, m.u0 + 0.15 + k * 0.32, m.u0 + 0.38 + k * 0.32, 0.32, 0.55 + (k % 2) * 0.12, C[k % 3], 0.85);
      // The hole in the roof, the rafters showing across it.
      p.flat(m.u0 + 0.1, m.v0 + 0.1, m.u0 + 0.75, m.v0 + 0.6, m.z1 + 0.005, 0x2b2622);
      p.flat(m.u0 + 0.1, m.v0 + 0.1, m.u0 + 0.75, m.v0 + 0.2, m.z1 + 0.006, 0x1d1a17);
      for (const u of [m.u0 + 0.3, m.u0 + 0.55]) p.box(u - 0.02, m.v0 + 0.1, u + 0.02, m.v0 + 0.6, m.z1 - 0.05, m.z1 + 0.02, 0x5a4530);
      // Rubble, and weeds at its foot.
      for (const [u, v, s] of [[m.u1 - 0.3, m.v1 + 0.08, 1], [m.u1 - 0.12, m.v1 + 0.04, 0.7]] as const) {
        p.box(u - 0.1 * s, v - 0.05, u + 0.1 * s, v + 0.05, 0, 0.12 * s, 0x8a8478, { top: 0x9a9488 });
      }
      for (const u of [m.u0 + 0.3, m.u1 - 0.6]) {
        p.dot(u, m.v1 + 0.07, 0.12, 0.06, 0x6b7a3e);
        p.dot(u + 0.05, m.v1 + 0.08, 0.2, 0.04, 0x7f8f48);
      }
    },
  };
}

/** AN AI RACK: a dark server house in louvres, status lights down its faces, chillers turning on the roof, a transformer and the power line in. */
export function rack(f: Footprint): Building {
  const m: Mass = {
    ...inside(f, 0.16, 0.15, 2.2), wall: 0x2b3038, storey: 2.05,
    facade: { kind: "louvres", slat: 0x3f4752, every: 0.16, edge: 0.1 },
    roof: { kind: "parapet", deck: 0x1f2328, rim: 0x3f4752, h: 0.14 },
    base: { colour: 0x1f2328, h: 0.15 },
  };
  const fans: Fan[] = [0.37, 0.63].map((u) => ({ u, v: (m.v0 + m.v1) / 2 - 0.05, z: m.z1 + 0.32, r: 0.1, housing: 0x5b636c }));
  const live = turning(fans, [{ u: m.u1 - 0.08, v: m.v1 + 0.006, z: m.z0 + 1.85, colour: 0x3fe0a8, period: 1.1 }]);
  return {
    plinth: { inset: 0.05, h: 0.15, colour: 0x8f949a, top: 0xa9aeb4 }, masses: [m], crane: "none", live,
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
      // The chillers' frame on the roof; the transformer and the power line in.
      p.box(m.u0 + 0.12, m.v0 + 0.15, m.u1 - 0.12, m.v1 - 0.25, m.z1, m.z1 + 0.1, 0x5b636c);
      p.box(m.u1 - 0.12, m.v1, m.u1 - 0.04, m.v1 + 0.06, 0.15, 0.6, 0xf2c230);
      p.box(m.u1 - 0.1, m.v1 + 0.02, m.u1 - 0.06, m.v1 + 0.04, 0.6, m.z1 - 0.2, 0x2b2f33);
      drawLiveBase(p, live);
    },
  };
}

/** A PUMP HOUSE: a little brick house on a stone base, a wheel on its side, a valve and a pipe out, a vent on its roof. @see PUMP */
export function pump(f: Footprint): Building {
  const m: Mass = {
    ...inside(f, 0.2, 0.2, 1.2), wall: 0x9a4e3c, storey: 1.2,
    facade: { kind: "plain" },
    roof: { kind: "parapet", deck: 0x4b5560, rim: 0x6e3528, h: 0.12 },
    base: { colour: 0x8f949a, h: 0.15 },
  };
  return {
    plinth: { inset: 0.08, h: 0.1, colour: 0x8f949a, top: 0xa9aeb4 }, masses: [m], crane: "none",
    grounds: (p) => p.flat(0.04, 0.04, f.w - 0.04, f.h - 0.04, 0.004, 0x8f949a),
    details: (p) => {
      door(p, m, m.u0 + 0.2, 0.18, 0.75, 0x2b2f36, 0x5b636c);
      // A louvred window, the wheel on the water side, and the pipe out the back.
      p.onV(m.v1, m.u0 + 0.38, m.u0 + 0.52, m.z0 + 0.45, m.z0 + 0.75, 0x5b636c);
      for (let z = m.z0 + 0.5; z < m.z0 + 0.72; z += 0.06) p.onV(m.v1 + 0.002, m.u0 + 0.38, m.u0 + 0.52, z, z + 0.02, 0x3a3f45);
      const wv = (m.v0 + m.v1) / 2;
      p.dot(m.u1 + 0.02, wv, 0.55, 0.22, 0x5b636c);
      p.dot(m.u1 + 0.03, wv, 0.55, 0.16, 0x3a3f45);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI;
        p.strut([m.u1 + 0.035, wv - Math.cos(a) * 0.18, 0.55 - Math.sin(a) * 0.36], [m.u1 + 0.035, wv + Math.cos(a) * 0.18, 0.55 + Math.sin(a) * 0.36], 0.02, 0x9aa3ab);
      }
      p.dot(m.u1 + 0.04, wv, 0.55, 0.06, 0x9aa3ab);
      p.box(m.u0 - 0.12, wv - 0.05, m.u0, wv + 0.05, 0.1, 0.2, 0x6f7a86);
      // The vent on the roof.
      p.box(m.u0 + 0.2, m.v0 + 0.2, m.u0 + 0.32, m.v0 + 0.32, m.z1, m.z1 + 0.25, 0x9aa3ab);
      p.box(m.u0 + 0.18, m.v0 + 0.18, m.u0 + 0.34, m.v0 + 0.34, m.z1 + 0.25, m.z1 + 0.29, 0x6f7a86);
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

/** A DRONE HANGAR: a low vault in ribbed black, its door open on a dim violet bay, a landing pad on its roof lit at the corners. */
export function droneHangar(f: Footprint): Building {
  const m: Mass = {
    ...inside(f, 0.15, 0.15, 1.5), wall: 0x2a2440, storey: 1.35,
    facade: { kind: "plain", lines: 0x3b3358, every: 0.3 },
    roof: { kind: "flat", deck: 0x3b3358 },
    piers: { colour: 0x352e52, every: 0.45, w: 0.05 },
  };
  const vault: Mass = { ...inside(f, 0.3, m.z1, m.z1 + 0.4), wall: 0x3b3358, storey: 1, facade: { kind: "plain" }, roof: { kind: "flat", deck: 0x463d68 } };
  const pz = vault.z1 + 0.005, pc = [[vault.u0 + 0.12, vault.v0 + 0.12], [vault.u1 - 0.12, vault.v0 + 0.12], [vault.u0 + 0.12, vault.v1 - 0.12], [vault.u1 - 0.12, vault.v1 - 0.12]];
  const live = turning([], pc.map(([u, v], k) => ({ u, v, z: pz + 0.03, colour: AI_LIGHT, period: 1.6, phase: k * 0.4 })));
  return {
    plinth: { inset: 0.05, h: 0.15, colour: 0x5d5770, top: 0x6f6984 }, masses: [m, vault], crane: "none", live,
    grounds: (p) => p.flat(0.02, 0.02, f.w - 0.02, f.h - 0.02, 0.004, 0x3b3651),
    details: (p) => {
      const mid = (m.u0 + m.u1) / 2;
      // The door, open: the bay inside, a drone on its cradle, the lights along its ceiling.
      p.onV(m.v1, mid - 0.5, mid + 0.5, m.z0, m.z0 + 1.05, AI_METAL);
      p.onV(m.v1, mid - 0.45, mid + 0.45, m.z0, m.z0 + 1.0, 0x0b0910);
      p.onV(m.v1 + 0.001, mid - 0.45, mid + 0.45, m.z0, m.z0 + 1.0, AI_LIGHT, 0.08);
      for (let u = mid - 0.38; u < mid + 0.4; u += 0.19) p.onV(m.v1 + 0.002, u, u + 0.08, m.z0 + 0.9, m.z0 + 0.93, AI_LIGHT);
      p.onV(m.v1 + 0.002, mid - 0.15, mid + 0.15, m.z0 + 0.3, m.z0 + 0.36, 0x4a4560);
      p.onV(m.v1 + 0.002, mid - 0.05, mid + 0.05, m.z0 + 0.22, m.z0 + 0.3, 0x4a4560);
      // THE PAD on the roof: a ring and a cross marked on it.
      const cu = (vault.u0 + vault.u1) / 2, cv = (vault.v0 + vault.v1) / 2, r = Math.min(vault.u1 - vault.u0, vault.v1 - vault.v0) * 0.32;
      p.flat(cu - r, cv - 0.03, cu + r, cv + 0.03, pz, 0xc9b8ff);
      p.flat(cu - 0.03, cv - r, cu + 0.03, cv + r, pz, 0xc9b8ff);
      for (const [u, v] of pc) p.box(u - 0.04, v - 0.04, u + 0.04, v + 0.04, vault.z1, vault.z1 + 0.03, AI_METAL);
      aiBand(p, m, 1.15);
      drawLiveBase(p, live);
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
