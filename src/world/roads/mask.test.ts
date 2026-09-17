/**
 * Connection masks. The part that has to be exactly right is the HEIGHT rule:
 * the same predicate feeds the render mask and the connectivity graph, so if it
 * is wrong a road looks joined and the graph disagrees — or worse, the reverse.
 */
import { describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, setHeight, setPaved, setRamp } from "../grid";
import { RAMP, packRamp } from "../iso";
import {
  DIAG, DIR, FLANK, OPPOSITE, connects, diagOf, edgeHeight, isPaved,
  maskAt, maskDirtyCells, orthOf,
} from "./mask";

const world = (w = 10, h = 10) => {
  const g = createGrid(w, h);
  fillTerrain(g, 1);
  return g;
};
const pave = (g: ReturnType<typeof world>, cells: [number, number][]) => {
  for (const [x, y] of cells) setPaved(g, x, y, 1);
};
const named = (m: number) =>
  (["N", "E", "S", "W"] as const).filter((d) => m & DIR[d]).join("");

describe("geometry conventions", () => {
  test("each diagonal flanks the two orthogonals it is named for", () => {
    expect(FLANK.N).toBe(DIAG.NE | DIAG.NW);
    expect(FLANK.E).toBe(DIAG.NE | DIAG.SE);
    expect(FLANK.S).toBe(DIAG.SE | DIAG.SW);
    expect(FLANK.W).toBe(DIAG.SW | DIAG.NW);
  });

  test("opposites are involutive", () => {
    for (const d of ["N", "E", "S", "W"] as const) {
      expect(OPPOSITE[OPPOSITE[d]]).toBe(d);
    }
  });

  test("orth and diag bits do not overlap", () => {
    const orth = DIR.N | DIR.E | DIR.S | DIR.W;
    const diag = DIAG.NE | DIAG.SE | DIAG.SW | DIAG.NW;
    expect(orth & diag).toBe(0);
    expect(orthOf(orth | diag)).toBe(orth);
    expect(diagOf(orth | diag)).toBe(diag);
  });
});

describe("maskAt", () => {
  test("an unpaved cell has no mask at all", () => {
    const g = world();
    expect(maskAt(g, 4, 4)).toBe(0);
    expect(isPaved(g, 4, 4)).toBe(false);
  });

  test("an isolated paved cell connects to nothing", () => {
    const g = world();
    pave(g, [[4, 4]]);
    expect(maskAt(g, 4, 4)).toBe(0);
  });

  test("a straight run reads as two opposite connections", () => {
    const g = world();
    pave(g, [[4, 2], [4, 3], [4, 4], [4, 5]]);   // varying y = E–W axis
    expect(named(orthOf(maskAt(g, 4, 3)))).toBe("EW");
  });

  test("the run along x reads as the other axis", () => {
    const g = world();
    pave(g, [[2, 4], [3, 4], [4, 4], [5, 4]]);
    expect(named(orthOf(maskAt(g, 3, 4)))).toBe("NS");
  });

  test("a bend reads as two ADJACENT connections", () => {
    const g = world();
    // an L: run along +y then turn to +x
    pave(g, [[4, 2], [4, 3], [4, 4], [5, 4], [6, 4]]);
    // came from E (y−1) and continues S (x+1) — adjacent, so a bend
    expect(orthOf(maskAt(g, 4, 4))).toBe(DIR.E | DIR.S);
  });

  test("a T reads as three, and a cross as four", () => {
    const g = world();
    pave(g, [[4, 2], [4, 3], [4, 4], [4, 5], [5, 4]]);
    expect(orthOf(maskAt(g, 4, 4))).toBe(DIR.E | DIR.S | DIR.W);
    pave(g, [[3, 4]]);
    expect(orthOf(maskAt(g, 4, 4))).toBe(DIR.N | DIR.E | DIR.S | DIR.W);
  });

  test("diagonals are reported separately from orthogonals", () => {
    const g = world();
    pave(g, [[4, 4], [3, 3]]);          // NE only, no orthogonal
    expect(orthOf(maskAt(g, 4, 4))).toBe(0);
    expect(diagOf(maskAt(g, 4, 4))).toBe(DIAG.NE);
  });

  test("a 2-wide avenue's edge cells see both diagonals behind them", () => {
    const g = world(12, 12);
    for (let y = 2; y <= 8; y++) pave(g, [[4, y], [5, y]]);
    // (4, 5): open E|S|W, missing N — the diagonals behind it are SE and SW
    expect(orthOf(maskAt(g, 4, 5))).toBe(DIR.E | DIR.S | DIR.W);
    expect(diagOf(maskAt(g, 4, 5))).toBe(DIAG.SE | DIAG.SW);
    // (5, 5): mirror image
    expect(orthOf(maskAt(g, 5, 5))).toBe(DIR.N | DIR.E | DIR.W);
    expect(diagOf(maskAt(g, 5, 5))).toBe(DIAG.NE | DIAG.NW);
  });
});

describe("height participates", () => {
  test("a road running off a plateau edge is a DEAD END, not a straight", () => {
    const g = world();
    pave(g, [[2, 4], [3, 4], [4, 4], [5, 4]]);
    setHeight(g, 4, 4, 4);
    setHeight(g, 5, 4, 4);   // the plateau
    // (3,4) at height 0 looks onto (4,4) at height 4 — not joined
    expect(connects(g, 3, 4, "S")).toBe(false);
    expect(orthOf(maskAt(g, 3, 4))).toBe(DIR.N);
  });

  test("a diagonal across a step does not count either", () => {
    const g = world();
    pave(g, [[4, 4], [3, 3]]);
    setHeight(g, 3, 3, 2);
    expect(diagOf(maskAt(g, 4, 4))).toBe(0);
  });

  test("equal heights connect at any elevation", () => {
    const g = world();
    pave(g, [[3, 4], [4, 4]]);
    setHeight(g, 3, 4, 8);
    setHeight(g, 4, 4, 8);
    expect(connects(g, 3, 4, "S")).toBe(true);
  });
});

describe("ramps bridge a step", () => {
  test("edgeHeight reaches base + rise toward the named edge only", () => {
    const g = world();
    setHeight(g, 4, 4, 2);
    setRamp(g, 4, 4, packRamp(RAMP.S, 2) as never);
    expect(edgeHeight(g, 4, 4, "S")).toBe(4);   // the high edge
    expect(edgeHeight(g, 4, 4, "N")).toBe(2);   // the low edge
    expect(edgeHeight(g, 4, 4, "E")).toBe(2);
  });

  test("a ramp joins the cell below it to the cell above it", () => {
    const g = world();
    // (4,4) is a ramp rising toward S (x+1) from 0 to 2; (5,4) is the plateau
    pave(g, [[3, 4], [4, 4], [5, 4]]);
    setRamp(g, 4, 4, packRamp(RAMP.S, 2) as never);
    setHeight(g, 5, 4, 2);

    expect(connects(g, 4, 4, "S")).toBe(true);    // up onto the plateau
    expect(connects(g, 4, 4, "N")).toBe(true);    // down to the flat
    expect(orthOf(maskAt(g, 4, 4))).toBe(DIR.N | DIR.S);
  });

  test("a HALF-step ramp joins a half-step rise, and not a full one", () => {
    const g = world();
    pave(g, [[4, 4], [5, 4]]);
    setRamp(g, 4, 4, packRamp(RAMP.S, 1) as never);
    setHeight(g, 5, 4, 1);
    expect(connects(g, 4, 4, "S")).toBe(true);
    setHeight(g, 5, 4, 2);
    expect(connects(g, 4, 4, "S")).toBe(false);
  });

  test("a ramp pointing the WRONG way does not bridge", () => {
    const g = world();
    pave(g, [[4, 4], [5, 4]]);
    setRamp(g, 4, 4, packRamp(RAMP.N, 2) as never);   // rises away from (5,4)
    setHeight(g, 5, 4, 2);
    expect(connects(g, 4, 4, "S")).toBe(false);
  });

  test("two ramps meeting nose to nose join at their shared high edge", () => {
    const g = world();
    pave(g, [[4, 4], [5, 4]]);
    setRamp(g, 4, 4, packRamp(RAMP.S, 2) as never);   // (4,4) rises toward (5,4)
    setRamp(g, 5, 4, packRamp(RAMP.N, 2) as never);   // (5,4) rises toward (4,4)
    expect(connects(g, 4, 4, "S")).toBe(true);
  });
});

describe("maskDirtyCells", () => {
  test("covers the cell and all eight neighbours", () => {
    const g = world();
    expect(maskDirtyCells(g, 4, 4)).toHaveLength(9);
  });

  test("clips at the map edge", () => {
    const g = world();
    expect(maskDirtyCells(g, 0, 0)).toHaveLength(4);
  });
});
