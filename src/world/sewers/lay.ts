/**
 * World v2 — LAYING A SEWER, worked out before it is laid: the route a drag
 * makes, what each end is, where the game puts its manholes, what the ground
 * makes of it, and what it costs. Pure: the Sewer tool's card and ghost read
 * it while you drag, and the stroke lays what it says. @see solve, plans/underground-sewers.md §3–4
 */
import { DIR, NEIGHBOUR } from "../../iso/dir";
import { SEWER_AI, SEWER_FIT, idx, inBounds, structureAt, type Grid } from "../grid";
import { portsAt } from "../water/ports";
import { NODE_EVERY, SEWER_KIND, hasSewer, solveSewers, type SewerSolve } from "./solve";

const SIDES = ["N", "E", "S", "W"] as const;
/** A span costs this many buried tiles. */
export const SPAN_PRICE = 3;

type Cell = { x: number; y: number };
/** One tile of a sewer to lay: its joins, and the fitting it gets, if any. */
export type SewerCell = Cell & { join: number; fit: number };

export type SewerPlan = {
  cells: SewerCell[];
  /** The map as it would be, and its sewers solved. */
  staged: Grid;
  solve: SewerSolve;
  /** New tiles; of them spans; lift stations it adds. */
  fresh: number;
  spans: number;
  lifts: number[];
  /** What it costs: the tiles by their depth, the spans, the lifts. */
  price: number;
  /** Slop a second the run carries to its exit, the least along the way; 0 with no exit. */
  capacity: number;
  /** Whether it drains to an exit. */
  exit: boolean;
  /** What stops it being laid, where. */
  problem: { cell: number; reason: string } | null;
};

/** Where the ground has no building on it: a sewer goes under ground and road only. */
const open = (g: Grid, x: number, y: number) => inBounds(g, x, y) && structureAt(g, x, y) < 0;

/**
 * A SEWER'S ROUTE from one tile to another, as the drag makes it: tile to
 * tile, round buildings, as straight as it can be — a turn costing half a
 * tile — and through another sewer only at its ends. A drag into water stops
 * at the bank. Null where there is no way. Pure.
 */
export function routeSewer(g: Grid, from: Cell, to: Cell, wet: (x: number, y: number) => boolean): Cell[] | null {
  if (!inBounds(g, from.x, from.y) || !inBounds(g, to.x, to.y)) return null;
  if (from.x === to.x && from.y === to.y) return open(g, from.x, from.y) ? [from] : null;
  const n = g.w * g.h, start = idx(g, from.x, from.y), goal = idx(g, to.x, to.y);
  const free = (i: number) => {
    const x = i % g.w, y = (i / g.w) | 0;
    if (!open(g, x, y)) return false;
    return i === start || i === goal || !hasSewer(g, i);
  };
  if (!free(start) || !free(goal)) return null;
  const cost = new Float64Array(n * 4).fill(Infinity);
  const prev = new Int32Array(n * 4).fill(-1);
  const heap: { c: number; k: number }[] = [];
  const push = (e: { c: number; k: number }) => {
    heap.push(e);
    for (let i = heap.length - 1; i > 0;) { const p = (i - 1) >> 1; if (heap[p].c <= heap[i].c) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l].c < heap[m].c) m = l;
        if (r < heap.length && heap[r].c < heap[m].c) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  for (let d = 0; d < 4; d++) { cost[start * 4 + d] = 0; push({ c: 0, k: start * 4 + d }); }
  let found = -1;
  while (heap.length) {
    const { c, k } = pop();
    if (c > cost[k]) continue;
    const i = (k / 4) | 0, d = k % 4;
    if (i === goal) { found = k; break; }
    const x = i % g.w, y = (i / g.w) | 0;
    for (let nd = 0; nd < 4; nd++) {
      const [dx, dy] = NEIGHBOUR[SIDES[nd]];
      if (!inBounds(g, x + dx, y + dy)) continue;
      const j = idx(g, x + dx, y + dy);
      if (!free(j)) continue;
      const nc = c + 1 + (nd === d || i === start ? 0 : 0.5);
      const nk = j * 4 + nd;
      if (nc < cost[nk]) { cost[nk] = nc; prev[nk] = k; push({ c: nc, k: nk }); }
    }
  }
  if (found < 0) return null;
  const out: Cell[] = [];
  for (let k = found; k >= 0; k = prev[k]) {
    const i = (k / 4) | 0;
    if (!out.length || idx(g, out[out.length - 1].x, out[out.length - 1].y) !== i) out.push({ x: i % g.w, y: (i / g.w) | 0 });
  }
  out.reverse();
  // INTO WATER, it stops at the bank: an outfall stands on the dry tile beside it.
  const dry = (c: Cell) => !wet(c.x, c.y) || hasSewer(g, idx(g, c.x, c.y));
  while (out.length > 2 && !dry(out[out.length - 1]) && !dry(out[out.length - 2])) out.pop();
  if (out.length > 1 && !dry(out[out.length - 1])) out.pop();
  while (out.length > 2 && !dry(out[0]) && !dry(out[1])) out.shift();
  if (out.length > 1 && !dry(out[0])) out.shift();
  return out;
}

/** Whether a tile is beside water, or in it. */
function atWater(g: Grid, c: Cell, wet: (x: number, y: number) => boolean): boolean {
  if (wet(c.x, c.y)) return true;
  return SIDES.some((s) => { const [dx, dy] = NEIGHBOUR[s]; return inBounds(g, c.x + dx, c.y + dy) && wet(c.x + dx, c.y + dy); });
}

/** A copy of the map to lay a sewer on, its sewers its own. */
function stage(g: Grid): Grid {
  return { ...g, sewer: g.sewer.slice(), sewerFit: g.sewerFit.slice(), rev: g.rev + 0.5 };
}

/**
 * A SEWER TO LAY along a route: each tile joined to the next; each end that
 * lands on a sewer already laid JOINS it, the rest fitted — an INLET at a
 * processor's slop port, an OUTFALL at water, else a manhole. MANHOLES go at
 * its ends, bends and junctions and every `NODE_EVERY` tiles, wherever the
 * pipe has ground over it. Then the ground has its say (the solve): spans,
 * lifts, and what it costs. `unit` is a buried tile's price at the least
 * depth; `liftPrice` a lift station's. Refused, with why, as a string.
 */
export function planSewer(
  g: Grid, route: readonly Cell[], wet: (x: number, y: number) => boolean,
  o: { unit: number; liftPrice: number; ai?: boolean },
): SewerPlan | { refused: string } {
  if (route.length < 2) return { refused: "Drag from water or a processor to lay a sewer" };
  for (const [k, c] of route.entries()) {
    if (!open(g, c.x, c.y)) return { refused: inBounds(g, c.x, c.y) ? "A sewer can't go under a building" : "Off the map" };
    const end = k === 0 || k === route.length - 1;
    if (!end && hasSewer(g, idx(g, c.x, c.y))) return { refused: "End the run on the other sewer to join it" };
  }
  const toward = (a: Cell, b: Cell) => SIDES.find((s) => NEIGHBOUR[s][0] === b.x - a.x && NEIGHBOUR[s][1] === b.y - a.y);
  const cells: SewerCell[] = [];
  for (const [k, c] of route.entries()) {
    let join = 0;
    for (const n of [route[k - 1], route[k + 1]]) {
      if (!n) continue;
      const side = toward(c, n);
      if (!side) return { refused: "A sewer runs tile to tile" };
      join |= DIR[side];
    }
    const i = idx(g, c.x, c.y);
    const isEnd = k === 0 || k === route.length - 1;
    let fit = 0;
    if (isEnd && !hasSewer(g, i)) {
      fit = portsAt(g, i, "slop", "in").length ? SEWER_FIT.inlet : atWater(g, c, wet) ? SEWER_FIT.outfall : SEWER_FIT.node;
    }
    cells.push({ x: c.x, y: c.y, join, fit });
  }

  // LAID, without the manholes along it yet: where has it ground over it?
  const staged = stage(g);
  const mark = o.ai ? SEWER_AI : 0;
  for (const c of cells) {
    const i = idx(g, c.x, c.y);
    staged.sewer[i] |= c.join | (hasSewer(g, i) ? 0 : mark);
    if (c.fit) staged.sewerFit[i] = c.fit;
  }
  const first = solveSewers(staged);
  const buried = (i: number) => first.kind[i] === SEWER_KIND.buried;
  // A manhole where a run turns or meets another, and every so often along it.
  const straight = (j: number) => j === (DIR.N | DIR.S) || j === (DIR.E | DIR.W);
  let since = 0;
  for (const [k, c] of cells.entries()) {
    const i = idx(g, c.x, c.y);
    if (staged.sewerFit[i]) { since = 0; continue; }
    since++;
    const isEnd = k === 0 || k === cells.length - 1;
    const bend = !isEnd && !straight(c.join);
    // Where it joins one laid already: a junction, unless that is a straight run's end.
    const junction = isEnd && hasSewer(g, i);
    const due = since >= NODE_EVERY && k < cells.length - 2;
    if ((bend || junction || due) && buried(i)) {
      if (!junction) c.fit = SEWER_FIT.node;
      staged.sewerFit[i] = SEWER_FIT.node;
      since = 0;
    }
  }
  // An end node on a span or a lift can't stand: it goes back a tile, onto ground.
  for (const k of [0, cells.length - 1]) {
    const c = cells[k], i = idx(g, c.x, c.y);
    if (c.fit !== SEWER_FIT.node || buried(i)) continue;
    staged.sewerFit[i] = 0;
    c.fit = 0;
    const next = cells[k === 0 ? 1 : cells.length - 2];
    const j = idx(g, next.x, next.y);
    if (!staged.sewerFit[j] && buried(j)) { next.fit = SEWER_FIT.node; staged.sewerFit[j] = SEWER_FIT.node; }
  }
  staged.rev += 0.25;
  const solve = solveSewers(staged);
  const before = solveSewers(g);

  // WHAT IT COSTS: each new tile by how deep it is dug, spans dearer, and each new lift station.
  let price = 0, fresh = 0, spans = 0;
  const lifts: number[] = [];
  for (const c of cells) {
    const i = idx(g, c.x, c.y);
    if (hasSewer(g, i)) continue;
    fresh++;
    if (solve.kind[i] === SEWER_KIND.span) { spans++; price += o.unit * SPAN_PRICE; continue; }
    const depth = Math.max(0, g.height[i] - solve.level[i]);
    price += o.unit * (1 + depth / 2);
  }
  const net = solve.nets[solve.of[idx(g, cells[0].x, cells[0].y)]];
  for (const i of net?.cells ?? []) {
    if (solve.kind[i] === SEWER_KIND.lift && before.kind[i] !== SEWER_KIND.lift) { lifts.push(i); price += o.liftPrice; }
  }
  // WHAT IT CARRIES to its exit: the least of each tile's on the way down, from its top end.
  let capacity = Infinity;
  const exit = cells.every((c) => solve.drains[idx(g, c.x, c.y)] === 1);
  if (exit) {
    for (const c of cells) {
      for (let i = idx(g, c.x, c.y); i >= 0 && solve.down[i] >= 0; i = solve.down[i]) capacity = Math.min(capacity, solve.capacity[i]);
    }
  }
  const mine = new Set(net?.cells ?? []);
  const problem = solve.problems.find((p) => mine.has(p.cell)) ?? null;
  return {
    cells, staged, solve, fresh, spans, lifts, price: Math.round(price),
    capacity: exit && Number.isFinite(capacity) ? capacity : 0, exit, problem,
  };
}

/**
 * A MANHOLE ADDED BY HAND, on a sewer already laid: where it has ground
 * over it and no fitting yet. Refused, with why, as a string.
 */
export function planNode(g: Grid, c: Cell): { refused: string } | { cell: number } {
  if (!inBounds(g, c.x, c.y)) return { refused: "Off the map" };
  const i = idx(g, c.x, c.y);
  if (!hasSewer(g, i)) return { refused: "Drag from water or a processor to lay a sewer" };
  if (g.sewerFit[i]) return { refused: "It has one already" };
  if (solveSewers(g).kind[i] !== SEWER_KIND.buried) return { refused: "A node needs ground under it" };
  return { cell: i };
}
