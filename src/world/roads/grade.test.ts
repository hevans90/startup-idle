import { describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, idx, setHeight, setPaved, type Grid } from "../grid";
import { useWorldStore } from "../../state/world.store";
import { rampDir } from "../iso";
import { getNetwork } from "../../state/world.store";
import { isConnected } from "./network";
import { gradeRoad } from "./grade";

const flat = (w = 16, h = 8) => { const g = createGrid(w, h); fillTerrain(g, 1); return g; };
const row = (y: number, x0: number, x1: number) => Array.from({ length: x1 - x0 + 1 }, (_, k) => ({ x: x0 + k, y }));
/** A cliff across the map: everything from `x` on, `z` half steps up. */
const cliff = (g: Grid, x: number, z: number) => { for (let y = 0; y < g.h; y++) for (let xx = x; xx < g.w; xx++) setHeight(g, xx, y, z); };
const steps = (h: number[]) => h.slice(1).map((v, k) => v - h[k]);

describe("a road grades its own ground", () => {
  test("level ground, and ground that already climbs a step a tile, are left alone", () => {
    const g = flat();
    expect(gradeRoad(g, row(2, 1, 10)).moved).toEqual([]);
    for (let x = 5; x < 16; x++) for (let y = 0; y < 8; y++) setHeight(g, x, y, Math.min(6, (x - 4) * 2));
    expect(gradeRoad(g, row(2, 1, 12)).moved).toEqual([]);
  });

  test("a cliff becomes a flight of ramps, cut into the hill and filled below it, never more than a step a tile", () => {
    const g = flat();
    cliff(g, 8, 6);
    const G = gradeRoad(g, row(3, 2, 13));
    expect(G.blocked).toEqual([]);
    expect(G.heights[0]).toBe(0);
    expect(G.heights[G.heights.length - 1]).toBe(6);
    for (const d of steps(G.heights)) { expect(d).toBeGreaterThanOrEqual(0); expect(d).toBeLessThanOrEqual(2); }
    // Both sides of the cliff move: some cells up, some down.
    expect(G.moved.some((m) => m.to > m.from)).toBe(true);
    expect(G.moved.some((m) => m.to < m.from)).toBe(true);
  });

  test("its two ends stay where the ground is, and so does a road already there", () => {
    const g = flat();
    cliff(g, 8, 6);
    setPaved(g, 7, 3, 1);
    const G = gradeRoad(g, row(3, 2, 13));
    expect(G.heights[5]).toBe(0);
    expect(G.moved.every((m) => !(m.x === 7 && m.y === 3) && m.x !== 2 && m.x !== 13)).toBe(true);
  });

  test("a climb too steep for its run is refused, with how many more tiles it needs", () => {
    const g = flat();
    cliff(g, 8, 8);
    const G = gradeRoad(g, row(3, 7, 9));
    expect(G.blocked.length).toBe(3);
    expect(G.short).toBe(2);
    expect(G.moved).toEqual([]);
    // Dragged far enough, it goes.
    expect(gradeRoad(g, row(3, 5, 10)).blocked).toEqual([]);
  });

  test("a dip one cell long is filled: a ramp tilts one way", () => {
    const g = flat();
    for (let x = 0; x < 16; x++) for (let y = 0; y < 8; y++) setHeight(g, x, y, 4);
    for (let y = 0; y < 8; y++) setHeight(g, 6, y, 0);
    const G = gradeRoad(g, row(3, 2, 10));
    for (let k = 1; k + 1 < G.heights.length; k++) expect(G.heights[k] < G.heights[k - 1] && G.heights[k] < G.heights[k + 1]).toBe(false);
  });

  test("a lane laid beside a graded one takes its heights, so a wide road climbs together", () => {
    const g = flat();
    cliff(g, 8, 6);
    // Ragged ground beside it, that alone would grade differently.
    setHeight(g, 6, 4, 3);
    const first = gradeRoad(g, row(3, 2, 13));
    first.moved.forEach((m) => setHeight(g, m.x, m.y, m.to));
    row(3, 2, 13).forEach((c) => setPaved(g, c.x, c.y, 1));
    const second = gradeRoad(g, row(4, 2, 13));
    expect(second.heights).toEqual(first.heights);
  });
});

describe("the road tool on a hill", () => {
  const s = () => useWorldStore.getState();
  const lay = (x0: number, y0: number, x1: number, y1: number) => {
    s().setTool("paintRoad"); s().setBrush("line");
    s().beginStroke({ x: x0, y: y0 }); s().updateStroke({ x: x1, y: y1 }); s().endStroke();
  };

  test("dragged up a cliff, it is one road: ramps every tile of the climb, joined end to end, and one undo takes it all back", () => {
    s().resize(16, 8);
    const g = s().grid;
    cliff(g, 8, 6);
    const before = Array.from(g.height);
    lay(2, 3, 13, 3);
    const net = getNetwork()!;
    expect(isConnected(net, g, { x: 2, y: 3 }, { x: 13, y: 3 })).toBe(true);
    let ramps = 0;
    for (let x = 2; x <= 13; x++) if (rampDir(g.ramp[idx(g, x, 3)])) ramps++;
    expect(ramps).toBeGreaterThanOrEqual(3);
    s().doUndo();
    expect(Array.from(g.height)).toEqual(before);
    expect(g.paved[idx(g, 5, 3)]).toBe(0);
  });

  test("a half step carries a road now", () => {
    s().resize(12, 6);
    const g = s().grid;
    cliff(g, 6, 1);
    lay(2, 2, 9, 2);
    const net = getNetwork()!;
    expect(isConnected(net, g, { x: 2, y: 2 }, { x: 9, y: 2 })).toBe(true);
  });

  test("a road joined to the side of a ramp levels it: the junction is flat, and both roads are one", () => {
    s().resize(16, 12);
    const g = s().grid;
    cliff(g, 8, 2);
    lay(2, 5, 13, 5);
    // The ramp is the last low cell, (7,5). A side road down to it.
    expect(rampDir(g.ramp[idx(g, 7, 5)])).not.toBe(0);
    lay(7, 10, 7, 5);
    expect(rampDir(g.ramp[idx(g, 7, 5)])).toBe(0);
    const net = getNetwork()!;
    expect(isConnected(net, g, { x: 7, y: 10 }, { x: 2, y: 5 })).toBe(true);
    expect(isConnected(net, g, { x: 7, y: 10 }, { x: 13, y: 5 })).toBe(true);
    expect(s().netComponents).toBe(1);
  });

  test("a road begun beside another joins it at its height, whatever the ground there", () => {
    s().resize(16, 12);
    const g = s().grid;
    lay(2, 5, 13, 5);
    // A bank a step up along one side of it.
    for (let x = 0; x < 16; x++) for (let y = 6; y < 12; y++) setHeight(g, x, y, 2);
    lay(6, 6, 6, 10);
    expect(isConnected(getNetwork()!, g, { x: 6, y: 10 }, { x: 2, y: 5 })).toBe(true);
  });

  test("a wide road's ramp is levelled across all its lanes for a junction", () => {
    s().resize(18, 14);
    const g = s().grid;
    cliff(g, 8, 2);
    for (const y of [4, 5, 6]) lay(2, y, 15, y);
    lay(7, 11, 7, 6);
    for (const y of [4, 5, 6]) expect(rampDir(g.ramp[idx(g, 7, y)])).toBe(0);
    expect(s().netComponents).toBe(1);
    expect(isConnected(getNetwork()!, g, { x: 7, y: 11 }, { x: 15, y: 4 })).toBe(true);
  });

  test("too short a drag up too tall a cliff lays nothing, and says why", () => {
    s().resize(16, 8);
    const g = s().grid;
    cliff(g, 8, 8);
    lay(7, 3, 9, 3);
    expect(g.paved[idx(g, 8, 3)]).toBe(0);
    expect(s().notice?.text).toContain("Too steep");
  });
});
