/**
 * World v2 — a building site: the plot, the hoarding, the pit and the plinth,
 * the building's own masses as far as each trade has got, the scaffold round
 * them, the materials in the yard, and the crane.
 *
 * Drawn a column at a time like everything else here, back to front within
 * each: the plot, the hoarding along the back, the crane's mast, the pit or
 * plinth, each mass followed by its own scaffold, the yard, and the open mesh
 * fence along the front. The crane's jib and hook stand clear above all of it
 * and are drawn once, unclipped, in front of the whole site. @see drawSky
 */
import { mix, tone, type Pen } from "./pen";
import {
  CONCRETE, REBAR, drawClad, drawFrame, drawMass, floorsOf, sortMasses, wholeFloors,
  type Building, type Footprint, type Mass,
} from "./model";
import { PIT, type Site } from "./schedule";

const EARTH = 0x8b6a4a;
const EARTH_DARK = 0x6a4f37;
const EARTH_PIT = 0x5c432f;
const TRACK = 0x7a5c40;
const PLY = 0xd8c08f;
const BRAND = 0x2f6d9e;
const BRAND_LIGHT = 0xf2efe6;
const MESH = 0xd7dde2;
const MESH_RAIL = 0xb9c1c8;
const FOOT = 0x8f949a;
const POLE = 0xc7a24a;
const BOARD = 0x9a7347;
const NET = 0x3f86c8;
const PALLET = 0xa27d4f;
const BRICKS = 0xb3563f;
const BLOCKS = 0xc9c4b8;
const CRANE = 0xf2c230;
const CRANE_DARK = 0xbf9418;
const WEIGHT = 0x7d8288;
const CABLE = 0x2b2e33;
const CAB_GLASS = 0x7fb6c9;

/** How far out from a wall the scaffold stands: its inner and outer rows. */
const SC_IN = 0.035, SC_OUT = 0.15;

/** Where the crane's mast stands: the back corner. */
export const MAST = { u: 0.16, v: 0.16, r: 0.065 };

/** The plot as a building site, under everything else. */
function drawPlot(p: Pen, f: Footprint) {
  p.flat(0.03, 0.03, f.w - 0.03, f.h - 0.03, 0.004, EARTH);
  // Tyre tracks in from the gate, in the middle of the front.
  const gu = f.w / 2;
  for (const d of [-0.16, 0.16]) p.flat(gu + d - 0.05, f.h * 0.35, gu + d + 0.05, f.h - 0.03, 0.006, TRACK);
}

/** Solid hoarding along the two back edges, painted with the builder's band. */
function drawHoarding(p: Pen, f: Footprint) {
  const H = 0.8, t = 0.04, e = 0.03;
  p.box(e, e, f.w - e, e + t, 0, H, PLY);
  p.box(e, e + t, e + t, f.h - e, 0, H, PLY);
  // The band, on the faces turned to the camera.
  p.onV(e + t, e + t, f.w - e, H * 0.5, H * 0.78, BRAND);
  p.onU(e + t, e + t, f.h - e, H * 0.5, H * 0.78, tone(BRAND, 0.76));
  p.onV(e + t, e + t, f.w - e, H * 0.58, H * 0.62, BRAND_LIGHT);
  p.onU(e + t, e + t, f.h - e, H * 0.58, H * 0.62, tone(BRAND_LIGHT, 0.76));
}

/**
 * The PIT, dug `d` half steps into the plot inside `inset`.
 *
 * Drawn as what can be seen of it from above, all at ground level, rather than
 * as a box below the ground: the far walls and the part of the floor that
 * shows past the near rim. Lowering the floor by `d` moves it a quarter of `d`
 * along both axes on screen, so the floor that shows is the opening less that
 * strip along its back edges, and the strip is the walls. A floor drawn at its
 * real depth would spill out under the near rim onto the next tile.
 */
function drawPit(p: Pen, f: Footprint, inset: number, back: number, d: number, fill: number) {
  if (d <= 0.01) return;
  const u0 = inset, v0 = back, u1 = f.w - inset, v1 = f.h - inset;
  const s = Math.min(d / 4, (u1 - u0) / 2, (v1 - v0) / 2);
  // The far walls, banded where the digging has cut through the layers.
  p.flat(u0, v0, u1, v0 + s, 0.008, EARTH);
  p.flat(u0, v0 + s * 0.45, u1, v0 + s * 0.6, 0.009, EARTH_DARK);
  p.flat(u0, v0 + s, u0 + s, v1, 0.008, tone(EARTH, 0.8));
  p.flat(u0 + s * 0.45, v0 + s, u0 + s * 0.6, v1, 0.009, tone(EARTH_DARK, 0.8));
  // The floor, going to concrete as the foundations are poured.
  p.flat(u0 + s, v0 + s, u1, v1, 0.008, mix(EARTH_PIT, CONCRETE, fill));
  // The ramp down from the gate, until the pour covers it.
  if (fill < 0.6) {
    const gu = f.w / 2;
    p.flat(gu - 0.22, v1 - Math.min(0.9, (v1 - v0) * 0.4), gu + 0.22, v1, 0.01, mix(TRACK, EARTH, 0.3));
  }
  // Formwork round the edge and a mat of bar over the pour.
  if (fill > 0) {
    for (let u = u0 + s + 0.18; u < u1 - 0.05; u += 0.24) p.flat(u - 0.008, v0 + s, u + 0.008, v1, 0.012, REBAR);
    for (let v = v0 + s + 0.18; v < v1 - 0.05; v += 0.24) p.flat(u0 + s, v - 0.008, u1, v + 0.008, 0.012, REBAR);
  }
}

/** A heap of spoil from the pit, in the front corner. */
function drawSpoil(p: Pen, f: Footprint, k: number) {
  if (k <= 0.02) return;
  const u = f.w - 0.5, v = f.h - 0.42, r = Math.min(0.42, f.h * 0.3) * Math.sqrt(k);
  for (let i = 0; i < 4; i++) {
    const rr = r * (1 - i * 0.24);
    p.box(u - rr, v - rr, u + rr, v + rr, i * 0.2 * k, (i + 1) * 0.2 * k, i % 2 ? EARTH : tone(EARTH, 0.94), { top: tone(EARTH, 1.12) });
  }
}

/** The site office: a cabin on legs with a window and a door, in the back corner. */
function drawCabin(p: Pen) {
  const u0 = 0.14, v0 = 0.14, u1 = 0.86, v1 = 0.46, z0 = 0.12, z1 = 0.95;
  for (const [u, v] of [[u0 + 0.05, v1 - 0.05], [u1 - 0.05, v1 - 0.05], [u1 - 0.05, v0 + 0.05]]) {
    p.box(u - 0.03, v - 0.03, u + 0.03, v + 0.03, 0, z0, 0x7a7f85);
  }
  p.box(u0, v0, u1, v1, z0, z1, 0xe6e2d6, { top: 0xbfbab0 });
  p.onV(v1, u0 + 0.08, u0 + 0.4, z0 + 0.35, z0 + 0.65, 0x86b7c3);
  p.onV(v1, u1 - 0.22, u1 - 0.08, z0, z0 + 0.62, 0x3d4a57);
  p.onV(v1, u0, u1, z1 - 0.12, z1 - 0.06, BRAND);
  p.onU(u1, v0, v1, z1 - 0.12, z1 - 0.06, tone(BRAND, 0.76));
}

/**
 * The SCAFFOLD on a mass's two front faces, from its foot to `top`, netted
 * from `net0` to `net1` where the work is.
 */
function drawScaffold(p: Pen, m: Mass, top: number, net0: number, net1: number) {
  if (top <= m.z0 + 0.2) return;
  const lift = floorsOf(m).h;
  const fu = m.u1, fv = m.v1;
  const POLE_W = 0.016;
  const pole = (u: number, v: number, z0: number, z1: number) =>
    p.box(u - POLE_W, v - POLE_W, u + POLE_W, v + POLE_W, z0, z1, POLE);
  // Along the face lit from the left (`v` = fv), and the one along `u` = fu.
  const along = (a0: number, a1: number) => {
    const n = Math.max(1, Math.round((a1 - a0) / 0.5));
    return Array.from({ length: n + 1 }, (_, k) => a0 + ((a1 - a0) * k) / n);
  };
  const us = along(m.u0 - SC_OUT, fu + SC_OUT), vs = along(m.v0 - SC_OUT, fv + SC_OUT);
  // The inner row, against the walls.
  for (const u of us) pole(u, fv + SC_IN, m.z0, top);
  for (const v of vs) pole(fu + SC_IN, v, m.z0, top);
  // A board at every lift, across both rows.
  for (let z = m.z0 + lift; z <= top + 1e-6; z += lift) {
    p.box(m.u0 - SC_OUT, fv + SC_IN, fu + SC_OUT, fv + SC_OUT, z - 0.03, z, BOARD);
    p.box(fu + SC_IN, m.v0 - SC_OUT, fu + SC_OUT, fv + SC_IN, z - 0.03, z, BOARD);
  }
  // The outer row, its rails, and a brace across every other bay.
  for (const u of us) pole(u, fv + SC_OUT, m.z0, top);
  for (const v of vs) pole(fu + SC_OUT, v, m.z0, top);
  for (let z = m.z0 + lift; z <= top + 1e-6; z += lift) {
    for (const zz of [z + 0.45]) {
      if (zz > top) continue;
      p.strut([m.u0 - SC_OUT, fv + SC_OUT, zz], [fu + SC_OUT, fv + SC_OUT, zz], 0.014, POLE);
      p.strut([fu + SC_OUT, m.v0 - SC_OUT, zz], [fu + SC_OUT, fv + SC_OUT, zz], 0.014, tone(POLE, 0.8));
    }
  }
  for (let k = 0; k + 1 < us.length; k += 2) {
    p.strut([us[k], fv + SC_OUT, m.z0], [us[k + 1], fv + SC_OUT, Math.min(top, m.z0 + lift * 2)], 0.012, tone(POLE, 0.85));
  }
  // The netting where the work is, so it shows where the building has got to.
  const n0 = Math.max(m.z0, net0), n1 = Math.min(top, net1);
  if (n1 > n0 + 0.05) {
    p.onV(fv + SC_OUT + 0.005, m.u0 - SC_OUT, fu + SC_OUT, n0, n1, NET, 0.42);
    p.onU(fu + SC_OUT + 0.005, m.v0 - SC_OUT, fv + SC_OUT, n0, n1, tone(NET, 0.76), 0.42);
  }
}

/** Materials on hand, stacked along the front of the plot where there is room. */
function drawYard(p: Pen, f: Footprint, b: Building, stock: number) {
  const front = Math.max(b.plinth.inset, ...b.masses.filter((m) => m.z0 <= b.plinth.h + 1e-6).map((m) => m.v1 + SC_OUT));
  const room = f.h - 0.08 - front;
  if (room < 0.16 || stock <= 0) return;
  const d = Math.min(0.13, room / 2 - 0.01), v = front + room / 2;
  const kinds = [BRICKS, BLOCKS, BRICKS, BLOCKS];
  for (let k = 0; k < Math.min(stock, 4); k++) {
    const u = 0.35 + k * 0.42;
    if (u + d > f.w - 0.1 || Math.abs(u - f.w / 2) < 0.4) continue;
    p.box(u - d, v - d, u + d, v + d, 0, 0.07, PALLET);
    p.box(u - d + 0.02, v - d + 0.02, u + d - 0.02, v + d - 0.02, 0.07, 0.45, kinds[k]);
  }
  // And a bundle of bar, along the front.
  const ru0 = f.w - 1.1, ru1 = f.w - 0.2;
  if (ru0 > f.w / 2 + 0.4) {
    for (let k = 0; k < 3; k++) p.strut([ru0, v + 0.04 * k - 0.04, 0.05], [ru1, v + 0.04 * k - 0.04, 0.05], 0.022, REBAR);
  }
}

/** The open mesh fence along the two front edges, with the gate standing open. */
function drawFence(p: Pen, f: Footprint) {
  const H = 0.85, e = 0.05;
  const gate0 = f.w / 2 - 0.4, gate1 = f.w / 2 + 0.4;
  const panels = (a0: number, a1: number, alongU: boolean) => {
    const n = Math.max(1, Math.round((a1 - a0) / 0.5));
    for (let k = 0; k < n; k++) {
      const a = a0 + ((a1 - a0) * k) / n, b = a0 + ((a1 - a0) * (k + 1)) / n;
      if (alongU && b > gate0 && a < gate1) continue;
      if (alongU) {
        const v = f.h - e;
        p.box(a - 0.04, v - 0.05, a + 0.04, v + 0.03, 0, 0.06, FOOT);
        p.onV(v, a, b, 0.06, H, MESH, 0.32);
        p.strut([a, v, H], [b, v, H], 0.02, MESH_RAIL);
        p.strut([a, v, 0.1], [b, v, 0.1], 0.016, MESH_RAIL);
        p.strut([a, v, 0.06], [a, v, H], 0.018, MESH_RAIL);
        p.strut([b, v, 0.06], [b, v, H], 0.018, MESH_RAIL);
      } else {
        const u = f.w - e;
        p.box(u - 0.05, a - 0.04, u + 0.03, a + 0.04, 0, 0.06, FOOT);
        p.onU(u, a, b, 0.06, H, tone(MESH, 0.8), 0.32);
        p.strut([u, a, H], [u, b, H], 0.02, tone(MESH_RAIL, 0.85));
        p.strut([u, a, 0.1], [u, b, 0.1], 0.016, tone(MESH_RAIL, 0.85));
        p.strut([u, a, 0.06], [u, a, H], 0.018, MESH_RAIL);
        p.strut([u, b, 0.06], [u, b, H], 0.018, MESH_RAIL);
      }
    }
  };
  panels(e, f.w - e, true);
  panels(e, f.h - e, false);
}

/** How tall the crane stands over a building `top` high. */
export const craneHeight = (top: number) => top + 3.2;

/** The crane's mast: a lattice of four legs and the braces between them. */
function drawMast(p: Pen, H: number) {
  const { u, v, r } = MAST;
  const legs: [number, number][] = [[u - r, v - r], [u + r, v - r], [u - r, v + r], [u + r, v + r]];
  const LEG = 0.02;
  const leg = ([a, b]: [number, number], c: number) => p.box(a - LEG, b - LEG, a + LEG, b + LEG, 0, H, c);
  // A concrete base the mast is bolted to.
  p.box(u - r - 0.06, v - r - 0.06, u + r + 0.06, v + r + 0.06, 0, 0.12, CONCRETE);
  leg(legs[0], CRANE_DARK);
  leg(legs[1], CRANE_DARK);
  leg(legs[2], CRANE_DARK);
  // Zigzag braces on the two faces the camera sees.
  for (let z = 0.12, k = 0; z < H - 0.05; z += 0.5, k++) {
    const z1 = Math.min(H, z + 0.5);
    p.strut([u - r, v + r, z], [u + r, v + r, z1], 0.012, k % 2 ? CRANE : CRANE_DARK);
    p.strut([u + r, v - r, z], [u + r, v + r, z1], 0.012, CRANE_DARK);
  }
  leg(legs[3], CRANE);
}

/**
 * What the crane is doing: its jib's heading, the trolley's reach along it,
 * and how high the hook hangs. @see craneAt
 */
export type CranePose = { heading: number; reach: number; hook: number; load: boolean };

/**
 * Where the jib points by default: mostly along the plot's width, a little
 * toward the front. Not at the far corner, which is straight at the camera —
 * a jib pointed there is foreshortened to nothing over its own mast.
 */
export function craneRest(_f: Footprint): number {
  return Math.atan2(0.28, 1);
}

/** The jib's length: across the site, never past the plot by much. */
export const jibLength = (f: Footprint) => Math.min(3.6, Math.hypot(f.w - MAST.u, f.h - MAST.v) * 0.82);

/**
 * THE CRANE ABOVE THE MAST: the slewing ring and cab, the jib and the
 * counter-jib with its weights, the ties from the peak, and the trolley,
 * cable and hook — with a pallet on it when it is lifting one.
 */
export function drawSky(p: Pen, f: Footprint, H: number, pose: CranePose) {
  const { u, v } = MAST;
  const L = jibLength(f), C = 0.85;
  const du = Math.cos(pose.heading), dv = Math.sin(pose.heading);
  const nu = -dv, nv = du;
  const z = H + 0.12;
  const at = (s: number, w: number, zz: number): [number, number, number] => [u + du * s + nu * w, v + dv * s + nv * w, zz];
  // Which of the jib's two sides is nearer the camera, which looks down +u +v.
  const near = nu + nv >= 0 ? 1 : -1;
  const W = 0.05;
  // The far chord, the counter-jib's weights, then the near chord and top.
  p.strut(at(-C, -W * near, z), at(L, -W * near, z), 0.03, CRANE_DARK);
  p.box(...weightBox(u, v, du, dv, C, z), WEIGHT);
  // The slewing ring and the cab under the jib, on the side of the mast.
  p.box(u - 0.08, v - 0.08, u + 0.08, v + 0.08, H - 0.05, H + 0.12, CRANE_DARK);
  const cu = u + nu * 0.12 * near, cv = v + nv * 0.12 * near;
  p.box(cu - 0.06, cv - 0.06, cu + 0.06, cv + 0.06, H - 0.35, H, CRANE, { top: tone(CRANE, 1.06) });
  p.onV(cv + 0.06, cu - 0.05, cu + 0.05, H - 0.3, H - 0.08, CAB_GLASS);
  p.onU(cu + 0.06, cv - 0.05, cv + 0.05, H - 0.3, H - 0.08, tone(CAB_GLASS, 0.76));
  // The peak over the mast, and the ties down to both ends.
  const peak: [number, number, number] = [u, v, H + 1.0];
  p.strut([u, v, z], peak, 0.03, CRANE);
  p.strut(peak, at(L * 0.75, 0, z + 0.14), 0.008, CABLE);
  p.strut(peak, at(-C, 0, z + 0.14), 0.008, CABLE);
  // The jib: two chords and a top one, braced in a zigzag.
  const T = z + 0.18;
  for (let s = 0, k = 0; s < L - 0.05; s += 0.22, k++) {
    p.strut(at(s, near * W, z), at(Math.min(L, s + 0.22), 0, T), 0.008, k % 2 ? CRANE_DARK : CRANE);
  }
  p.strut(at(0, near * W, z), at(L, near * W, z), 0.03, CRANE);
  p.strut(at(0, 0, T), at(L - 0.1, 0, T), 0.024, CRANE);
  p.strut(at(-C, near * W, z), at(0, near * W, z), 0.03, CRANE);
  // The trolley, the cable, the hook, and what it is carrying.
  const r = Math.max(0.3, Math.min(L - 0.1, pose.reach));
  const tr = at(r, 0, z);
  p.box(tr[0] - 0.05, tr[1] - 0.05, tr[0] + 0.05, tr[1] + 0.05, z - 0.08, z, CRANE_DARK);
  const hz = Math.max(0.4, Math.min(z - 0.2, pose.hook));
  p.strut([tr[0], tr[1], z - 0.08], [tr[0], tr[1], hz + 0.12], 0.007, CABLE);
  p.box(tr[0] - 0.035, tr[1] - 0.035, tr[0] + 0.035, tr[1] + 0.035, hz, hz + 0.12, CRANE_DARK);
  if (pose.load) {
    p.strut([tr[0] - 0.09, tr[1] - 0.09, hz - 0.15], [tr[0], tr[1], hz], 0.005, CABLE);
    p.strut([tr[0] + 0.09, tr[1] + 0.09, hz - 0.15], [tr[0], tr[1], hz], 0.005, CABLE);
    p.box(tr[0] - 0.12, tr[1] - 0.12, tr[0] + 0.12, tr[1] + 0.12, hz - 0.22, hz - 0.15, PALLET);
    p.box(tr[0] - 0.1, tr[1] - 0.1, tr[0] + 0.1, tr[1] + 0.1, hz - 0.15 - 0.3, hz - 0.22, BRICKS);
  }
}

/** The counter-jib's weights: a block behind the mast, under the counter-jib. */
function weightBox(u: number, v: number, du: number, dv: number, C: number, z: number):
  [number, number, number, number, number, number] {
  const cu = u - du * (C - 0.18), cv = v - dv * (C - 0.18);
  return [cu - 0.1, cv - 0.1, cu + 0.1, cv + 0.1, z - 0.35, z + 0.05];
}

/**
 * ONE COLUMN OF A SITE. `stock` is the loads on hand, stacked in the yard.
 */
export function drawSite(p: Pen, b: Building, f: Footprint, site: Site, stock: number) {
  drawPlot(p, f);
  drawHoarding(p, f);
  const crane = b.crane === "tower" && site.framing && site.strike < 1;
  if (crane) drawMast(p, craneHeight(site.top));
  // The pit, dug and filled in, then the plinth on it.
  const pi = b.plinth.inset;
  // THE CABIN in the back corner while the ground is being worked, and the
  // pit kept clear of it; gone when the plinth is cast over the whole plot.
  const cabin = site.plinth === 0 && f.h >= 2;
  drawPit(p, f, pi, cabin ? 0.55 : pi, site.pit, site.fill);
  if (site.pit > 0 && site.plinth === 0) drawSpoil(p, f, Math.max(site.pit / PIT, 1 - site.fill));
  if (cabin) drawCabin(p);
  if (site.plinth > 0.005) {
    p.box(pi, pi, f.w - pi, f.h - pi, 0, site.plinth, CONCRETE);
    // The mat of bar showing until the plinth is cast to its height.
    if (site.plinth < b.plinth.h - 1e-6) {
      for (let u = pi + 0.2; u < f.w - pi; u += 0.25) p.strut([u, pi + 0.05, site.plinth + 0.01], [u, f.h - pi - 0.05, site.plinth + 0.01], 0.01, REBAR);
    }
  }
  // The building, mass by mass, each with its scaffold.
  if (site.framing) {
    for (const m of sortMasses(b.masses)) {
      if (site.frame <= m.z0 + 1e-6) continue;
      const clad = wholeFloors(m, site.clad);
      const frame = Math.min(m.z1, site.frame);
      if (clad >= m.z1 - 1e-6) drawMass(p, m);
      else {
        drawClad(p, m, clad, CONCRETE);
        drawFrame(p, m, Math.max(m.z0, clad), frame);
      }
      // The scaffold stands a guard rail above the work, and comes down from
      // the top: off a mass as soon as its own walls are done — a podium is
      // not left wrapped while the tower on it goes up — and off the last when
      // the whole is. @see STAGES.strike
      const sTop = Math.min(m.z1 + 0.5, Math.max(frame, clad) + 0.5);
      const done = Math.max(site.strike, Math.max(0, Math.min(1, (site.clad - m.z1) / (floorsOf(m).h * 2))));
      const top = m.z0 + (sTop - m.z0) * (1 - done);
      drawScaffold(p, m, top, clad, frame + 0.5);
    }
    if (site.fit > 0.5 && b.details) b.details(p, f);
  }
  drawYard(p, f, b, stock);
  drawFence(p, f);
}

/** A finished building: its grounds, plinth, masses and fit-out. */
export function drawFinished(p: Pen, b: Building, f: Footprint) {
  b.grounds?.(p, f);
  const pi = b.plinth.inset;
  if (b.plinth.h > 0) p.box(pi, pi, f.w - pi, f.h - pi, 0, b.plinth.h, b.plinth.colour, { top: b.plinth.top });
  for (const m of sortMasses(b.masses)) drawMass(p, m);
  b.details?.(p, f);
}
