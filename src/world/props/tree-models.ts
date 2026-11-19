/**
 * THE TREES THROUGH THE YEAR, as models: each kind in leaf as it always was (`TREES`), and under it a skeleton of
 * its own — trunk, limbs and twigs, the habit of the kind — that the other looks are made on: buds breaking at the
 * twigs' ends, a crown thinning as it falls, bare, and snow lying along the branches. A pine keeps its needles and
 * only takes the snow. Baked by `bun run bake:trees`. @see world/calendar TREE_STATES, render/tree-mesh
 */
import type { Mat } from "../agents/cars/models";
import type { Tri, V3 } from "../agents/cars/raster";
import { ball, limb } from "../agents/people/figures";
import { crown, seeded, shadowOf, trunk, TREES, type Prop, type PropShadow } from "./models";
import type { TreeState } from "../calendar";

/** A kind's habit: how its trunk, limbs and twigs go, metres. */
type Habit = {
  seed: number;
  /** Where its limbs leave the trunk, from and to. */
  base: [number, number];
  /** The crown's middle, its reach round and up and down. */
  z: number; rx: number; rz: number;
  /** The trunk's radius at its foot, and how far up its leader goes past the crown's middle (a share of `rz`). */
  r: number; leader: number;
  limbs: number; twigs: number;
  /** How a limb leaves the trunk: 0 level, 1 straight up. */
  rise: number;
  /** How a limb's end hangs, metres down (a birch's). */
  droop?: number;
  trunk: Mat; twig: Mat;
  /** The shadow's reach in leaf. */
  shade: number;
};

const HABIT: Readonly<Record<string, Habit>> = {
  oak: { seed: 111, base: [2.6, 4.2], z: 6, rx: 3.4, rz: 2.3, r: 0.26, leader: 0.5, limbs: 6, twigs: 4, rise: 0.35, trunk: "bark", twig: "bark", shade: 3.4 },
  lime: { seed: 123, base: [2.2, 4.6], z: 5.2, rx: 2.3, rz: 2.6, r: 0.17, leader: 0.85, limbs: 6, twigs: 3, rise: 0.6, trunk: "bark", twig: "bark", shade: 2.4 },
  hornbeam: { seed: 137, base: [1.8, 5.5], z: 4.8, rx: 1.4, rz: 2.9, r: 0.15, leader: 0.9, limbs: 7, twigs: 3, rise: 0.8, trunk: "bark", twig: "bark", shade: 1.6 },
  cherry: { seed: 141, base: [1.5, 2.4], z: 3.6, rx: 2.8, rz: 1.4, r: 0.16, leader: 0.3, limbs: 5, twigs: 4, rise: 0.4, trunk: "bark", twig: "bark", shade: 2.8 },
  willow: { seed: 171, base: [1.8, 2.8], z: 4.4, rx: 3.0, rz: 1.8, r: 0.3, leader: 0.3, limbs: 7, twigs: 4, rise: 0.75, droop: 1.8, trunk: "bark", twig: "bark", shade: 3.0 },
  poplar: { seed: 181, base: [1.4, 8.2], z: 6.8, rx: 1.25, rz: 4.4, r: 0.2, leader: 1.0, limbs: 14, twigs: 3, rise: 0.95, trunk: "bark", twig: "bark", shade: 1.4 },
  apple: { seed: 191, base: [1.2, 1.8], z: 3.0, rx: 2.4, rz: 1.3, r: 0.16, leader: 0.2, limbs: 5, twigs: 4, rise: 0.45, trunk: "bark", twig: "bark", shade: 2.5 },
  shrub: { seed: 201, base: [0.1, 0.5], z: 0.9, rx: 1.0, rz: 0.6, r: 0.06, leader: 0.4, limbs: 7, twigs: 2, rise: 0.75, trunk: "bark", twig: "bark", shade: 1.1 },
  birch: { seed: 153, base: [3.4, 6.4], z: 5.6, rx: 1.5, rz: 2.2, r: 0.12, leader: 1.0, limbs: 7, twigs: 3, rise: 0.55, droop: 0.6, trunk: "birchBark", twig: "bark", shade: 1.8 },
};

type Seg = { a: V3; b: V3; ra: number; rb: number };
const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** A kind's skeleton: its segments, and the ends of its twigs and limbs, where its leaves come. */
function skeleton(h: Habit): { segs: Seg[]; ends: V3[]; fine: V3[]; mats: Mat[] } {
  const rand = seeded(h.seed), segs: Seg[] = [], ends: V3[] = [], fine: V3[] = [], mats: Mat[] = [];
  const add = (a: V3, b: V3, ra: number, rb: number, mat: Mat) => { segs.push({ a, b, ra, rb }); mats.push(mat); };
  const top = h.z + h.rz * h.leader;
  add([0, 0, 0], [0, 0, 0.35], h.r * 1.7, h.r * 1.2, h.trunk);
  add([0, 0, 0], [0, 0, h.base[0]], h.r * 1.25, h.r, h.trunk);
  add([0, 0, h.base[0]], [0, 0, top], h.r, h.r * 0.3, h.trunk);
  ends.push([0, 0, top]);
  for (let i = 0; i < h.limbs; i++) {
    const a = (i / h.limbs) * Math.PI * 2 + (rand() - 0.5) * 0.9;
    const z0 = h.base[0] + (h.base[1] - h.base[0]) * (i / Math.max(1, h.limbs - 1)) * (0.7 + 0.3 * rand());
    const start: V3 = [0, 0, z0];
    const reach = h.rx * (0.7 + 0.25 * rand());
    const zEnd = Math.min(top - 0.2, z0 + reach * (0.35 + h.rise * 1.1) + (rand() - 0.5) * h.rz * 0.4);
    const end: V3 = [Math.cos(a) * reach, Math.sin(a) * reach, zEnd - (h.droop ?? 0)];
    // A knee a little over the line, so a limb arches out and does not run straight.
    const knee: V3 = [Math.cos(a) * reach * 0.5, Math.sin(a) * reach * 0.5, z0 + (zEnd - z0) * 0.62 + 0.25];
    const rr = h.r * (0.75 - 0.2 * (i / h.limbs));
    add(start, knee, rr, rr * 0.7, h.trunk);
    add(knee, end, rr * 0.7, rr * 0.3, h.twig === h.trunk ? h.trunk : h.twig);
    ends.push(end);
    for (let j = 0; j < h.twigs; j++) {
      const t = 0.35 + 0.6 * rand(), from = t < 0.5 ? lerp(start, knee, t * 2) : lerp(knee, end, (t - 0.5) * 2);
      const b = a + (rand() - 0.5) * 1.6, len = h.rx * (0.3 + 0.3 * rand());
      const to: V3 = [from[0] + Math.cos(b) * len, from[1] + Math.sin(b) * len, from[2] + len * (h.rise * 0.9 + (rand() - 0.4) * 0.6) - (h.droop ?? 0) * 0.5];
      add(from, to, rr * 0.45, rr * 0.14, h.twig);
      ends.push(to);
      // THE FINE TWIGS off it, that make a bare crown a mass and not a few sticks.
      for (let q = 0; q < 3; q++) {
        const f = lerp(from, to, 0.45 + 0.5 * rand()), c = b + (rand() - 0.5) * 2.2, l = len * (0.35 + 0.35 * rand());
        const tip: V3 = [f[0] + Math.cos(c) * l, f[1] + Math.sin(c) * l, f[2] + l * (0.3 + h.rise * 0.6 + (rand() - 0.5) * 0.7)];
        add(f, tip, 0.035, 0.012, h.twig);
        fine.push(tip);
      }
    }
  }
  return { segs, ends, fine, mats };
}

/** The skeleton as tris; and, with `snow`, snow lying along the top of every branch that is not too steep to hold it. */
function branches(h: Habit, out: Tri[], snow: boolean) {
  const { segs, mats } = skeleton(h);
  segs.forEach((s, k) => limb(s.a, s.b, s.ra, s.rb, mats[k], out, k < 3 ? 10 : 6, false));
  if (!snow) return;
  for (const s of segs) {
    const d: V3 = [s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]], len = Math.hypot(...d);
    if (len < 0.2 || Math.abs(d[2]) / len > 0.9 || s.ra < 0.03) continue;
    // Thicker than the branch it lies on, and over it: what shows from above and the side is the snow.
    const ra = Math.max(0.07, s.ra * 1.05), rb = Math.max(0.05, s.rb * 1.1);
    limb([s.a[0], s.a[1], s.a[2] + s.ra * 0.9], [s.b[0], s.b[1], s.b[2] + s.rb * 0.9], ra, rb, "snow", out, 6, false);
    // A little lodged where it forks off.
    ball([s.a[0], s.a[1], s.a[2] + s.ra], [ra * 1.5, ra * 1.5, ra], "snow", out, undefined, 7, 4);
  }
  // And a cap where the limbs leave the trunk.
  ball([0, 0, h.base[0] + 0.1], [h.r * 1.4, h.r * 1.4, h.r * 0.8], "snow", out, undefined, 8, 5);
}

/** Leaves at the ends of the twigs: `size` how big a clump (a bud's small), `keep` the share of ends that have one. */
function clumps(h: Habit, out: Tri[], size: number, keep: number) {
  const rand = seeded(h.seed + 7), { ends } = skeleton(h);
  for (const e of ends) {
    const r = size * (0.75 + 0.5 * rand());
    if (rand() > keep) continue;
    ball(e, [r, r, r * 0.85], "leaf", out, undefined, 9, 6);
    // (A second, smaller, beside the first: a clump is not a ball.)
    const a = rand() * Math.PI * 2;
    ball([e[0] + Math.cos(a) * r * 0.8, e[1] + Math.sin(a) * r * 0.8, e[2] - r * 0.3], [r * 0.7, r * 0.7, r * 0.6], "leaf", out, undefined, 8, 5);
  }
}

/** A pine's snow: a ring on the shoulder of each tier of needles. @see models.ts TREES pine */
function pineSnow(out: Tri[]) {
  const rand = seeded(907);
  for (let k = 0; k < 5; k++) {
    const z = 2.2 + k * 1.45, r = 2.3 * (1 - k / 5.6);
    // Pads of it lying on the tier's shoulder, gaps between, no two the same: not a band painted round it.
    const n = 9 + Math.round(r * 3);
    for (let i = 0; i < n; i++) {
      if (rand() < 0.22) continue;
      const a = ((i + rand() * 0.6) / n) * Math.PI * 2, d = r * (0.7 + 0.12 * rand()), zz = z + 0.32 + (0.82 - d / r) * 1.4;
      const pr = r * (0.26 + 0.14 * rand());
      ball([Math.cos(a) * d, Math.sin(a) * d, zz], [pr, pr, pr * 0.32], "snow", out, undefined, 8, 5);
    }
  }
  ball([0, 0, 9.45], [0.18, 0.18, 0.22], "snow", out, undefined, 8, 5);
}

/**
 * THE KINDS ONLY THE FOREST HAS, in leaf: a weeping willow and a poplar by the water, a wild apple, a shrub of the
 * scrub a wood comes back through, heather on the heights and reeds at the shore. @see render/forest biomes
 */
export const WILD: readonly Prop[] = [
  {
    // A willow: a broad crown on a short stout trunk, its leaves hanging in curtains to the ground.
    id: "willow", shadow: shadowOf(3.0),
    tris: () => {
      const r = seeded(171), out: Tri[] = [];
      trunk(r, out, 2.4, 0.3, "bark", 4, 1.6);
      crown(r, out, 10, 4.6, 2.6, 1.3, 0.8, 1.2);
      for (let k = 0; k < 30; k++) {
        const a = (k / 30) * Math.PI * 2 + r() * 0.3, d = 2.2 + 0.9 * r(), len = 1.3 + 1.2 * r();
        ball([Math.cos(a) * d, Math.sin(a) * d, 4.3 - len * 0.6], [0.42, 0.42, len], "leaf", out, undefined, 8, 6);
      }
      return out;
    },
  },
  {
    // A poplar: a tall narrow column.
    id: "poplar", shadow: shadowOf(1.4),
    tris: () => {
      const r = seeded(181), out: Tri[] = [];
      trunk(r, out, 2.0, 0.2, "bark", 0);
      ball([0, 0, 6.6], [1.05, 1.05, 4.6], "leaf", out, undefined, 14, 10);
      for (let k = 0; k < 14; k++) { const a = r() * Math.PI * 2, z = 3 + r() * 7.4, w = 0.75 * Math.sin(((z - 2) / 9.2) * Math.PI) + 0.2; ball([Math.cos(a) * w, Math.sin(a) * w, z], [0.55, 0.55, 0.85], "leaf", out, undefined, 9, 6); }
      return out;
    },
  },
  {
    // A wild apple: low and round, white in blossom.
    id: "apple", shadow: shadowOf(2.5),
    tris: () => { const r = seeded(191), out: Tri[] = []; trunk(r, out, 1.6, 0.16, "bark", 4, 1.4); crown(r, out, 13, 3.0, 2.4, 1.3, 0.6, 1.0); return out; },
  },
  {
    // A shrub: a mound of leaves on no trunk to speak of.
    id: "shrub", shadow: shadowOf(1.1, 0.24),
    tris: () => {
      const r = seeded(201), out: Tri[] = [];
      ball([0, 0, 0.7], [0.95, 0.95, 0.7], "leaf", out, undefined, 12, 8);
      for (let k = 0; k < 9; k++) { const a = r() * Math.PI * 2, d = 0.5 + 0.4 * r(); ball([Math.cos(a) * d, Math.sin(a) * d, 0.5 + r() * 0.7], [0.45 + 0.2 * r(), 0.45 + 0.2 * r(), 0.4], "leaf", out, undefined, 9, 6); }
      return out;
    },
  },
  {
    // Heather: a low cushion, knee high.
    id: "heather", shadow: shadowOf(0.8, 0.16),
    tris: () => {
      const r = seeded(211), out: Tri[] = [];
      for (let k = 0; k < 9; k++) { const a = r() * Math.PI * 2, d = 0.9 * r(); ball([Math.cos(a) * d, Math.sin(a) * d, 0.15], [0.6 + 0.2 * r(), 0.6 + 0.2 * r(), 0.45], "leaf", out, undefined, 9, 6); }
      return out;
    },
  },
  {
    // Reeds: a clump of tall thin blades, leaning, a few brown heads.
    id: "reeds", shadow: shadowOf(0.7, 0.14),
    tris: () => {
      const r = seeded(221), out: Tri[] = [];
      for (let k = 0; k < 34; k++) {
        const a = r() * Math.PI * 2, d = 0.45 * Math.sqrt(r()), h = 1.4 + 1.1 * r(), lean = 0.15 + 0.35 * r();
        const foot: V3 = [Math.cos(a) * d, Math.sin(a) * d, 0], tip: V3 = [foot[0] + Math.cos(a) * lean, foot[1] + Math.sin(a) * lean, h];
        limb(foot, tip, 0.07, 0.02, "leaf", out, 5, false);
        if (k % 7 === 0) ball([tip[0], tip[1], tip[2] - 0.15], [0.06, 0.06, 0.2], "bark", out, undefined, 6, 4);
      }
      return out;
    },
  },
];

/** PLANTED AND CUT: a stump where a tree was felled, and a clump of a flower bed. Only the player makes these. */
export const MADE: readonly Prop[] = [
  {
    // A stump: a short cut trunk, its face pale where the saw went through.
    id: "stump", shadow: shadowOf(0.6, 0.18),
    tris: () => {
      const out: Tri[] = [];
      limb([0, 0, 0], [0, 0, 0.45], 0.34, 0.28, "bark", out, 10, false);
      limb([0, 0, 0.44], [0, 0, 0.47], 0.27, 0.27, "wood", out, 10, true);
      // A root or two over the ground.
      for (const a of [0.4, 2.3, 4.1]) limb([0, 0, 0.12], [Math.cos(a) * 0.55, Math.sin(a) * 0.55, 0], 0.12, 0.05, "bark", out, 6, false);
      return out;
    },
  },
  {
    // Flowers: a mound of leaves, stems up out of it, a head on each — the heads the colour of the season.
    id: "flowers", shadow: shadowOf(0.6, 0.14),
    tris: () => { const out: Tri[] = []; flowerBed(out, true, 1); return out; },
  },
];

/** A clump of a bed: its leaves (fixed green), and with `heads` a share `keep` of its flowers. */
function flowerBed(out: Tri[], heads: boolean, keep: number) {
  const r = seeded(231);
  for (let k = 0; k < 5; k++) { const a = r() * Math.PI * 2, d = 0.3 * r(); ball([Math.cos(a) * d, Math.sin(a) * d, 0.1], [0.32, 0.32, 0.2], "liveryGreen", out, undefined, 8, 5); }
  for (let k = 0; k < 16; k++) {
    const a = r() * Math.PI * 2, d = 0.45 * Math.sqrt(r()), h = 0.35 + 0.3 * r(), go = r() < keep;
    const foot: V3 = [Math.cos(a) * d * 0.5, Math.sin(a) * d * 0.5, 0.1], tip: V3 = [Math.cos(a) * d, Math.sin(a) * d, h];
    limb(foot, tip, 0.025, 0.018, heads ? "liveryGreen" : "bark", out, 4, false);
    if (heads && go) ball(tip, [0.1, 0.1, 0.07], "leaf", out, undefined, 7, 4);
  }
}

/** Snow on what is low and round: pads lying on its top. */
function cushionSnow(out: Tri[], seed: number, r: number, z: number) {
  const rand = seeded(seed);
  for (let k = 0; k < 6; k++) { const a = rand() * Math.PI * 2, d = r * 0.5 * rand(); ball([Math.cos(a) * d, Math.sin(a) * d, z], [r * 0.45, r * 0.45, r * 0.14], "snow", out, undefined, 8, 5); }
}

export type TreeLook = { id: string; state: TreeState; tris: () => Tri[]; shadow: PropShadow };

/** Every kind in every look it takes; a pine, heather and reeds only as they are and in snow. */
export const TREE_LOOKS: readonly TreeLook[] = [...TREES, ...WILD, ...MADE].flatMap((t): TreeLook[] => {
  const withSnow = (f: (o: Tri[]) => void): TreeLook[] => [
    { id: t.id, state: "full", tris: t.tris, shadow: t.shadow },
    { id: t.id, state: "snow", tris: () => { const out = t.tris(); f(out); return out; }, shadow: t.shadow },
  ];
  if (t.id === "pine") return withSnow(pineSnow);
  if (t.id === "heather") return withSnow((o) => cushionSnow(o, 907, 1.4, 0.58));
  if (t.id === "reeds") return withSnow((o) => cushionSnow(o, 911, 0.7, 0.5));
  if (t.id === "stump") return withSnow((o) => cushionSnow(o, 913, 0.5, 0.48));
  if (t.id === "flowers") {
    // Leaves first, then in flower, going over, cut back to dead stalks, and snowed on.
    const bed = (f: (o: Tri[]) => void) => () => { const o: Tri[] = []; f(o); return o; };
    return [
      { id: t.id, state: "bud", tris: bed((o) => flowerBed(o, true, 0)), shadow: t.shadow },
      { id: t.id, state: "full", tris: t.tris, shadow: t.shadow },
      { id: t.id, state: "thin", tris: bed((o) => flowerBed(o, true, 0.35)), shadow: t.shadow },
      { id: t.id, state: "bare", tris: bed((o) => flowerBed(o, false, 0)), shadow: shadowOf(0.4, 0.08) },
      { id: t.id, state: "snow", tris: bed((o) => { flowerBed(o, false, 0); cushionSnow(o, 917, 0.7, 0.3); }), shadow: shadowOf(0.4, 0.08) },
    ];
  }
  const h = HABIT[t.id];
  if (!h) return [{ id: t.id, state: "full", tris: t.tris, shadow: t.shadow }];
  const out = (f: (o: Tri[]) => void) => () => { const o: Tri[] = []; f(o); return o; };
  // (A shrub's buds are its leaves' size: it is small all over.)
  const small = t.id === "shrub" ? 0.35 : 1;
  return [
    { id: t.id, state: "full", tris: t.tris, shadow: t.shadow },
    { id: t.id, state: "bud", tris: out((o) => { branches(h, o, false); clumps(h, o, 0.26 * small, 1); }), shadow: shadowOf(h.shade, 0.16) },
    { id: t.id, state: "thin", tris: out((o) => { branches(h, o, false); clumps(h, o, 0.75 * small, 0.55); }), shadow: shadowOf(h.shade, 0.2) },
    { id: t.id, state: "bare", tris: out((o) => branches(h, o, false)), shadow: shadowOf(h.shade, 0.12) },
    { id: t.id, state: "snow", tris: out((o) => branches(h, o, true)), shadow: shadowOf(h.shade, 0.12) },
  ];
});
