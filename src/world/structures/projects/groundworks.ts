/**
 * World v2 — THE GROUNDWORKS OF A SITE, laid out: where its pit opens, where
 * its piles go and in what order, and where the machines that do the work
 * stand — the digger and the lorry it loads, the piling rig at each pile in
 * turn, the mixer at the gate. Plot tiles, from the plot's back corner.
 *
 * Pure: the drawing of the ground and the placing of the machines both read
 * it, so a pile is drawn where the rig drove it. @see schedule GROUND, site
 * drawGround, site-plant
 */
import type { Building, Footprint } from "./model";
import { PIT, type Site } from "./schedule";

export type Spot = { u: number; v: number };
export type Ground = {
  /** The pit's opening, and how far its floor shows shifted toward the camera at its full depth. @see site drawPit */
  pit: { u0: number; v0: number; u1: number; v1: number; s: number };
  /** Whether the site office stands in the back corner, the pit kept clear of it. */
  cabin: boolean;
  /** The piles, on the floor as it is drawn, in the order they are driven. */
  piles: Spot[];
  /** Where the digger stands; and the lorry it loads, where there is room for one — else it heaps its spoil at `heap`. */
  digger: Spot;
  lorry: (Spot & { heading: number }) | null;
  heap: Spot;
  /** Where the concrete lands, and spreads from. */
  pour: Spot;
};

/**
 * A SITE'S MACHINES, as they come from the yard and go home (@see fleet/plant): the digger on a low-loader, the
 * lorry it loads, the rig on another, the mixer — and on a plot with no room for a lorry in its gate, the digger
 * and the rig alone.
 */
export const SITE_PLANT = ["loader", "spoil", "loader", "mixer"] as const, SITE_PLANT_SMALL = ["loader", "loader"] as const;
export const sitePlantOf = (f: Footprint) => (f.w >= 2 && f.h >= 2 ? SITE_PLANT : SITE_PLANT_SMALL);

/** The way the rig faces at every pile: its leader to the left of it on the screen, clear of its house. */
export const RIG_HEADING = Math.PI * 0.75;
/** How far ahead of its middle a rig's pile is, tiles. @see models rigAt */
export const RIG_REACH = 0.283;
/** Of a pile's turn, the share the rig spends getting to it. */
export const RIG_MOVE = 0.28;

export function groundPlan(b: Building, f: Footprint): Ground {
  const pi = b.plinth.inset, cabin = f.h >= 2;
  const u0 = pi, v0 = cabin ? 0.55 : pi, u1 = f.w - pi, v1 = f.h - pi;
  const s = Math.min(PIT / 4, (u1 - u0) / 2, (v1 - v0) / 2);
  // PILES on a grid over the floor, a stride apart and in from its edges; driven a row at a time from the back, back and forth.
  const fu0 = u0 + s + 0.16, fu1 = u1 - 0.16, fv0 = v0 + s + 0.16, fv1 = v1 - 0.16;
  const nu = Math.max(1, Math.min(5, Math.round((fu1 - fu0) / 0.46) + 1)), nv = Math.max(1, Math.min(4, Math.round((fv1 - fv0) / 0.46) + 1));
  const piles: Spot[] = [];
  for (let r = 0; r < nv; r++) for (let c = 0; c < nu; c++) {
    const cc = r % 2 ? nu - 1 - c : c;
    piles.push({ u: nu > 1 ? fu0 + ((fu1 - fu0) * cc) / (nu - 1) : (fu0 + fu1) / 2, v: nv > 1 ? fv0 + ((fv1 - fv0) * r) / (nv - 1) : (fv0 + fv1) / 2 });
  }
  // THE GATE is the middle of the front. With room, a lorry stands in it, cab to the gate, and the digger in the pit behind its tail.
  const gu = f.w / 2, room = f.w >= 2 && f.h >= 2;
  const lorry = room ? { u: gu, v: f.h - 0.44, heading: Math.PI / 2 } : null;
  const digger = lorry ? { u: gu, v: Math.max(v0 + s + 0.3, lorry.v - 0.68) } : { u: (u0 + s + u1) / 2 - 0.05, v: (v0 + s + v1) / 2 };
  const heap = { u: f.w - 0.5, v: f.h - 0.42 };
  const pour = lorry ? { u: gu, v: Math.min(v1 - 0.08, lorry.v - 0.5) } : { u: (u0 + s + u1) / 2, v: v1 - 0.12 };
  return { pit: { u0, v0, u1, v1, s }, cabin, piles, digger, lorry, heap, pour };
}

/** How many piles are in the ground with so much of the piling done. */
export const pilesDriven = (g: Ground, piles: number) => Math.min(g.piles.length, Math.floor(piles * g.piles.length + 1e-6));

/**
 * WHERE THE RIG IS with so much of the piling done: on its way to a pile from the one before — from the gate, to
 * the first — or stood at it and driving, `in` how far it has gone in, nought to one. Nowhere before the piling
 * and after it.
 */
export function rigAt(g: Ground, site: Pick<Site, "piles" | "dig">): (Spot & { driving: boolean; in: number; pile: number }) | null {
  const n = g.piles.length;
  if (site.dig < 1 || site.piles <= 0 || site.piles >= 1 || n === 0) return null;
  const x = site.piles * n, k = Math.min(n - 1, Math.floor(x)), fr = x - k;
  const stand = (p: Spot): Spot => ({ u: p.u - Math.cos(RIG_HEADING) * RIG_REACH, v: p.v - Math.sin(RIG_HEADING) * RIG_REACH });
  const to = stand(g.piles[k]), from = k > 0 ? stand(g.piles[k - 1]) : { u: g.digger.u, v: g.pit.v1 - 0.2 };
  if (fr < RIG_MOVE) { const t = fr / RIG_MOVE, e = t * t * (3 - 2 * t); return { u: from.u + (to.u - from.u) * e, v: from.v + (to.v - from.v) * e, driving: false, in: 0, pile: k }; }
  return { ...to, driving: true, in: (fr - RIG_MOVE) / (1 - RIG_MOVE), pile: k };
}

/** How far the concrete has spread from where it lands, with so much of it poured: the part of the floor it covers. */
export function pourCover(g: Ground, fill: number): { u0: number; v0: number; u1: number; v1: number } | null {
  if (fill <= 0) return null;
  const { u0, v0, u1, v1, s } = g.pit, e = Math.sqrt(Math.min(1, fill));
  const lerp = (a: number, b: number) => a + (b - a) * e;
  return { u0: lerp(g.pour.u - 0.1, u0 + s), v0: lerp(g.pour.v - 0.1, v0 + s), u1: lerp(g.pour.u + 0.1, u1), v1: lerp(g.pour.v + 0.05, v1) };
}
