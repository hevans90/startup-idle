/**
 * World v2 — THE SEWERS UNDER THE GROUND, solved: how deep each tile of one
 * lies, which way it falls, and where the ground makes it come up.
 *
 * A sewer is laid as a run of joined cells (`grid.sewer`) with fittings at
 * the surface (`grid.sewerFit`): its EXITS — an outfall into water, an inlet
 * to a processor — and its NODES, the manholes a building is piped to. Slop
 * runs downhill to an exit, so every tile must lie at least `GRADE` higher
 * than the next one down, and at least `COVER` under the ground. The ground
 * decides the rest:
 *
 *  - a SPAN where it falls away under the pipe — a valley, a river, a cliff —
 *    the pipe crossing on piers at its own level and diving again where the
 *    ground is high enough; no longer than `SPAN_MOST`;
 *  - a LIFT STATION where keeping the fall would bury it deeper than
 *    `DEEPEST`: the tile whose slop has to climb pumps it up to the next.
 *
 * Solved for the whole map at once, from the exits upstream, and kept till
 * the map changes. Pure: nothing here moves slop or draws. @see plans/underground-sewers.md
 */
import { DIR, NEIGHBOUR } from "../../iso/dir";
import { SEWER_BORE, SEWER_AI, SEWER_FIT, idx, inBounds, type Grid } from "../grid";

/** Height units a sewer falls a tile, at least. */
export const GRADE = 0.1;
/** Height units of ground over a sewer, at least, where it is buried. */
export const COVER = 1;
/** Height units under the ground a sewer may lie, at most, before it needs a lift. */
export const DEEPEST = 4;
/** Tiles a span may cross, at most. */
export const SPAN_MOST = 8;
/** Tiles of trunk between nodes, at most, when the game puts them. */
export const NODE_EVERY = 8;
/** Tiles a lateral may run from a slop port to a node, at most. */
export const LATERAL_REACH = 6;
/** Slop a second a sewer carries at the least grade, a bore; steeper carries more, to `STEEP_MOST` times. */
export const SEWER_RATE = 1;
export const STEEP_MOST = 3;
/** Slop a second a lift station pumps. */
export const LIFT_RATE = 1.5;
/** Height units a dip must fall under where the pipe would be for it to be spanned, not dug under. */
const SPAN_DIP = 1.5;

const SIDES = ["N", "E", "S", "W"] as const;
const OPPOSITE = { N: "S", S: "N", E: "W", W: "E" } as const;

/** What a sewer is on a tile: under the ground, across a span, or a lift station. */
export const SEWER_KIND = { buried: 0, span: 1, lift: 2 } as const;

/** One sewer network: its cells, its exits and nodes by cell, and whether the AI laid it. */
export type SewerNet = { id: number; cells: number[]; exits: number[]; nodes: number[]; ai: boolean };

export type SewerSolve = {
  rev: number;
  nets: SewerNet[];
  /** Which network each cell is in, −1 for none. */
  of: Int32Array;
  /** The pipe's floor on each cell, height units; NaN where there is no sewer. */
  level: Float32Array;
  /** The next cell down toward its exit, −1 at an exit or where it has none. */
  down: Int32Array;
  /** {@link SEWER_KIND} on each cell. */
  kind: Uint8Array;
  /** Slop a second the pipe from a cell to the next down carries. */
  capacity: Float32Array;
  /** 1 where the cell drains to an exit. */
  drains: Uint8Array;
  /** What is wrong, where: a span too long, a node with no ground to stand on. */
  problems: { cell: number; reason: string }[];
};

/** Whether a cell's sewer joins its neighbour on a side: both carry the shared face. */
export function sewerJoined(g: Grid, x: number, y: number, side: (typeof SIDES)[number]): boolean {
  const [dx, dy] = NEIGHBOUR[side];
  if (!inBounds(g, x + dx, y + dy)) return false;
  return (g.sewer[idx(g, x, y)] & DIR[side]) !== 0 && (g.sewer[idx(g, x + dx, y + dy)] & DIR[OPPOSITE[side]]) !== 0;
}

/** Whether a cell has a sewer under it: joined somewhere, or a lone fitting. */
export const hasSewer = (g: Grid, i: number) => (g.sewer[i] & 15) !== 0 || g.sewerFit[i] !== 0;

/** The cells a cell's sewer joins. */
function joinsOf(g: Grid, i: number): number[] {
  const x = i % g.w, y = (i / g.w) | 0, out: number[] = [];
  for (const side of SIDES) {
    if (!sewerJoined(g, x, y, side)) continue;
    const [dx, dy] = NEIGHBOUR[side];
    out.push(idx(g, x + dx, y + dy));
  }
  return out;
}

const isExit = (g: Grid, i: number) => g.sewerFit[i] === SEWER_FIT.outfall || g.sewerFit[i] === SEWER_FIT.inlet;

const kept = new WeakMap<Grid, SewerSolve>();

/** The map's sewers, solved: kept till the map changes. */
export function solveSewers(g: Grid): SewerSolve {
  const seen = kept.get(g);
  if (seen && seen.rev === g.rev) return seen;
  const solved = solve(g);
  kept.set(g, solved);
  return solved;
}

function solve(g: Grid): SewerSolve {
  const n = g.w * g.h;
  const of = new Int32Array(n).fill(-1);
  const level = new Float32Array(n).fill(NaN);
  const down = new Int32Array(n).fill(-1);
  const kind = new Uint8Array(n);
  const capacity = new Float32Array(n);
  const drains = new Uint8Array(n);
  const problems: { cell: number; reason: string }[] = [];
  const nets: SewerNet[] = [];
  const ground = (i: number) => g.height[i];

  // THE NETWORKS: flooded over the joins.
  for (let start = 0; start < n; start++) {
    if (!hasSewer(g, start) || of[start] >= 0) continue;
    const net: SewerNet = { id: nets.length, cells: [], exits: [], nodes: [], ai: false };
    const queue = [start];
    of[start] = net.id;
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      net.cells.push(i);
      if (g.sewer[i] & SEWER_AI) net.ai = true;
      if (isExit(g, i)) net.exits.push(i);
      else if (g.sewerFit[i] === SEWER_FIT.node) net.nodes.push(i);
      for (const j of joinsOf(g, i)) if (of[j] < 0) { of[j] = net.id; queue.push(j); }
    }
    nets.push(net);
  }

  for (const net of nets) {
    // THE WAY DOWN: from every exit at once, out along the joins, so each
    // cell falls toward its nearest exit. A loop's extra join carries nothing.
    const order: number[] = [...net.exits];
    for (const e of net.exits) drains[e] = 1;
    for (let q = 0; q < order.length; q++) {
      for (const j of joinsOf(g, order[q])) {
        if (drains[j]) continue;
        drains[j] = 1;
        down[j] = order[q];
        order.push(j);
      }
    }
    const up = new Map<number, number[]>();
    for (const i of order) if (down[i] >= 0) { const l = up.get(down[i]); if (l) l.push(i); else up.set(down[i], [i]); }

    // HOW HIGH EACH MAY LIE, from the top down: as near the ground as it can
    // be, and low enough that all above it can still fall into it.
    //  - A DIP — ground well under where those above want the pipe — is
    //    SPANNED: it asks nothing of the pipe, which crosses it at their
    //    level, so long as the span stays within `SPAN_MOST`. Past that, or
    //    at an exit or a node, which need ground, the pipe dives under it.
    //  - Where keeping the fall would bury a tile deeper than `DEEPEST`, the
    //    tile above that pulls it down LIFTS its slop instead, and asks nothing.
    const high = new Map<number, number>();
    const spanned = new Map<number, number>();
    const lifted = new Set<number>();
    for (let k = order.length - 1; k >= 0; k--) {
      const i = order[k], kids = up.get(i) ?? [];
      const own = ground(i) - COVER;
      const wants = () => {
        let m = Infinity;
        for (const c of kids) if (!lifted.has(c)) m = Math.min(m, high.get(c)! - GRADE);
        return m;
      };
      let above = wants();
      if (above < ground(i) - DEEPEST) {
        for (const c of kids) if (high.get(c)! - GRADE < ground(i) - DEEPEST) lifted.add(c);
        above = wants();
      }
      const pinned = isExit(g, i) || g.sewerFit[i] === SEWER_FIT.node;
      const run = 1 + Math.max(0, ...kids.filter((c) => !lifted.has(c)).map((c) => spanned.get(c) ?? 0));
      if (!pinned && above - own > SPAN_DIP && run <= SPAN_MOST) {
        high.set(i, above);
        spanned.set(i, run);
      } else high.set(i, Math.min(own, above));
    }

    // THE LEVELS, from the exits up: each as high as it may lie, once it is
    // above the next one down. One that cannot be both is out of the ground:
    // a span, at the least fall, until the ground rises round it again.
    // A dip marked for a span is only spanned if it has to be: where the pipe
    // below already lies low enough, it goes into the ground like any other —
    // the foot of a cliff on the way to the exit is no valley.
    for (const i of order) {
      const h = spanned.has(i) ? ground(i) - COVER : high.get(i)!;
      if (down[i] < 0) { level[i] = h; continue; }
      if (lifted.has(i)) { level[i] = h; kind[i] = SEWER_KIND.lift; continue; }
      const need = level[down[i]] + GRADE;
      level[i] = h >= need ? h : need;
      // Out of the ground: its crown above it.
      if (level[i] > ground(i) - COVER / 2) kind[i] = SEWER_KIND.span;
    }

    // WHAT IT CARRIES, a tile to the next down: by its bore and how steeply
    // it falls; a lift station, what it pumps.
    for (const i of order) {
      const bore = g.sewer[i] & SEWER_BORE ? 2 : 1;
      if (kind[i] === SEWER_KIND.lift) { capacity[i] = LIFT_RATE * bore; continue; }
      const fall = down[i] >= 0 ? level[i] - level[down[i]] : GRADE;
      capacity[i] = SEWER_RATE * bore * Math.min(STEEP_MOST, Math.sqrt(Math.max(fall, GRADE) / GRADE));
    }

    // SPANS TOO LONG, and nodes on them: a run of span tiles joined down is one span.
    const spanRun = new Map<number, number>();
    for (const i of order) {
      if (kind[i] !== SEWER_KIND.span) continue;
      const below = down[i];
      spanRun.set(i, below >= 0 && kind[below] === SEWER_KIND.span ? spanRun.get(below)! + 1 : 1);
    }
    const flagged = new Set<number>();
    for (const [i, run] of spanRun) {
      if (run <= SPAN_MOST) continue;
      // The whole span, down to where it left the ground.
      for (let c = i; c >= 0 && kind[c] === SEWER_KIND.span && !flagged.has(c); c = down[c]) {
        flagged.add(c);
        problems.push({ cell: c, reason: `A span longer than ${SPAN_MOST} tiles` });
      }
    }
    for (const i of net.nodes) if (kind[i] === SEWER_KIND.span) problems.push({ cell: i, reason: "A node needs ground under it" });

    // WITH NO EXIT: lying under the ground, going nowhere.
    for (const i of net.cells) if (!drains[i]) level[i] = ground(i) - COVER;
  }
  return { rev: g.rev, nets, of, level, down, kind, capacity, drains, problems };
}
