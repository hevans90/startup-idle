/**
 * World v2 — THE PROPS, as models: trees, a bench, a café's table and
 * parasol, a fountain. In metres, `x` forward, `y` to the left, `z` up, the
 * foot of the thing at the origin; baked by the vehicles' rasteriser into a
 * sheet at four turns, as the cars and people are. @see dev/bake-props.ts
 *
 * TWO LAYERS: the first white and tinted in the game — a tree's leaves, a
 * parasol's cloth — so one bake is a lime in May and one in a wet October;
 * the second in its own colours.
 */
import type { Mat } from "../agents/cars/models";
import { face, type Tri, type V3 } from "../agents/cars/raster";
import { ball, limb, quad } from "../agents/people/figures";

export type PropShadow = { hl: number; hw: number; edge: number; soft: number; strength: number; reach: number };
export type Prop = { id: string; tris: () => Tri[]; shadow: PropShadow };

/** The tinted layer: leaves and cloth. */
export const PROP_LAYERS = 2;
export const propLayerOf = (m: Mat) => (m === "leaf" || m === "canvas" ? 0 : 1);

/** A small sequence of its own for each model, so a bake is the same every time. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0; return (s >>> 8) / 0x1000000; };
}

/** A box, its faces flat. */
export function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: Mat, out: Tri[]) {
  const c: V3 = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
  const P = (x: number, y: number, z: number): V3 => [x, y, z];
  for (const q of [
    [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)],
    [P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0)],
    [P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)],
    [P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)],
    [P(x0, y0, z0), P(x0, y1, z0), P(x0, y1, z1), P(x0, y0, z1)],
    [P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)],
  ]) face(q, mat, c, out);
}

/**
 * A LATHE: a profile of (radius, height) points turned round the upright
 * axis at (`x`, `y`), smooth round it; capped across its last point if that
 * has a radius. Discs, cones, bowls.
 */
export function lathe(x: number, y: number, prof: readonly [number, number][], mat: Mat, out: Tri[], N = 20, cap = true) {
  const pt = (r: number, z: number, k: number): V3 => { const a = (k / N) * Math.PI * 2; return [x + Math.cos(a) * r, y + Math.sin(a) * r, z]; };
  for (let i = 0; i + 1 < prof.length; i++) {
    const [r0, z0] = prof[i], [r1, z1] = prof[i + 1];
    // The normal of this band of the profile: out from the axis, tilted by its slope.
    const dr = r1 - r0, dz = z1 - z0, len = Math.hypot(dr, dz) || 1;
    const nr = dz / len, nz = -dr / len;
    for (let k = 0; k < N; k++) {
      const n = (kk: number): V3 => { const a = (kk / N) * Math.PI * 2; return [Math.cos(a) * nr, Math.sin(a) * nr, nz]; };
      quad([pt(r0, z0, k), pt(r0, z0, k + 1), pt(r1, z1, k + 1), pt(r1, z1, k)], [n(k), n(k + 1), n(k + 1), n(k)], mat, out);
    }
  }
  const [rl, zl] = prof[prof.length - 1];
  if (cap && rl > 1e-6) for (let k = 0; k < N; k++) face([[x, y, zl], pt(rl, zl, k), pt(rl, zl, k + 1)], mat, [x, y, zl - 1], out);
}

/** A round slab: a disc `r` across from `z0` to `z1`, capped. */
const disc = (x: number, y: number, r: number, z0: number, z1: number, mat: Mat, out: Tri[], N = 20) =>
  lathe(x, y, [[r, Math.min(z0, z1)], [r, Math.max(z0, z1)]], mat, out, N);

// ─── TREES ───────────────────────────────────────────────────────────────────

/** A crown: `n` lumps of leaves about (0, 0, `z`), spread `rx` round and `rz` up and down, each `r0`–`r1` across. */
function crown(rand: () => number, out: Tri[], n: number, z: number, rx: number, rz: number, r0: number, r1: number) {
  // The biggest middle first, so the lumps round it read as its surface.
  ball([0, 0, z], [rx * 0.82, rx * 0.82, rz * 0.82], "leaf", out, undefined, 14, 9);
  for (let k = 0; k < n; k++) {
    const a = rand() * Math.PI * 2, t = rand() * 2 - 1, d = 0.55 + 0.4 * rand();
    const r = r0 + (r1 - r0) * rand();
    const c: V3 = [Math.cos(a) * rx * d * Math.sqrt(1 - t * t), Math.sin(a) * rx * d * Math.sqrt(1 - t * t), z + t * rz * d];
    ball(c, [r, r, r * 0.85], "leaf", out, undefined, 10, 7);
  }
}

/** A trunk up to `h`, and a few boughs out into the crown. */
function trunk(rand: () => number, out: Tri[], h: number, r: number, mat: Mat = "bark", boughs = 3, reach = 1.2) {
  limb([0, 0, 0], [0, 0, h], r * 1.25, r, mat, out, 10, false);
  // A flare at its foot.
  limb([0, 0, 0], [0, 0, 0.35], r * 1.7, r * 1.2, mat, out, 10, false);
  for (let k = 0; k < boughs; k++) {
    const a = (k / boughs) * Math.PI * 2 + rand();
    const z = h * (0.6 + 0.3 * rand());
    limb([0, 0, z], [Math.cos(a) * reach, Math.sin(a) * reach, z + reach * 0.9], r * 0.55, r * 0.3, mat, out, 6, false);
  }
}

const shadowOf = (r: number): PropShadow => ({ hl: r * 0.35, hw: r * 0.35, edge: r * 0.35, soft: r * 0.5, strength: 0.32, reach: r * 0.85 });

export const TREES: readonly Prop[] = [
  {
    // An oak: a broad, lumpy crown on a stout trunk.
    id: "oak", shadow: shadowOf(3.4),
    tris: () => { const r = seeded(11), out: Tri[] = []; trunk(r, out, 3.2, 0.26, "bark", 4, 1.8); crown(r, out, 16, 6, 3.4, 2.3, 1.0, 1.7); return out; },
  },
  {
    // A lime: an upright oval, the street tree.
    id: "lime", shadow: shadowOf(2.4),
    tris: () => { const r = seeded(23), out: Tri[] = []; trunk(r, out, 2.6, 0.17, "bark", 3, 1.0); crown(r, out, 13, 5.2, 2.3, 2.6, 0.8, 1.3); return out; },
  },
  {
    // A hornbeam, clipped upright: a column of leaves.
    id: "hornbeam", shadow: shadowOf(1.6),
    tris: () => {
      const r = seeded(37), out: Tri[] = [];
      trunk(r, out, 2.2, 0.15, "bark", 0);
      ball([0, 0, 4.8], [1.4, 1.4, 2.9], "leaf", out, undefined, 14, 10);
      for (let k = 0; k < 10; k++) { const a = r() * Math.PI * 2, z = 2.6 + r() * 4.6; ball([Math.cos(a) * 0.8, Math.sin(a) * 0.8, z], [0.7, 0.7, 0.8], "leaf", out, undefined, 9, 6); }
      return out;
    },
  },
  {
    // A cherry: low and spreading, tinted in blossom.
    id: "cherry", shadow: shadowOf(2.8),
    tris: () => { const r = seeded(41), out: Tri[] = []; trunk(r, out, 1.8, 0.16, "bark", 4, 1.5); crown(r, out, 15, 3.6, 2.8, 1.4, 0.7, 1.2); return out; },
  },
  {
    // A birch: a slim white trunk, a light, ragged crown.
    id: "birch", shadow: shadowOf(1.8),
    tris: () => {
      const r = seeded(53), out: Tri[] = [];
      trunk(r, out, 7.2, 0.12, "birchBark", 4, 0.8);
      ball([0, 0, 5.6], [1.3, 1.3, 2.2], "leaf", out, undefined, 12, 8);
      for (let k = 0; k < 20; k++) { const a = r() * Math.PI * 2, z = 3.6 + r() * 4.2, d = (1 - (z - 3.6) / 5.5) * 1.5 * (0.5 + 0.5 * r()); ball([Math.cos(a) * d, Math.sin(a) * d, z], [0.7, 0.7, 0.85], "leaf", out, undefined, 9, 6); }
      return out;
    },
  },
  {
    // A pine: tiers of needles narrowing to its top.
    id: "pine", shadow: shadowOf(2.2),
    tris: () => {
      const out: Tri[] = [];
      limb([0, 0, 0], [0, 0, 9.5], 0.22, 0.08, "bark", out, 8, false);
      for (let k = 0; k < 5; k++) {
        const z = 2.2 + k * 1.45, r = 2.3 * (1 - k / 5.6);
        lathe(0, 0, [[r * 0.75, z - 0.15], [r, z + 0.1], [r * 0.8, z + 0.6], [0.1, z + 2.1]], "leaf", out, 14);
      }
      return out;
    },
  },
];

// ─── STREET FURNITURE ────────────────────────────────────────────────────────

/** How high a bench's seat is, metres, and where along it its two places are. */
export const SEAT_Z = 0.45;
export const SEATS_M = [-0.45, 0.45];

/** A BENCH facing +x: cast iron ends, slats to sit on and lean on. 1.8 m long. */
function benchTris(): Tri[] {
  const out: Tri[] = [];
  for (const y of [-0.82, 0.82]) {
    box(-0.22, 0.24, y - 0.035, y + 0.035, 0, 0.06, "iron", out);
    limb([0.18, y, 0.04], [0.12, y, SEAT_Z - 0.03], 0.03, 0.03, "iron", out, 6, false);
    limb([-0.16, y, 0.04], [-0.2, y, 0.9], 0.03, 0.028, "iron", out, 6, false);
    box(-0.2, 0.24, y - 0.03, y + 0.03, SEAT_Z - 0.06, SEAT_Z - 0.02, "iron", out);
    limb([0.2, y, 0.62], [-0.05, y, 0.62], 0.025, 0.025, "iron", out, 6, false);
  }
  for (let k = 0; k < 4; k++) box(-0.17 + k * 0.105, -0.09 + k * 0.105, -0.9, 0.9, SEAT_Z - 0.02, SEAT_Z + 0.02, "wood", out);
  for (const z of [0.6, 0.76]) {
    const x = -0.18 - (z - 0.6) * 0.15;
    box(x - 0.025, x + 0.025, -0.9, 0.9, z, z + 0.1, "wood", out);
  }
  return out;
}

/** A CAFÉ SET: a round table, a chair either side, a parasol open over them; facing +x. */
function cafeTris(): Tri[] {
  const out: Tri[] = [];
  // The table: a foot, a column, a top.
  disc(0, 0, 0.26, 0, 0.03, "iron", out, 14);
  limb([0, 0, 0.03], [0, 0, 0.72], 0.035, 0.03, "iron", out, 8, false);
  disc(0, 0, 0.4, 0.72, 0.75, "linen", out);
  // Two chairs facing it across: four legs, a seat, a back.
  for (const s of [-1, 1]) {
    const cy = s * 0.62;
    for (const [dx, dy] of [[-0.18, -0.17], [0.18, -0.17], [-0.18, 0.17], [0.18, 0.17]]) limb([dx, cy + dy, 0], [dx * 0.9, cy + dy * 0.9, 0.44], 0.016, 0.016, "iron", out, 5, false);
    box(-0.2, 0.2, cy - 0.2, cy + 0.2, 0.44, 0.48, "wood", out);
    const by = cy + s * 0.19;
    for (const dx of [-0.17, 0.17]) limb([dx, by, 0.46], [dx, by + s * 0.04, 0.88], 0.016, 0.016, "iron", out, 5, false);
    box(-0.19, 0.19, by + s * 0.015 - 0.02, by + s * 0.015 + 0.02, 0.66, 0.86, "wood", out);
  }
  // The parasol: a pole, eight panels from the crown to the rim, striped, and a valance.
  limb([0, 0, 0.75], [0, 0, 2.45], 0.022, 0.018, "linen", out, 6, false);
  const N = 8, R = 1.35, top = 2.5, rim = 2.05;
  for (let k = 0; k < N; k++) {
    const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2;
    const p0: V3 = [Math.cos(a0) * R, Math.sin(a0) * R, rim], p1: V3 = [Math.cos(a1) * R, Math.sin(a1) * R, rim];
    const mat: Mat = k % 2 ? "canvas" : "linen";
    face([[0, 0, top], p0, p1], mat, [0, 0, 0], out);
    face([p0, p1, [p1[0] * 1.0, p1[1] * 1.0, rim - 0.16], [p0[0], p0[1], rim - 0.16]], mat, [0, 0, rim], out);
  }
  ball([0, 0, top + 0.03], [0.05, 0.05, 0.05], "linen", out, undefined, 8, 5);
  return out;
}

/** A FOUNTAIN: a round stone basin, water in it, a column, an upper bowl spilling over. */
function fountainTris(): Tri[] {
  const out: Tri[] = [];
  // The basin's wall, round and over its rim and down inside, the water in it.
  lathe(0, 0, [[1.75, 0], [1.75, 0.5], [1.6, 0.5], [1.6, 0.2]], "stone", out, 28, false);
  disc(0, 0, 1.6, 0.2, 0.42, "water", out, 28);
  limb([0, 0, 0.4], [0, 0, 1.25], 0.2, 0.14, "stone", out, 12, false);
  lathe(0, 0, [[0.18, 1.15], [0.7, 1.3], [0.78, 1.42]], "stone", out, 18, false);
  disc(0, 0, 0.7, 1.38, 1.4, "water", out, 18);
  limb([0, 0, 1.4], [0, 0, 1.9], 0.07, 0.04, "stone", out, 8, false);
  // The jet and the water falling round the upper bowl.
  ball([0, 0, 2.15], [0.12, 0.12, 0.35], "spray", out, undefined, 8, 6);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    limb([Math.cos(a) * 0.76, Math.sin(a) * 0.76, 1.38], [Math.cos(a) * 0.86, Math.sin(a) * 0.86, 0.48], 0.035, 0.05, "spray", out, 5, false);
  }
  return out;
}

export const FURNITURE: readonly Prop[] = [
  { id: "bench", tris: benchTris, shadow: { hl: 0.2, hw: 0.85, edge: 0.06, soft: 0.2, strength: 0.32, reach: 0.25 } },
  { id: "cafe", tris: cafeTris, shadow: { hl: 0.9, hw: 0.9, edge: 0.2, soft: 0.5, strength: 0.28, reach: 0.6 } },
  { id: "fountain", tris: fountainTris, shadow: { hl: 1.5, hw: 1.5, edge: 0.15, soft: 0.25, strength: 0.25, reach: 0.4 } },
];

export const PROPS: readonly Prop[] = [...TREES, ...FURNITURE];
