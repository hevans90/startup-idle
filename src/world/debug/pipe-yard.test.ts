/**
 * THE PIPE YARD has one of every piece a pipe is drawn with: what the look's
 * phases are judged on, so a piece that drops out of it is a piece nobody
 * looks at again. @see buildPipeYard, plans/pipe-network.md phase 9
 */
import { describe, expect, test } from "bun:test";

import { MAIN_BORE, MAIN_END, MAIN_SEWER, SEWER_FIT, SEWER_GRATE, createGrid, idx } from "../grid";
import { pipeGraph } from "../pipes/graph";
import { SEWER_KIND, solveSewers } from "../sewers/solve";
import { findMains } from "../water/mains";
import { applyFixture } from "./fixtures";

const yard = () => { const g = createGrid(48, 48); applyFixture(g, "pipeyard", 1); return g; };

describe("the pipe yard", () => {
  test("a trunk with every way a sewer is laid and every thing that stands on one", () => {
    const g = yard(), s = solveSewers(g);
    const kinds = new Set<number>(), fits = new Set<number>();
    for (let i = 0; i < g.sewer.length; i++) if (g.sewer[i] & 15) { kinds.add(s.kind[i]); if (g.sewerFit[i]) fits.add(g.sewerFit[i]); }
    expect([...kinds].sort()).toEqual([SEWER_KIND.buried, SEWER_KIND.span, SEWER_KIND.lift]);
    expect(fits.has(SEWER_FIT.node)).toBe(true);
    expect(fits.has(SEWER_FIT.outfall)).toBe(true);
    // A storm drain's grate, on a manhole.
    const grates = [...g.sewer.keys()].filter((i) => g.sewer[i] & SEWER_GRATE);
    expect(grates.length).toBe(1);
    expect(g.sewerFit[grates[0]]).toBe(SEWER_FIT.node);
    // A span with a bank at either end: where its portals go.
    const span = [...g.sewer.keys()].filter((i) => (g.sewer[i] & 15) && s.kind[i] === SEWER_KIND.span);
    expect(span.some((i) => s.kind[i - 1] !== SEWER_KIND.span && (g.sewer[i - 1] & 15))).toBe(true);
    expect(span.some((i) => s.kind[i + 1] !== SEWER_KIND.span && (g.sewer[i + 1] & 15))).toBe(true);
  });

  test("a connection from a workplace, dropping into a manhole", () => {
    const g = yard();
    const ends = new Set([...g.mainEnd].filter(Boolean));
    expect(ends.has(MAIN_END.drain)).toBe(true);
    expect(ends.has(MAIN_END.drop)).toBe(true);
    expect([...g.main].some((m) => m & MAIN_SEWER)).toBe(true);
  });

  test("a water main with a pump, an outlet at a building, a capped stub, a widened stretch and a road to cross", () => {
    const g = yard();
    const main = findMains(g).list.find((n) => !n.sewer)!;
    expect(main.intakes.length).toBe(1);
    expect(main.outlets.length).toBe(1);
    const ends = main.cells.map((i) => g.mainEnd[i]).filter(Boolean);
    expect(ends.sort()).toEqual([MAIN_END.pump, MAIN_END.outlet, MAIN_END.cap]);
    // Widened along a stretch and not the whole: a slim length at either end of it, for the reducers.
    const wide = main.cells.filter((i) => g.main[i] & MAIN_BORE);
    expect(wide.length).toBeGreaterThan(1);
    expect(wide.length).toBeLessThan(main.cells.length / 2);
    for (const i of [Math.min(...wide) - 1, Math.max(...wide) + 1]) { expect(g.main[i]).not.toBe(0); expect(g.main[i] & MAIN_BORE).toBe(0); }
    // Over a road, and over ground of more than one height: saddles here, frames there.
    expect(main.cells.some((i) => g.paved[i])).toBe(true);
    expect(new Set(main.cells.map((i) => g.height[i])).size).toBeGreaterThan(2);
    // A tee where the stub leaves it, and a bend or two.
    const graph = pipeGraph(g), nodes = graph.nodes.filter((n) => n.layer === "main" && main.cells.includes(n.cell));
    expect(nodes.some((n) => n.links.length === 3)).toBe(true);
    expect(nodes.some((n) => n.links.length === 2 && n.kind === "joint")).toBe(true);
    expect(g.main[idx(g, 23, 24 - 10)]).not.toBe(0);
  });

  test("on a map too small for it, it lays what fits and does not fall over", () => {
    const g = createGrid(16, 16);
    applyFixture(g, "pipeyard", 1);
    expect(g.minHeight).toBeLessThanOrEqual(g.maxHeight);
  });
});
