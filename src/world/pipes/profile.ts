/**
 * World v2 — A PIPE SEEN FROM THE SIDE: the run tile by tile, with the ground
 * it crosses, where the pipe lies, and what decides whether it works — so a
 * card can show WHERE a fault is and by how much, not only name it.
 *
 *  - a WATER MAIN: the water's level at its source, the line the water can
 *    rise to along the run — falling with distance, stepped up by a pump —
 *    and the floor of the building it must reach. Where that line lies under
 *    the floor is the fault: the water stands too low, or the run is too long.
 *  - a SEWER: how deep it lies under the ground, each span across a dip and
 *    each lift station, and its fall toward the exit. A span too long, or a
 *    manhole with no ground under it, is the fault.
 *
 * Heights in half steps, a point a tile. Pure data: the strip draws it.
 * @see PipeProfileStrip, plans/pipe-network.md §8
 */
import { SEWER_FIT, type Grid } from "../grid";
import { SEWER_KIND, type SewerSolve } from "../sewers/solve";

export type ProfileMark = { at: number; kind: "pump" | "lift" | "manhole" | "exit" };

export type PipeProfile = {
  kind: "main" | "sewer";
  /** The tiles of the run, in order, from the source or the top to the building or the exit. */
  cells: number[];
  /** The ground at each, and where the pipe lies. */
  ground: number[];
  pipe: number[];
  /** A main's: the level its water can rise to at each tile; null where no water reaches. */
  head: (number | null)[] | null;
  /** A main's: the water's level at its source, and the building's floor; null for none. */
  source: number | null;
  floor: number | null;
  /** A sewer's: the tiles it crosses on piers. */
  spans: boolean[] | null;
  marks: ProfileMark[];
  /** The stretches at fault, as tile ranges along the run, both ends in; and why. */
  bad: [number, number][];
  reason: string | null;
};

/** Runs of `true` in a list, as ranges with both ends in. */
export function runsOf(flags: readonly boolean[]): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k < flags.length; k++) {
    if (!flags[k]) continue;
    if (out.length && out[out.length - 1][1] === k - 1) out[out.length - 1][1] = k; else out.push([k, k]);
  }
  return out;
}

/**
 * A SEWER'S PROFILE from a tile of it down to its exit, off a solve — the
 * map's own, or a plan's of the map as it would be. `fit` is the fittings
 * layer that goes with the solve. Null where the tile has no sewer.
 */
export function sewerProfile(g: Grid, solve: SewerSolve, fit: ArrayLike<number>, from: number): PipeProfile | null {
  if (Number.isNaN(solve.level[from])) return null;
  const cells: number[] = [];
  for (let c = from, guard = 0; c >= 0 && guard < g.w * g.h; c = solve.down[c], guard++) cells.push(c);
  const wrong = new Map(solve.problems.map((p) => [p.cell, p.reason]));
  const marks: ProfileMark[] = [];
  cells.forEach((c, k) => {
    if (solve.kind[c] === SEWER_KIND.lift) marks.push({ at: k, kind: "lift" });
    if (fit[c] === SEWER_FIT.node) marks.push({ at: k, kind: "manhole" });
    else if (fit[c] === SEWER_FIT.outfall || fit[c] === SEWER_FIT.inlet) marks.push({ at: k, kind: "exit" });
  });
  const bad = runsOf(cells.map((c) => wrong.has(c)));
  return {
    kind: "sewer", cells, ground: cells.map((c) => g.height[c]), pipe: cells.map((c) => solve.level[c]),
    head: null, source: null, floor: null, spans: cells.map((c) => solve.kind[c] === SEWER_KIND.span), marks, bad,
    reason: bad.length ? wrong.get(cells[bad[0][0]]) ?? null : !solve.drains[from] ? "No exit yet" : null,
  };
}

/** The tile of a set furthest up its sewer: the one with the longest way down. For a plan's run, whichever way it was dragged. */
export function topOf(solve: SewerSolve, cells: readonly number[]): number {
  const far = (c: number) => { let n = 0; for (let k = c; k >= 0 && n < 1e5; k = solve.down[k]) n++; return n; };
  let best = cells[0], most = -1;
  for (const c of cells) { const d = far(c); if (d > most) { most = d; best = c; } }
  return best;
}
