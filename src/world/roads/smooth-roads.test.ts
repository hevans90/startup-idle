import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { useWorldStore } from "../../state/world.store";
import { createGrid, fillTerrain, idx, setHeight, type Grid } from "../grid";
import { generateMap } from "../gen/generate-map";
import { MAX_RISE } from "../iso";
import { setGroundMode } from "../render/ground-mode";
import { gradeRoad } from "./grade";
import { connects, isPaved } from "./mask";
import { getNetwork } from "../../state/world.store";
import { isConnected } from "./network";
import { buildTraffic, routeLanes, spotsAt } from "../agents/lanes/drive";
import { roadHeightAt } from "../agents/roads";

/** ROADS ON THE CONTINUOUS SURFACE (`?ground=smooth`): no ramps, tiles a step apart joined, nothing laid moved. */
const s = () => useWorldStore.getState();
const drag = (x0: number, y0: number, x1: number, y1: number) => {
  s().setTool("paintRoad"); s().setBrush("line"); useWorldStore.setState({ notice: null });
  s().beginStroke({ x: x0, y: y0 }); s().updateStroke({ x: x1, y: y1 }); s().endStroke();
  return s().notice?.text ?? null;
};
/** Two paved neighbours that do not join, and any ramp: what a road on the surface must never have. */
const faults = (G: Grid) => {
  const out: string[] = [];
  for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) {
    if (!isPaved(G, x, y)) continue;
    if (G.ramp[idx(G, x, y)] && !G.deck[idx(G, x, y)]) out.push(`R${x},${y}`);
    if (x + 1 < G.w && isPaved(G, x + 1, y) && !connects(G, x, y, "S")) out.push(`X${x},${y}`);
    if (y + 1 < G.h && isPaved(G, x, y + 1) && !connects(G, x, y, "W")) out.push(`Y${x},${y}`);
  }
  return out;
};

describe("roads on the continuous surface", () => {
  beforeAll(() => setGroundMode("smooth"));
  afterAll(() => setGroundMode("smooth"));

  test("what drives on a road is on its drawn top: no jump anywhere across it, and a twisted tile's two triangles", () => {
    const g = createGrid(8, 8); fillTerrain(g, 1);
    const H = [[2, 3, 4, 3], [3, 2, 3, 4], [4, 3, 2, 3], [3, 4, 3, 2]];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.paved[idx(g, x + 2, y + 2)] = 1; setHeight(g, x + 2, y + 2, H[y][x]); }
    // Fine steps over the whole block, both ways: never more than the steepest fall a step that short can go.
    let most = 0;
    for (let y = 1.6; y <= 5.4; y += 0.02) for (let x = 1.6; x <= 5.4; x += 0.02) {
      most = Math.max(most, Math.abs(roadHeightAt(g, x + 0.02, y) - roadHeightAt(g, x, y)), Math.abs(roadHeightAt(g, x, y + 0.02) - roadHeightAt(g, x, y)));
    }
    expect(most).toBeLessThan(0.1);
    // The middle of a tile is on the diagonal from (0,0) to (1,1), as its top is split.
    const at = (X: number, Y: number) => roadHeightAt(g, X - 0.5, Y - 0.5);
    for (const [x, y] of [[3, 3], [4, 3], [3, 4]]) expect(roadHeightAt(g, x, y)).toBeCloseTo((at(x, y) + at(x + 1, y + 1)) / 2, 6);
  });

  test("two road tiles a step apart are joined; two steps apart, or a deck off its own level, are not", () => {
    const g = createGrid(6, 6); fillTerrain(g, 1);
    for (const x of [1, 2, 3]) g.paved[idx(g, x, 2)] = 1;
    setHeight(g, 2, 2, MAX_RISE);
    expect(connects(g, 1, 2, "S")).toBe(true);
    setHeight(g, 3, 2, MAX_RISE * 2 + 1);
    expect(connects(g, 2, 3 - 1, "S")).toBe(false);
    setGroundMode("steps");
    expect(connects(g, 1, 2, "S")).toBe(false);
    setGroundMode("smooth");
  });

  test("a road laid up a hill to a road at its foot: within a step a tile, joined, and the road below not moved", () => {
    const g = createGrid(16, 16); fillTerrain(g, 1);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) setHeight(g, x, y, Math.max(0, 10 - y));
    // A road along the foot, already there.
    for (let x = 2; x < 14; x++) { g.paved[idx(g, x, 11)] = 1; setHeight(g, x, 11, 0); }
    const before = Array.from({ length: 12 }, (_, k) => g.height[idx(g, 2 + k, 11)]);
    const path = Array.from({ length: 10 }, (_, k) => ({ x: 7, y: 10 - k }));
    const G = gradeRoad(g, path);
    expect(G.blocked).toEqual([]);
    for (let k = 1; k < path.length; k++) expect(Math.abs(G.heights[k] - G.heights[k - 1])).toBeLessThanOrEqual(MAX_RISE);
    expect(Math.abs(G.heights[0] - 0)).toBeLessThanOrEqual(MAX_RISE);
    expect(G.moved.some((m) => m.y === 11)).toBe(false);
    expect(Array.from({ length: 12 }, (_, k) => g.height[idx(g, 2 + k, 11)])).toEqual(before);
  });

  test("laid with the tool up a hill from a road: one network, a car can drive from the foot to the top, and it rides the slope", () => {
    s().resize(24, 24);
    const g = s().grid;
    fillTerrain(g, 1);
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) setHeight(g, x, y, Math.max(0, 16 - y));
    s().loadGrid(g);
    expect(drag(2, 18, 20, 18)).toBeNull();      // along the foot
    expect(drag(10, 17, 10, 6)).toBeNull();      // up the hill from it
    expect(drag(11, 6, 18, 6)).toBeNull();       // along the top
    const G = s().grid;
    expect(faults(G)).toEqual([]);
    expect(isConnected(getNetwork()!, G, { x: 3, y: 18 }, { x: 17, y: 6 })).toBe(true);
    const T = buildTraffic(G);
    const route = routeLanes(T.G, spotsAt(T, G, { x: 3, y: 18 }, null), spotsAt(T, G, { x: 17, y: 6 }, null));
    expect(route).not.toBeNull();
    // The road climbs, and what goes by it climbs with it: higher at the top than at the foot, and no jump of more
    // than a step between two points a quarter of a tile apart.
    let last = roadHeightAt(G, 10, 17), most = 0;
    for (let y = 17; y >= 6; y -= 0.25) { const z = roadHeightAt(G, 10, y); most = Math.max(most, Math.abs(z - last)); last = z; }
    expect(roadHeightAt(G, 10, 6)).toBeGreaterThan(roadHeightAt(G, 10, 17) + 4);
    expect(most).toBeLessThanOrEqual(1);
  });

  test("a cliff too tall for the run is still refused, and a longer run takes it", () => {
    const g = createGrid(16, 8); fillTerrain(g, 1);
    for (let y = 0; y < 8; y++) for (let x = 8; x < 16; x++) setHeight(g, x, y, 8);
    const short = gradeRoad(g, Array.from({ length: 3 }, (_, k) => ({ x: 7 + k, y: 3 })));
    expect(short.blocked.length).toBeGreaterThan(0);
    expect(short.short).toBeGreaterThan(0);
    expect(gradeRoad(g, Array.from({ length: 8 }, (_, k) => ({ x: 4 + k, y: 3 }))).blocked).toEqual([]);
  });

  test("strokes over generated maps lay a road that joins and has no ramp, or none", () => {
    let seed = 5;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const pick = (n: number) => Math.floor(rnd() * n);
    let strokes = 0, taken = 0, open = 0;
    const bad: string[] = [];
    for (let m = 0; m < 4; m++) {
      s().resize(64, 64);
      const g = s().grid;
      generateMap(g, { seed: 300 + m * 11, material: 1, dirt: 2, sand: 3, woods: [4, 5, 6] });
      s().loadGrid(g);
      const G = s().grid;
      // (What the generator's own roads already have is not a stroke's to answer for.)
      let had = new Set(faults(G));
      for (let k = 0; k < 40; k++) {
        const horiz = rnd() < 0.5, a = 2 + pick(60), b0 = 2 + pick(40), b1 = Math.min(61, b0 + 4 + pick(30));
        const said = horiz ? drag(b0, a, b1, a) : drag(a, b0, a, b1);
        strokes++;
        if (said) { if (/bridge/i.test(said)) open++; continue; }
        taken++;
        const now = faults(G);
        bad.push(...now.filter((f) => !had.has(f)).map((f) => `map ${m} stroke ${k}: ${f}`));
        had = new Set(now);
      }
    }
    if (bad.length) console.log(bad.slice(0, 8).join("\n"));
    expect(bad.length).toBe(0);
    expect(taken / (strokes - open)).toBeGreaterThan(0.85);
  }, 120_000);
});
