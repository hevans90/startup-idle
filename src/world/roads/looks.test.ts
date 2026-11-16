/**
 * What each road cell has painted on it: the markings a driver reads, worked
 * out from small grids.
 */
import { describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, idx, type Grid } from "../grid";
import { buildLaneGraph } from "../agents/lanes/graph";
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

  test("a stop line across the wide road's lane coming in, set back behind the crossing, and arrows in its lanes a cell back", () => {
    const inbound = look(g, 14, 6), outbound = look(g, 14, 5);
    expect(inbound.stop).toBe("f");
    expect(inbound.arrow).toBe("");
    // Its lanes' own arrows, toward the junction, with the turns there are: both ways off at a crossroads.
    expect(look(g, 13, 6).hw).toBe("1LR");
    expect(look(g, 13, 6).arrow).toBe("");
    expect(look(g, 17, 5).hw).toBe("0LR");
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

describe("a highway", () => {
  // Four cells wide, a side road off its far kerb at x = 20, another crossing it whole at x = 40 (lights).
  const g = grid(60, 24, [
    ...[8, 9, 10, 11].flatMap((y) => row(y, 0, 59)),
    ...col(20, 12, 23),
    ...col(40, 0, 23).filter(([, y]) => y < 8 || y > 11),
  ]);

  test("its cells say how wide it is and where each is across it, and its run's ends where a junction stops it", () => {
    expect(look(g, 10, 8).ln).toBe("u4.0");
    expect(look(g, 10, 11).ln).toBe("u4.3");
    // The cell before the side road's junction: the run ends at its high end; the one after, at its low end.
    expect(look(g, 19, 9).ln).toBe("ub!4.1");
    expect(look(g, 21, 9).ln).toBe("ua!4.1");
  });

  test("it is marked on through a side road's junction, and not through one at lights", () => {
    expect(look(g, 20, 8).ln).toBe("ux4.0");
    expect(look(g, 20, 11).ln).toBe("ux4.3");
    expect(look(g, 40, 9).ln).toBe("");
  });

  test("its lanes are arrowed a cell back from a junction with the turns there are, and plainly along a run", () => {
    // Going toward +x (side 1) the side road is off to the right; going back toward it, off to the left.
    expect(look(g, 18, 9).hw).toBe("1R");
    expect(look(g, 22, 9).hw).toBe("0L");
    expect(look(g, 8, 9).hw).toBe("0P1P");
    expect(look(g, 9, 9).hw).toBe("");
  });
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
  test("three cells out of a junction there is one for each way along the road, and none elsewhere", () => {
    // A long street off a T at x = 10.
    const g = grid(40, 20, [...row(8, 0, 39), ...col(10, 9, 19)]);
    expect(look(g, 13, 8).spd).toBe("020120");
    expect(look(g, 7, 8).spd).toBe("020120");
    expect(look(g, 12, 8).spd).toBe("");
    expect(look(g, 20, 8).spd).toBe("");
    // On a road two cells wide, every cell across it says so: each way's nearside lane is in one of them.
    const w = grid(40, 20, [...row(8, 0, 39), ...row(9, 0, 39), ...col(10, 10, 19)]);
    expect(look(w, 13, 8).spd).toBe("030130");
    expect(look(w, 13, 9).spd).toBe("030130");
    // And never in the cell the lanes' arrows are in.
    expect(look(w, 12, 8).spd).toBe("");
    expect(look(w, 12, 8).hw).not.toBe("");
  });
});

describe("a wide road at a junction", () => {
  test("three cells wide at lights: a stop line across each way in, on every cell of its width, set back behind the crossing", () => {
    const g = grid(40, 24, [...[8, 9, 10].flatMap((y) => row(y, 0, 39)), ...col(20, 0, 23).filter(([, y]) => y < 8 || y > 10)]);
    for (const y of [8, 9, 10]) { expect(look(g, 19, y).hs).toBe("1Sb"); expect(look(g, 21, y).hs).toBe("0Sb"); }
    expect(look(g, 19, 9).xing).toBe("u");
  });

  test("its bend is carried round: every cell of the corner knows the road's width and the inside corner, and the run does not end there", () => {
    // Three wide along y 8-10 from x 0 to 22, then down x 20-22.
    const g = grid(40, 30, [...[8, 9, 10].flatMap((y) => row(y, 0, 22)), ...[20, 21, 22].flatMap((x) => col(x, 11, 29))]);
    // The corner is x 20-22, y 8-10; the ways out are toward x − 1 and y + 1: the inside corner is at (20, 11).
    expect(look(g, 20, 8).bd).toBe("3,0,3");
    expect(look(g, 22, 10).bd).toBe("3,-2,1");
    expect(look(g, 19, 9).ln).toBe("u!3.1");
    expect(look(g, 19, 9).hs).toBe("");
  });
});

describe("between two junctions close together", () => {
  test("a wide road has no arrows there and its middle ends plainly; a long run keeps both", () => {
    // Side roads at x = 10 and x = 13 off a two-cell road: two cells between them.
    const g = grid(40, 20, [...row(8, 0, 39), ...row(9, 0, 39), ...col(10, 10, 19), ...col(13, 10, 19)]);
    for (const x of [11, 12]) { expect(look(g, x, 8).hw).toBe(""); expect(look(g, x, 8).ln).toMatch(/^u[ab]n!2\.0$/); }
    // Out past them the road runs on: arrows a cell back from the junction, a tapered end.
    expect(look(g, 15, 8).hw).not.toBe("");
    expect(look(g, 14, 8).ln).toBe("ua!2.0");
  });
});

describe("a wide road meeting a wide road", () => {
  test("at a T the one that runs through is marked on through it, and the one that ends gives way across its whole width", () => {
    const g = grid(40, 40, [...[10, 11, 12].flatMap((y) => row(y, 0, 39)), ...[18, 19, 20].flatMap((x) => col(x, 13, 39))]);
    for (const x of [18, 19, 20]) for (const y of [10, 11, 12]) expect(look(g, x, y).ln).toBe(`ux3.${y - 10}`);
    for (const x of [18, 19, 20]) expect(look(g, x, 13).hs).toBe("2Gb");
  });
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

describe("a wide road that jogs a cell sideways", () => {
  // Two cells wide along y 8-9 to x = 20, the slice at x = 20 three cells (y 8-10), then along y 9-10.
  const g = grid(40, 20, [...row(8, 0, 20), ...row(9, 0, 39), ...row(10, 20, 39)]);

  test("is the one road all the way: two cells wide, the wider slice too, with no end at the jog", () => {
    for (const [x, y] of [[5, 8], [19, 9], [20, 8], [20, 9], [20, 10], [21, 10], [35, 9]]) expect(look(g, x, y).ln).toMatch(/^uj?!?2\./);
    // Away from the jog, as any straight road; through it, its middle slants.
    expect(look(g, 5, 8).ln).toBe("u2.0");
    expect(look(g, 35, 10).ln).toBe("u2.1");
    expect(look(g, 20, 9).ln).toMatch(/~/);
    // The wider slice, and it alone, is marked as the jog: its kerbs cut the corner.
    for (const y of [8, 9, 10]) expect(look(g, 20, y).ln).toMatch(/^uj/);
    for (const x of [19, 21]) expect(look(g, x, 9).ln).not.toMatch(/^uj/);
    // Its shoulder lines keep to the kerb: straight either side of the jog — the low edge where the cells are —
    // and across the jog's own slice from the one to the other.
    expect(look(g, 19, 9).ln).toBe("u2.1");
    expect(look(g, 20, 9).ln).toBe("uj2.0.5~-0.5,0.5^-1,0");
    expect(look(g, 21, 9).ln).toBe("u2.0");
  });

  test("its painted middle is where its lanes' middle is, slice by slice", () => {
    const G = buildLaneGraph(g), st = G.streets.find((q) => q.width === 2 && q.a1 - q.a0 > 30)!;
    expect(st).toBeDefined();
    for (let x = st.a0; x <= st.a1; x++) {
      const m = /^u[abcnj!x]*2\.(-?[\d.]+?)(?:~.*)?(?:\^.*)?$/.exec(look(g, x, 9).ln)!;
      // The cell at y = 9 is `c` across from the road's low edge; its middle one cell on: so the road's middle, in cell middles.
      const painted = 9 + 1 - Number(m[1]) - 0.5;
      expect(Math.abs(painted - st.mid[x - st.a0])).toBeLessThan(0.002);
    }
  });

  test("its lanes cross the jog in the jog's own slice, edge to edge, and nowhere else", () => {
    const G = buildLaneGraph(g), st = G.streets.find((q) => q.width === 2 && q.a1 - q.a0 > 30)!;
    expect(st.lanes.length).toBe(4);
    for (const id of st.lanes) {
      const pts = [...G.lanes[id].pts].sort((p, q) => p.x - q.x);
      // Straight to the slice's low edge, across it, straight on: four points, the middle two the jog's.
      expect(pts.length).toBe(4);
      expect(pts[1].x).toBeCloseTo(19.5, 6);
      expect(pts[2].x).toBeCloseTo(20.5, 6);
      expect(pts[0].y).toBeCloseTo(pts[1].y, 6);
      expect(pts[2].y).toBeCloseTo(pts[1].y + 1, 6);
      expect(pts[3].y).toBeCloseTo(pts[2].y, 6);
      // On the road either side: within a cell of its middle (8.5 before the jog, 9.5 after).
      expect(Math.abs(pts[1].y - 8.5)).toBeLessThan(1);
    }
  });

  // Three cells wide, and four — the widest road, whose jog's slice is wider than any road and still no junction.
  for (const k of [3, 4]) test(`a road ${k} cells wide jogs the same way: one street, its lines and its lanes through the one slice`, () => {
    const cells: [number, number][] = [];
    for (let x = 0; x < 40; x++) for (let j = 0; j <= k; j++) if (x < 20 ? j < k : x === 20 || j >= 1) cells.push([x, 8 + j]);
    const w = grid(40, 24, cells), G = buildLaneGraph(w);
    const st = G.streets.find((q) => q.width === k)!;
    expect([st.a0, st.a1]).toEqual([0, 39]);
    expect(G.streets.length).toBe(1);
    // The jog's slice, every cell of it: the road, marked as the jog, slanting a cell across.
    for (let j = 0; j <= k; j++) expect(look(w, 20, 8 + j).ln).toBe(`uj${k}.${j - 0.5}~-0.5,0.5^${-j},${1 - j}`);
    for (let j = 0; j < k; j++) { expect(look(w, 19, 8 + j).ln).toBe(`u${k}.${j}`); expect(look(w, 21, 9 + j).ln).toBe(`u${k}.${j}`); }
    // Every lane: straight, across the slice, straight; and inside the road's kerbs either side.
    expect(st.lanes.length).toBe(2 * Math.min(4, k));
    for (const id of st.lanes) {
      const pts = [...G.lanes[id].pts].sort((p, q) => p.x - q.x);
      expect(pts.map((p) => p.x)).toEqual([-0.5, 19.5, 20.5, 39.5]);
      expect(pts[1].y).toBeCloseTo(pts[0].y, 6);
      expect(pts[2].y).toBeCloseTo(pts[1].y + 1, 6);
      expect(pts[3].y).toBeCloseTo(pts[2].y, 6);
      expect(pts[1].y).toBeGreaterThan(7.5);
      expect(pts[1].y).toBeLessThan(7.5 + k);
    }
  });
});
