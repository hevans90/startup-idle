import { describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, idx } from "../grid";
import { streetEarnings, streetsOf } from "./streets";

/** A plus: a road along row 5 and one down column 10, crossing at (10, 5). */
function plus() {
  const g = createGrid(20, 12);
  fillTerrain(g, 1);
  for (let x = 0; x < g.w; x++) g.paved[idx(g, x, 5)] = 1;
  for (let y = 0; y < g.h; y++) g.paved[idx(g, 10, y)] = 1;
  return g;
}

describe("streets", () => {
  test("run between junctions, and a junction is on none", () => {
    const g = plus(), s = streetsOf(g);
    expect(s.of[idx(g, 10, 5)]).toBe(-1);
    expect(s.tiles.length).toBe(4);
    expect(s.of[idx(g, 0, 5)]).toBe(s.of[idx(g, 9, 5)]);
    expect(s.of[idx(g, 0, 5)]).not.toBe(s.of[idx(g, 11, 5)]);
    expect(s.of[idx(g, 0, 0)]).toBe(-1);
  });

  test("a wide road's lanes are one street, cut where another road crosses", () => {
    const g = createGrid(30, 20);
    fillTerrain(g, 1);
    // Two lanes along rows 5 and 6, and two down columns 15 and 16.
    for (let x = 0; x < g.w; x++) for (const y of [5, 6]) g.paved[idx(g, x, y)] = 1;
    for (let y = 0; y < g.h; y++) for (const x of [15, 16]) g.paved[idx(g, x, y)] = 1;
    const s = streetsOf(g);
    expect(s.of[idx(g, 2, 5)]).toBe(s.of[idx(g, 2, 6)]);
    expect(s.of[idx(g, 2, 5)]).toBe(s.of[idx(g, 12, 6)]);
    expect(s.of[idx(g, 15, 5)]).toBe(-1);
    expect(s.of[idx(g, 2, 5)]).not.toBe(s.of[idx(g, 20, 5)]);
    expect(s.tiles.length).toBe(4);
  });

  test("earn what the buildings opening onto them earn, best first, known by their biggest", () => {
    const g = plus(), s = streetsOf(g);
    const doors = new Map([[1, idx(g, 2, 5)], [2, idx(g, 4, 5)], [3, idx(g, 15, 5)], [4, idx(g, 10, 5)]]);
    const earning = new Map([[1, 5], [2, 20], [3, 10], [4, 1]]);
    const ranked = streetEarnings(g, s, doors, earning);
    expect(ranked[0]).toMatchObject({ street: s.of[idx(g, 2, 5)], perSecond: 26, best: 2 });
    // The door on the junction counts for a street it leads on to.
    expect(ranked.reduce((n, r) => n + r.perSecond, 0)).toBe(36);
  });
});
