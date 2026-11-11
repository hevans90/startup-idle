/**
 * World v2 — ONE PIPE GRAPH, compiled from the map: every water main, every
 * sewer connection above ground and every trunk under it, as NODES joined by
 * LINKS.
 *
 * The grid's layers stay the authored truth (`main`/`mainEnd` for mains and
 * connections, `sewer`/`sewerFit` for trunks) and nothing is saved here: the
 * graph is derived, like the lane graph, and kept till the map changes.
 *
 *  - a NODE is anywhere a run stops being one straight pipe: a fitting, a
 *    dead end, a junction, a bend, a manhole a connection comes down into —
 *    and a point every `NODE_SPACING` tiles of a long straight, so a solver
 *    has somewhere to hold a level along it;
 *  - a LINK is the run between two nodes: its tiles in order, its length, and
 *    its bore — wide only if every tile of it is widened, so a widened
 *    stretch is its own link;
 *  - a DROP joins a connection to the trunk under its manhole, the one place
 *    the two layers meet;
 *  - a SYSTEM is everything joined, drops included: a workplace's connection,
 *    the trunk it falls into and the outfall at the end are one.
 *
 * The networks the game has always read — a main's cells and fittings
 * (`MainNet`), a trunk's cells, exits and manholes (`SewerNet`) — are found
 * here, once, in the order they always were, and handed out by `findMains`
 * and `solveSewers`. @see plans/pipe-network.md §1
 */
import { DIR, NEIGHBOUR } from "../../iso/dir";
import {
  MAIN_AI, MAIN_BORE, MAIN_END, MAIN_SEWER, SEWER_AI, SEWER_BORE, SEWER_FIT, idx, inBounds, type Grid,
} from "../grid";

const SIDES = ["N", "E", "S", "W"] as const;
type Side = (typeof SIDES)[number];
const OPPOSITE = { N: "S", S: "N", E: "W", W: "E" } as const;

/** Tiles of straight run between nodes, at most. */
export const NODE_SPACING = 4;

/**
 * One network of mains: its cells, its intakes and outlets by cell; its BORE
 * — 2 once every tile of it is widened, else 1 — whether the AI laid it, and
 * whether it is a SEWER, with its outfalls into water by cell.
 */
export type MainNet = { id: number; cells: number[]; intakes: number[]; outlets: number[]; outfalls: number[]; bore: number; ai: boolean; sewer: boolean };

/** One sewer network: its cells, its exits and nodes by cell, and whether the AI laid it. */
export type SewerNet = { id: number; cells: number[]; exits: number[]; nodes: number[]; ai: boolean };

/** Which of the map's two pipe layers a thing is on: mains and connections above ground, trunks under it. */
export type PipeLayer = "main" | "trunk";

/** What a node is: a fitting by its name, or a plain joint in the run. */
export type PipeNodeKind =
  | "joint" | "intake" | "pump" | "outlet" | "cap" | "outfall" | "drain" | "drop"
  | "manhole" | "inlet";

export type PipeNode = {
  id: number;
  layer: PipeLayer;
  /** The tile it is on. */
  cell: number;
  kind: PipeNodeKind;
  /** The links that meet at it, by id. */
  links: number[];
  /** The system it is part of. */
  system: number;
};

/** What a link carries and how: a water main, a sewer connection, a trunk, or the drop between the last two. */
export type PipeLinkKind = "main" | "connection" | "trunk" | "drop";

export type PipeLink = {
  id: number;
  kind: PipeLinkKind;
  /** The nodes at its ends. */
  a: number;
  b: number;
  /** Its tiles, from `a` to `b`, both ends in. A drop's is the one tile. */
  cells: number[];
  /** Tiles from end to end; nought for a drop. */
  length: number;
  /** 2 where every tile of it is widened, else 1. */
  bore: number;
  /** Laid by the AI. */
  ai: boolean;
};

/** Everything joined together, drops included. */
export type PipeSystem = { id: number; fluid: "water" | "slop"; nodes: number[]; links: number[] };

export type PipeGraph = {
  rev: number;
  nodes: PipeNode[];
  links: PipeLink[];
  systems: PipeSystem[];
  /** The node on a tile of each layer, −1 for none. */
  nodeAt: Record<PipeLayer, Int32Array>;
  /** The link through a tile of each layer that is not a node, −1 for none. */
  linkAt: Record<PipeLayer, Int32Array>;
  /** The mains' networks, and which each cell is in (−1 for none). @see findMains */
  mains: MainNet[];
  mainOf: Int32Array;
  /** The trunks' networks, likewise. @see solveSewers */
  sewers: SewerNet[];
  sewerOf: Int32Array;
  /** Each connection — a sewer on the mains' layer — and the manhole it comes down into, by cell; null with none. */
  laterals: { net: MainNet; node: number | null; bore: number }[];
};

/** Whether a cell's pipe on a layer joins its neighbour on a side: both carry the shared face. */
export function pipeJoined(g: Grid, layer: PipeLayer, x: number, y: number, side: Side): boolean {
  const [dx, dy] = NEIGHBOUR[side];
  if (!inBounds(g, x + dx, y + dy)) return false;
  const bits = layer === "main" ? g.main : g.sewer;
  return (bits[idx(g, x, y)] & DIR[side]) !== 0 && (bits[idx(g, x + dx, y + dy)] & DIR[OPPOSITE[side]]) !== 0;
}

/** Whether a cell carries a pipe on a layer: joined somewhere, or a lone fitting. */
export const hasPipe = (g: Grid, layer: PipeLayer, i: number) =>
  layer === "main" ? g.main[i] !== 0 || g.mainEnd[i] !== 0 : (g.sewer[i] & 15) !== 0 || g.sewerFit[i] !== 0;

const MAIN_KIND: Record<number, PipeNodeKind> = {
  [MAIN_END.intake]: "intake", [MAIN_END.pump]: "pump", [MAIN_END.outlet]: "outlet", [MAIN_END.cap]: "cap",
  [MAIN_END.outfall]: "outfall", [MAIN_END.drain]: "drain", [MAIN_END.drop]: "drop",
};
const TRUNK_KIND: Record<number, PipeNodeKind> = {
  [SEWER_FIT.node]: "manhole", [SEWER_FIT.outfall]: "outfall", [SEWER_FIT.inlet]: "inlet",
};

const kept = new WeakMap<Grid, PipeGraph>();

/** The map's pipes as one graph: kept till the map changes. */
export function pipeGraph(g: Grid): PipeGraph {
  const seen = kept.get(g);
  if (seen && seen.rev === g.rev) return seen;
  const graph = compile(g);
  kept.set(g, graph);
  return graph;
}

function compile(g: Grid): PipeGraph {
  const n = g.w * g.h;
  const { mains, mainOf } = floodMains(g);
  const { sewers, sewerOf } = floodSewers(g);
  const nodes: PipeNode[] = [], links: PipeLink[] = [];
  const nodeAt = { main: new Int32Array(n).fill(-1), trunk: new Int32Array(n).fill(-1) };
  const linkAt = { main: new Int32Array(n).fill(-1), trunk: new Int32Array(n).fill(-1) };

  for (const layer of ["main", "trunk"] as const) {
    const sides = (i: number) => SIDES.filter((s) => pipeJoined(g, layer, i % g.w, (i / g.w) | 0, s));
    const step = (i: number, s: Side) => i + NEIGHBOUR[s][0] + NEIGHBOUR[s][1] * g.w;
    const wide = (i: number) => (layer === "main" ? (g.main[i] & MAIN_BORE) !== 0 : (g.sewer[i] & SEWER_BORE) !== 0);
    const byAi = (i: number) => (layer === "main" ? (g.main[i] & MAIN_AI) !== 0 : (g.sewer[i] & SEWER_AI) !== 0);
    const kindOf = (i: number): PipeNodeKind =>
      (layer === "main" ? MAIN_KIND[g.mainEnd[i]] : TRUNK_KIND[g.sewerFit[i]]) ?? "joint";
    const linkKind = (i: number): PipeLinkKind => (layer === "trunk" ? "trunk" : g.main[i] & MAIN_SEWER ? "connection" : "main");
    /** Where a run stops being one straight pipe. */
    const breaks = (i: number): boolean => {
      if ((layer === "main" ? g.mainEnd[i] : g.sewerFit[i]) !== 0) return true;
      // A connection passing over a manhole comes down into it there.
      if (layer === "main" && (g.main[i] & MAIN_SEWER) !== 0 && g.sewerFit[i] === SEWER_FIT.node) return true;
      const j = sides(i);
      return j.length !== 2 || OPPOSITE[j[0]] !== j[1];
    };
    const add = (i: number): number => {
      if (nodeAt[layer][i] >= 0) return nodeAt[layer][i];
      const id = nodes.length;
      nodes.push({ id, layer, cell: i, kind: kindOf(i), links: [], system: -1 });
      nodeAt[layer][i] = id;
      return id;
    };
    const cells: number[] = [];
    for (let i = 0; i < n; i++) if (hasPipe(g, layer, i)) cells.push(i);
    for (const i of cells) if (breaks(i)) add(i);
    // A RING WITH NOTHING ON IT has no break: its first tile stands for one.
    const reached = new Uint8Array(n);
    for (const start of cells) {
      if (reached[start]) continue;
      const queue = [start];
      let any = false;
      reached[start] = 1;
      for (let q = 0; q < queue.length; q++) {
        const i = queue[q];
        if (nodeAt[layer][i] >= 0) any = true;
        for (const s of sides(i)) { const j = step(i, s); if (!reached[j]) { reached[j] = 1; queue.push(j); } }
      }
      if (!any) add(start);
    }
    // THE RUNS, out of every node along every side, cut every `NODE_SPACING` tiles.
    const walked = new Set<number>();
    const key = (i: number, s: Side) => i * 4 + SIDES.indexOf(s);
    for (let k = 0; k < nodes.length; k++) {
      const from = nodes[k];
      if (from.layer !== layer) continue;
      for (const out of sides(from.cell)) {
        if (walked.has(key(from.cell, out))) continue;
        let a = from.id, run = [from.cell], dir = out, at = from.cell;
        for (;;) {
          walked.add(key(at, dir));
          at = step(at, dir);
          run.push(at);
          const isNode = nodeAt[layer][at] >= 0;
          if (isNode || run.length - 1 >= NODE_SPACING) {
            const b = add(at);
            const id = links.length;
            links.push({ id, kind: linkKind(run[1] ?? at), a, b, cells: run, length: run.length - 1, bore: run.every(wide) ? 2 : 1, ai: run.some(byAi) });
            nodes[a].links.push(id);
            nodes[b].links.push(id);
            for (const c of run.slice(1, -1)) linkAt[layer][c] = id;
            walked.add(key(at, OPPOSITE[dir]));
            if (isNode) break;
            // A spacing node, made here: carry straight on from it as a new run.
            a = b; run = [at];
          }
          // Straight on: a tile that is no node joins only the way it came and the way it goes.
          const next = sides(at).find((s) => s !== OPPOSITE[dir]);
          if (!next) break;
          dir = next;
        }
      }
    }
  }

  // THE DROPS: a connection's node standing on a manhole, joined to it.
  for (let k = 0, count = nodes.length; k < count; k++) {
    const top = nodes[k];
    if (top.layer !== "main" || !(g.main[top.cell] & MAIN_SEWER) || g.sewerFit[top.cell] !== SEWER_FIT.node) continue;
    const under = nodeAt.trunk[top.cell];
    if (under < 0) continue;
    const id = links.length;
    links.push({ id, kind: "drop", a: top.id, b: under, cells: [top.cell], length: 0, bore: 1, ai: false });
    top.links.push(id);
    nodes[under].links.push(id);
  }

  // THE SYSTEMS: everything joined, flooded over the links.
  const systems: PipeSystem[] = [];
  for (const start of nodes) {
    if (start.system >= 0) continue;
    const slop = start.layer === "trunk" || (g.main[start.cell] & MAIN_SEWER) !== 0;
    const sys: PipeSystem = { id: systems.length, fluid: slop ? "slop" : "water", nodes: [], links: [] };
    const queue = [start.id], got = new Set<number>();
    start.system = sys.id;
    for (let q = 0; q < queue.length; q++) {
      const node = nodes[queue[q]];
      sys.nodes.push(node.id);
      for (const l of node.links) {
        if (!got.has(l)) { got.add(l); sys.links.push(l); }
        const other = links[l].a === node.id ? links[l].b : links[l].a;
        if (nodes[other].system < 0) { nodes[other].system = sys.id; queue.push(other); }
      }
    }
    systems.push(sys);
  }

  const laterals = mains.filter((net) => net.sewer).map((net) => ({
    net,
    node: net.cells.find((i) => g.sewerFit[i] === SEWER_FIT.node) ?? null,
    bore: net.cells.some((i) => g.main[i] & MAIN_BORE) ? 2 : 1,
  }));
  return { rev: g.rev, nodes, links, systems, nodeAt, linkAt, mains, mainOf, sewers, sewerOf, laterals };
}

/** Every network of mains, flooded over the joins in map order. */
function floodMains(g: Grid): { mains: MainNet[]; mainOf: Int32Array } {
  const of = new Int32Array(g.w * g.h).fill(-1);
  const list: MainNet[] = [];
  for (let start = 0; start < of.length; start++) {
    if (!hasPipe(g, "main", start) || of[start] >= 0) continue;
    const id = list.length, net: MainNet = { id, cells: [], intakes: [], outlets: [], outfalls: [], bore: 2, ai: false, sewer: false };
    const queue = [start];
    of[start] = id;
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q], x = i % g.w, y = (i / g.w) | 0;
      net.cells.push(i);
      if (!(g.main[i] & MAIN_BORE)) net.bore = 1;
      if (g.main[i] & MAIN_AI) net.ai = true;
      if (g.main[i] & MAIN_SEWER) net.sewer = true;
      const end = g.mainEnd[i];
      if (end === MAIN_END.intake || end === MAIN_END.pump) net.intakes.push(i);
      else if (end === MAIN_END.outlet) net.outlets.push(i);
      else if (end === MAIN_END.outfall) net.outfalls.push(i);
      for (const side of SIDES) {
        if (!pipeJoined(g, "main", x, y, side)) continue;
        const [dx, dy] = NEIGHBOUR[side];
        const j = idx(g, x + dx, y + dy);
        if (of[j] >= 0) continue;
        of[j] = id;
        queue.push(j);
      }
    }
    list.push(net);
  }
  return { mains: list, mainOf: of };
}

/** Every network of trunks, likewise. */
function floodSewers(g: Grid): { sewers: SewerNet[]; sewerOf: Int32Array } {
  const of = new Int32Array(g.w * g.h).fill(-1);
  const nets: SewerNet[] = [];
  for (let start = 0; start < of.length; start++) {
    if (!hasPipe(g, "trunk", start) || of[start] >= 0) continue;
    const net: SewerNet = { id: nets.length, cells: [], exits: [], nodes: [], ai: false };
    const queue = [start];
    of[start] = net.id;
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q], x = i % g.w, y = (i / g.w) | 0;
      net.cells.push(i);
      if (g.sewer[i] & SEWER_AI) net.ai = true;
      const fit = g.sewerFit[i];
      if (fit === SEWER_FIT.outfall || fit === SEWER_FIT.inlet) net.exits.push(i);
      else if (fit === SEWER_FIT.node) net.nodes.push(i);
      for (const side of SIDES) {
        if (!pipeJoined(g, "trunk", x, y, side)) continue;
        const [dx, dy] = NEIGHBOUR[side];
        const j = idx(g, x + dx, y + dy);
        if (of[j] < 0) { of[j] = net.id; queue.push(j); }
      }
    }
    nets.push(net);
  }
  return { sewers: nets, sewerOf: of };
}
