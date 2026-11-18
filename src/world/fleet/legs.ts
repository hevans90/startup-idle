/**
 * World v2 — OFF THE ROAD, a vehicle still drives. A LEG is a stretch of its
 * way that no lane carries: out of its place in the yard, under the crane,
 * through the gate; off the road onto a site and back onto it. The vehicle is
 * THE SAME ONE the road's traffic knows — the same mover, by its number,
 * drawn by the same hand — so where a leg meets the road nothing is taken up
 * and nothing put down: it drives on. @see fleet, agents/town
 */
import { idx, type Grid } from "../grid";
import { roadHeightAt } from "../agents/roads";
import type { Mover, Town } from "../agents/town";

/** A place on a leg: where; how far over the ground there it rides (a yard stands on a plinth), half steps. */
export type LegPoint = {
  x: number; y: number; up?: number;
  /** Seconds to stand there before going on; what it is repainted as when it gets there (loaded, emptied). */
  stop?: number; colour?: number;
  /** Come to going backwards. */
  rev?: boolean;
  /** Done when it gets there. */
  on?: () => void;
};
export type Leg = { m: Mover; pts: LegPoint[]; k: number; wait: number; speed: number; up: number; done?: () => void };

/** Tiles a second off the road, and the fastest a vehicle swings round, radians a second. */
export const LEG_SPEED = 1.25, LEG_TURN = 3.2;

/** The ground under a point, half steps: the road's surface where it is road, else the land's. */
export function groundAt(g: Grid, x: number, y: number): number {
  const cx = Math.max(0, Math.min(g.w - 1, Math.round(x))), cy = Math.max(0, Math.min(g.h - 1, Math.round(y)));
  return g.paved[idx(g, cx, cy)] ? roadHeightAt(g, x, y) : g.height[idx(g, cx, cy)];
}

/** A lorry that is not on the roads: a mover like any, with nowhere to go. Its number is the town's next. */
export function ghost(town: Town, g: Grid, x: number, y: number, heading: number, colour: number, up = 0): Mover {
  return {
    id: town.next++, kind: "truck", path: [], line: [{ x, y }, { x, y }], at: new Float32Array(2), s: 0, speed: 0, cruise: 1,
    x, y, z: groundAt(g, x, y) + up, heading, stuck: 0, colour, phase: 0,
  } as Mover;
}

/** Set a vehicle off on a leg: from where it is, through `pts`. `up` is how high it rides now. */
export function startLeg(town: Town, m: Mover, pts: LegPoint[], done?: () => void, up = 0, speed = LEG_SPEED): Leg {
  const leg: Leg = { m, pts, k: 0, wait: 0, speed, up, ...(done ? { done } : {}) };
  town.legs.push(leg);
  return leg;
}

/** A frame of every leg: each vehicle a little further on, turning as it goes; stood where it is to stand; and, at the end of its leg, handed on. */
export function stepLegs(town: Town, g: Grid, dt: number): void {
  for (const leg of [...town.legs]) {
    const m = leg.m;
    let left = dt;
    while (left > 0 && (leg.k < leg.pts.length || leg.wait > 0)) {
      if (leg.wait > 0) { const w = Math.min(leg.wait, left); leg.wait -= w; left -= w; m.speed = 0; continue; }
      const p = leg.pts[leg.k], dx = p.x - m.x, dy = p.y - m.y, d = Math.hypot(dx, dy);
      // (Slower into a stop and into the last of it: it does not arrive at a run.)
      const last = leg.k === leg.pts.length - 1, v = leg.speed * (p.stop || last ? Math.min(1, 0.4 + d * 1.5) : 1), step = v * left;
      const up = p.up ?? 0;
      if (d > 1e-4) {
        // Its nose the way it goes — or its tail, backing — swung there no faster than a lorry swings.
        const want = Math.atan2(dy, dx) + (p.rev ? Math.PI : 0);
        let turn = want - m.heading;
        while (turn > Math.PI) turn -= 2 * Math.PI;
        while (turn < -Math.PI) turn += 2 * Math.PI;
        m.heading += Math.max(-LEG_TURN * left, Math.min(LEG_TURN * left, turn));
      }
      if (d <= step) {
        m.x = p.x; m.y = p.y; leg.up = up;
        left -= d / Math.max(1e-6, v);
        if (p.colour !== undefined) m.colour = p.colour;
        p.on?.();
        leg.wait = p.stop ?? 0;
        leg.k++;
      } else {
        m.x += (dx / d) * step; m.y += (dy / d) * step;
        leg.up += (up - leg.up) * Math.min(1, step / d);
        left = 0;
      }
      m.speed = v;
      m.z = groundAt(g, m.x, m.y) + leg.up;
    }
    if (leg.k >= leg.pts.length && leg.wait <= 0) {
      town.legs = town.legs.filter((q) => q !== leg);
      m.speed = 0;
      leg.done?.();
    }
  }
}
