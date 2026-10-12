/**
 * World v2 — how far each trade has got on a site, from how far the work is.
 *
 * A building goes up as buildings do, one trade after another and the next
 * starting before the last is done:
 *
 *  - DIG: the plot stripped and a pit dug, the spoil heaped in a corner;
 *  - FOUNDATIONS: the pit filled and the plinth cast;
 *  - FRAME: concrete columns and floor slabs, a floor at a time, the whole
 *    height of the building across all its masses — a tower's frame starts
 *    when the podium's reaches its roof;
 *  - CLADDING: the walls and glass, following the frame up a few floors
 *    behind, inside a scaffold netted where the work is;
 *  - ROOF: on each mass as its cladding reaches the top;
 *  - FIT-OUT: signs and plant;
 *  - STRIKE: the scaffold coming down from the top.
 *
 * And the fence comes down and the grounds go in when it OPENS, which is no
 * longer a stage of the drawing but the building itself. Pure, so it can be
 * tested without a canvas. @see site
 */
import type { Building } from "./model";

/** The work at which each trade starts and finishes, as a share of the whole. */
export const STAGES = {
  dig: [0, 0.1],
  found: [0.1, 0.2],
  frame: [0.2, 0.8],
  clad: [0.3, 0.9],
  fit: [0.88, 0.96],
  strike: [0.9, 0.985],
} as const;

/** How deep the pit is dug, in half steps. */
export const PIT = 0.8;

export type Site = {
  /** How deep the pit stands open, half steps. Nought once it is filled. */
  pit: number;
  /** How far the pit is filled with concrete, nought to one. */
  fill: number;
  /** How far up the plinth is cast, half steps. */
  plinth: number;
  /** The height the frame has reached, half steps; at the plinth's top before it starts. */
  frame: number;
  /** The height the cladding has reached. */
  clad: number;
  /** How far through the fit-out, nought to one. */
  fit: number;
  /** How far the scaffold is struck, nought to one. */
  strike: number;
  /** Whether the frame has started at all: no scaffold or crane hook before. */
  framing: boolean;
  /** The building's full height, the frame's goal. */
  top: number;
};

const span = (p: number, [a, b]: readonly [number, number]) => Math.max(0, Math.min(1, (p - a) / (b - a)));

/** The building's top: the highest roof of any of its masses. */
export const topOf = (b: Building) => Math.max(b.plinth.h, ...b.masses.map((m) => m.z1));

/** What stands on a site with `p` of its work done. */
export function siteAt(b: Building, p: number): Site {
  const top = topOf(b);
  const dig = span(p, STAGES.dig), found = span(p, STAGES.found);
  // Dug out, then filled back up as the foundations go in, then the plinth.
  const pit = found > 0 ? PIT * Math.max(0, 1 - found * 2) : PIT * dig;
  const plinth = b.plinth.h * Math.max(0, found * 2 - 1);
  const base = b.plinth.h;
  const frame = base + (top - base) * span(p, STAGES.frame);
  const clad = base + (top - base) * span(p, STAGES.clad);
  return {
    pit, fill: Math.min(1, found * 2), plinth, frame, clad,
    fit: span(p, STAGES.fit),
    strike: span(p, STAGES.strike),
    framing: p > STAGES.frame[0],
    top,
  };
}
