/**
 * World v2 — slopes in bare terrain.
 *
 * The `ramp` layer has only ever been written by the ROAD derivation, and every
 * other tool clears it, so a hillside could be stepped but never sloped. That
 * was noted as a gap when the explicit ramp tool was removed, and it is what
 * stops water running down anything: there is nothing for it to run down.
 *
 * A slope is DERIVED from the ground, like a road's ramp is derived from paving
 * — the brush says "slope here" and the terrain says which way. Asking the
 * player for a direction as well as a place would be asking them to restate
 * what the heightmap already knows, and to keep restating it every time they
 * edited the ground nearby.
 */
import { NEIGHBOUR } from "../../iso/dir";
import { idx, inBounds, structureAt, type Grid } from "../grid";
import { MAX_RISE, RAMP, packRamp, type RampDir } from "../iso";

const DIRS = ["N", "E", "S", "W"] as const;

export type SlopeNeed =
  | { kind: "slope"; dir: RampDir; rise: number }
  | { kind: "none"; reason: string };

/**
 * The slope a cell should carry, if any.
 *
 * It sits on the LOWER cell and rises toward its single higher neighbour, the
 * same convention roads use, so a staircase of steps slopes continuously.
 * Refused where the answer would be a guess: two higher neighbours is a corner
 * the artset cannot draw, and anything past `MAX_RISE` is a cliff.
 */
export function slopeNeed(grid: Grid, x: number, y: number): SlopeNeed {
  if (!inBounds(grid, x, y)) return { kind: "none", reason: "off map" };
  if (structureAt(grid, x, y) >= 0) return { kind: "none", reason: "built on" };
  const here = grid.height[idx(grid, x, y)];

  const up: { dir: RampDir; rise: number }[] = [];
  for (const d of DIRS) {
    const [dx, dy] = NEIGHBOUR[d];
    const nx = x + dx, ny = y + dy;
    if (!inBounds(grid, nx, ny)) continue;
    const rise = grid.height[idx(grid, nx, ny)] - here;
    if (rise <= 0) continue;
    up.push({ dir: RAMP[d] as RampDir, rise });
  }
  if (!up.length) return { kind: "none", reason: "nothing to climb" };
  if (up.length > 1) return { kind: "none", reason: "two steps at once" };
  const [{ dir, rise }] = up;
  if (rise > MAX_RISE) return { kind: "none", reason: `step of ${rise / 2} is too tall` };
  return { kind: "slope", dir, rise };
}

/** The packed ramp byte a cell should hold, or 0 where a slope makes no sense. */
export function derivedSlope(grid: Grid, x: number, y: number): number {
  const need = slopeNeed(grid, x, y);
  return need.kind === "slope" ? packRamp(need.dir, need.rise === 1 ? 1 : 2) : RAMP.NONE;
}
