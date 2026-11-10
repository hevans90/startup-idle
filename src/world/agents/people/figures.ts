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
import type { Mat } from "../cars/models";
import { cross, face, norm, sub, type Tri, type V3 } from "../cars/raster";
import { CHILD_HEIGHT, CHILD_STEP_M, HOLD_GAP_M, HOLD_REACH_M, HOLD_Z, STEP_M, type Breed } from "./people-format";

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
  /** A woman's figure: shorter, a waist, hips and a bust, narrower shoulders, slimmer limbs. */
  fem?: boolean;
  /** A child: the figure scaled down whole, the head larger for it. @see CHILD_HEIGHT */
  child?: boolean;
};

export const FIGURES: readonly Figure[] = [
  { id: "suit", build: 1.05, lower: "trousers", sleeves: "long", hair: "short" },
  { id: "casual", build: 1, lower: "trousers", sleeves: "short", hair: "short", carry: "backpack" },
  { id: "longHair", build: 0.92, lower: "trousers", sleeves: "long", hair: "long", carry: "bag", fem: true },
  { id: "skirt", build: 0.9, lower: "skirt", sleeves: "short", hair: "long", fem: true },
  { id: "bun", build: 0.92, lower: "trousers", sleeves: "long", hair: "bun", carry: "bag", fem: true },
  { id: "ponytail", build: 0.9, lower: "shorts", sleeves: "short", hair: "ponytail", fem: true },
  { id: "curly", build: 1, lower: "trousers", sleeves: "short", hair: "curly", carry: "backpack" },
  { id: "bald", build: 1.12, lower: "trousers", sleeves: "long", hair: "bald" },
  { id: "shorts", build: 1.05, lower: "shorts", sleeves: "short", hair: "short", carry: "backpack" },
  { id: "skirtLong", build: 0.9, lower: "skirt", sleeves: "long", hair: "bun", fem: true },
  { id: "slim", build: 0.88, lower: "trousers", sleeves: "short", hair: "ponytail", carry: "bag", fem: true },
  { id: "builder", build: 1.1, lower: "trousers", sleeves: "long", hair: "hardhat", hivis: true },
  { id: "kid", build: 1.05, lower: "shorts", sleeves: "short", hair: "short", child: true },
  { id: "kidSkirt", build: 1, lower: "skirt", sleeves: "short", hair: "ponytail", child: true },
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
/**
 * THE STEP THE TOWN WALKS AT, metres: `STEP_M`, which sets how fast the phase
 * runs. The legs swing just far enough to cover it — a woman's, scaled down
 * whole, a little further — so the feet keep pace with the ground and do not
 * skate. @see people-format STEP_M
 */
export const STRIDE_M = STEP_M;
const swingFor = (scale: number, step = STRIDE_M) => Math.asin(Math.min(0.95, step / scale / (2 * (THIGH + SHIN) * 0.97)));
const KNEE = 0.45;

// ─── PRIMITIVES ──────────────────────────────────────────────────────────────

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const lerp = (a: V3, b: V3, t: number): V3 => add(a, mul(sub(b, a), t));

/** Smooth triangles of a quad with a normal at each corner, skipping slivers. */
export function quad(q: V3[], ns: V3[], mat: Mat, out: Tri[], paint?: (p: V3) => Mat) {
  for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]]) {
    if (Math.hypot(...cross(sub(q[b], q[a]), sub(q[c], q[a]))) < 1e-10) continue;
    const n = norm(add(add(ns[a], ns[b]), ns[c]));
    out.push({ p: [q[a], q[b], q[c]], mat, n, ns: [ns[a], ns[b], ns[c]], paint });
  }
}

/** An ellipsoid round `c`, radii along, across and up; `paint` picks its material at each point. */
export function ball(c: V3, r: V3, mat: Mat, out: Tri[], paint?: (p: V3) => Mat, U = 12, V = 8) {
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
export function limb(a: V3, b: V3, ra: number, rb: number, mat: Mat, out: Tri[], N = 8, joints = true) {
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
export function loft(rings: { z: number; l: number; rl: number; rw: number }[], mat: Mat, out: Tri[], paint?: (p: V3) => Mat, N = 14) {
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
 * Walking; at work; sat down; on a bike; stood, swaying a little from foot to
 * foot; running; or walking hand in hand. @see figureTris
 */
export type Pose = "walk" | "work" | "sit" | "ride" | "stand" | "run" | "hold";

/**
 * A BICYCLE, metres, in the rider's own frame — the saddle over the origin:
 * the crank's axle, the wheels' axles and radius, the bars, and how far it
 * goes a turn of the pedals. The whole is moved back after so the bike's
 * middle, between its wheels, is the mover's point. @see bikeTris
 */
export const BIKE = {
  crank: [0.24, 0, 0.29] as V3, crankLen: 0.17,
  front: 0.72, rear: -0.3, wheelZ: 0.34, wheelR: 0.34,
  bars: [0.56, 0, 1.06] as V3, barW: 0.26,
  /** Where each hand holds on: the middle of its grip, `y` out to the left (and mirrored). */
  grip: [0.47, 0.235, 1.07] as V3,
  hip: 0.95,
};
export { RIDERS } from "./people-format";

/**
 * The middle joint of a two-bone limb from `a` to `b`, bones `l1` and `l2`,
 * bent toward `hint`: a knee forward, an elbow down and out.
 */
function jointOf(a: V3, b: V3, l1: number, l2: number, hint: V3): V3 {
  const ab = sub(b, a), d = Math.min(Math.hypot(...ab), l1 + l2 - 1e-4), dir = norm(ab);
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d), up = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const k = hint[0] * dir[0] + hint[1] * dir[1] + hint[2] * dir[2];
  const perp = norm(sub(hint, mul(dir, k)));
  return add(add(a, mul(dir, along)), mul(perp, up));
}

/** The bike, its pedals turned to `phase` (2π a turn), in the rider's frame. */
export function bikeTris(phase: number): Tri[] {
  const out: Tri[] = [];
  const { crank: C, front: F, rear: R, wheelZ: wz, wheelR: wr, bars } = BIKE;
  const rearAx: V3 = [R, 0, wz], frontAx: V3 = [F, 0, wz];
  const seatTop: V3 = [-0.05, 0, 0.84], headTop: V3 = [0.5, 0, 0.86], headFoot: V3 = [0.54, 0, 0.66];
  // THE WHEELS: a tyre round a rim, and spokes.
  for (const ax of [rearAx, frontAx]) {
    const N = 18;
    for (let k = 0; k < N; k++) {
      const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2;
      const p = (a: number, r: number): V3 => [ax[0] + Math.cos(a) * r, 0, ax[2] + Math.sin(a) * r];
      limb(p(a0, wr - 0.02), p(a1, wr - 0.02), 0.022, 0.022, "tyre", out, 6, false);
      limb(p(a0, wr - 0.05), p(a1, wr - 0.05), 0.01, 0.01, "rim", out, 4, false);
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      limb(ax, [ax[0] + Math.cos(a) * (wr - 0.05), 0, ax[2] + Math.sin(a) * (wr - 0.05)], 0.004, 0.004, "spoke", out, 3, false);
    }
    ball(ax, [0.025, 0.04, 0.025], "hub", out, undefined, 6, 4);
  }
  // THE FRAME: a diamond of tubes, the forks, the stem and bars, the saddle.
  const tube = (a: V3, b: V3, r = 0.02) => limb(a, b, r, r, "iron", out, 6, true);
  tube(C, seatTop); tube(seatTop, headTop); tube(C, headFoot, 0.024);
  tube(C, rearAx, 0.013); tube(seatTop, rearAx, 0.012); tube(headTop, headFoot, 0.024);
  for (const side of [1, -1]) limb(headFoot, [F, side * 0.04, wz], 0.014, 0.012, "iron", out, 6, false);
  // THE STEM up out of the head tube and forward, a clamp at its end.
  const stemFoot: V3 = [headTop[0] - 0.01, 0, headTop[2] + 0.08];
  limb(headTop, stemFoot, 0.019, 0.017, "iron", out, 8, false);
  limb(stemFoot, bars, 0.016, 0.016, "chrome", out, 8, false);
  ball(bars, [0.028, 0.035, 0.028], "chrome", out, undefined, 8, 5);
  // THE BARS, swept back toward the rider either side: out from the clamp,
  // round and back, to a black rubber grip — a brake lever in front of it.
  const G = BIKE.grip;
  for (const side of [1, -1]) {
    const pts: V3[] = [
      [bars[0], 0, bars[2]],
      [bars[0], side * 0.1, bars[2] + 0.005],
      [bars[0] - 0.025, side * 0.16, bars[2] + 0.01],
      [G[0] + 0.03, side * (G[1] - 0.045), G[2]],
    ];
    for (let k = 1; k < pts.length; k++) limb(pts[k - 1], pts[k], 0.012, 0.012, "iron", out, 6, true);
    const g0: V3 = [G[0] + 0.03, side * (G[1] - 0.045), G[2]], g1: V3 = [G[0] - 0.02, side * (G[1] + 0.05), G[2] - 0.005];
    limb(g0, g1, 0.018, 0.018, "tyre", out, 8, false);
    ball(g1, [0.019, 0.019, 0.019], "tyre", out, undefined, 6, 4);
    // The lever: from the bar, forward and down along the grip.
    const lv0: V3 = [G[0] + 0.035, side * (G[1] - 0.04), G[2] + 0.005];
    limb(lv0, [G[0] + 0.075, side * (G[1] + 0.03), G[2] - 0.03], 0.006, 0.005, "chrome", out, 4, false);
  }
  // A bell by the left grip, and a lamp on the front.
  ball([bars[0] - 0.01, 0.13, bars[2] + 0.03], [0.022, 0.022, 0.014], "chrome", out, undefined, 8, 4);
  ball([headTop[0] + 0.05, 0, headTop[2] - 0.02], [0.03, 0.035, 0.03], "iron", out, undefined, 8, 5);
  ball([headTop[0] + 0.075, 0, headTop[2] - 0.02], [0.012, 0.025, 0.022], "lamp", out, undefined, 6, 4);
  limb(seatTop, [-0.06, 0, 0.9], 0.012, 0.012, "chrome", out, 5, false);
  ball([-0.04, 0, 0.92], [0.12, 0.06, 0.03], "seat", out, undefined, 10, 5);
  // THE CRANKS, either side, opposite each other, and their pedals.
  for (const side of [1, -1]) {
    const a = phase + (side > 0 ? 0 : Math.PI);
    const ped: V3 = [C[0] + Math.sin(a) * BIKE.crankLen, side * 0.1, C[2] - Math.cos(a) * BIKE.crankLen];
    limb([C[0], side * 0.06, C[2]], ped, 0.012, 0.012, "chrome", out, 5, false);
    ball(ped, [0.05, 0.04, 0.012], "tyre", out, undefined, 6, 3);
  }
  ball(C, [0.06, 0.03, 0.06], "chrome", out, undefined, 8, 4);
  return out;
}

/** How high a sitter's hips are, metres: on a seat 0.45 m up. @see props SEAT_Z */
export const SIT_HIP = 0.56;

/**
 * A figure posed: walking at `phase` (π a step, as the town counts it); at
 * work — feet planted and the arm nearer the camera, `near` (+1 left, −1
 * right), swinging a hammer; sitting, on a seat under the origin, facing
 * forward, hands in their lap; stood, `phase` its sway; running; or walking
 * with the hand on side `near` holding another's. @see HOLD_GAP_M
 */
export function figureTris(f: Figure, phase: number, pose: Pose, near: number): Tri[] {
  const work = pose === "work", sit = pose === "sit", ride = pose === "ride";
  const stand = pose === "stand", run = pose === "run", hold = pose === "hold";
  const out: Tri[] = [];
  const b = f.build, fem = !!f.fem && !f.child;
  /** How tall, as a share of a man: scaled to it whole, at the end. */
  const tall = f.child ? CHILD_HEIGHT : fem ? FEM_HEIGHT : 1;
  const hipW = (fem ? 0.08 : 0.088) * b, shW = (fem ? 0.162 : 0.185) * b;
  /** Limbs a little slimmer on a woman. */
  const lr = fem ? 0.86 : 1;

  // THE LEGS: the thigh swings through the stride, the knee bends as it comes through.
  type Leg = { hip: V3; knee: V3; ankle: V3; foot: number };
  const leg = (side: number): Leg => {
    if (ride) {
      // ON THE PEDALS: the ankle over its pedal, the knee forward, the hips on the saddle.
      const a = phase + (side > 0 ? 0 : Math.PI), lift = HIP_Z - BIKE.hip;
      const ankle: V3 = [BIKE.crank[0] + Math.sin(a) * BIKE.crankLen - 0.03, side * (hipW + 0.02), BIKE.crank[2] - Math.cos(a) * BIKE.crankLen + 0.07 + lift];
      const hip: V3 = [0, side * hipW, HIP_Z];
      return { hip, knee: jointOf(hip, ankle, THIGH, SHIN, [1, 0, 0.4]), ankle, foot: 0 };
    }
    if (sit) {
      // Thighs along the seat, shins down to the ground: lifted by how far the hips are dropped.
      const lift = HIP_Z - SIT_HIP;
      return {
        hip: [0, side * hipW, HIP_Z], knee: [THIGH, side * (hipW + 0.015), HIP_Z + 0.02],
        ankle: [THIGH + 0.06, side * (hipW + 0.03), ANKLE_Z + lift], foot: 0,
      };
    }
    if (work) {
      const hip: V3 = [0, side * hipW, HIP_Z - 0.03];
      const ankle: V3 = [side * 0.05, side * (hipW + 0.04), ANKLE_Z];
      return { hip, knee: [0.04, side * (hipW + 0.02), (HIP_Z + ANKLE_Z) / 2], ankle, foot: 0 };
    }
    if (stand) {
      // Feet a little apart, the weight on one and then the other.
      const hip: V3 = [0, side * hipW, HIP_Z];
      const ankle: V3 = [side * 0.01, side * (hipW + 0.025), ANKLE_Z];
      return { hip, knee: [0.015, side * (hipW + 0.012), (HIP_Z + ANKLE_Z) / 2], ankle, foot: 0 };
    }
    const p = phase + (side > 0 ? 0 : Math.PI);
    if (run) {
      // RUNNING: a long swing, the heel kicked up behind as the leg comes through.
      const th = 0.62 * Math.sin(p) + 0.08, bend = 0.35 + 1.25 * Math.max(0, Math.cos(p));
      const hip: V3 = [0, side * hipW, HIP_Z];
      const knee = add(hip, [Math.sin(th) * THIGH, 0, -Math.cos(th) * THIGH]);
      const ankle = add(knee, [Math.sin(th - bend) * SHIN, 0, -Math.cos(th - bend) * SHIN]);
      return { hip, knee, ankle, foot: Math.max(-0.6, Math.min(0.6, (th - bend) * 0.6)) };
    }
    const step = f.child ? CHILD_STEP_M : STRIDE_M;
    const th = swingFor(tall, step) * Math.sin(p), bend = KNEE * Math.max(0, Math.cos(p));
    const hip: V3 = [0, side * hipW, HIP_Z];
    const knee = add(hip, [Math.sin(th) * THIGH, 0, -Math.cos(th) * THIGH]);
    const ankle = add(knee, [Math.sin(th - bend) * SHIN, 0, -Math.cos(th - bend) * SHIN]);
    return { hip, knee, ankle, foot: Math.max(-0.5, Math.min(0.6, (th - bend) * 0.6)) };
  };
  const L = leg(1), R = leg(-1);
  // Whole body down so the lower foot is on the ground: the walk's bob.
  const drop = ride ? HIP_Z - BIKE.hip : sit ? HIP_Z - SIT_HIP : Math.min(L.ankle[2], R.ankle[2]) - ANKLE_Z;
  const at = (p: V3): V3 => [p[0], p[1], p[2] - drop];

  for (const g of [L, R]) {
    const hip = at(g.hip), knee = at(g.knee), ankle = at(g.ankle);
    // A LEG as legs go: a full thigh tapering to the knee, the calf swelling
    // below it, a slim ankle. Trousers hang straighter, to a hem over the shoe.
    const calf = lerp(knee, ankle, 0.32);
    const thigh = (mat: Mat, to: V3 = knee, r1 = 0.054 * lr) => limb(hip, to, 0.088 * lr, r1, mat, out, 10);
    const shin = (mat: Mat) => {
      limb(knee, calf, 0.052 * lr, 0.056 * lr, mat, out, 10, false);
      limb(calf, ankle, 0.056 * lr, 0.032 * lr, mat, out, 10, false);
      ball(ankle, [0.032 * lr, 0.032 * lr, 0.032 * lr], mat, out, undefined, 8, 5);
    };
    if (f.lower === "trousers") {
      thigh("bottom", knee, 0.064 * lr);
      limb(knee, ankle, 0.064 * lr, 0.055 * lr, "bottom", out, 10, false);
    } else if (f.lower === "shorts") {
      const hem = lerp(hip, knee, 0.62);
      limb(hip, hem, 0.094 * lr, 0.082 * lr, "bottom", out, 10);
      limb(hem, knee, 0.068 * lr, 0.054 * lr, "skin", out, 10, false);
      ball(knee, [0.054 * lr, 0.054 * lr, 0.054 * lr], "skin", out, undefined, 8, 5);
      shin("skin");
    } else {
      thigh("skin");
      shin("skin");
    }
    // THE SHOE: heel under the ankle, the toe forward, tipped with the step; low and narrow.
    const c = g.foot, fwd: V3 = [Math.cos(c), 0, Math.sin(c)];
    const shoe: V3 = fem ? [0.1, 0.038, 0.032] : [0.12, 0.045, 0.04];
    ball(add(ankle, add(mul(fwd, shoe[0] * 0.55), [0, 0, -0.04])), shoe, "shoe", out, undefined, 12, 6);
  }

  // THE BODY, hips to shoulders, leaning into the walk; its lower part is the bottoms.
  const lean = ride ? 0.2 : run ? 0.09 : sit ? -0.03 : work || stand ? 0.01 : 0.025;
  const waist = 1.0 - drop;
  const top: Mat = "top";
  const vest = (p: V3): Mat => {
    if (p[2] < waist + (f.lower === "skirt" ? 0.0 : 0.0)) return "bottom";
    if (!f.hivis) return top;
    // Hi-vis over the top, two bright bands round it.
    if (Math.abs(p[2] - (1.16 - drop)) < 0.022 || Math.abs(p[2] - (1.3 - drop)) < 0.022) return "chrome";
    return "hivis";
  };
  // From the crotch up: a pelvis the legs go into, the waist, the chest — a
  // woman's narrower at the waist, fuller at the hips and bust.
  const ring = (z: number, l: number, rl: number, rw: number) => ({ z: z - drop, l, rl, rw: rw * b });
  loft(fem ? [
    ring(0.8, 0, 0.1, 0.15),
    ring(0.9, 0, 0.11, 0.168),
    ring(1.02, lean * 0.3, 0.085, 0.118),
    ring(1.14, lean * 0.5, 0.095, 0.13),
    ring(1.24, lean * 0.7 + 0.025, 0.125, 0.145),
    ring(1.33, lean, 0.1, 0.152),
    ring(1.41, lean, 0.085, 0.15),
    ring(1.47, lean, 0.05, 0.075),
  ] : [
    ring(0.8, 0, 0.1, 0.148),
    ring(0.9, 0, 0.105, 0.155),
    ring(1.0, lean * 0.3, 0.098, 0.145),
    ring(1.18, lean * 0.6, 0.112, 0.16),
    ring(1.34, lean, 0.12, 0.188),
    ring(1.43, lean, 0.1, 0.182),
    ring(1.49, lean, 0.06, 0.09),
  ], top, out, vest);
  if (f.lower === "skirt" && sit) {
    // Sat in: drawn forward over the thighs to a hem at the knee.
    loft([
      ring(1.03, lean * 0.3, 0.092, 0.125),
      ring(0.97, 0.03, 0.13, 0.19),
      ring(0.9, 0.24, 0.31, 0.2),
      ring(0.83, 0.25, 0.32, 0.21),
    ].reverse(), "bottom", out);
  } else if (f.lower === "skirt") {
    loft([
      // An A-line from the waist, over the hips, to a hem below the knee.
      ring(1.03, lean * 0.3, 0.092, 0.125),
      ring(0.9, 0, 0.125, 0.195),
      ring(0.72, 0, 0.17, 0.2),
      ring(0.52, 0, 0.2, 0.215),
    ].reverse(), "bottom", out);
  }

  // THE ARMS, swinging against the legs; at work, the near one beating.
  for (const side of [1, -1]) {
    const g = side > 0 ? L : R;
    const shoulder: V3 = [lean, side * shW, SHOULDER_Z - drop];
    let up: number, fore: number;
    if (sit) { up = 0.3; fore = 1.35; }
    else if (work) { up = side === near ? 1.2 + 0.9 * Math.sin(phase) : 0.45; fore = up + 0.6; }
    else if (stand) { up = 0.04; fore = 0.16; }
    else if (run) { const th = Math.asin((g.knee[0] - g.hip[0]) / THIGH); up = -1.0 * th; fore = up + 1.5; }
    else { const th = Math.asin((g.knee[0] - g.hip[0]) / THIGH); up = -0.8 * th; fore = up + 0.35; }
    const out1 = side * 0.06;
    let elbow = add(shoulder, [Math.sin(up) * UPPER_ARM, out1 * 0.5, -Math.cos(up) * UPPER_ARM]);
    let wrist = add(elbow, [Math.sin(fore) * FOREARM, out1 * 0.3, -Math.cos(fore) * FOREARM]);
    if (hold && side === near) {
      // HAND IN HAND, out to the side and a little forward: where the other's
      // hand is, a grown-up's down and out, a child's up, in this figure's
      // own measure before it is scaled. @see HOLD_GAP_M
      const reach = f.child ? HOLD_GAP_M - HOLD_REACH_M : HOLD_REACH_M;
      wrist = at([0.03 / tall, side * (reach - 0.04) / tall, (HOLD_Z + 0.02) / tall]);
      elbow = jointOf(shoulder, wrist, UPPER_ARM, FOREARM, [-0.2, side * 0.5, -1]);
    }
    if (ride) {
      // HANDS ON THE BARS, the elbows a little bent, down and out.
      wrist = [BIKE.grip[0] - 0.045, side * BIKE.grip[1], BIKE.grip[2] + 0.025];
      elbow = jointOf(shoulder, wrist, UPPER_ARM, FOREARM, [-0.3, side * 0.6, -1]);
    }
    if (f.sleeves === "long") {
      limb(shoulder, elbow, 0.052 * lr, 0.045 * lr, top, out);
      limb(elbow, wrist, 0.045 * lr, 0.036 * lr, top, out);
    } else {
      const hem = lerp(shoulder, elbow, 0.55);
      limb(shoulder, hem, 0.056 * lr, 0.052 * lr, top, out);
      limb(hem, elbow, 0.04 * lr, 0.036 * lr, "skin", out, 8, false);
      limb(elbow, wrist, 0.036 * lr, 0.03 * lr, "skin", out);
    }
    const hand = add(wrist, mul(norm(sub(wrist, elbow)), 0.045));
    ball(hand, [0.045 * lr, 0.035 * lr, 0.05 * lr], "skin", out, undefined, 8, 5);
  }

  // THE HEAD on its neck, a nose to say which way it faces, and the hair.
  // On a bike, carried forward over the leaning shoulders and a little down, looking up the road.
  const head = ride ? add(at(HEAD), [lean + 0.04, 0, -0.04]) : run ? add(at(HEAD), [lean - 0.01, 0, -0.01]) : at(HEAD), hl = head[0], hz = head[2];
  limb([lean, 0, 1.47 - drop], [hl, 0, hz - 0.08], 0.05, 0.045, "skin", out, 8, false);
  const headFrom = out.length;
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
    const swing = work || sit || ride ? 0 : 0.03 * Math.sin(phase * 2);
    limb([hl - 0.09, 0, hz + 0.03], [hl - 0.16, swing, hz - 0.16], 0.035, 0.022, "hair", out, 6);
  }
  if (f.hair === "curly") ball([hl - 0.025, 0, hz + 0.035], [0.105, 0.105, 0.105], "hair", out, (p) => (p[0] > hl + 0.05 && p[2] < hz + 0.04 ? "skin" : "hair"));
  if (f.hair === "hardhat") {
    ball([hl, 0, hz + 0.035], [0.12, 0.11, 0.1], "hardhat", out, (p) => (p[2] < hz + 0.03 ? "skin" : "hardhat"));
    ball([hl + 0.02, 0, hz + 0.035], [0.15, 0.13, 0.012], "hardhat", out, undefined, 12, 3);
  }

  // A CHILD'S HEAD larger, as children's are, for how small they are.
  if (f.child) for (let j = headFrom; j < out.length; j++) {
    const t = out[j], k = 1.3, c: V3 = [hl, 0, hz - 0.03];
    t.p = t.p.map((q) => add(c, mul(sub(q, c), k))) as Tri["p"];
    const paint = t.paint;
    if (paint) t.paint = (q) => paint(add(c, mul(sub(q, c), 1 / k)));
  }
  // WHAT THEY CARRY: a backpack on their back, or a bag at the hip on a strap.
  const carry = run || f.child ? undefined : f.carry;
  if (carry === "backpack") ball([lean - 0.17, 0, 1.2 - drop], [0.07, 0.14, 0.17], "bag", out);
  if (carry === "bag") {
    ball([0.0, -0.21 * b, 0.98 - drop], [0.12, 0.04, 0.09], "bag", out);
    limb([lean, 0.17 * b, 1.42 - drop], [0.0, -0.2 * b, 1.06 - drop], 0.012, 0.012, "bag", out, 4, false);
  }
  // STOOD, swaying a little from side to side about the feet.
  if (stand) {
    const sway = 0.018 * Math.sin(phase);
    for (const t of out) {
      t.p = t.p.map((q) => [q[0], q[1] + sway * q[2], q[2]]) as Tri["p"];
      const paint = t.paint;
      if (paint) t.paint = (q) => paint([q[0], q[1] - sway * q[2], q[2]]);
    }
  }
  // A WOMAN a little shorter: 1.63 m to a man's 1.75, scaled whole about her
  // feet; a child much shorter, their head larger for it.
  if (tall !== 1) for (const t of out) {
    t.p = t.p.map((q) => mul(q, tall)) as Tri["p"];
    const paint = t.paint;
    if (paint) t.paint = (q) => paint(mul(q, 1 / tall));
  }
  if (ride) {
    // ON HER BIKE, or his: the bike under them, and the two moved back so the bike's middle is the point.
    out.push(...bikeTris(phase));
    const back = -(BIKE.front + BIKE.rear) / 2;
    for (const t of out) {
      t.p = t.p.map((q) => [q[0] + back, q[1], q[2]]) as Tri["p"];
      const paint = t.paint;
      if (paint) t.paint = (q) => paint([q[0] - back, q[1], q[2]]);
    }
  }
  return out;
}

/** How tall a woman's figure is, as a share of a man's. */
export const FEM_HEIGHT = 0.93;

// ─── DOGS ────────────────────────────────────────────────────────────────────

/**
 * A breed's measures, metres: its body's length and depth, how high its back
 * is, how long its legs, its head and muzzle, and its ears and tail.
 */
const BREED: Record<Breed, {
  len: number; deep: number; wide: number; back: number; leg: number; head: number; muzzle: number;
  ears: "up" | "flop"; tail: "up" | "out"; neck: number;
}> = {
  terrier: { len: 0.36, deep: 0.085, wide: 0.07, back: 0.27, leg: 0.17, head: 0.07, muzzle: 0.06, ears: "up", tail: "up", neck: 0.08 },
  lab: { len: 0.6, deep: 0.13, wide: 0.11, back: 0.52, leg: 0.34, head: 0.1, muzzle: 0.1, ears: "flop", tail: "out", neck: 0.12 },
  dachs: { len: 0.56, deep: 0.075, wide: 0.065, back: 0.22, leg: 0.1, head: 0.065, muzzle: 0.09, ears: "flop", tail: "out", neck: 0.08 },
};

/**
 * A DOG, facing +x, its middle over the origin: trotting at `phase` (π a step,
 * the legs in diagonal pairs), or stood with its nose to the ground, sniffing.
 * Its coat is `top` and its markings — ears, tail's tip, a saddle — `hair`,
 * both tinted in the game; the nose and eyes are dark, the collar red.
 */
export function dogTris(breed: Breed, phase: number, pose: "walk" | "sniff"): Tri[] {
  const B = BREED[breed], out: Tri[] = [];
  const sniff = pose === "sniff";
  const half = B.len / 2, bob = sniff ? 0 : 0.008 * Math.abs(Math.cos(phase));
  const back = B.back - bob;
  // THE BODY: a loaf from the haunches to the chest, its back marked darker.
  const saddle = (p: V3): Mat => (p[2] > back - 0.012 && Math.abs(p[0]) < half * 0.6 ? "hair" : "top");
  ball([0, 0, back - B.deep], [half, B.wide, B.deep], "top", out, saddle, 14, 8);
  ball([half * 0.7, 0, back - B.deep * 0.9], [B.deep * 1.1, B.wide * 1.1, B.deep * 1.1], "top", out, undefined, 10, 6);
  ball([-half * 0.7, 0, back - B.deep], [B.deep, B.wide, B.deep], "top", out, undefined, 10, 6);
  // THE LEGS in diagonal pairs, forward and back through the trot, a paw at each foot.
  for (const [fx, side, off] of [[1, 1, 0], [-1, -1, 0], [1, -1, Math.PI], [-1, 1, Math.PI]] as const) {
    const top: V3 = [fx * half * 0.72, side * B.wide * 0.7, back - B.deep * 1.2];
    const p = phase + off, a = sniff ? 0 : 0.42 * Math.sin(p), lift = sniff ? 0 : 0.18 * B.leg * Math.max(0, Math.cos(p));
    const L = top[2] - 0.015;
    const paw: V3 = [top[0] + Math.sin(a) * L, top[1], top[2] - Math.cos(a) * L + lift];
    const knee = lerp(top, paw, 0.5);
    knee[0] += fx > 0 ? -0.01 : 0.02;
    limb(top, knee, B.wide * 0.42, B.wide * 0.3, "top", out, 6);
    limb(knee, paw, B.wide * 0.3, B.wide * 0.24, "top", out, 6, false);
    ball([paw[0] + 0.012, paw[1], paw[2] + 0.005], [B.wide * 0.34, B.wide * 0.28, B.wide * 0.2], "top", out, undefined, 6, 4);
  }
  // THE NECK and HEAD: up and forward, or down to the ground, nose first.
  const neckFoot: V3 = [half * 0.82, 0, back - B.deep * 0.4];
  const headAt: V3 = sniff
    ? [half + B.neck * 0.9, 0, B.head + B.muzzle * 0.4]
    : [half + B.neck * 0.45, 0, back + B.neck * 0.75];
  limb(neckFoot, headAt, B.wide * 0.7, B.wide * 0.6, "top", out, 8, false);
  // The collar, red, round the neck by the head. @see COLLAR
  const collar = lerp(neckFoot, headAt, 0.62);
  ball(collar, [B.wide * 0.5, B.wide * 0.68, B.wide * 0.5], "tail", out, undefined, 8, 4);
  ball(headAt, [B.head, B.head * 0.85, B.head * 0.9], "top", out, undefined, 10, 6);
  // The muzzle, forward of the head — down at the ground, sniffing — its nose and eyes dark.
  const dir: V3 = sniff ? norm([0.5, 0, -1]) : [1, 0, -0.15];
  const muzzle = add(headAt, mul(dir, B.head * 0.7 + B.muzzle * 0.5));
  ball(muzzle, [B.muzzle * 0.6, B.head * 0.5, B.head * 0.45], "top", out, undefined, 8, 5);
  ball(add(muzzle, mul(dir, B.muzzle * 0.55)), [0.018, 0.02, 0.016], "shoe", out, undefined, 6, 4);
  for (const side of [1, -1]) ball(add(headAt, [B.head * 0.55, side * B.head * 0.5, B.head * 0.35]), [0.012, 0.012, 0.012], "shoe", out, undefined, 5, 3);
  // THE EARS, pricked up or hanging, and the TAIL, up and wagging or out behind.
  for (const side of [1, -1]) {
    if (B.ears === "up") limb(add(headAt, [-0.01, side * B.head * 0.55, B.head * 0.6]), add(headAt, [-0.02, side * B.head * 0.75, B.head * 1.35]), 0.022, 0.006, "hair", out, 5, false);
    else ball(add(headAt, [-B.head * 0.2, side * B.head * 0.85, -B.head * 0.15]), [B.head * 0.45, B.head * 0.15, B.head * 0.7], "hair", out, undefined, 8, 5);
  }
  const wag = 0.05 * Math.sin(phase * 2) + (sniff ? 0.03 : 0);
  const tail0: V3 = [-half * 0.95, 0, back - B.deep * 0.2];
  const tail1: V3 = B.tail === "up" ? add(tail0, [-0.04, wag, B.len * 0.32]) : add(tail0, [-B.len * 0.4, wag, B.len * 0.08]);
  limb(tail0, lerp(tail0, tail1, 0.6), B.wide * 0.28, B.wide * 0.2, "top", out, 6, false);
  limb(lerp(tail0, tail1, 0.6), tail1, B.wide * 0.2, B.wide * 0.08, "hair", out, 6, false);
  return out;
}
