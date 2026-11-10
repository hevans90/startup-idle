/**
 * What each road cell has painted on it: the markings a driver reads, worked
 * out from small grids.
 */
import { describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, idx, type Grid } from "../grid";
import { dressOf, keyOf, lookAt, looksOf } from "./looks";

function grid(w: number, h: number, cells: [number, number][]): Grid {
  const g = createGrid(w, h);
  fillTerrain(g, 1);
  for (const [x, y] of cells) g.paved[idx(g, x, y)] = 1;
  return g;
}
const row = (y: number, x0: number, x1: number) => Array.from({ length: x1 - x0 + 1 }, (_, k) => [x0 + k, y] as [number, number]);
const col = (x: number, y0: number, y1: number) => Array.from({ length: y1 - y0 + 1 }, (_, k) => [x, y0 + k] as [number, number]);
const look = (g: Grid, x: number, y: number) => lookAt(g, x, y)!;

describe("a one-lane road", () => {
  test("a dashed centre line down the middle, and nothing else, away from any end", () => {
    const g = grid(20, 9, row(4, 1, 18)), L = look(g, 9, 4);
    expect(L.ctr).toBe("u");
    expect(L.gw + L.stop + L.slow + L.arrow).toBe("");
    expect(L.yl).toBe(false);
    expect(look(grid(9, 20, col(4, 1, 18)), 4, 9).ctr).toBe("v");
  });

  test("off the map, nothing", () => {
    const g = grid(5, 5, row(2, 0, 4));
    expect(lookAt(g, 2, 1)).toBeNull();
  });
});

describe("a T-junction", () => {
  // The major road along row 5; the minor one comes down column 10 into it.
  const g = grid(21, 16, [...row(5, 0, 20), ...col(10, 6, 15)]);

  test("the minor road gives way where it meets the major", () => {
    const L = look(g, 10, 6);
    expect(L.gw).toBe("c");
    expect(L.ctr).toBe("V");
    expect(L.yl).toBe(true);
  });

  test("the major road runs on with a warning line and no give-way", () => {
    for (const x of [9, 11]) {
      const L = look(g, x, 5);
      expect(L.gw).toBe("");
      expect(L.ctr).toBe("U");
    }
  });

  test("the junction itself carries the major road's line through", () => {
    expect(look(g, 10, 5).ctr).toBe("U");
  });
});

describe("a bend", () => {
  // Along row 4 to column 10, then down it.
  const g = grid(16, 16, [...row(4, 1, 10), ...col(10, 5, 14)]);

  test("SLOW on each road coming up to it, no give-way", () => {
    expect(look(g, 9, 4).slow).toBe("1");
    expect(look(g, 10, 5).slow).toBe("2");
    expect(look(g, 9, 4).gw).toBe("");
  });

  test("the line bends round the corner", () => {
    expect(look(g, 10, 4).ctr).toBe("b");
  });
});

describe("a road into a square", () => {
  const sq: [number, number][] = [];
  for (let y = 2; y <= 8; y++) sq.push(...row(y, 2, 8));
  const g = grid(12, 20, [...sq, ...col(5, 9, 18)]);

  test("gives way going in, and is not told to slow down for a bend", () => {
    const L = look(g, 5, 9);
    expect(L.gw).toBe("2");
    expect(L.slow).toBe("");
  });

  test("no yellow lines round the square, and nothing on it", () => {
    for (const [x, y] of [[2, 2], [5, 2], [8, 5], [5, 5]] as const) {
      const L = look(g, x, y);
      expect(L.yl).toBe(false);
      expect(L.gw + L.stop + L.arrow + L.ctr).toBe("");
      expect(L.box).toBe(0);
    }
  });
});

describe("two-lane roads crossing: a roundabout", () => {
  // Lanes along rows 5 and 6, and down columns 15 and 16.
  const g = grid(32, 22, [
    ...row(5, 0, 31), ...row(6, 0, 31),
    ...col(15, 0, 21).filter(([, y]) => y !== 5 && y !== 6), ...col(16, 0, 21).filter(([, y]) => y !== 5 && y !== 6),
  ]);

  test("its island over the crossing, round its middle, and no yellow box", () => {
    for (const [x, y] of [[15, 5], [16, 5], [15, 6], [16, 6]] as const) {
      const L = look(g, x, y);
      expect(L.box).toBe(0);
      // The middle is the crossing's: (15.5, 5.5), in each cell's own (u, v).
      const [u, v, r] = L.rb.split(",").map(Number);
      expect(u).toBeCloseTo(15.5 - x + 0.5, 3);
      expect(v).toBeCloseTo(5.5 - y + 0.5, 3);
      expect(r).toBeGreaterThan(0.2);
    }
  });

  test("give way onto it, across the lane coming in, the one with its kerb on the right", () => {
    // Coming from x−1, heading +x: the kerb on the right is at y+1, so row 6.
    const inbound = look(g, 14, 6), outbound = look(g, 14, 5);
    expect(inbound.gw).toBe("f");
    expect(inbound.stop + inbound.arrow).toBe("");
    expect(outbound.gw + outbound.stop + outbound.arrow).toBe("");
  });

  test("lane lines: the centre on the edge the two halves share, a lane line down each", () => {
    // Along x, two cells wide; this the low cell across, and the high.
    expect(look(g, 5, 5)).toMatchObject({ ctr: "", ln: "u2.0" });
    expect(look(g, 5, 6)).toMatchObject({ ctr: "", ln: "u2.1" });
  });
});

describe("a two-lane road crossed by a one-lane one: lights", () => {
  const g = grid(32, 22, [...row(5, 0, 31), ...row(6, 0, 31), ...col(15, 0, 21).filter(([, y]) => y !== 5 && y !== 6)]);

  test("a stop line across the wide road's lane coming in, set back behind the crossing, and an arrow a cell back", () => {
    const inbound = look(g, 14, 6), outbound = look(g, 14, 5);
    expect(inbound.stop).toBe("f");
    expect(inbound.arrow).toBe("");
    expect(look(g, 13, 6).arrow.startsWith("1")).toBe(true);
    expect(look(g, 13, 5).arrow).toBe("");
    expect(inbound.gw).toBe("");
    expect(outbound.stop).toBe("");
  });

  test("and across the narrow road's, no give way", () => {
    // Coming down from y−1 toward +y: the junction is on side 3.
    expect(look(g, 15, 4).stop).toBe("d");
    expect(look(g, 15, 4).gw).toBe("");
    expect(look(g, 15, 7).stop).toBe("c");
  });
});

describe("a zebra", () => {
  const g = grid(20, 9, row(4, 1, 18));
  const dress = new Uint8Array(g.w * g.h);
  for (let x = 1; x <= 18; x++) dress[idx(g, x, 4)] = dressOf(2, x === 9);
  const ls = looksOf(g, dress);

  test("its stripes on its own cell, zigzags either side of it", () => {
    expect(ls[idx(g, 9, 4)]!.zeb).toBe("u");
    expect(ls[idx(g, 8, 4)]!.zz).toBe("u");
    expect(ls[idx(g, 10, 4)]!.zz).toBe("u");
    expect(ls[idx(g, 7, 4)]!.zz).toBe("");
  });

  test("the street's level comes through for the pavement", () => {
    expect(ls[idx(g, 5, 4)]!.lvl).toBe(2);
  });
});

describe("keys", () => {
  test("the same neighbourhood is the same key; a different look is not", () => {
    const g = grid(20, 9, row(4, 1, 18));
    const a = look(g, 6, 4), b = lookAt(g, 6, 4)!;
    expect(keyOf(a)).toBe(keyOf(b));
    expect(keyOf({ ...a, gw: "1" })).not.toBe(keyOf(a));
    expect(keyOf({ ...a, vr: (a.vr + 1) % 10 })).not.toBe(keyOf(a));
  });
});
