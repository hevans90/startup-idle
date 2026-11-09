/**
 * World v2 — WHAT RUNS ON AN AI BUILDING while it is open: coolant flowing
 * through glass panels on its walls, circuits traced across them, fans
 * turning on its roof — and, as it runs hot, the circuits glowing red.
 *
 * TWO HALVES. `drawLiveBase` is the hardware, drawn with the building once:
 * each panel's frame, glass and empty channel, each trace's dim copper, each
 * fan's housing. `drawLive` is what moves, drawn over it every few frames
 * into one unclipped Graphics: coolant running along the channels as fast as
 * the building's tank meets its demand, the traces from a calm violet pulse
 * to a flickering red as it falls short, and the blades. @see liveState
 */
import { damageOf } from "../../events/damage";
import { tankFor } from "../../projects/cooling";
import type { Fan, FaceAt, Live, Panel, Trace } from "./model";
import { RIGHT, mix, tone, type Pen, type Pt } from "./pen";

/** Half steps to a tile, as long on the screen: a tile along a face is 73.8 px, a half step 16.5. */
const ZK = 4.47;
/** How far proud of its face each layer stands, tiles, so it is drawn over what is under it. */
const OUT = 0.004;

export const COOLANT = 0x52e6ff, COOLANT_GLOW = 0x1f8fc0;
const CHANNEL = 0x123848, GLASS = 0x0a111c, FRAME = 0x3a3550, MANIFOLD = 0x6a7280;
const COPPER = 0x3a2a63, PAD = 0x4d3a80;
export const CALM = 0x9a5cff, HOT = 0xff3b2f, HOTTER = 0xffa040;
const HOUSING = 0x2c2838, WELL = 0x0b0910, BLADE = 0x8a93a3;

/** The channel's width across, tiles. */
const CH = 0.016;
/** A trace's width, tiles; and the pad at each end of it, half across. */
const TR = 0.014, PAD_R = 0.013;

/** Where a trace's pads are: its two ends. */
const padsOf = (t: Trace): [number, number][] =>
  t.segs.length ? [[t.segs[0][0], t.segs[0][1]], [t.segs[t.segs.length - 1][2], t.segs[t.segs.length - 1][3]]] : [];

/** A rectangle on a face, `a` along it, `z` up; a +u face darker, unless it glows. */
function rect(p: Pen, f: FaceAt, out: number, a0: number, a1: number, z0: number, z1: number, c: number, alpha = 1, glow = false) {
  if (f.face === "v") p.onV(f.at + out, a0, a1, z0, z1, c, alpha);
  else p.onU(f.at + out, a0, a1, z0, z1, glow ? tone(c, 0.88) : tone(c, RIGHT), alpha);
}

/** A line along or up a face, `w` tiles wide, from `(a0, z0)` to `(a1, z1)`: square to its axes. */
function line(p: Pen, f: FaceAt, out: number, a0: number, z0: number, a1: number, z1: number, w: number, c: number, alpha = 1, glow = false) {
  if (Math.abs(z1 - z0) < 1e-6) rect(p, f, out, Math.min(a0, a1) - w / 2, Math.max(a0, a1) + w / 2, z0 - (w * ZK) / 2, z0 + (w * ZK) / 2, c, alpha, glow);
  else rect(p, f, out, a0 - w / 2, a0 + w / 2, Math.min(z0, z1) - (w * ZK) / 2, Math.max(z0, z1) + (w * ZK) / 2, c, alpha, glow);
}

/** Where a panel's glass is, inside its frame. */
const glassOf = (q: Panel) => ({ a0: q.a0 + 0.025, a1: q.a1 - 0.025, z0: q.z0 + 0.12, z1: q.z1 - 0.12 });

/** A panel's channel, as a path of points `[a, z]`: snaking across (h) or up (v) its glass, `runs` lengths. */
export function channelOf(q: Panel): [number, number][] {
  const g = glassOf(q);
  const ia0 = g.a0 + 0.03, ia1 = g.a1 - 0.03, iz0 = g.z0 + 0.1, iz1 = g.z1 - 0.1;
  const n = Math.max(1, q.runs), pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const k = n === 1 ? 0.5 : i / (n - 1);
    if (q.dir === "h") {
      const z = iz0 + (iz1 - iz0) * k;
      pts.push(i % 2 ? [ia1, z] : [ia0, z], i % 2 ? [ia0, z] : [ia1, z]);
    } else {
      const a = ia0 + (ia1 - ia0) * k;
      pts.push(i % 2 ? [a, iz1] : [a, iz0], i % 2 ? [a, iz0] : [a, iz1]);
    }
  }
  return pts;
}

/** A segment's length on the screen, in tiles. */
const lenOf = (a: [number, number], b: [number, number]) => Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) / ZK;

/** The part of a path from `s0` to `s1` along it, each straight piece. */
function along(path: [number, number][], s0: number, s1: number, each: (a: [number, number], b: [number, number]) => void) {
  let s = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i], b = path[i + 1], l = lenOf(a, b);
    const lo = Math.max(s0, s), hi = Math.min(s1, s + l);
    if (hi > lo && l > 0) {
      const at = (x: number): [number, number] => [a[0] + (b[0] - a[0]) * ((x - s) / l), a[1] + (b[1] - a[1]) * ((x - s) / l)];
      each(at(lo), at(hi));
    }
    s += l;
  }
}

const pathLength = (path: [number, number][]) => path.reduce((s, p, i) => (i ? s + lenOf(path[i - 1], p) : 0), 0);

/** A fan's blades, or its well: a ring of points round it in its own plane. */
function ring(p: Pen, fan: Fan, r: number, n = 18): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    out.push(p.P(fan.u + Math.cos(t) * r, fan.v + Math.sin(t) * r, fan.z));
  }
  return out;
}

/** The hardware: each panel's frame, glass and dry channel; each trace in copper; each fan's housing. */
export function drawLiveBase(p: Pen, live: Live) {
  for (const q of live.panels) {
    rect(p, q, OUT, q.a0, q.a1, q.z0, q.z1, FRAME);
    const g = glassOf(q);
    rect(p, q, OUT * 2, g.a0, g.a1, g.z0, g.z1, GLASS);
    // The manifolds it is fed from and drains to, across its top and foot (or down its sides).
    if (q.dir === "h") {
      rect(p, q, OUT * 2, g.a0, g.a0 + 0.02, g.z0, g.z1, MANIFOLD);
      rect(p, q, OUT * 2, g.a1 - 0.02, g.a1, g.z0, g.z1, MANIFOLD);
    } else {
      rect(p, q, OUT * 2, g.a0, g.a1, g.z1 - 0.09, g.z1, MANIFOLD);
      rect(p, q, OUT * 2, g.a0, g.a1, g.z0, g.z0 + 0.09, MANIFOLD);
    }
    const path = channelOf(q);
    for (let i = 0; i + 1 < path.length; i++) line(p, q, OUT * 3, path[i][0], path[i][1], path[i + 1][0], path[i + 1][1], CH, CHANNEL);
  }
  for (const t of live.traces) {
    for (const [a0, z0, a1, z1] of t.segs) line(p, t, OUT, a0, z0, a1, z1, TR, COPPER);
    for (const [a, z] of padsOf(t)) rect(p, t, OUT * 2, a - PAD_R, a + PAD_R, z - PAD_R * ZK, z + PAD_R * ZK, PAD);
  }
  for (const f of live.fans) {
    // Its well is drawn with the blades: a disc is not cut to a tile. @see drawLive
    p.box(f.u - f.r - 0.04, f.v - f.r - 0.04, f.u + f.r + 0.04, f.v + f.r + 0.04, f.z - 0.22, f.z, HOUSING);
  }
}

/** How the building is running: `flow` the share of its coolant it is getting, `heat` how far short it falls. */
export type LiveState = { flow: number; heat: number };

/**
 * How an AI building is running: its coolant flowing as its tank meets its
 * demand, idling with nothing to cool; overheated, it runs as hot as it can;
 * shut for anything else, nothing moves. @see world/projects/cooling
 */
export function liveState(id: number): LiveState {
  const cause = damageOf(id);
  if (cause === "heat") return { flow: 0, heat: 1 };
  if (cause) return { flow: 0, heat: 0 };
  const t = tankFor(id);
  if (!t || t.demand <= 0) return { flow: 0.35, heat: 0 };
  return { flow: t.share, heat: Math.max(0, Math.min(1, (1 - t.share) * 1.25)) };
}

/**
 * What moves, at `t` seconds: the coolant, the traces' light and the fans'
 * blades. Drawn unclipped over the hardware.
 */
export function drawLive(p: Pen, live: Live, t: number, { flow, heat }: LiveState) {
  // THE COOLANT: dashes running along each channel, as fast and as bright as it flows.
  const run = 0.06 + 0.5 * flow, gap = 0.14, dash = 0.035;
  for (const q of live.panels) {
    const path = channelOf(q), L = pathLength(path);
    // The glass, flushed red as it runs hot.
    if (heat > 0.05) {
      const g = glassOf(q);
      rect(p, q, OUT * 4, g.a0, g.a1, g.z0, g.z1, HOT, 0.08 + 0.22 * heat * (0.75 + 0.25 * Math.sin(t * 5 + q.at * 7)), true);
    }
    if (flow > 0.02) {
      for (let i = 0; i + 1 < path.length; i++) line(p, q, OUT * 5, path[i][0], path[i][1], path[i + 1][0], path[i + 1][1], CH * 1.6, COOLANT_GLOW, 0.2 + 0.3 * flow, true);
      const off = (t * run) % gap;
      for (let s = off - gap; s < L; s += gap) {
        along(path, s, s + dash, (a, b) => line(p, q, OUT * 6, a[0], a[1], b[0], b[1], CH * 1.2, COOLANT, 0.45 + 0.55 * flow, true));
      }
    }
  }
  // THE CIRCUITS: violet, a packet of light running along each; red and flickering as it runs hot.
  const colour = heat < 0.5 ? mix(CALM, HOT, heat * 2) : mix(HOT, HOTTER, (heat - 0.5) * 0.6);
  for (const tr of live.traces) {
    const flick = heat > 0.3 ? 0.7 + 0.3 * Math.sin(t * (9 + 14 * heat) + tr.phase * 3.1) * Math.sin(t * 3.7 + tr.phase) : 1;
    const pulse = 0.55 + 0.45 * Math.sin(t * (1.6 + 5 * heat) + tr.phase);
    const lit = (0.25 + 0.75 * heat) * pulse * flick;
    for (const [a0, z0, a1, z1] of tr.segs) {
      if (heat > 0.05) line(p, tr, OUT * 3, a0, z0, a1, z1, TR * 3.2, colour, 0.22 * lit, true);
      line(p, tr, OUT * 4, a0, z0, a1, z1, TR, colour, 0.35 + 0.6 * lit, true);
    }
    for (const [a, z] of padsOf(tr)) rect(p, tr, OUT * 5, a - PAD_R, a + PAD_R, z - PAD_R * ZK, z + PAD_R * ZK, heat > 0.5 ? HOTTER : colour, 0.4 + 0.6 * lit, true);
    // A packet of data down the traces while it runs cool.
    if (heat < 0.6) {
      const path: [number, number][] = [];
      for (const [a0, z0, a1, z1] of tr.segs) path.push([a0, z0], [a1, z1]);
      const L = pathLength(path), s = ((t * 0.35 + tr.phase) % 1) * L;
      along(path, s, s + 0.05, (a, b) => line(p, tr, OUT * 6, a[0], a[1], b[0], b[1], TR * 1.4, 0xe6d4ff, 0.9 * (1 - heat), true));
    }
  }
  // THE FANS: faster as it runs hotter, over a red glow when it is overheating.
  const spin = 2 + 4 * flow + 10 * heat;
  for (const f of live.fans) {
    p.poly(ring(p, f, f.r), WELL);
    if (heat > 0.15) p.poly(ring(p, f, f.r * 0.9), HOT, 0.65 * heat);
    const turn = t * spin + f.u * 3 + f.v * 5;
    for (let k = 0; k < 5; k++) {
      const a = turn + (k / 5) * Math.PI * 2, w = 0.32;
      const at = (r: number, d: number): Pt => p.P(f.u + Math.cos(a + d) * r, f.v + Math.sin(a + d) * r, f.z + 0.01);
      p.poly([at(f.r * 0.18, -w), at(f.r * 0.92, -w * 0.45), at(f.r * 0.92, w * 0.35), at(f.r * 0.18, w)], BLADE, 0.9);
    }
    p.poly(ring(p, { ...f, z: f.z + 0.02 }, f.r * 0.2, 10), HOUSING);
  }
}

/** A trace's pieces from a list of points, each turn square: `[a, z, a, z, ...]` walked in order. */
export function traceOf(at: FaceAt, phase: number, ...walks: number[][]): Trace {
  const segs: [number, number, number, number][] = [];
  for (const w of walks) for (let i = 0; i + 3 < w.length; i += 2) segs.push([w[i], w[i + 1], w[i + 2], w[i + 3]]);
  return { ...at, segs, phase };
}
