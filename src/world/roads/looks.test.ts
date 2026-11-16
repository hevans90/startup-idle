/**
 * What each road cell has painted on it: the markings a driver reads, worked
 * out from small grids.
 */
import { describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, idx, type Grid } from "../grid";
import { buildLaneGraph, jogSpread } from "../agents/lanes/graph";
import { PLAIN, VARIANTS, WORN, dressOf, keyOf, lookAt, looksOf, rightOf, variantOf } from "./looks";

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


});

describe("a two-lane road crossed by a one-lane one: lights", () => {
  const g = grid(32, 22, [...row(5, 0, 31), ...row(6, 0, 31), ...col(15, 0, 21).filter(([, y]) => y !== 5 && y !== 6)]);


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

describe("a highway", () => {
  // Four cells wide, a side road off its far kerb at x = 20, another crossing it whole at x = 40 (lights).
  const g = grid(60, 24, [
    ...[8, 9, 10, 11].flatMap((y) => row(y, 0, 59)),
    ...col(20, 12, 23),
    ...col(40, 0, 23).filter(([, y]) => y < 8 || y > 11),
  ]);



});

describe("a road tile's variant", () => {
  test("a fitting or wear keeps its own; plain road is one of four, so most of a road shares a handful of textures", () => {
    for (let d = 0; d < WORN; d++) expect(variantOf(d)).toBe(d);
    const plain = new Set(Array.from({ length: VARIANTS - WORN }, (_, k) => variantOf(WORN + k)));
    expect(plain.size).toBe(4);
    for (const v of plain) expect(v).toBeGreaterThanOrEqual(PLAIN);
  });
});

describe("speed roundels", () => {
});

describe("a wide road at a junction", () => {

});

describe("between two junctions close together", () => {
});

describe("a wide road meeting a wide road", () => {
});

describe("the paint and the traffic agree", () => {
  test("a lane's arrows are painted on the side of the road its traffic drives on, whichever way the road runs", () => {
    for (const k of [2, 3, 4]) for (const axis of ["x", "y"] as const) {
      const cells = axis === "x" ? Array.from({ length: k }, (_, c) => row(10 + c, 0, 29)).flat() : Array.from({ length: k }, (_, c) => col(10 + c, 0, 29)).flat();
      const g = grid(30, 30, cells), G = buildLaneGraph(g), mid = 10 + (k - 1) / 2;
      const street = G.lanes.filter((l) => l.kind === "street");
      expect(street.length).toBe(2 * Math.min(4, k));
      for (const l of street) {
        const a = l.pts[0], b = l.pts[l.pts.length - 1];
        const h: [number, number] = axis === "x" ? [Math.sign(b.x - a.x), 0] : [0, Math.sign(b.y - a.y)];
        const [rx, ry] = rightOf(h[0], h[1]);
        // Where the painter puts that way's lanes: right of the road's middle. Where the lane is: the same side.
        const off = axis === "x" ? a.y - mid : a.x - mid;
        expect(Math.sign(off)).toBe(axis === "x" ? ry : rx);
      }
    }
  });
});

describe("a wide road ending at another: the head of a T", () => {
  // Three cells wide along y 10-12, into a two-cell road down x 30-31.
  const cells: [number, number][] = [...col(30, 0, 23), ...col(31, 0, 23)];
  for (let x = 0; x < 30; x++) for (const y of [10, 11, 12]) cells.push([x, y]);
  const g = grid(40, 24, cells);

});

describe("a wide road that jogs a cell sideways", () => {
  // Two cells wide along y 8-9 to x = 20, the slice at x = 20 three cells (y 8-10), then along y 9-10.
  const g = grid(40, 20, [...row(8, 0, 20), ...row(9, 0, 39), ...row(10, 20, 39)]);



  test("its lanes cross the jog over a cell's length each, a little along from its slice by how far out they are, and keep their distance", () => {
    const G = buildLaneGraph(g), st = G.streets.find((q) => q.width === 2 && q.a1 - q.a0 > 30)!;
    expect(st.lanes.length).toBe(4);
    const slants: number[] = [];
    for (const id of st.lanes) {
      const pts = [...G.lanes[id].pts].sort((p, q) => p.x - q.x);
      // Straight, across, straight on: four points, the middle two the jog's — a cell apart along, about the slice.
      expect(pts.length).toBe(4);
      expect(pts[2].x - pts[1].x).toBeCloseTo(1, 6);
      expect(pts[1].x).toBeCloseTo(19.5 + (pts[1].y - 8.5) * (1 - jogSpread(2)), 6);
      // Where its slant crosses x = 20, across the road.
      slants.push(pts[1].y + (20 - pts[1].x));
      expect(pts[0].y).toBeCloseTo(pts[1].y, 6);
      expect(pts[2].y).toBeCloseTo(pts[1].y + 1, 6);
      expect(pts[3].y).toBeCloseTo(pts[2].y, 6);
      // On the road either side: within a cell of its middle (8.5 before the jog, 9.5 after).
      expect(Math.abs(pts[1].y - 8.5)).toBeLessThan(1);
    }
    // Through the slant, each lane as far from the next as on the straight, measured square across it.
    slants.sort((p, q) => p - q);
    for (let i = 1; i < slants.length; i++) expect((slants[i] - slants[i - 1]) * Math.SQRT1_2).toBeGreaterThan(0.26);
  });

});
