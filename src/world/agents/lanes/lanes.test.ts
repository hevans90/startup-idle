import { describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, idx, type Grid } from "../../grid";
import { generateMap } from "../../gen/generate-map";
import { FIXTURE_IDS, FIXTURE_SIZE, applyFixture } from "../../debug/fixtures";
import { WALK as PAINT_WALK } from "../../render/road-paint";
import { isPaved } from "../../roads/mask";
import { buildLaneGraph, laneOffset, WALK, type LaneGraph } from "./graph";
import { pointAt } from "./geometry";

const pave = (g: Grid, x: number, y: number) => { g.paved[idx(g, x, y)] = 1; };
const blank = (w = 24, h = 24) => { const g = createGrid(w, h); fillTerrain(g, 1); return g; };
/** Roads `k` wide along rows from `y` and down columns from `x`, edge to edge. */
function cross(kx: number, ky: number, w = 24, h = 24, at = 10) {
  const g = blank(w, h);
  for (let x = 0; x < w; x++) for (let j = 0; j < kx; j++) pave(g, x, at + j);
  for (let y = 0; y < h; y++) for (let j = 0; j < ky; j++) pave(g, at + j, y);
  return g;
}

/** Every lane reachable from a lane, along `next`. */
function reach(G: LaneGraph, from: number): Set<number> {
  const seen = new Set([from]), q = [from];
  while (q.length) for (const n of G.lanes[q.pop()!].next) if (!seen.has(n)) { seen.add(n); q.push(n); }
  return seen;
}

/** The pavement's pieces, walking only `ok` stretches. */
function pieces(G: LaneGraph, ok: (e: LaneGraph["walk"]["edges"][number]) => boolean): number {
  const { nodes, edges, adj } = G.walk;
  const seen = new Int32Array(nodes.length).fill(-1);
  let n = 0;
  for (let s = 0; s < nodes.length; s++) {
    if (seen[s] >= 0 || !adj[s].length) continue;
    const q = [s];
    seen[s] = n;
    while (q.length) {
      const a = q.pop()!;
      for (const k of adj[a]) {
        if (!ok(edges[k])) continue;
        const b = edges[k].a === a ? edges[k].b : edges[k].a;
        if (seen[b] < 0) { seen[b] = n; q.push(b); }
      }
    }
    n++;
  }
  return n;
}

/** Every point of every curve and lane is on the road. */
const onRoad = (g: Grid, G: LaneGraph) => {
  const c = (v: number, n: number) => Math.min(n - 1, Math.max(0, Math.round(v)));
  return G.lanes.every((l) => l.pts.every((p) => isPaved(g, c(p.x, g.w), c(p.y, g.h))));
};

describe("the lane graph", () => {
  test("puts the pavement where the paint does", () => {
    expect(WALK).toBe(PAINT_WALK);
  });

  test("a road one cell wide: a lane each way, 0.12 right of the middle", () => {
    const g = blank(20, 8);
    for (let x = 0; x < 20; x++) pave(g, x, 4);
    const G = buildLaneGraph(g);
    expect(G.streets.length).toBe(1);
    expect(G.junctions.length).toBe(0);
    const [a, b] = G.streets[0].lanes.map((i) => G.lanes[i]);
    expect(laneOffset(1, 0)).toBeCloseTo(0.12, 5);
    // Heading +x, the right is +y.
    const east = a.pts[1].x > a.pts[0].x ? a : b, west = east === a ? b : a;
    expect(east.pts[0].y).toBeCloseTo(4.12, 5);
    expect(west.pts[0].y).toBeCloseTo(3.88, 5);
    // Off the map both ends: where trips from beyond come and go.
    expect(east.source && east.sink && west.source && west.sink).toBe(true);
  });

  test("a road two cells wide: a lane a cell, in the middle of its carriageway", () => {
    const g = blank(20, 8);
    for (let x = 0; x < 20; x++) { pave(g, x, 3); pave(g, x, 4); }
    const G = buildLaneGraph(g);
    const ys = G.streets[0].lanes.map((i) => G.lanes[i].pts[0].y).sort();
    expect(ys[0]).toBeCloseTo(3.13, 5);
    expect(ys[1]).toBeCloseTo(4 - 0.13, 5);
  });

  test("a crossroads of one-cell roads gives way, with every turn and no U-turn", () => {
    const G = buildLaneGraph(cross(1, 1));
    expect(G.junctions.length).toBe(1);
    const J = G.junctions[0];
    expect(J.kind).toBe("priority");
    expect(J.arms.length).toBe(4);
    expect(J.arms.filter((a) => a.major).length).toBe(2);
    const cons = G.lanes.filter((l) => l.kind === "connector");
    expect(cons.length).toBe(12);
    expect(cons.filter((c) => c.turn === "left").length).toBe(4);
    expect(cons.filter((c) => c.turn === "right").length).toBe(4);
    // Straight across meets straight across, and a left turn the way ahead.
    expect(G.zones.length).toBeGreaterThan(8);
    // A right turn is tighter than a left.
    const r = cons.find((c) => c.turn === "right")!, l = cons.find((c) => c.turn === "left")!;
    expect(r.radius!).toBeLessThan(l.radius!);
  });

  test("a T: the road through is the main road", () => {
    const g = blank(24, 24);
    for (let x = 0; x < 24; x++) pave(g, x, 10);
    for (let y = 10; y < 24; y++) pave(g, 12, y);
    const G = buildLaneGraph(g);
    const J = G.junctions[0];
    expect(J.kind).toBe("priority");
    const major = J.arms.filter((a) => a.major);
    expect(major.length).toBe(2);
    for (const a of major) expect(Math.abs(a.out.y)).toBe(0);
  });

  test("two wide roads crossing: a roundabout, round the island on the left", () => {
    const g = cross(2, 2);
    const G = buildLaneGraph(g);
    expect(G.junctions.length).toBe(1);
    expect(G.junctions[0].kind).toBe("roundabout");
    const ring = G.lanes.filter((l) => l.kind === "ring");
    expect(ring.length).toBe(8);
    expect(G.lanes.filter((l) => l.kind === "entry").length).toBe(4);
    expect(G.lanes.filter((l) => l.kind === "exit").length).toBe(4);
    // Each car coming on gives way to the ring where it joins.
    expect(G.zones.filter((z) => z.merge).length).toBeGreaterThanOrEqual(4);
    // Left of the way round is the middle.
    const C = G.junctions[0].centre;
    for (const l of ring) {
      const { p, h } = pointAt(l.pts, l.at, l.len / 2);
      const toC = { x: C.x - p.x, y: C.y - p.y };
      expect(h.x * toC.y - h.y * toC.x).toBeLessThan(0);
    }
    expect(onRoad(g, G)).toBe(true);
  });

  test("a wide road crossed by a narrow one: lights", () => {
    const g = blank(24, 24);
    for (let x = 0; x < 24; x++) { pave(g, x, 10); pave(g, x, 11); }
    for (let y = 0; y < 24; y++) pave(g, 12, y);
    expect(buildLaneGraph(g).junctions.map((j) => j.kind)).toEqual(["signals"]);
  });

  test("a bend: round it both ways, and the pavement runs round with no crossing", () => {
    const g = blank(20, 20);
    for (let x = 0; x <= 10; x++) pave(g, x, 10);
    for (let y = 10; y < 20; y++) pave(g, 10, y);
    const G = buildLaneGraph(g);
    expect(G.junctions[0].kind).toBe("bend");
    expect(G.lanes.filter((l) => l.kind === "connector").length).toBe(2);
    expect(G.crossings.filter((c) => c.junction >= 0).length).toBe(0);
    // One pavement each side of the road, crossed along each leg.
    expect(pieces(G, (e) => e.crossing === undefined)).toBe(2);
    expect(G.crossings.length).toBe(2);
  });

  test("a crossing goes over the middle of a slice, kerb to kerb, and a long street is crossed along it", () => {
    const g = blank(30, 8);
    for (let x = 0; x < 30; x++) pave(g, x, 4);
    const G = buildLaneGraph(g);
    expect(G.crossings.map((c) => [G.walk.nodes[c.a].x, G.walk.nodes[c.b].x])).toEqual([[5, 5], [15, 15], [25, 25]]);
    for (const c of G.crossings) expect(Math.abs(G.walk.nodes[c.a].y - G.walk.nodes[c.b].y)).toBeCloseTo(1 - WALK, 5);
    expect(pieces(G, () => true)).toBe(1);
  });

  test("a dead end turns round", () => {
    const g = blank(20, 8);
    for (let x = 0; x < 12; x++) pave(g, x, 4);
    const G = buildLaneGraph(g);
    const u = G.lanes.filter((l) => l.turn === "uturn");
    expect(u.length).toBe(1);
    expect(onRoad(g, G)).toBe(true);
    // In from the map's edge, round, and back off it.
    const into = G.lanes.find((l) => l.kind === "street" && l.source)!;
    expect([...reach(G, into.id)].some((i) => G.lanes[i].sink)).toBe(true);
  });

  test("crossings join the blocks: four pieces of pavement without them, one with", () => {
    const G = buildLaneGraph(cross(1, 1));
    expect(G.crossings.filter((c) => c.junction >= 0).length).toBe(4);
    expect(pieces(G, (e) => e.crossing === undefined)).toBe(4);
    expect(pieces(G, () => true)).toBe(1);
  });

  test("on a generated town, everything stays on the road and every way in has a way out", () => {
    for (const seed of [7, 99, 1234]) {
      const g = createGrid(64, 64);
      generateMap(g, { seed, material: 1, dirt: 2, sand: 3, woods: [4, 5, 6] });
      const G = buildLaneGraph(g);
      expect(onRoad(g, G)).toBe(true);
      expect(G.walk.nodes.every((p) => isPaved(g, Math.round(p.x), Math.round(p.y)))).toBe(true);
      const sources = G.lanes.filter((l) => l.source);
      for (const s of sources) {
        const r = reach(G, s.id);
        expect([...r].some((i) => G.lanes[i].sink)).toBe(true);
      }
      // Every lane leads on somewhere, unless it leaves the map.
      for (const l of G.lanes) if (!l.sink) expect(l.next.length).toBeGreaterThan(0);
    }
  });

  test("on every fixture: lanes on the road, every lane leads on, every junction has a way in", () => {
    for (const id of FIXTURE_IDS) {
      const n = FIXTURE_SIZE[id] ?? 48;
      const g = createGrid(n, n, 1);
      applyFixture(g, id, 1);
      const G = buildLaneGraph(g);
      expect({ id, on: onRoad(g, G) }).toEqual({ id, on: true });
      for (const l of G.lanes) if (!l.sink) expect({ id, lane: l.id, next: l.next.length > 0 }).toEqual({ id, lane: l.id, next: true });
      for (const J of G.junctions) expect({ id, j: J.id, arms: J.arms.length > 0 }).toEqual({ id, j: J.id, arms: true });
    }
  });
});
