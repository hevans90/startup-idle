/**
 * World v2 — how far each trade has got on a site, from how far the work is.
 *
 * A building goes up as buildings do, one trade after another and the next
 * starting before the last is done:
 *
 *  - GROUNDWORKS, which are a site's first loads' worth of its work ({@link groundShare}) and a job of their own:
 *    the plot SET OUT with pegs and tape; the pit DUG by a digger, the spoil taken away; PILES driven one after
 *    another by a rig; a mat of BAR laid over them; concrete POURED from a mixer till the pit is full; the plinth
 *    CAST on it. @see GROUND, groundworks
 *  - then, in what is left of the work:
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
  frame: [0.2, 0.8],
  clad: [0.3, 0.9],
  fit: [0.88, 0.96],
  strike: [0.9, 0.985],
} as const;

/**
 * THE GROUNDWORKS, as shares of themselves: setting out, the dig, the piles, the bar, the pour, the plinth.
 */
export const GROUND = {
  set: [0, 0.07],
  dig: [0.07, 0.38],
  pile: [0.38, 0.66],
  bar: [0.66, 0.74],
  pour: [0.74, 0.92],
  plinth: [0.92, 1],
} as const;
/** The share of a site's work that is groundworks when nothing says: a fifth, as it always was. */
export const GROUND_SHARE = 0.2;
/**
 * HOW MUCH OF A SITE'S WORK IS GROUNDWORKS: what its first two loads allow — the founder's garage, its first — and
 * never more than a third of it, however few loads it takes.
 */
export const groundShare = (deliveries: number, def?: string) =>
  deliveries > 0 ? Math.min(0.34, (def === "garage" ? 1 : 2) / deliveries) : GROUND_SHARE;

/** How deep the pit is dug, in half steps. */
export const PIT = 0.8;

export type Site = {
  /** Whether the groundworks are still going: nothing of the building yet. */
  ground: boolean;
  /** How far through each of the groundworks, nought to one: the setting out, the dig, the piles, the bar. (The pour is `fill`.) */
  set: number;
  dig: number;
  piles: number;
  bar: number;
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

/** What stands on a site with `p` of its work done, `g` of that work its groundworks. */
export function siteAt(b: Building, p: number, g = GROUND_SHARE): Site {
  const top = topOf(b);
  const q = g > 0 ? Math.min(1, p / g) : 1;
  const dig = span(q, GROUND.dig), pour = span(q, GROUND.pour), cast = span(q, GROUND.plinth);
  // Dug out; filled with concrete as it is poured; and the plinth cast on that, the pit gone under it.
  const pit = cast > 0 ? 0 : PIT * dig;
  const plinth = b.plinth.h * cast;
  const base = b.plinth.h;
  // What is left of the work, spread over the trades as they always were.
  const r = g < 1 ? Math.max(0, (p - g) / (1 - g)) : 0, at = STAGES.frame[0] + (1 - STAGES.frame[0]) * r;
  const frame = base + (top - base) * span(at, STAGES.frame);
  const clad = base + (top - base) * span(at, STAGES.clad);
  return {
    ground: p < g - 1e-9,
    set: span(q, GROUND.set), dig, piles: span(q, GROUND.pile), bar: span(q, GROUND.bar),
    pit, fill: pour, plinth, frame, clad,
    fit: span(at, STAGES.fit),
    strike: span(at, STAGES.strike),
    framing: p > g,
    top,
  };
}
