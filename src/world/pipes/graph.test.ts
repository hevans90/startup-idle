import { describe, expect, test } from "bun:test";

import { DIR } from "../../iso/dir";
import { applyFixture, FIXTURE_SIZE } from "../debug/fixtures";
import { MAIN_BORE, MAIN_END, MAIN_SEWER, SEWER_BORE, SEWER_FIT, createGrid, edited, idx, type Grid } from "../grid";
import { solveSewers } from "../sewers/solve";
import { findMains } from "../water/mains";
import { NODE_SPACING, hasPipe, pipeGraph, type PipeGraph, type PipeLayer } from "./graph";

const SIDE_OF = (dx: number, dy: number) => (dx === -1 ? "N" : dx === 1 ? "S" : dy === -1 ? "E" : "W");
const BACK = { N: "S", S: "N", E: "W", W: "E" } as const;

/** Lay a run tile to tile on a layer, joined along it; `flags` on every tile. */
function run(g: Grid, layer: PipeLayer, cells: [number, number][], flags = 0) {
  const bits = layer === "main" ? g.main : g.sewer;
  for (let k = 0; k < cells.length; k++) {
    const [x, y] = cells[k];
    bits[idx(g, x, y)] |= flags;
    if (k === 0) continue;
    const [px, py] = cells[k - 1], side = SIDE_OF(x - px, y - py);
    bits[idx(g, px, py)] |= DIR[side];
    bits[idx(g, x, y)] |= DIR[BACK[side]];
  }
  edited(g);
}
const along = (x0: number, y0: number, x1: number, y1: number): [number, number][] => {
  const out: [number, number][] = [];
  for (let x = x0, y = y0; ; x += Math.sign(x1 - x0), y += Math.sign(y1 - y0)) { out.push([x, y]); if (x === x1 && y === y1) break; }
  return out;
};
const kinds = (gr: PipeGraph) => gr.nodes.map((n) => n.kind).sort();

/** Every piped tile is a node or lies in exactly one link, and every link's ends are its end tiles. */
function sound(g: Grid, gr: PipeGraph) {
  for (const layer of ["main", "trunk"] as const) {
    const inLinks = new Map<number, number>();
    for (const l of gr.links) {
      if (l.kind === "drop" || gr.nodes[l.a].layer !== layer) continue;
      expect(gr.nodes[l.a].cell).toBe(l.cells[0]);
      expect(gr.nodes[l.b].cell).toBe(l.cells[l.cells.length - 1]);
      expect(l.length).toBe(l.cells.length - 1);
      expect(l.length).toBeLessThanOrEqual(NODE_SPACING);
      for (const c of l.cells.slice(1, -1)) inLinks.set(c, (inLinks.get(c) ?? 0) + 1);
    }
    for (let i = 0; i < g.w * g.h; i++) {
      if (!hasPipe(g, layer, i)) { expect(gr.nodeAt[layer][i]).toBe(-1); continue; }
      const isNode = gr.nodeAt[layer][i] >= 0;
      expect(isNode ? inLinks.has(i) : inLinks.get(i) === 1).toBe(!isNode);
      if (!isNode) expect(gr.linkAt[layer][i]).toBeGreaterThanOrEqual(0);
    }
  }
  for (const n of gr.nodes) for (const l of n.links) expect([gr.links[l].a, gr.links[l].b]).toContain(n.id);
  for (const s of gr.systems) for (const k of s.nodes) expect(gr.nodes[k].system).toBe(s.id);
  expect(gr.systems.reduce((m, s) => m + s.nodes.length, 0)).toBe(gr.nodes.length);
  expect(gr.systems.reduce((m, s) => m + s.links.length, 0)).toBe(gr.links.length);
}

describe("the one pipe graph", () => {
  test("a straight main is its two fittings, and a point every few tiles between", () => {
    const g = createGrid(24, 6);
    run(g, "main", along(2, 3, 21, 3));
    g.mainEnd[idx(g, 2, 3)] = MAIN_END.intake;
    g.mainEnd[idx(g, 21, 3)] = MAIN_END.outlet;
    edited(g);
    const gr = pipeGraph(g);
    // 19 tiles of run: four links of four, and one of three.
    expect(gr.links.map((l) => l.length)).toEqual([4, 4, 4, 4, 3]);
    expect(kinds(gr)).toEqual(["intake", "joint", "joint", "joint", "joint", "outlet"]);
    expect(gr.systems).toEqual([expect.objectContaining({ fluid: "water" })]);
    expect(gr.links.every((l) => l.kind === "main" && l.bore === 1)).toBe(true);
    sound(g, gr);
  });

  test("a bend, a tee and a dead end are each a node", () => {
    const g = createGrid(12, 12);
    run(g, "main", [...along(1, 2, 3, 2), ...along(3, 3, 3, 5)]);   // an L
    run(g, "main", along(3, 5, 3, 7));                               // on down
    run(g, "main", along(3, 5, 5, 5));                               // a branch off it
    const gr = pipeGraph(g);
    const at = (x: number, y: number) => gr.nodes[gr.nodeAt.main[idx(g, x, y)]];
    expect(at(3, 2).links).toHaveLength(2);     // the bend
    expect(at(3, 5).links).toHaveLength(3);     // the tee
    for (const [x, y] of [[1, 2], [3, 7], [5, 5]]) expect(at(x, y).links).toHaveLength(1);
    expect(gr.nodeAt.main[idx(g, 2, 2)]).toBe(-1);
    expect(gr.systems).toHaveLength(1);
    sound(g, gr);
  });

  test("a ring with nothing on it still has a node, and one link back to it a side", () => {
    const g = createGrid(8, 8);
    run(g, "main", [...along(1, 1, 3, 1), ...along(3, 2, 3, 3), ...along(2, 3, 1, 3), [1, 2], [1, 1]]);
    const gr = pipeGraph(g);
    expect(gr.nodes).toHaveLength(4);           // its four corners
    expect(gr.links).toHaveLength(4);
    sound(g, gr);
  });

  test("a widened stretch is its own link: bore is a link's, not the network's", () => {
    const g = createGrid(24, 6);
    run(g, "main", along(2, 3, 21, 3));
    for (let x = 6; x <= 10; x++) g.main[idx(g, x, 3)] |= MAIN_BORE;
    edited(g);
    const gr = pipeGraph(g);
    expect(gr.links.map((l) => l.bore)).toEqual([1, 2, 1, 1, 1]);
    expect(findMains(g).list[0].bore).toBe(1);
    sound(g, gr);
  });

  test("a connection comes down into its trunk: one system from the slop port to the outfall", () => {
    const g = createGrid(16, 10);
    // A trunk under y = 6, a manhole at x = 4, its outfall at x = 12; a connection down to the manhole from y = 2.
    run(g, "trunk", along(2, 6, 12, 6), SEWER_BORE);
    g.sewerFit[idx(g, 4, 6)] = SEWER_FIT.node;
    g.sewerFit[idx(g, 12, 6)] = SEWER_FIT.outfall;
    run(g, "main", along(4, 2, 4, 6), MAIN_SEWER);
    g.mainEnd[idx(g, 4, 2)] = MAIN_END.drain;
    g.mainEnd[idx(g, 4, 6)] = MAIN_END.drop;
    // And a water main beside it, which is none of it.
    run(g, "main", along(8, 1, 8, 3));
    edited(g);
    const gr = pipeGraph(g);
    const drops = gr.links.filter((l) => l.kind === "drop");
    expect(drops).toHaveLength(1);
    expect([gr.nodes[drops[0].a].kind, gr.nodes[drops[0].b].kind]).toEqual(["drop", "manhole"]);
    const slop = gr.systems.filter((s) => s.fluid === "slop");
    expect(slop).toHaveLength(1);
    expect(slop[0].nodes.map((k) => gr.nodes[k].kind)).toEqual(expect.arrayContaining(["drain", "drop", "manhole", "outfall"]));
    expect(gr.systems.filter((s) => s.fluid === "water")).toHaveLength(1);
    expect(gr.links.filter((l) => l.kind === "trunk").every((l) => l.bore === 2)).toBe(true);
    expect(gr.links.filter((l) => l.kind === "connection").length).toBeGreaterThan(0);
    expect(gr.laterals).toEqual([expect.objectContaining({ node: idx(g, 4, 6), bore: 1 })]);
    sound(g, gr);
  });

  test("it is kept till the map changes", () => {
    const g = createGrid(8, 8);
    run(g, "main", along(1, 1, 5, 1));
    const a = pipeGraph(g);
    expect(pipeGraph(g)).toBe(a);
    run(g, "main", along(1, 3, 5, 3));
    expect(pipeGraph(g)).not.toBe(a);
    expect(pipeGraph(g).systems).toHaveLength(2);
  });

  for (const id of ["sewers", "ports", "singularity"] as const) {
    test(`the ${id} fixture: every pipe on it in the graph, and the old networks read off it`, () => {
      const n = FIXTURE_SIZE[id] ?? 64, g = createGrid(n, n, 1);
      applyFixture(g, id, 1);
      const gr = pipeGraph(g);
      sound(g, gr);
      expect(gr.links.length).toBeGreaterThan(0);
      // The networks the game reads are the graph's own.
      expect(findMains(g).list).toBe(gr.mains);
      expect(solveSewers(g).nets).toBe(gr.sewers);
      // A system never mixes the two fluids, and every connection on a manhole is dropped into it.
      for (const s of gr.systems) {
        const slop = s.nodes.map((k) => gr.nodes[k]).filter((x) => x.layer === "trunk" || (g.main[x.cell] & MAIN_SEWER) !== 0).length;
        expect(slop === 0 || slop === s.nodes.length).toBe(true);
      }
      const drops = gr.links.filter((l) => l.kind === "drop").length;
      expect(drops).toBe(gr.laterals.filter((l) => l.node !== null && gr.nodeAt.trunk[l.node] >= 0).length);
      // Each network's tiles are one system's.
      for (const net of gr.mains) {
        const sys = new Set(net.cells.map((c) => (gr.nodeAt.main[c] >= 0 ? gr.nodes[gr.nodeAt.main[c]].system : gr.nodes[gr.links[gr.linkAt.main[c]].a].system)));
        expect(sys.size).toBe(1);
      }
    });
  }
});
