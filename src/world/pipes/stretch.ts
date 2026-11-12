/**
 * World v2 — A STRETCH of a main: the run between two JOINTS, which is what
 * a player means by "this bit". A joint is where the pipe stops being one
 * run — a fitting (an intake, a pump, an outlet, a cap), or a place three or
 * four runs meet. A bend is not one, nor are the points the graph keeps
 * every few tiles of a straight: a stretch goes on through those.
 *
 * So a stretch can be widened by itself (the graph has a bore a link, and a
 * reducer is drawn where it changes), or lifted by itself, leaving what it
 * was joined to standing with a cap where that leaves a loose end.
 * For water mains and sewer connections: the pipes above the ground.
 * @see pipeGraph, plans/pipe-network.md §8 "Edit a stretch, not the lot"
 */
import { DIR, NEIGHBOUR } from "../../iso/dir";
import { MAIN_BORE, MAIN_END, type Grid } from "../grid";
import { pipeGraph, type PipeGraph, type PipeNode } from "./graph";

export type Stretch = {
  /** Its tiles in order, both ends in. */
  cells: number[];
  /** Whether each end is a joint other runs still hang on once this one is gone: a tee, a cross, a fitting on a run that carries on. */
  shared: [boolean, boolean];
  /** How many of its tiles are not yet widened. */
  narrow: number;
};

/** Whether a node ends a stretch: a fitting, or where the runs that meet are not just two. */
const isJoint = (n: PipeNode, graph: PipeGraph) =>
  n.kind !== "joint" || n.links.filter((l) => graph.links[l].kind !== "drop").length !== 2;

/** The stretch of main through a tile, or null where there is no main. On a joint itself: the run that leaves it first, as the graph lists them. */
export function stretchAt(g: Grid, cell: number): Stretch | null {
  const graph = pipeGraph(g);
  const node = graph.nodeAt.main[cell];
  let first = graph.linkAt.main[cell];
  if (first < 0 && node >= 0) first = graph.nodes[node].links.find((l) => graph.links[l].kind !== "drop") ?? -1;
  if (first < 0) {
    // A lone fitting, joined to nothing: itself.
    return node >= 0 ? { cells: [cell], shared: [false, false], narrow: g.main[cell] & MAIN_BORE ? 0 : 1 } : null;
  }
  const start = graph.links[first];
  /** Walk on from a link's end node while it is not a joint: the tiles passed, and the node stopped at. */
  const walk = (from: number, through: number): { cells: number[]; end: number } => {
    const cells: number[] = [];
    let node = from, link = through;
    for (let guard = 0; guard < graph.links.length + 1; guard++) {
      const n = graph.nodes[node];
      if (isJoint(n, graph)) break;
      const next = n.links.find((l) => l !== link && graph.links[l].kind !== "drop");
      if (next === undefined) break;
      const l = graph.links[next], run = l.a === node ? l.cells : [...l.cells].reverse();
      cells.push(...run.slice(1));
      node = l.a === node ? l.b : l.a;
      link = next;
    }
    return { cells, end: node };
  };
  const back = walk(start.a, first), on = walk(start.b, first);
  const cells = [...back.cells.reverse(), ...start.cells, ...on.cells];
  const others = (id: number) => graph.nodes[id].links.filter((l) => graph.links[l].kind !== "drop").length > 1;
  return { cells, shared: [others(back.end), others(on.end)], narrow: cells.filter((i) => !(g.main[i] & MAIN_BORE)).length };
}

/** Whether two tiles are on the same stretch. */
export function sameStretch(g: Grid, a: number, b: number): boolean {
  const s = stretchAt(g, a);
  return !!s && s.cells.includes(b) && !!stretchAt(g, b)?.cells.includes(a);
}

const SIDES = ["N", "E", "S", "W"] as const;

/**
 * WHAT LIFTING A STRETCH LEAVES: every tile's new `main` and `mainEnd`, for
 * the tiles it changes. Its own tiles go — but an end other runs hang on
 * stays, without its join this way; and where that leaves a pipe with one
 * join and no fitting, a CAP goes on it.
 */
export function deleteStretch(g: Grid, s: Stretch): { cell: number; main: number; end: number }[] {
  const out = new Map<number, { cell: number; main: number; end: number }>();
  const last = s.cells.length - 1;
  const keep = (k: number) => (k === 0 && s.shared[0]) || (k === last && s.shared[1]);
  const set = (cell: number, main: number, end: number) => out.set(cell, { cell, main, end });
  for (const [k, cell] of s.cells.entries()) if (!keep(k)) set(cell, 0, 0);
  // THE ENDS THAT STAY lose their join toward the stretch; a loose end is capped.
  for (const k of [0, last]) {
    if (!keep(k) || s.cells.length < 2) continue;
    const cell = s.cells[k], beside = s.cells[k === 0 ? 1 : last - 1];
    const x = cell % g.w, y = (cell / g.w) | 0, dx = (beside % g.w) - x, dy = ((beside / g.w) | 0) - y;
    const side = SIDES.find((sd) => NEIGHBOUR[sd][0] === dx && NEIGHBOUR[sd][1] === dy);
    if (!side) continue;
    const flags = g.main[cell] & ~15, joins = (g.main[cell] & 15) & ~DIR[side];
    const count = SIDES.filter((sd) => joins & DIR[sd]).length;
    const end = g.mainEnd[cell] || (count === 1 ? MAIN_END.cap : 0);
    set(cell, count || end ? flags | joins : 0, count || end ? end : 0);
  }
  return [...out.values()];
}
