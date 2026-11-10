/**
 * World v2 — THE LAMPS ON THE VEHICLES: which way a driver is signalling, and
 * how bright each of its lamps is. Indicators ahead of a turn, a lane change,
 * pulling out from the kerb or in to it, and out past parked cars and back;
 * hazards for a bus stood at a stop in its lane; brake lights as it slows or
 * stands; head and tail lamps at night. Pure: the masks they light are baked.
 * @see cars/raster LAMPS, town-render, render/car-glow
 */
import { dot, right, sub, type Pt } from "./lanes/geometry";
import { inside, isChange } from "./lanes/drive";
import type { LaneGraph } from "./lanes/graph";
import type { Mover } from "./town";

/** How far ahead a driver signals a turn or a lane change, tiles; and a pull in to the kerb. */
const LOOK = 2.5;
const PULL_LOOK = 2.2;
/** A junction lane turning this much (the sine between its ends' headings) is a turn. */
const TURN = 0.35;
/** Blinks a second. */
const BLINK = 1.5;
/** Slowing harder than this, tiles/s², is braking; and slower than this, stood with the brake on. */
const BRAKING = 0.35;
const STOOD = 0.03;
/** In this far, a bus at a stop is out of the lane; less and it stands in it with its hazards on. */
const PULLED = 0.12;

/** −1 left, 1 right, 2 both (hazards), 0 none. */
export type Signal = -1 | 0 | 1 | 2;

const heading = (a: Pt, b: Pt): Pt => { const d = sub(b, a), l = Math.hypot(d.x, d.y) || 1; return { x: d.x / l, y: d.y / l }; };

/** Which way a vehicle is signalling, on lanes `G`. */
export function signalOf(G: LaneGraph | null, m: Mover): Signal {
  const d = m.drive;
  if (!d || m.park || m.siren) return 0;
  // A BUS AT A STOP, stood in its lane: hazards; and out from it, or from a bay, to the left.
  if (m.bus && (m.wait ?? 0) > 0 && m.bus.from !== undefined && m.bus.from < PULLED) return 2;
  if (m.leaving) return -1;
  const end = m.at[m.at.length - 1] - m.s;
  // IN TO THE KERB: a bay, or a bus to its stop.
  if ((m.bayTo || (m.bus && m.bus.k >= 0 && (m.bus.to ?? 0) >= PULLED)) && end < PULL_LOOK) return 1;
  // OUT PAST PARKED CARS, and back in.
  if (m.pass) {
    if (m.s < m.pass.a + 0.3) return -1;
    if (m.s > m.pass.b - 0.8) return 1;
  }
  if (!G || d.graph !== G) return 0;
  // A LANE CHANGE OR A TURN, soon: whichever comes first.
  for (let j = d.k; j < d.lanes.length && d.start[j] - m.s < LOOK; j++) {
    const l = G.lanes[d.lanes[j]];
    if (j > d.k && isChange(G, d.lanes[j - 1], d.lanes[j])) {
      const was = G.lanes[d.lanes[j - 1]];
      return dot(sub(l.pts[0], was.pts[0]), right(heading(was.pts[0], was.pts[1]))) > 0 ? 1 : -1;
    }
    if (inside(l) && l.pts.length >= 2) {
      const n = l.pts.length, a = heading(l.pts[0], l.pts[1]), b = heading(l.pts[n - 2], l.pts[n - 1]);
      const turn = a.x * b.y - a.y * b.x;
      // (Straight over: no signal, and none for anything after it.)
      return turn > TURN ? 1 : turn < -TURN ? -1 : 0;
    }
  }
  return 0;
}

/** Whether a vehicle is braking: slowing hard, or stood on the road. `was` its speed `dt` ago. */
export const braking = (m: Mover, was: number, dt: number) =>
  !!m.drive && !m.park && (m.speed < STOOD || (dt > 0 && (was - m.speed) / dt > BRAKING));

/** How bright each lamp is, 0–1: in `LAMPS` order — head, tail, right, left. @see raster LAMPS */
export function lampsOf(m: Mover, signal: Signal, brakes: boolean, night: number, t: number): [number, number, number, number] {
  if (m.park) return [0, 0, 0, 0];
  const dark = Math.min(1, night * 1.4);
  const on = Math.floor(t * BLINK * 2 + (m.id % 7) * 0.31) % 2 === 0;
  return [
    dark,
    brakes ? 1 : dark * 0.55,
    on && (signal === 1 || signal === 2) ? 1 : 0,
    on && (signal === -1 || signal === 2) ? 1 : 0,
  ];
}
