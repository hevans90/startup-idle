/**
 * World v2 — which pipes are the same pipe.
 *
 * Topology and nothing else: no water, no heads, no heights. Pipes that TOUCH
 * are one pipe, which is the same adjacency rule roads use, so a run you paint
 * is a run that carries and two runs that pass without touching are two runs.
 *
 * Its own module because it is its own question, and because the water field
 * has to hold one of these while `pipes.ts` has to read the field — put the
 * fill in with the flow and those two import each other.
 */
import { DIR, NEIGHBOUR } from "../../iso/dir";
import type { Grid } from "../grid";

/** The four faces a pipe can connect across. */
const FACES: (keyof typeof DIR)[] = ["N", "E", "S", "W"];

/**
 * The networks on the map: which cells carry pipe, and which of them touch.
 *
 * Derived from the grid rather than carried, because it is a view of the map
 * and the map is what the editor changes. It is a flood fill over the pipe
 * cells alone, and the cost is the walk that finds them.
 *
 * REBUILT WHEN THE MAP CHANGES AND NOT EVERY FRAME. It was the latter, on the
 * reasoning that running the pipes had to walk the grid anyway — which stopped
 * being true when the runs themselves became the thing walked. Pipes are laid
 * by hand and the topology they make cannot change on its own, so the fill
 * runs on the edit that changes it and the frames in between read the answer.
 *
 * {@link cells} is then also the LIST OF EVERY PIPE CELL ON THE MAP, which is
 * what `waterInPipes`, `waterAtMouths` and the pipework in the drip renderer
 * each used to go looking for on their own.
 */
export type PipeNets = {
  /** Pipe cell indices, grouped by network. */
  cells: Int32Array;
  /** Where each network starts in {@link cells}; `count + 1` entries are set. */
  at: Int32Array;
  count: number;
  /** Scratch for the fill, so a frame allocates nothing. */
  seen: Uint8Array;
  queue: Int32Array;
  /** The `grid.rev` this was filled at; `-1` until it has been. @see edited */
  rev: number;
};

export function createPipeNets(w: number, h: number): PipeNets {
  const n = w * h;
  return {
    cells: new Int32Array(n),
    at: new Int32Array(n + 1),
    count: 0,
    seen: new Uint8Array(n),
    queue: new Int32Array(n),
    rev: -1,
  };
}

export function findPipeNets(grid: Grid, nets: PipeNets): PipeNets {
  if (nets.rev === grid.rev) return nets;
  const { w, h, pipe } = grid;
  const { cells, at, seen, queue } = nets;
  seen.fill(0);
  let written = 0;
  nets.count = 0;
  at[0] = 0;
  for (let start = 0; start < pipe.length; start++) {
    if (!pipe[start] || seen[start]) continue;
    // Breadth first from here over the four faces, and only ever onto cells
    // that carry pipe — two runs that pass without touching are two networks,
    // which is what anyone who painted them would expect.
    let head = 0, tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    while (head < tail) {
      const i = queue[head++];
      cells[written++] = i;
      const x = i % w, y = (i / w) | 0;
      for (const face of FACES) {
        const [dx, dy] = NEIGHBOUR[face];
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!pipe[j] || seen[j]) continue;
        seen[j] = 1;
        queue[tail++] = j;
      }
    }
    // IN MAP ORDER WITHIN THE NETWORK, which the fill does not give: a
    // breadth-first walk comes out in the order the queue happened to reach
    // the cells. Nothing about the FLOW cares — a substep reads and writes per
    // cell and per edge, and the celerity scan is a max — but the drip
    // renderer draws the pipework off this list, and drawing order is what
    // decides which of two overlapping bars is on top. Sorted, a network's
    // cells come out in the row-major order the renderer used when it walked
    // the grid itself. Across networks the grouping still wins, and that is
    // allowed: two networks do not touch — that is what makes them two — so
    // no bar of one can overlap a bar of the other.
    cells.subarray(at[nets.count], written).sort();
    at[++nets.count] = written;
  }
  nets.rev = grid.rev;
  return nets;
}

/** Total cells carrying pipe, across every network. @see PipeNets.cells */
export const pipeCellCount = (nets: PipeNets) => nets.at[nets.count];
