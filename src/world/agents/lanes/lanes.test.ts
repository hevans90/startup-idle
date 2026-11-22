import { describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, idx, setHeight, setPaved, type Grid } from "../../grid";
import { generateMap } from "../../gen/generate-map";
import { FIXTURE_IDS, FIXTURE_SIZE, applyFixture } from "../../debug/fixtures";
import { SETTLE, deferLanes, forgetZones, lanesDue, lanesSettle, lanesSettling, pumpLanes } from "./graph";
import { routeLanes, waysFrom } from "./drive";
import { WALK as PAINT_WALK } from "../../render/road-paint";
import { isPaved } from "../../roads/mask";
import { buildLaneGraph, LANE_MAX, MEDIAN_HALF, PARK_STRIP, laneEdge, laneOffset, lanesFor, WALK, type LaneGraph } from "./graph";
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
  // (A lane's end on the line between two cells — the gate of a junction narrower than its street — is on the road if the cell it came by is.)
  const on = (p: { x: number; y: number }) => [-1e-6, 1e-6].some((e) => isPaved(g, c(p.x + e, g.w), c(p.y + e, g.h)));
  return G.lanes.every((l) => l.pts.every(on));
};

describe("a road's lanes, measured as a British road's", () => {
  test("no lane wider than a motorway's 3.65 m, on any road; none narrower than 2.6 m", () => {
    for (const k of [1, 2, 3, 4]) {
      const w = (laneOffset(k, 1) - laneOffset(k, 0)) || 2 * laneOffset(k, 0);
      expect(w).toBeLessThanOrEqual(LANE_MAX + 1e-9);
      expect(w / 0.09).toBeGreaterThan(2.6);
    }
  });

  test("a road with a central reservation: its lanes clear of it, and a hard strip beyond them — wider on the widest", () => {
    for (const k of [3, 4]) {
      const lane = laneOffset(k, 1) - laneOffset(k, 0);
      expect(laneOffset(k, 0) - lane / 2).toBeGreaterThan(MEDIAN_HALF);
      expect(k / 2 - WALK - laneEdge(k)).toBeGreaterThanOrEqual(PARK_STRIP - 1e-9);
      expect(lanesFor(k)).toBe(k);
    }
    // Four cells: a hard shoulder of 3.3 m or more.
    expect((2 - WALK - laneEdge(4)) / 0.09).toBeGreaterThan(3.3);
  });

  test("no bays at its kerbs: a road with a barrier down its middle is not parked on", () => {
    for (const k of [3, 4]) {
      const g = blank(30, 12);
      for (let x = 0; x < 30; x++) for (let j = 0; j < k; j++) pave(g, x, 3 + j);
      expect(buildLaneGraph(g).bays.length).toBe(0);
    }
  });
});

describe("the lane graph", () => {
  test("puts the pavement where the paint does", () => {
    expect(WALK).toBe(PAINT_WALK);
  });

  test("a road one cell wide: a lane each way, 0.12 left of the middle", () => {
    const g = blank(20, 8);
    for (let x = 0; x < 20; x++) pave(g, x, 4);
    const G = buildLaneGraph(g);
    expect(G.streets.length).toBe(1);
    expect(G.junctions.length).toBe(0);
    const [a, b] = G.streets[0].lanes.map((i) => G.lanes[i]);
    expect(laneOffset(1, 0)).toBeCloseTo(0.12, 5);
    // Heading +x, the left — the side traffic keeps to — is −y.
    const east = a.pts[1].x > a.pts[0].x ? a : b, west = east === a ? b : a;
    expect(east.pts[0].y).toBeCloseTo(3.88, 5);
    expect(west.pts[0].y).toBeCloseTo(4.12, 5);
    // Off the map both ends: where trips from beyond come and go.
    expect(east.source && east.sink && west.source && west.sink).toBe(true);
  });

  test("a road two cells wide: two lanes each way, inside a parking strip along each kerb", () => {
    const g = blank(20, 8);
    for (let x = 0; x < 20; x++) { pave(g, x, 3); pave(g, x, 4); }
    const G = buildLaneGraph(g);
    const ys = G.streets[0].lanes.map((i) => G.lanes[i].pts[0].y).sort();
    // The carriageway 0.74 each side of the middle, less 0.2 to park in: two lanes of 0.27.
    expect(ys.length).toBe(4);
    for (const [k, y] of [3.5 - 0.405, 3.5 - 0.135, 3.5 + 0.135, 3.5 + 0.405].entries()) expect(ys[k]).toBeCloseTo(y, 5);
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
    // A left turn, round the kerb, is tighter than a right across the road.
    const r = cons.find((c) => c.turn === "right")!, l = cons.find((c) => c.turn === "left")!;
    expect(l.radius!).toBeLessThan(r.radius!);
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

  test("two wide roads crossing: a roundabout, round the island on the right", () => {
    const g = cross(2, 2);
    const G = buildLaneGraph(g);
    expect(G.junctions.length).toBe(1);
    expect(G.junctions[0].kind).toBe("roundabout");
    const ring = G.lanes.filter((l) => l.kind === "ring");
    expect(ring.length).toBe(8);
    // Both lanes in onto it, and off it into the outer lane.
    expect(G.lanes.filter((l) => l.kind === "entry").length).toBe(8);
    expect(G.lanes.filter((l) => l.kind === "exit").length).toBe(4);
    // Each car coming on gives way to the ring where it joins.
    expect(G.zones.filter((z) => z.merge).length).toBeGreaterThanOrEqual(4);
    // Right of the way round is the middle: clockwise, as traffic keeping left goes.
    const C = G.junctions[0].centre;
    for (const l of ring) {
      const { p, h } = pointAt(l.pts, l.at, l.len / 2);
      const toC = { x: C.x - p.x, y: C.y - p.y };
      expect(h.x * toC.y - h.y * toC.x).toBeGreaterThan(0);
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

  test("a junction's zones kept from before a road was laid are those found afresh after it", () => {
    for (const id of ["bigtown", "streets", "traffic", "junctions", "plaza", "avenue", "roadShapes"] as const) {
      const n = FIXTURE_SIZE[id] ?? 48;
      const g = createGrid(n, n, 1);
      applyFixture(g, id, 1);
      forgetZones();
      const before = buildLaneGraph(g).zones.length;
      // A stub of road off the first kerb found with open ground beside it, and a crossroads cut through it.
      let laid = 0;
      for (let y = 2; y < n - 4 && laid < 2; y++) for (let x = 2; x < n - 4 && laid < 2; x++) {
        if (!g.paved[y * n + x] || g.paved[y * n + x + 1] || g.paved[y * n + x + 2] || g.paved[(y + 1) * n + x + 1] || g.paved[(y - 1) * n + x + 1]) continue;
        for (let k = 1; k <= 3; k++) { setHeight(g, x + k, y, g.height[y * n + x]); setPaved(g, x + k, y, 1); }
        laid++; x += 6; y += 5;
      }
      const kept = buildLaneGraph(g).zones;
      forgetZones();
      // (A copy of the map is its own map: its lanes are built, not handed back.)
      const afresh = buildLaneGraph({ ...g }).zones;
      expect({ id, laid: laid > 0, before: before >= 0, zones: kept }).toEqual({ id, laid: true, before: true, zones: afresh });
    }
  });

  test("how far to drive to each of several, found in one search, is what a search for each finds", () => {
    for (const id of ["bigtown", "streets", "traffic", "junctions"] as const) {
      const n = FIXTURE_SIZE[id] ?? 48;
      const g = createGrid(n, n, 1);
      applyFixture(g, id, 1);
      const G = buildLaneGraph(g);
      // Spots along the street lanes, a spread of them: every one from every other.
      const street = G.lanes.filter((l) => l.kind === "street" && l.len > 1);
      const spots = street.filter((_, k) => k % Math.max(1, Math.floor(street.length / 24)) === 0).map((l, k) => ({ lane: l.id, s: l.len * (0.2 + 0.6 * ((k * 7) % 10) / 10) }));
      const alone = (a: { lane: number; s: number }, b: { lane: number; s: number }) => {
        const r = routeLanes(G, [a], [b]);
        return r ? r.lanes.reduce((m, l) => m + G.lanes[l].len, 0) - r.s0 - (G.lanes[r.lanes[r.lanes.length - 1]].len - r.s1) : Infinity;
      };
      for (const a of spots) {
        const others = spots.filter((b) => b !== a);
        expect({ id, from: a.lane, far: waysFrom(G, a, others) }).toEqual({ id, from: a.lane, far: others.map((b) => alone(a, b)) });
      }
      expect(spots.length).toBeGreaterThan(3);
    }
  });

  test("a map's lanes built a little at a time are its lanes built at once, and it goes on with the old ones meanwhile", () => {
    const n = FIXTURE_SIZE.bigtown ?? 48;
    const g = createGrid(n, n, 1);
    applyFixture(g, "bigtown", 1);
    const old = buildLaneGraph(g);
    deferLanes(true);
    try {
      // A stub of road laid off the first kerb with open ground beside it.
      let laid = false;
      for (let y = 2; y < n - 4 && !laid; y++) for (let x = 2; x < n - 4 && !laid; x++) {
        if (!g.paved[y * n + x] || g.paved[y * n + x + 1] || g.paved[y * n + x + 2] || g.paved[(y + 1) * n + x + 1] || g.paved[(y - 1) * n + x + 1]) continue;
        for (let k = 1; k <= 3; k++) { setHeight(g, x + k, y, g.height[y * n + x]); setPaved(g, x + k, y, 1); }
        laid = true;
      }
      expect(laid).toBe(true);
      expect(buildLaneGraph(g)).toBe(old);
      expect(lanesDue(g)).toBe(true);
      let frames = 0;
      while (!pumpLanes(g, 0)) expect(++frames).toBeLessThan(100000);
      expect(frames).toBeGreaterThan(3);
      expect(lanesDue(g)).toBe(false);
      const soon = buildLaneGraph(g);
      expect(soon).not.toBe(old);
      // What waits on them, a frame each: counted down to nothing, a pump a frame.
      expect(lanesSettle(g)).toBe(SETTLE);
      for (let k = SETTLE - 1; k >= 0; k--) { expect(pumpLanes(g, 0)).toBe(false); expect(lanesSettle(g)).toBe(k); }
      expect(lanesSettling(g)).toBe(false);
      deferLanes(false);
      forgetZones();
      const once = buildLaneGraph({ ...g });
      expect(JSON.stringify(soon, (_k, v) => (v instanceof Map ? [...v] : v instanceof Float32Array ? [...v] : v))).toBe(JSON.stringify(once, (_k, v) => (v instanceof Map ? [...v] : v instanceof Float32Array ? [...v] : v)));
    } finally { deferLanes(false); }
  });
});
