/**
 * World v2 — DRONE FARMING, seen: two drones to a farm, kept on a pad in its
 * yard. In spring they fly low passes up and down its ground, spraying; for a
 * while after each harvest they sweep it in rows, a scan line under each, and
 * carry crates home to the barn; otherwise they sit on the pad. Where each is,
 * worked out from the year and the clock alone — nothing kept, nothing saved.
 * @see notable "drones", ai-layer
 */
import type { Structure } from "../grid";
import { HARVEST_AT } from "../vegetation/crops";

export type FarmDrone = {
  x: number; y: number;
  /** "spray" in spring, "sweep" over a harvest, "carry" home with a crate, "rest" on the pad. */
  doing: "spray" | "sweep" | "carry" | "rest";
};
export type FarmPad = { x: number; y: number; /** 0–1: the dish's pulse, sending what was scanned. */ uplink: number };

/** Tiles a second a farm drone flies a pass. */
const PASS_SPEED = 1.6;
/** The share of a year after a harvest the drones sweep for: half a minute or so. */
const SWEEP = 0.01;
/** Spring's spraying, as shares of the year. */
const SPRAY: [number, number] = [0.04, 0.14];

/** A point along a back-and-forth over a box, `s` tiles along it. */
function passAt(x0: number, y0: number, w: number, h: number, s: number): { x: number; y: number; row: number } {
  const rows = Math.max(1, h), len = rows * w + (rows - 1);
  let d = ((s % (2 * len)) + 2 * len) % (2 * len);
  if (d > len) d = 2 * len - d;
  const row = Math.min(rows - 1, Math.floor(d / (w + 1)));
  const along = Math.min(w, d - row * (w + 1));
  return { x: x0 + (row % 2 ? w - along : along), y: y0 + row + 0.5, row };
}

/**
 * THE DRONES OVER EACH FARM, and its pad: `year` the calendar's share of the year, `t` seconds on the clock,
 * `reach` how far its fields go.
 */
export function farmDronesAt(farms: readonly Structure[], year: number, t: number, reach: number): { drones: FarmDrone[]; pads: FarmPad[] } {
  const drones: FarmDrone[] = [], pads: FarmPad[] = [];
  const since = HARVEST_AT.map((h) => (((year - h) % 1) + 1) % 1);
  const sweeping = Math.min(...since) < SWEEP;
  const spraying = year >= SPRAY[0] && year < SPRAY[1];
  for (const f of farms) {
    // (On the field just off the farm's near side, where no barn stands in front of it. Cell centres whole.)
    const pad = { x: f.x + f.w - 0.5 + 0.4, y: f.y + f.h - 1.1 };
    const x0 = f.x - reach, y0 = f.y - reach, w = f.w + 2 * reach, h = f.h + 2 * reach;
    let uplink = 0;
    for (let k = 0; k < 2; k++) {
      // (Each its own half of the ground, a little out of step with the other.)
      const half = Math.ceil(h / 2), hy = y0 + k * half, hh = k ? h - half : half;
      if (sweeping || spraying) {
        const s = (t + f.id * 3.7) * PASS_SPEED + k * 5;
        const p = passAt(x0, hy, w, hh, s);
        // THE END OF A ROW, sweeping: a crate home to the barn, and the dish sends what was scanned.
        const cycle = (s % (w * 2 + 6)) / (w * 2 + 6);
        if (sweeping && cycle > 0.85) {
          const c = (cycle - 0.85) / 0.15, back = c < 0.5 ? c * 2 : 2 - c * 2;
          drones.push({ x: p.x + (pad.x - p.x) * back, y: p.y + (pad.y - p.y) * back, doing: "carry" });
          uplink = Math.max(uplink, 1 - Math.abs(c - 0.5) * 2);
        } else drones.push({ x: p.x, y: p.y, doing: sweeping ? "sweep" : "spray" });
      } else drones.push({ x: pad.x + (k ? 0.08 : -0.08), y: pad.y + (k ? -0.04 : 0.04), doing: "rest" });
    }
    pads.push({ ...pad, uplink });
  }
  return { drones, pads };
}
