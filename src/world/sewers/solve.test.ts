import { describe, expect, test } from "bun:test";

import { DIR } from "../../iso/dir";
import { SEWER_FIT, createGrid, idx, type Grid } from "../grid";
import { COVER, DEEPEST, GRADE, SEWER_KIND, SEWER_RATE, SPAN_MOST, solveSewers } from "./solve";

/**
 * A straight sewer along y = 0 from x = 0 to `heights.length − 1`, over
 * ground of those heights, its exit (an outfall) at x = 0 and a node at the
 * far end.
 */
function line(heights: number[]): Grid {
  const g = createGrid(heights.length, 3);
  heights.forEach((h, x) => { for (let y = 0; y < 3; y++) g.height[idx(g, x, y)] = h; });
  for (let x = 0; x < heights.length; x++) {
    // Along x: N is x−1, S is x+1.
    g.sewer[idx(g, x, 0)] = (x > 0 ? DIR.N : 0) | (x < heights.length - 1 ? DIR.S : 0);
  }
  g.sewerFit[idx(g, 0, 0)] = SEWER_FIT.outfall;
  g.sewerFit[idx(g, heights.length - 1, 0)] = SEWER_FIT.node;
  g.rev++;
  return g;
}
const at = (g: Grid, x: number) => idx(g, x, 0);

describe("an underground sewer", () => {
  test("on flat ground lies a cover deep and falls toward its exit", () => {
    const g = line([2, 2, 2, 2, 2, 2]);
    const s = solveSewers(g);
    for (let x = 1; x < 6; x++) {
      expect(s.down[at(g, x)]).toBe(at(g, x - 1));
      expect(s.level[at(g, x)] - s.level[at(g, x - 1)]).toBeGreaterThanOrEqual(GRADE - 1e-6);
      expect(s.kind[at(g, x)]).toBe(SEWER_KIND.buried);
    }
    // As near the ground as it can be at its top end.
    expect(s.level[at(g, 5)]).toBeCloseTo(2 - COVER);
    expect(s.capacity[at(g, 3)]).toBeCloseTo(SEWER_RATE);
    expect(s.problems).toEqual([]);
  });

  test("down a slope it follows the ground, and carries more for falling faster", () => {
    const g = line([0, 1, 2, 3, 4]);
    const s = solveSewers(g);
    for (let x = 0; x < 5; x++) expect(s.level[at(g, x)]).toBeCloseTo(x - COVER);
    expect(s.capacity[at(g, 2)]).toBeGreaterThan(SEWER_RATE);
  });

  test("across a valley it comes up on a span and dives again", () => {
    const g = line([3, 3, 0, 0, 3, 3]);
    const s = solveSewers(g);
    expect(s.kind[at(g, 2)]).toBe(SEWER_KIND.span);
    expect(s.kind[at(g, 3)]).toBe(SEWER_KIND.span);
    expect(s.kind[at(g, 4)]).toBe(SEWER_KIND.buried);
    // A span keeps falling, at the least grade.
    expect(s.level[at(g, 3)] - s.level[at(g, 2)]).toBeCloseTo(GRADE);
    expect(s.problems).toEqual([]);
  });

  test("over a river: the bed is a valley like any other", () => {
    const g = line([2, 2, -2, -2, -2, 2, 2]);
    const s = solveSewers(g);
    for (const x of [2, 3, 4]) expect(s.kind[at(g, x)]).toBe(SEWER_KIND.span);
  });

  test("a valley wider than a span may be: it spans what it may, dives under the rest, and is lifted out", () => {
    const g = line([3, ...Array(SPAN_MOST + 2).fill(0), 3]);
    const s = solveSewers(g);
    const kinds = Array.from({ length: SPAN_MOST + 4 }, (_, x) => s.kind[at(g, x)]);
    expect(kinds.filter((k) => k === SEWER_KIND.span).length).toBeLessThanOrEqual(SPAN_MOST);
    expect(kinds).toContain(SEWER_KIND.lift);
    expect(s.problems).toEqual([]);
  });

  test("over a hill too high to dig through, slop from beyond it is lifted", () => {
    // From a basin at 2, over a hill of 9, down to the exit at 2.
    const g = line([2, 9, 9, 2, 2]);
    const s = solveSewers(g);
    const kinds = [0, 1, 2, 3, 4].map((x) => s.kind[at(g, x)]);
    expect(kinds).toContain(SEWER_KIND.lift);
    for (let x = 0; x < 5; x++) {
      if (s.kind[at(g, x)] === SEWER_KIND.span) continue;
      expect(g.height[at(g, x)] - s.level[at(g, x)]).toBeLessThanOrEqual(DEEPEST + 1e-6);
    }
  });

  test("a low hill it digs through rather than lift", () => {
    const g = line([2, 4, 4, 2, 2]);
    const s = solveSewers(g);
    expect([0, 1, 2, 3, 4].map((x) => s.kind[at(g, x)])).toEqual([0, 0, 0, 0, 0]);
  });

  test("off a cliff edge toward its exit it falls steeply, buried", () => {
    const g = line([0, 0, 6, 6, 6]);
    const s = solveSewers(g);
    expect(s.kind.slice(at(g, 0), at(g, 5))).toEqual(new Uint8Array(5));
    expect(s.capacity[at(g, 2)]).toBeGreaterThan(SEWER_RATE * 2);
  });

  test("with no exit, it drains nowhere", () => {
    const g = line([2, 2, 2]);
    g.sewerFit[at(g, 0)] = 0;
    g.rev++;
    const s = solveSewers(g);
    expect([0, 1, 2].every((x) => s.drains[at(g, x)] === 0)).toBe(true);
    expect(s.nets).toHaveLength(1);
    expect(s.nets[0].exits).toEqual([]);
  });

  test("a node in a valley keeps the pipe in the ground there: a manhole needs ground", () => {
    const g = line([3, 3, 0, 0, 3, 3]);
    g.sewerFit[at(g, 2)] = SEWER_FIT.node;
    g.rev++;
    const s = solveSewers(g);
    expect(s.kind[at(g, 2)]).not.toBe(SEWER_KIND.span);
    expect(s.problems).toEqual([]);
  });

  test("kept till the map changes", () => {
    const g = line([2, 2, 2]);
    expect(solveSewers(g)).toBe(solveSewers(g));
    g.rev++;
    expect(solveSewers(g)).not.toBe(solveSewers({ ...g, rev: g.rev - 1 }));
  });
});
