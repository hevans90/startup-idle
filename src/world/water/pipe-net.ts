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
 * Derived from the grid every frame rather than carried, because it is a view
 * of the map and the map is what the editor changes. It is a flood fill over
 * the pipe cells alone, and the cost is the walk that finds them — the same
 * walk running the pipes needed anyway.
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
};

export function createPipeNets(w: number, h: number): PipeNets {
  const n = w * h;
  return {
    cells: new Int32Array(n),
    at: new Int32Array(n + 1),
    count: 0,
    seen: new Uint8Array(n),
    queue: new Int32Array(n),
  };
}

export function findPipeNets(grid: Grid, nets: PipeNets): PipeNets {
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
    at[++nets.count] = written;
  }
  return nets;
}
