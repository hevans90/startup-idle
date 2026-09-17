/**
 * World v2 — ramps are DERIVED from paving and height, not placed by hand.
 *
 * A road crossing a step needs a ramp to be traversable, so the ramp is implied
 * by the road rather than being a separate decision. Paint a road between two
 * heights and the ramp appears; erase the road or level the ground and it goes.
 *
 * (The plan originally made `ramp` an explicit layer, on the grounds that
 * inferring it would let a height edit silently reshape terrain. That reasoning
 * holds for TERRAIN slopes and not for roads: a road's ramp is not a separate
 * choice, it is what makes the road a road. Deriving it also means the ramp can
 * never contradict the road — the failure the explicit layer kept producing.)
 *
 * THE RAMP ALWAYS SITS ON THE LOWER CELL, rising toward its higher neighbour.
 * That way its low edge matches the flat road behind it and its high edge
 * matches the ground it climbs to, so a staircase of steps ramps continuously:
 * each cell ramps to the next one up.
 */
import { DIR, NEIGHBOUR } from "../../iso/dir";
import { PAVED_RAMP_RISES } from "../ramp-art";
import { RAMP, packRamp, type RampDir } from "../iso";

/** What the derivation needs to read. Satisfied by a grid, or by staged edits. */
export type SurfaceReader = {
  inBounds: (x: number, y: number) => boolean;
  paved: (x: number, y: number) => boolean;
  height: (x: number, y: number) => number;
};

const DIRS = ["N", "E", "S", "W"] as const;

export type RampNeed =
  | { kind: "none" }
  | { kind: "ramp"; dir: RampDir; rise: number }
  /** A step the artset cannot bridge, or two at once — the road stays split. */
  | { kind: "unbridgeable"; reason: string };

/**
 * The ramp a paved cell needs, if any.
 *
 * Only ONE direction is possible per cell, so a cell facing two higher paved
 * neighbours is reported unbridgeable rather than silently picking one. Likewise
 * a rise the artset has no paved ramp for — ×0.5 — which is why a half-step
 * step cannot carry a road.
 */
export function rampNeed(read: SurfaceReader, x: number, y: number): RampNeed {
  if (!read.inBounds(x, y) || !read.paved(x, y)) return { kind: "none" };
  const here = read.height(x, y);

  const up: { dir: RampDir; rise: number }[] = [];
  for (const d of DIRS) {
    const [dx, dy] = NEIGHBOUR[d];
    const nx = x + dx, ny = y + dy;
    if (!read.inBounds(nx, ny) || !read.paved(nx, ny)) continue;
    const rise = read.height(nx, ny) - here;
    if (rise <= 0) continue;
    up.push({ dir: RAMP[d] as RampDir, rise });
  }
  if (!up.length) return { kind: "none" };
  if (up.length > 1) {
    return { kind: "unbridgeable", reason: "two steps at once" };
  }
  const [{ dir, rise }] = up;
  if (!PAVED_RAMP_RISES.includes(rise)) {
    return {
      kind: "unbridgeable",
      reason: rise === 1 ? "no paved half-ramp art" : `step of ${rise / 2} is too tall`,
    };
  }
  return { kind: "ramp", dir, rise };
}

/** The packed ramp byte a cell should hold. 0 for flat or unbridgeable. */
export function derivedRamp(read: SurfaceReader, x: number, y: number): number {
  const need = rampNeed(read, x, y);
  return need.kind === "ramp" ? packRamp(need.dir, need.rise === 1 ? 1 : 2) : RAMP.NONE;
}

export { DIR };
