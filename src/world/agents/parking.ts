/**
 * World v2 — PARKING, at the kerb: which bays are taken, which one a car on
 * its way to a door takes, where its people get out to walk from, and the
 * parked cars filed again on new lanes when the roads change.
 *
 * A car going to a door parks in a free bay near it, and its people walk in;
 * a trip by car from a door starts with them walking out to one parked near
 * it. Some bays outside homes are always taken: the residents' cars. Live,
 * not saved. @see town stepParked, lanes/graph baysOf
 */
import { NEIGHBOUR } from "../../iso/dir";
import type { Grid } from "../grid";
import type { Bay, LaneGraph } from "./lanes/graph";
import type { Kerbside } from "./lanes/walk";
import type { Place } from "./roads";
import type { Mover, Town } from "./town";

/** How far from a door a bay may be to park for it, tiles. */
export const PARK_REACH = 5;
/** The share of the bays outside homes that have a resident's car in. */
export const RESIDENT_SHARE = 0.35;
/** At most this many parked cars to each car the town drives. */
export const PARK_CAP = 1.5;
/** Seconds a visitor stays parked, least and most. */
export const STAY = [40, 150] as const;

/** The bays taken: a car in it, or one on its way to it. */
export function heldBays(t: Town): Set<number> {
  const held = new Set<number>();
  for (const c of t.parked) if (c.park) held.add(c.park.bay);
  for (const m of t.movers) if (m.bayTo) held.add(m.bayTo.bay);
  return held;
}

const near = (b: Bay, p: { x: number; y: number }) => Math.hypot(b.x - p.x, b.y - p.y);

/** The nearest free bay to a door, within reach: null if none. */
export function bayNear(G: LaneGraph, held: ReadonlySet<number>, door: Place): Bay | null {
  let best: Bay | null = null, bd = PARK_REACH;
  for (const b of G.bays) {
    if (held.has(b.id)) continue;
    const d = near(b, door);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

/** A parked car near a door, nearest first, that nobody is already going out to. */
export function carNear(t: Town, G: LaneGraph, door: Place): Mover | null {
  let best: Mover | null = null, bd = PARK_REACH;
  for (const c of t.parked) {
    const P = c.park!;
    if (P.graph !== G || P.trip) continue;
    const d = near(G.bays[P.bay], door);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

/** Where its people get out of, or in to, a car in a bay: the kerb beside it, from its kerb side. */
export function kerbOf(g: Grid, b: Bay): Kerbside {
  const [dx, dy] = NEIGHBOUR[b.kerb];
  return { kind: "kerb", x: b.cell % g.w, y: (b.cell / g.w) | 0, d: b.kerb, by: { x: b.x + dx * 0.12, y: b.y + dy * 0.12 } };
}

/** Its people: the driver, and now and then a passenger or two, by a hash of the car. */
export function aboard(m: Pick<Mover, "id">): number {
  const h = (Math.imul(m.id, 0x9e3779b1) >>> 0) % 100;
  return h < 70 ? 1 : h < 92 ? 2 : 3;
}

/**
 * The parked cars on new lanes: each into the bay where its old one was, or
 * gone with the road under it. Cars on their way to a bay drive to the door
 * instead.
 */
export function refile(t: Town, G: LaneGraph): void {
  const at = new Map<string, Bay>();
  const key = (x: number, y: number) => `${Math.round(x * 20)},${Math.round(y * 20)}`;
  for (const b of G.bays) at.set(key(b.x, b.y), b);
  t.parked = t.parked.filter((c) => {
    const P = c.park!;
    if (P.graph === G) return true;
    const b = at.get(key(c.x, c.y));
    if (!b) return false;
    P.bay = b.id; P.graph = G;
    return true;
  });
  for (const m of t.movers) m.bayTo = undefined;
}
