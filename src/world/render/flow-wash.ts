/**
 * World v2 — the pattern the current carries on its back.
 *
 * A river needs to look like it is going somewhere, and the obvious way to draw
 * that is a plane wave: bands across the flow, their phase the corner's
 * position projected onto the flow direction, sliding along with time. It does
 * not work, and it cannot be made to. The phase is `position · direction`, so
 * two neighbouring columns forty tiles from the origin whose flow differs by
 * eight degrees have phases four whole cycles apart. Measured on a river, the
 * correlation between one column's shade and its neighbour's was 0.002 — which
 * is to say television static, which is what it looked like.
 *
 * So the pattern is not computed from where a column IS. It is CARRIED. A still
 * field of smooth noise is the pattern water has when nothing is happening to
 * it; every frame the live field is traced back up the current, sampled, and
 * pulled a little way back towards the still one. Water that is moving smears
 * the pattern into streaks along its own path; water that is not settles back
 * to the mottle it started with.
 *
 * It cannot go noisy, and that is the point: every value is an interpolation
 * between values that were already smooth. There is no phase to drift.
 */
import { flowX, flowY, type ColumnField } from "../../fluid/columns";

/**
 * How long a streak lasts before it is pulled back to the still pattern, in
 * seconds. A streak comes out about this long in tiles times the speed of the
 * water, so at one and a half tiles a second this is a streak a tile long.
 */
const SETTLE = 0.7;

/**
 * The still pattern: three waves at angles and wavelengths that do not divide
 * into one another, so it reads as mottling rather than as stripes.
 *
 * None of them shorter than a tile. At four columns to the tile anything finer
 * than that is at the sampling limit of the mesh that draws it, and a pattern
 * the mesh cannot resolve is noise however coherent it was to begin with —
 * which is the mistake this file exists to correct, made a second way.
 */
const WAVES = [
  { length: 3.10, dx: 0.83, dy: 0.56, amp: 1.00 },
  { length: 1.70, dx: -0.48, dy: 0.88, amp: 0.66 },
  { length: 1.05, dx: 0.31, dy: -0.95, amp: 0.38 },
];

export type FlowWash = {
  readonly nx: number;
  readonly ny: number;
  /** Tiles across one column, so a speed in tiles becomes a step in columns. */
  readonly cell: number;
  /** What water looks like when nothing is happening to it. Never changes. */
  readonly seed: Float32Array;
  /** What is on the water now, in [-1, 1]. */
  now: Float32Array;
  /** Scratch, so a frame never reads what it has already written. */
  next: Float32Array;
};

export function createFlowWash(columns: ColumnField): FlowWash {
  const { nx, ny, cell } = columns;
  const seed = new Float32Array(nx * ny);
  let total = 0;
  for (const w of WAVES) total += w.amp;
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const px = x * cell, py = y * cell;
      let v = 0;
      for (const w of WAVES) {
        v += w.amp * Math.sin(((Math.PI * 2) / w.length) * (px * w.dx + py * w.dy));
      }
      seed[y * nx + x] = v / total;
    }
  }
  return { nx, ny, cell, seed, now: Float32Array.from(seed), next: new Float32Array(nx * ny) };
}

/**
 * Carry the pattern one frame down the current.
 *
 * Traced BACKWARDS: for each column, where was the water that is here now a
 * moment ago, and what did it have on it? That is the semi-Lagrangian step, and
 * it is unconditionally stable however fast the water is going — the forward
 * version has to be told not to overshoot.
 */
export function stepFlowWash(
  wash: FlowWash, columns: ColumnField, dt: number,
  region: { x0: number; y0: number; x1: number; y1: number },
) {
  const { nx, cell, seed, now, next } = wash;
  const back = dt / cell;
  const settle = 1 - Math.exp(-dt / SETTLE);
  const lastX = wash.nx - 1, lastY = wash.ny - 1;
  for (let y = region.y0; y <= region.y1; y++) {
    for (let x = region.x0; x <= region.x1; x++) {
      const i = y * nx + x;
      let sx = x - flowX(columns, x, y) * back;
      let sy = y - flowY(columns, x, y) * back;
      sx = sx < 0 ? 0 : sx > lastX ? lastX : sx;
      sy = sy < 0 ? 0 : sy > lastY ? lastY : sy;
      const x0 = sx | 0, y0 = sy | 0;
      const x1 = x0 < lastX ? x0 + 1 : x0, y1 = y0 < lastY ? y0 + 1 : y0;
      const fx = sx - x0, fy = sy - y0;
      const a = now[y0 * nx + x0], b = now[y0 * nx + x1];
      const c = now[y1 * nx + x0], d = now[y1 * nx + x1];
      const carried = (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
      next[i] = carried + (seed[i] - carried) * settle;
    }
  }
  // Swap rather than copy: the whole point of the scratch array.
  for (let y = region.y0; y <= region.y1; y++) {
    const row = y * nx;
    now.set(next.subarray(row + region.x0, row + region.x1 + 1), row + region.x0);
  }
}
