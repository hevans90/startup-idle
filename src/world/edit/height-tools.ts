/**
 * World v2 — height edits as pure value computations.
 *
 * Each op takes the cells a stroke covers and returns the height to WRITE per
 * cell; the caller stages those through a {@link import("./commands").PatchBuilder},
 * so height editing inherits undo for free and needs no machinery of its own.
 *
 * Heights are in HALF steps (`HEIGHT_UNIT` = 16.5px). A full step — one slab
 * skirt — is 2 units, and the artset has nothing between, so `step` is 1 or 2
 * and the field stays integral.
 */
import { idx, inBounds, type Grid } from "../grid";
import { NEIGHBOUR } from "../../iso/dir";
import type { Cell } from "../iso";

export type HeightOp = "raise" | "lower" | "flatten" | "smooth";

/**
 * Editing clamp, in half steps. `Int8Array` holds ±127, so this leaves room
 * for a stack to be raised without the array silently wrapping — a wrap would
 * turn a hill into a pit with no error anywhere.
 */
export const HEIGHT_MIN = -126;
export const HEIGHT_MAX = 126;

export const clampHeight = (v: number) =>
  Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, Math.round(v)));

export type HeightWrite = { x: number; y: number; value: number };

/** Median of a numeric list. Even counts take the lower of the middle pair, so the result is always a height that actually occurs. */
export function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

/**
 * Mean of a cell and its four neighbours, reading OFF-MAP as the cell itself
 * so an edge cell is pulled toward its real neighbours rather than toward
 * zero — otherwise smoothing dents the map border.
 */
function neighbourMean(grid: Grid, x: number, y: number, read: (x: number, y: number) => number) {
  let sum = read(x, y), n = 1;
  for (const [dx, dy] of Object.values(NEIGHBOUR)) {
    const nx = x + dx, ny = y + dy;
    sum += inBounds(grid, nx, ny) ? read(nx, ny) : read(x, y);
    n++;
  }
  return sum / n;
}

export type HeightOpts = {
  /** Half steps per application: 1 = half step, 2 = a full slab. */
  step?: number;
  /** `flatten` target. Defaults to the median height of the stroke's cells. */
  reference?: number;
};

/**
 * Heights to write for one stroke.
 *
 * `smooth` reads every value from a SNAPSHOT of the field taken before any
 * write is computed. Reading the live array instead would make the result
 * depend on the order cells happen to be visited, so the same stroke would
 * smooth differently depending on the brush shape that produced the cells.
 */
export function heightWrites(
  grid: Grid,
  cells: readonly Cell[],
  op: HeightOp,
  opts: HeightOpts = {},
): HeightWrite[] {
  const step = opts.step ?? 2;
  const inside = cells.filter((c) => inBounds(grid, c.x, c.y));
  if (!inside.length) return [];

  const read = (x: number, y: number) => grid.height[idx(grid, x, y)];

  switch (op) {
    case "raise":
    case "lower": {
      const d = op === "raise" ? step : -step;
      return inside.map((c) => ({ x: c.x, y: c.y, value: clampHeight(read(c.x, c.y) + d) }));
    }
    case "flatten": {
      const target = clampHeight(
        opts.reference ?? median(inside.map((c) => read(c.x, c.y))),
      );
      return inside.map((c) => ({ x: c.x, y: c.y, value: target }));
    }
    case "smooth": {
      // snapshot first — see the note above
      const snap = new Map<number, number>();
      for (const c of inside) {
        snap.set(idx(grid, c.x, c.y), read(c.x, c.y));
        for (const [dx, dy] of Object.values(NEIGHBOUR)) {
          const nx = c.x + dx, ny = c.y + dy;
          if (inBounds(grid, nx, ny)) snap.set(idx(grid, nx, ny), read(nx, ny));
        }
      }
      const frozen = (x: number, y: number) => snap.get(idx(grid, x, y)) ?? 0;
      return inside.map((c) => ({
        x: c.x, y: c.y, value: clampHeight(neighbourMean(grid, c.x, c.y, frozen)),
      }));
    }
  }
}

/**
 * Cells whose RENDERING depends on a height change: the cell itself plus its
 * four neighbours.
 *
 * A cliff face belongs to the taller cell but its existence depends on the
 * shorter one, so lowering a cell must re-sync the neighbours that now look
 * onto it. Missing this leaves faces floating over ground that dropped away.
 */
export function heightDirtyCells(grid: Grid, cells: readonly Cell[]): Cell[] {
  const seen = new Set<number>();
  const out: Cell[] = [];
  const push = (x: number, y: number) => {
    if (!inBounds(grid, x, y)) return;
    const k = idx(grid, x, y);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ x, y });
  };
  for (const c of cells) {
    push(c.x, c.y);
    for (const [dx, dy] of Object.values(NEIGHBOUR)) push(c.x + dx, c.y + dy);
  }
  return out;
}
