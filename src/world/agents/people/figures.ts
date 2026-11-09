/**
 * World v2 — THE TOWN'S PEOPLE AS MODELS: small figures in code, posed
 * through a walk and baked into a sheet by `dev/bake-people.ts`, as the
 * vehicles are. Nothing here runs while the game plays. @see cars/models.ts
 *
 * IN METRES, a person as tall as a person: 1.75 m, the cars' scale. They had
 * been drawn half as tall again as that, heads at a car's roof and more.
 *
 * A FIGURE is a build, what it wears below and above, its hair and what it
 * carries. Its colours are layers baked white and tinted in the game — skin,
 * bottoms, top, hair — so every figure comes in every colour; shoes, bags,
 * a builder's hi-vis and hard hat are baked in their own.
 */
import { HEIGHT_UNIT, HH, HW } from "../../iso";
import { TILES_PER_M, type Mat } from "../cars/models";
import { cross, face, norm, sub, type Tri, type V3 } from "../cars/raster";

export type Figure = {
  id: string;
  /** Shoulders and hips, as a share of an average build's. */
  build: number;
  lower: "trousers" | "shorts" | "skirt";
  sleeves: "long" | "short";
  hair: "short" | "long" | "bun" | "ponytail" | "curly" | "bald" | "hardhat";
  carry?: "backpack" | "bag";
  /** A builder's hi-vis over the top. */
  hivis?: boolean;
};

export const FIGURES: readonly Figure[] = [
  { id: "suit", build: 1.05, lower: "trousers", sleeves: "long", hair: "short" },
  { id: "casual", build: 1, lower: "trousers", sleeves: "short", hair: "short", carry: "backpack" },
  { id: "longHair", build: 0.92, lower: "trousers", sleeves: "long", hair: "long", carry: "bag" },
  { id: "skirt", build: 0.9, lower: "skirt", sleeves: "short", hair: "long" },
  { id: "bun", build: 0.92, lower: "trousers", sleeves: "long", hair: "bun", carry: "bag" },
  { id: "ponytail", build: 0.9, lower: "shorts", sleeves: "short", hair: "ponytail" },
  { id: "curly", build: 1, lower: "trousers", sleeves: "short", hair: "curly", carry: "backpack" },
  { id: "bald", build: 1.12, lower: "trousers", sleeves: "long", hair: "bald" },
  { id: "shorts", build: 1.05, lower: "shorts", sleeves: "short", hair: "short", carry: "backpack" },
  { id: "skirtLong", build: 0.9, lower: "skirt", sleeves: "long", hair: "bun" },
  { id: "slim", build: 0.88, lower: "trousers", sleeves: "short", hair: "ponytail", carry: "bag" },
  { id: "builder", build: 1.1, lower: "trousers", sleeves: "long", hair: "hardhat", hivis: true },
];
export const figureById = new Map(FIGURES.map((f) => [f.id, f]));

/** The layers, bottom to top: four tinted, and the rest in their own colours. */
export const PERSON_LAYERS = ["skin", "bottom", "top", "hair", "trim"] as const;
export const layerOfMat = (m: Mat): number => {
  const k = PERSON_LAYERS.indexOf(m as (typeof PERSON_LAYERS)[number]);
  return k >= 0 && k < 4 ? k : 4;
};

// ─── THE BODY'S MEASURES, metres ─────────────────────────────────────────────

const HIP_Z = 0.93, THIGH = 0.45, SHIN = 0.43, ANKLE_Z = 0.08;
const SHOULDER_Z = 1.42, UPPER_ARM = 0.29, FOREARM = 0.26;
const HEAD: V3 = [0.015, 0, 1.64];
/** A tile along the ground in half steps' height, on the screen. @see town.ts */
const HALF_STEP_IN_TILES = HEIGHT_UNIT / Math.hypot(HW, HH);
/**
 * THE STRIDE THE TOWN WALKS AT, metres a step: `town.ts`'s STRIDE, which sets
 * how fast the phase runs. The legs swing just far enough to cover it, so
 * the feet keep pace with the ground and do not skate. @see town.ts STRIDE
 */
export const STRIDE_M = (2 * 0.5 * Math.sin(0.5) * HALF_STEP_IN_TILES) / TILES_PER_M;
const SWING = Math.asin(Math.min(0.95, STRIDE_M / (2 * (THIGH + SHIN) * 0.97)));
const KNEE = 0.7;

// ─── PRIMITIVES ──────────────────────────────────────────────────────────────

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const lerp = (a: V3, b: V3, t: number): V3 => add(a, mul(sub(b, a), t));

/** Smooth triangles of a quad with a normal at each corner, skipping slivers. */
function quad(q: V3[], ns: V3[], mat: Mat, out: Tri[], paint?: (p: V3) => Mat) {
  for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]]) {
    if (Math.hypot(...cross(sub(q[b], q[a]), sub(q[c], q[a]))) < 1e-10) continue;
    const n = norm(add(add(ns[a], ns[b]), ns[c]));
    out.push({ p: [q[a], q[b], q[c]], mat, n, ns: [ns[a], ns[b], ns[c]], paint });
  }
}

/** An ellipsoid round `c`, radii along, across and up; `paint` picks its material at each point. */
function ball(c: V3, r: V3, mat: Mat, out: Tri[], paint?: (p: V3) => Mat, U = 12, V = 8) {
  const at = (i: number, j: number): [V3, V3] => {
    const th = (i / U) * Math.PI * 2, ph = -Math.PI / 2 + (j / V) * Math.PI;
    const d: V3 = [Math.cos(ph) * Math.cos(th), Math.cos(ph) * Math.sin(th), Math.sin(ph)];
    return [add(c, [d[0] * r[0], d[1] * r[1], d[2] * r[2]]), norm([d[0] / r[0], d[1] / r[1], d[2] / r[2]])];
  };
  for (let i = 0; i < U; i++) for (let j = 0; j < V; j++) {
    const ps = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
    quad(ps.map((p) => p[0]), ps.map((p) => p[1]), mat, out, paint);
  }
}

/** A limb from `a` to `b`, `ra` thick at one end and `rb` at the other, a ball at each joint. */
function limb(a: V3, b: V3, ra: number, rb: number, mat: Mat, out: Tri[], N = 8, joints = true) {
  const axis = norm(sub(b, a));
  const helper: V3 = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const e1 = norm(cross(axis, helper)), e2 = cross(axis, e1);
  const ring = (c: V3, r: number) => Array.from({ length: N }, (_, k) => {
    const t = (k / N) * Math.PI * 2, d = add(mul(e1, Math.cos(t)), mul(e2, Math.sin(t)));
    return { p: add(c, mul(d, r)), n: d };
  });
  const A = ring(a, ra), B = ring(b, rb);
  for (let k = 0; k < N; k++) {
    const k1 = (k + 1) % N;
    quad([A[k].p, A[k1].p, B[k1].p, B[k].p], [A[k].n, A[k1].n, B[k1].n, B[k].n], mat, out);
  }
  if (joints) { ball(a, [ra, ra, ra], mat, out, undefined, 8, 5); ball(b, [rb, rb, rb], mat, out, undefined, 8, 5); }
}

/**
 * A body lofted up through rings: each at height `z`, `l` forward, half
 * `rl` deep and `rw` wide — rounded, a little squarer than an ellipse — capped
 * at the top. `paint` picks its material at each point.
 */
function loft(rings: { z: number; l: number; rl: number; rw: number }[], mat: Mat, out: Tri[], paint?: (p: V3) => Mat, N = 14) {
  const pt = (r: (typeof rings)[number], k: number): V3 => {
    const t = (k / N) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    const sq = (x: number) => Math.sign(x) * Math.abs(x) ** 0.8;
    return [r.l + r.rl * sq(c), r.rw * sq(s), r.z];
  };
  const P = rings.map((r) => Array.from({ length: N }, (_, k) => pt(r, k)));
  const nAt = (i: number, k: number): V3 => {
    const ring = P[i], tr = sub(ring[(k + 1) % N], ring[(k + N - 1) % N]);
    const tz = sub(P[Math.min(P.length - 1, i + 1)][k], P[Math.max(0, i - 1)][k]);
    let n = norm(cross(tr, tz));
    const o = sub(ring[k], [rings[i].l, 0, rings[i].z]);
    if (n[0] * o[0] + n[1] * o[1] + n[2] * o[2] < 0) n = mul(n, -1);
    return n;
  };
  for (let i = 0; i + 1 < P.length; i++) for (let k = 0; k < N; k++) {
    const k1 = (k + 1) % N;
    quad([P[i][k], P[i][k1], P[i + 1][k1], P[i + 1][k]], [nAt(i, k), nAt(i, k1), nAt(i + 1, k1), nAt(i + 1, k)], mat, out, paint);
  }
  const top = P[P.length - 1], r = rings[rings.length - 1], c: V3 = [r.l, 0, r.z];
  const from = out.length;
  for (let k = 0; k < N; k++) face([c, top[k], top[(k + 1) % N]], mat, [r.l, 0, r.z - 0.1], out);
  if (paint) for (let j = from; j < out.length; j++) out[j].paint = paint;
}

// ─── THE POSE ────────────────────────────────────────────────────────────────

/**
 * A figure posed: walking at `phase` (π a step, as the town counts it), or at
 * work — feet planted and the arm nearer the camera, `near` (+1 left, −1
 * right), swinging a hammer.
 */
export function figureTris(f: Figure, phase: number, work: boolean, near: number): Tri[] {
  const out: Tri[] = [];
  const b = f.build, hipW = 0.085 * b, shW = 0.185 * b;

  // THE LEGS: the thigh swings through the stride, the knee bends as it comes through.
  type Leg = { hip: V3; knee: V3; ankle: V3; foot: number };
  const leg = (side: number): Leg => {
    if (work) {
      const hip: V3 = [0, side * hipW, HIP_Z - 0.03];
      const ankle: V3 = [side * 0.05, side * (hipW + 0.04), ANKLE_Z];
      return { hip, knee: [0.04, side * (hipW + 0.02), (HIP_Z + ANKLE_Z) / 2], ankle, foot: 0 };
    }
    const p = phase + (side > 0 ? 0 : Math.PI);
    const th = SWING * Math.sin(p), bend = KNEE * Math.max(0, Math.cos(p));
    const hip: V3 = [0, side * hipW, HIP_Z];
    const knee = add(hip, [Math.sin(th) * THIGH, 0, -Math.cos(th) * THIGH]);
    const ankle = add(knee, [Math.sin(th - bend) * SHIN, 0, -Math.cos(th - bend) * SHIN]);
    return { hip, knee, ankle, foot: Math.max(-0.5, Math.min(0.6, (th - bend) * 0.6)) };
  };
  const L = leg(1), R = leg(-1);
  // Whole body down so the lower foot is on the ground: the walk's bob.
  const drop = Math.min(L.ankle[2], R.ankle[2]) - ANKLE_Z;
  const at = (p: V3): V3 => [p[0], p[1], p[2] - drop];

  for (const g of [L, R]) {
    const hip = at(g.hip), knee = at(g.knee), ankle = at(g.ankle);
    if (f.lower === "trousers") {
      limb(hip, knee, 0.075, 0.06, "bottom", out);
      limb(knee, ankle, 0.06, 0.045, "bottom", out);
    } else if (f.lower === "shorts") {
      const hem = lerp(hip, knee, 0.7);
      limb(hip, hem, 0.08, 0.072, "bottom", out);
      limb(hem, knee, 0.055, 0.05, "skin", out, 8, false);
      limb(knee, ankle, 0.05, 0.038, "skin", out);
    } else {
      limb(hip, knee, 0.06, 0.05, "skin", out);
      limb(knee, ankle, 0.05, 0.038, "skin", out);
    }
    // THE SHOE: a long rounded block forward of the ankle, tipped with the step.
    const c = g.foot, fwd: V3 = [Math.cos(c), 0, Math.sin(c)];
    ball(add(ankle, add(mul(fwd, 0.06), [0, 0, -0.035])), [0.12, 0.05, 0.045], "shoe", out, undefined, 10, 6);
  }

  // THE BODY, hips to shoulders, leaning into the walk; its lower part is the bottoms.
  const lean = work ? 0.01 : 0.025;
  const waist = 1.0 - drop;
  const top: Mat = "top";
  const vest = (p: V3): Mat => {
    if (p[2] < waist + (f.lower === "skirt" ? 0.0 : 0.0)) return "bottom";
    if (!f.hivis) return top;
    // Hi-vis over the top, two bright bands round it.
    if (Math.abs(p[2] - (1.16 - drop)) < 0.022 || Math.abs(p[2] - (1.3 - drop)) < 0.022) return "chrome";
    return "hivis";
  };
  loft([
    { z: 0.86 - drop, l: 0, rl: 0.1, rw: 0.15 * b },
    { z: 1.0 - drop, l: lean * 0.3, rl: 0.095, rw: 0.14 * b },
    { z: 1.18 - drop, l: lean * 0.6, rl: 0.11, rw: 0.155 * b },
    { z: 1.34 - drop, l: lean, rl: 0.12, rw: 0.185 * b },
    { z: 1.43 - drop, l: lean, rl: 0.1, rw: 0.18 * b },
    { z: 1.49 - drop, l: lean, rl: 0.06, rw: 0.09 },
  ], top, out, vest);
  if (f.lower === "skirt") {
    loft([
      { z: 0.98 - drop, l: 0, rl: 0.11, rw: 0.155 * b },
      { z: 0.78 - drop, l: 0, rl: 0.17, rw: 0.21 * b },
      { z: 0.56 - drop, l: 0, rl: 0.21, rw: 0.25 * b },
    ].reverse(), "bottom", out);
  }

  // THE ARMS, swinging against the legs; at work, the near one beating.
  for (const side of [1, -1]) {
    const g = side > 0 ? L : R;
    const shoulder: V3 = [lean, side * shW, SHOULDER_Z - drop];
    let up: number, fore: number;
    if (work) { up = side === near ? 1.2 + 0.9 * Math.sin(phase) : 0.45; fore = up + 0.6; }
    else { const th = Math.asin((g.knee[0] - g.hip[0]) / THIGH); up = -0.8 * th; fore = up + 0.35; }
    const out1 = side * 0.06;
    const elbow = add(shoulder, [Math.sin(up) * UPPER_ARM, out1 * 0.5, -Math.cos(up) * UPPER_ARM]);
    const wrist = add(elbow, [Math.sin(fore) * FOREARM, out1 * 0.3, -Math.cos(fore) * FOREARM]);
    if (f.sleeves === "long") {
      limb(shoulder, elbow, 0.052, 0.045, top, out);
      limb(elbow, wrist, 0.045, 0.036, top, out);
    } else {
      const hem = lerp(shoulder, elbow, 0.55);
      limb(shoulder, hem, 0.056, 0.052, top, out);
      limb(hem, elbow, 0.04, 0.036, "skin", out, 8, false);
      limb(elbow, wrist, 0.036, 0.03, "skin", out);
    }
    const hand = add(wrist, mul(norm(sub(wrist, elbow)), 0.045));
    ball(hand, [0.045, 0.035, 0.05], "skin", out, undefined, 8, 5);
  }

  // THE HEAD on its neck, a nose to say which way it faces, and the hair.
  const head = at(HEAD), hl = head[0], hz = head[2];
  limb([lean, 0, 1.47 - drop], [hl, 0, hz - 0.08], 0.05, 0.045, "skin", out, 8, false);
  const hairline = (p: V3) => {
    const dl = (p[0] - hl) / 0.1, dz = p[2] - hz;
    return dz > 0.035 - 0.1 * Math.max(0, -dl) + 0.02 * Math.max(0, dl);
  };
  const scalp: ((p: V3) => Mat) | undefined =
    f.hair === "bald" || f.hair === "hardhat" ? undefined : (p) => (hairline(p) ? "hair" : "skin");
  ball(head, [0.1, 0.085, 0.115], "skin", out, scalp);
  ball([hl + 0.095, 0, hz - 0.01], [0.025, 0.018, 0.025], "skin", out, undefined, 6, 4);
  if (f.hair === "long") ball([hl - 0.05, 0, hz - 0.1], [0.07, 0.095, 0.16], "hair", out);
  if (f.hair === "bun") ball([hl - 0.085, 0, hz + 0.06], [0.05, 0.05, 0.05], "hair", out, undefined, 8, 6);
  if (f.hair === "ponytail") {
    const swing = work ? 0 : 0.03 * Math.sin(phase * 2);
    limb([hl - 0.09, 0, hz + 0.03], [hl - 0.16, swing, hz - 0.16], 0.035, 0.022, "hair", out, 6);
  }
  if (f.hair === "curly") ball([hl - 0.025, 0, hz + 0.035], [0.105, 0.105, 0.105], "hair", out, (p) => (p[0] > hl + 0.05 && p[2] < hz + 0.04 ? "skin" : "hair"));
  if (f.hair === "hardhat") {
    ball([hl, 0, hz + 0.035], [0.12, 0.11, 0.1], "hardhat", out, (p) => (p[2] < hz + 0.03 ? "skin" : "hardhat"));
    ball([hl + 0.02, 0, hz + 0.035], [0.15, 0.13, 0.012], "hardhat", out, undefined, 12, 3);
  }

  // WHAT THEY CARRY: a backpack on their back, or a bag at the hip on a strap.
  if (f.carry === "backpack") ball([lean - 0.17, 0, 1.2 - drop], [0.07, 0.14, 0.17], "bag", out);
  if (f.carry === "bag") {
    ball([0.0, -0.21 * b, 0.98 - drop], [0.12, 0.04, 0.09], "bag", out);
    limb([lean, 0.17 * b, 1.42 - drop], [0.0, -0.2 * b, 1.06 - drop], 0.012, 0.012, "bag", out, 4, false);
  }
  return out;
}
