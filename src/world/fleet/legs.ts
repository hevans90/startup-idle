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
import { halfLength } from "../agents/cars/fleet";
import { planAgain, type Mover, type Town } from "../agents/town";

/** A place on a leg: where; how far over the ground there it rides (a yard stands on a plinth), half steps. */
export type LegPoint = {
  x: number; y: number; up?: number;
  /** Seconds to stand there before going on; what it is repainted as when it gets there (loaded, emptied). */
  stop?: number; colour?: number;
  /** Come to going backwards. */
  rev?: boolean;
  /** Where it GIVES WAY before it goes on to here: out of a gate, onto a road. @see clearOut */
  give?: boolean;
  /** Not set off for while this says so — or till it has waited long enough. */
  hold?: () => boolean;
  /** Done when it gets there. */
  on?: () => void;
};
export type Leg = {
  m: Mover; pts: LegPoint[]; k: number; wait: number; speed: number; up: number; done?: () => void; /** Seconds it has stood behind another. */ held?: number;
  /** THE ROAD IT JOINS at its end, as the mover it will be there: it waits at the end of its leg till there is room on the road for it. */
  join?: Mover;
  /** Seconds it has given way at a gate, and that it has pulled out. */
  gave?: number; out?: boolean;
  /** Seconds it has been held. @see LegPoint.hold */
  stood?: number;
};
/** Half a vehicle's width and a little, tiles: nearer than this to its line, another is in its way. Seconds one stands behind another before it goes on regardless: a knot comes undone. */
const IN_WAY = 0.3, PATIENCE = 6;

/**
 * WHETHER THERE IS ROOM FOR A VEHICLE at a place, facing `heading`, half so long: nothing on the road or off it —
 * but `skip` — standing or driving on its line within a length of it. `ahead`: only what is in front of it counts
 * (one driving: what is behind is behind). Nobody is put down on top of anybody; nobody drives through anybody.
 */
export function roomAt(town: Town, at: { x: number; y: number; heading: number }, half: number, skip?: Mover, ahead = false, gives?: (o: Mover) => boolean): boolean {
  const cx = Math.cos(at.heading), cy = Math.sin(at.heading);
  const hit = (o: Mover) => {
    if (gives?.(o)) return false;
    // (Nor one stood at its work, off the road: a builder's car on its site.)
    if (o === skip || o.id === skip?.id || o.kind === "person" || o.job?.role === "working" || o.job?.role === "cleaning") return false;
    const dx = o.x - at.x, dy = o.y - at.y, along = dx * cx + dy * cy, across = Math.abs(dx * cy - dy * cx);
    // (Nor, for a place on the road, one going the other way in the lane beside it: stood there to let this one by, it and this each waited for the other.)
    if (!ahead && across > OTHER_LANE && Math.cos(o.heading - at.heading) < -0.7) return false;
    return across < IN_WAY && (ahead ? along > 0.02 : true) && Math.abs(along) < half + halfLength(o) + 0.05;
  };
  return !town.movers.some(hit) && !town.legs.some((l) => hit(l.m));
}
/** Across this much, one going the other way is in the lane beside, tiles. */
const OTHER_LANE = 0.14;
/** Seconds of road clear of whatever is coming, for one to pull out of a gate; and less, once it has waited. */
const GAP_IN = 1.6, GAP_WAITED = 0.8;
/**
 * WHETHER ONE AT A GATE MAY PULL OUT, along the rest of its leg: nothing standing on its way, nothing coming that
 * would be upon it, and room where it joins the road. It looks before it goes, and then goes all the way: it does
 * not cross one lane and stand in it waiting for the other.
 */
function clearOut(town: Town, leg: Leg, half: number, seconds: number): boolean {
  const j = leg.join, m = leg.m;
  if (j && !roomAt(town, j, half, m)) return false;
  let ax = m.x, ay = m.y;
  for (let k = leg.k; k < leg.pts.length; k++) {
    const p = leg.pts[k], d = Math.hypot(p.x - ax, p.y - ay), n = Math.max(1, Math.ceil(d / 0.12));
    for (let i = 1; i <= n; i++) {
      const x = ax + ((p.x - ax) * i) / n, y = ay + ((p.y - ay) * i) / n;
      for (const o of town.movers) {
        if (o.id === m.id || o.id === j?.id || o.kind === "person" || o.job?.role === "working" || o.job?.role === "cleaning") continue;
        const dx = x - o.x, dy = y - o.y, c = Math.cos(o.heading), s = Math.sin(o.heading), along = dx * c + dy * s;
        if (Math.abs(dx * s - dy * c) < 0.2 && along > -(halfLength(o) + 0.1) && along < halfLength(o) + 0.15 + o.speed * seconds) return false;
      }
    }
    ax = p.x; ay = p.y;
  }
  return true;
}
/**
 * Whether one off the road is coming AT another: that other on its line ahead, the way it is going. Two nose to nose
 * would each stand for the other; the one with the lower number goes, and the other gives it the way.
 */
function facing(town: Town, o: Mover, m: Mover): boolean {
  const l = town.legs.find((q) => q.m === o), p = l?.pts[l.k];
  if (!l || !p) return false;
  const dx = p.x - o.x, dy = p.y - o.y, d = Math.hypot(dx, dy);
  if (d < 1e-4) return false;
  const ex = m.x - o.x, ey = m.y - o.y;
  return (ex * dx + ey * dy) / d > 0 && Math.abs(ex * dy - ey * dx) / d < IN_WAY;
}
/** Half a vehicle's width, and a hair: two nearer than this are touching. */
const HALF_WIDE = 0.1, HAIR = 0.02;
/** Whether one vehicle, at a place, would be touching another as that stands. */
function touching(at: { x: number; y: number; heading: number }, half: number, o: Mover): boolean {
  const hb = halfLength(o), dx = o.x - at.x, dy = o.y - at.y, turn = o.heading - at.heading, cos = Math.abs(Math.cos(turn)), sin = Math.abs(Math.sin(turn));
  const apart = (h: number, a: number, b: number) => {
    const c = Math.cos(h), s = Math.sin(h);
    return Math.abs(dx * c + dy * s) > a + b * cos + HALF_WIDE * sin + HAIR || Math.abs(dx * s - dy * c) > HALF_WIDE + b * sin + HALF_WIDE * cos + HAIR;
  };
  return !apart(at.heading, half, hb) && !apart(o.heading, hb, half);
}
/**
 * ONE STOOD STILL IN THE ROAD is only in the way if going on would touch it: it has most likely stopped for this one,
 * and to stop for it in turn is for ever. (Lying as this one does, or swung round to where it goes; and one touched already is no reason to stay.)
 */
function letsBy(town: Town, o: Mover, m: Mover, to: { x: number; y: number; heading: number }, half: number, on = to.heading): boolean {
  return o.speed < 0.05 && !town.legs.some((l) => l.m === o) && (!touching(to, half, o) || !touching({ ...to, heading: on }, half, o) || touching(m, half, o));
}
/** Those waiting for room, and how long each has: by name. */
const waited = new Map<string, number>();
/**
 * ROOM, OR IT HAS WAITED LONG ENOUGH: as {@link roomAt}, for one that waits to be put on the road — which goes
 * regardless after `PATIENCE` seconds, so that nothing stood in its place holds a job for good.
 */
export function roomOrWaited(town: Town, name: string, at: { x: number; y: number; heading: number }, half: number, dt: number): boolean {
  if (roomAt(town, at, half)) { waited.delete(name); return true; }
  const w = (waited.get(name) ?? 0) + dt;
  if (w >= PATIENCE) { waited.delete(name); return true; }
  waited.set(name, w);
  return false;
}

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
      if (p.hold && (leg.stood ?? 0) < PATIENCE * 2 && p.hold()) { leg.stood = (leg.stood ?? 0) + left; m.speed = 0; break; }
      // AT THE GATE it gives way. (Out of patience, it goes when it can, and those coming wait for it.)
      if (p.give && !leg.out) {
        const w = leg.gave ?? 0;
        if (w < PATIENCE * 5 && !clearOut(town, leg, halfLength(m), w < PATIENCE ? GAP_IN : GAP_WAITED)) { leg.gave = w + left; m.speed = 0; break; }
        leg.out = true;
      }
      // BEHIND WHATEVER IS IN FRONT OF IT, on the road or off: it stands till that has moved on.
      // (Out of patience, it goes on by — and has none again till its way has been clear.)
      const behind = d > 1e-4 && !roomAt(town, { x: m.x, y: m.y, heading: Math.atan2(dy, dx) }, halfLength(m), m, true, (o) => (facing(town, o, m) && o.id > m.id) || letsBy(town, o, m, { x: m.x + (dx / d) * 0.12, y: m.y + (dy / d) * 0.12, heading: m.heading }, halfLength(m), Math.atan2(dy, dx) + (p.rev ? Math.PI : 0)));
      if (behind && (leg.held ?? 0) < PATIENCE) { leg.held = (leg.held ?? 0) + left; m.speed = 0; break; }
      if (!behind) leg.held = 0;
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
      // (At the road: on to it when there is room — never down on top of what is driving there. Out of patience, it goes.)
      // (Nor does it wait for one that has stopped behind where it joins, to let it out: each stood for the other.)
      const j = leg.join;
      // (The roads changed since it set off: its way found again, from where it is.)
      if (j?.drive && town.traffic && j.drive.graph !== town.traffic.G) {
        j.x = m.x; j.y = m.y; j.heading = m.heading;
        if (!planAgain(town, g, j)) j.gone = true;
      }
      const half = j ? halfLength({ ...j, colour: m.colour }) : 0;
      const letting = (o: Mover) => !!j && (letsBy(town, o, m, { x: j.x, y: j.y, heading: m.heading }, half, j.heading) || o.speed < 0.05 && (o.x - j.x) * Math.cos(j.heading) + (o.y - j.y) * Math.sin(j.heading) < -(half + halfLength(o)) * 0.6);
      if (j && (leg.held ?? 0) < PATIENCE * 2 && !roomAt(town, j, half, m, false, letting)) { leg.held = (leg.held ?? 0) + dt; m.speed = 0; continue; }
      town.legs = town.legs.filter((q) => q !== leg);
      m.speed = 0;
      leg.done?.();
    }
  }
}
