/**
 * World v2 — a port's YARD: what its cranes have landed, waiting to go out
 * by the gate.
 *
 * A berth that LANDS things — a cargo crane, a hardware berth, a gantry —
 * puts each call's cargo in the yard, and lorries take it out by road. A yard
 * filling up slows those berths' calls, up to twice as long when it is full:
 * so a port wants a road behind it that goes somewhere, and two ports can be
 * worth more than one big one. NOTHING IS LOST when it jams, and a trading
 * quay, a ferry and a pontoon land nothing and are never slowed.
 * @see plans/seaports.md §3
 *
 * With no road out the yard still empties, by means unseen, at a quarter of
 * a lorry's rate. Live state, like the traffic: not saved.
 */
import type { FitId } from "./fittings";

/** The fittings whose calls land cargo. */
export const LANDS: readonly FitId[] = ["crane", "hardware", "gantry"];
export const lands = (fit: string) => (LANDS as readonly string[]).includes(fit);

/** What a yard holds, a berth of the port, in boats' calls' worth. */
export const YARD_A_BERTH = 4;
/** What a lorry takes, and seconds from one to the next. */
export const LORRY_LOAD = 2;
export const LORRY_GAP = 8;
/** Seconds a lorry stands at the gate while the yard gantry sets its box on it. @see carryAt */
export const LORRY_LOADS = 7;
/** The share of a lorry's rate a yard empties at with no road out. */
export const NO_ROAD = 0.25;
/** How much longer a landing berth's call takes with the yard full: this many times over. */
export const YARD_SLOWS = 1;

export type Yards = {
  /** What stands in each port's yard, by structure id. */
  held: Map<number, number>;
  /** Seconds to each port's next lorry. */
  until: Map<number, number>;
};

export const createYards = (): Yards => ({ held: new Map(), until: new Map() });

/** How full a port's yard is, nought to one. */
export const yardFill = (y: Yards, port: number, berths: number) =>
  Math.min(1, (y.held.get(port) ?? 0) / Math.max(1, berths * YARD_A_BERTH));

/** How many times as long a landing berth's call takes, for the yard as it stands. */
export const yardSlows = (y: Yards, port: number, berths: number) => 1 + YARD_SLOWS * yardFill(y, port, berths);

/** A call's cargo landed: `weight` boats' worth, and no more than the yard holds. */
export function landCargo(y: Yards, port: number, weight: number, berths: number): void {
  y.held.set(port, Math.min(berths * YARD_A_BERTH, (y.held.get(port) ?? 0) + weight));
}

/**
 * What became of asking for a lorry: one SENT; the port's last still on the
 * road, or no room on the roads, so ask again (BUSY); or NO ROAD out at all.
 */
export type Haul = "sent" | "busy" | "none";

/** `dt` seconds of the yards emptying. `haul` sends a lorry from a port, if it can. */
export function stepYards(y: Yards, dt: number, haul: (port: number) => Haul): void {
  for (const [port, held] of y.held) {
    if (held <= 0) { y.held.delete(port); y.until.delete(port); continue; }
    const left = (y.until.get(port) ?? LORRY_GAP / 2) - dt;
    if (left > 0) { y.until.set(port, left); continue; }
    const got = haul(port);
    if (got === "sent") { y.held.set(port, Math.max(0, held - LORRY_LOAD)); y.until.set(port, LORRY_GAP); }
    else if (got === "none") { y.held.set(port, Math.max(0, held - LORRY_LOAD * NO_ROAD)); y.until.set(port, LORRY_GAP); }
    else y.until.set(port, 1);
  }
}

/**
 * WHERE THE YARD GANTRY IS IN LOADING A LORRY, `e` of the way through the
 * lorry's wait, nought to one: which place it is making for or stands over
 * (the stack, then the lorry), how far its spreader is down there, and
 * whether the box is on it. It fetches the box from the stack, carries it
 * to the lorry, and sets it down before the lorry goes. Pure, so it can be
 * held to; the renderer moves the gantry to follow it. @see seaport-renderer
 */
export function carryAt(e: number): { over: "stack" | "lorry"; down: number; carried: boolean } {
  const ramp = (from: number, to: number) => Math.max(0, Math.min(1, (e - from) / (to - from)));
  // To the stack; down on the box; up with it; to the lorry; down onto it; and up, empty.
  if (e < 0.44) return { over: "stack", down: ramp(0.24, 0.34) * (1 - ramp(0.36, 0.44)), carried: e >= 0.35 };
  return { over: "lorry", down: ramp(0.62, 0.8) * (1 - ramp(0.9, 1)), carried: e < 0.87 };
}
