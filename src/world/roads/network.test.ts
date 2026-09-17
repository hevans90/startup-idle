/**
 * Road connectivity.
 *
 * The bug this class of system always has is a network that LOOKS joined but is
 * two components, so the tests are mostly about the boundary cases where a join
 * is visual only: a step, a ramp pointing the wrong way, a diagonal-only touch.
 */
import { describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, setHeight, setPaved, setRamp } from "../grid";
import { RAMP, packRamp } from "../iso";
import {
  applyEdit, cellsAdjacentToNet, componentCount, componentSize,
  createNetwork, isConnected, netIdAt, rebuild,
} from "./network";

const world = (w = 12, h = 12) => {
  const g = createGrid(w, h);
  fillTerrain(g, 1);
  return g;
};
const pave = (g: ReturnType<typeof world>, cells: [number, number][]) => {
  for (const [x, y] of cells) setPaved(g, x, y, 1);
};
const run = (g: ReturnType<typeof world>, x: number, y0: number, y1: number) => {
  for (let y = y0; y <= y1; y++) setPaved(g, x, y, 1);
};

describe("basics", () => {
  test("unpaved cells have no component", () => {
    const g = world();
    const net = createNetwork(g);
    expect(netIdAt(net, g, 4, 4)).toBe(-1);
    expect(componentCount(net)).toBe(0);
  });

  test("a straight run is ONE component of the right size", () => {
    const g = world();
    run(g, 4, 2, 8);
    const net = createNetwork(g);
    expect(componentCount(net)).toBe(1);
    expect(componentSize(net, netIdAt(net, g, 4, 5))).toBe(7);
    expect(isConnected(net, g, { x: 4, y: 2 }, { x: 4, y: 8 })).toBe(true);
  });

  test("two separate runs are two components", () => {
    const g = world();
    run(g, 4, 2, 5);
    run(g, 8, 2, 5);
    const net = createNetwork(g);
    expect(componentCount(net)).toBe(2);
    expect(isConnected(net, g, { x: 4, y: 2 }, { x: 8, y: 2 })).toBe(false);
  });

  test("cells touching only DIAGONALLY are not connected", () => {
    const g = world();
    pave(g, [[4, 4], [5, 5]]);
    const net = createNetwork(g);
    expect(componentCount(net)).toBe(2);
  });

  test("an L-bend is one component", () => {
    const g = world();
    run(g, 4, 2, 5);
    pave(g, [[5, 5], [6, 5]]);
    const net = createNetwork(g);
    expect(componentCount(net)).toBe(1);
    expect(isConnected(net, g, { x: 4, y: 2 }, { x: 6, y: 5 })).toBe(true);
  });
});

describe("height and ramps", () => {
  test("a step SPLITS a road that looks continuous", () => {
    const g = world();
    run(g, 4, 2, 8);
    for (let y = 6; y <= 8; y++) setHeight(g, 4, y, 4);
    const net = createNetwork(g);
    expect(componentCount(net)).toBe(2);
    expect(isConnected(net, g, { x: 4, y: 2 }, { x: 4, y: 8 })).toBe(false);
  });

  test("a ramp REJOINS it — one component, not two", () => {
    const g = world();
    run(g, 4, 2, 8);
    for (let y = 6; y <= 8; y++) setHeight(g, 4, y, 2);
    // (4,5) ramps up toward W (y+1), which is where the plateau starts
    setRamp(g, 4, 5, packRamp(RAMP.W, 2) as never);
    const net = createNetwork(g);
    expect(componentCount(net)).toBe(1);
    expect(isConnected(net, g, { x: 4, y: 2 }, { x: 4, y: 8 })).toBe(true);
  });

  test("a ramp facing the wrong way strands ITSELF as well", () => {
    const g = world();
    run(g, 4, 2, 8);
    for (let y = 6; y <= 8; y++) setHeight(g, 4, y, 2);
    setRamp(g, 4, 5, packRamp(RAMP.E, 2) as never);   // rises away from the plateau
    const net = createNetwork(g);
    // Its high edge faces the FLAT side and its low edge the plateau, so it
    // matches neither: three components, with the ramp its own island. Worth
    // pinning — a backwards ramp is a more visible failure than a missing one.
    expect(componentCount(net)).toBe(3);
    expect(componentSize(net, netIdAt(net, g, 4, 5))).toBe(1);
  });

  test("a ramp of the wrong RISE leaves it split", () => {
    const g = world();
    run(g, 4, 2, 8);
    for (let y = 6; y <= 8; y++) setHeight(g, 4, y, 2);
    setRamp(g, 4, 5, packRamp(RAMP.W, 1) as never);   // half step onto a full one
    expect(componentCount(createNetwork(g))).toBe(2);
  });
});

describe("incremental edits", () => {
  test("painting a cell that bridges two runs merges them", () => {
    const g = world();
    run(g, 4, 2, 4);
    run(g, 4, 6, 8);
    const net = createNetwork(g);
    expect(componentCount(net)).toBe(2);

    setPaved(g, 4, 5, 1);
    applyEdit(net, g, [{ x: 4, y: 5 }], false);
    expect(componentCount(net)).toBe(1);
    expect(isConnected(net, g, { x: 4, y: 2 }, { x: 4, y: 8 })).toBe(true);
  });

  test("ERASING a cell splits the component — the case union-find cannot undo", () => {
    const g = world();
    run(g, 4, 2, 8);
    const net = createNetwork(g);
    expect(componentCount(net)).toBe(1);

    setPaved(g, 4, 5, 0);
    applyEdit(net, g, [{ x: 4, y: 5 }], true);
    expect(componentCount(net)).toBe(2);
    expect(isConnected(net, g, { x: 4, y: 2 }, { x: 4, y: 8 })).toBe(false);
  });

  test("a HEIGHT edit can sever a join without touching `paved` at all", () => {
    const g = world();
    run(g, 4, 2, 8);
    const net = createNetwork(g);
    expect(componentCount(net)).toBe(1);

    setHeight(g, 4, 5, 4);
    applyEdit(net, g, [{ x: 4, y: 5 }], true);
    // the raised cell is its own island now
    expect(componentCount(net)).toBe(3);
    expect(componentSize(net, netIdAt(net, g, 4, 5))).toBe(1);
  });

  test("an incremental paint agrees with a full rebuild", () => {
    const g = world(16, 16);
    const net = createNetwork(g);
    const painted: { x: number; y: number }[] = [];
    // a deliberately awkward shape: two arms that only meet at the end
    for (let y = 2; y <= 10; y++) painted.push({ x: 3, y });
    for (let x = 3; x <= 10; x++) painted.push({ x, y: 10 });
    for (let y = 2; y <= 10; y++) painted.push({ x: 10, y });
    for (const c of painted) {
      setPaved(g, c.x, c.y, 1);
      applyEdit(net, g, [c], false);
    }
    const fresh = createNetwork(g);
    expect(componentCount(net)).toBe(componentCount(fresh));
    expect(componentCount(net)).toBe(1);
  });

  test("rebuild is idempotent", () => {
    const g = world();
    run(g, 4, 2, 8);
    const net = createNetwork(g);
    const before = componentCount(net);
    rebuild(net, g);
    rebuild(net, g);
    expect(componentCount(net)).toBe(before);
  });
});

describe("cellsAdjacentToNet", () => {
  test("lists the unpaved cells a network touches, deduplicated", () => {
    const g = world();
    pave(g, [[4, 4]]);
    const net = createNetwork(g);
    const id = netIdAt(net, g, 4, 4);
    const adj = cellsAdjacentToNet(net, g, id);
    expect(adj).toHaveLength(4);
    expect(adj.every((c) => g.paved[c.y * g.w + c.x] === 0)).toBe(true);
  });

  test("does not include cells of the network itself", () => {
    const g = world();
    run(g, 4, 2, 8);
    const net = createNetwork(g);
    const id = netIdAt(net, g, 4, 5);
    for (const c of cellsAdjacentToNet(net, g, id)) {
      expect(netIdAt(net, g, c.x, c.y)).toBe(-1);
    }
  });

  test("only reports the component asked for", () => {
    const g = world();
    run(g, 3, 2, 4);
    run(g, 9, 2, 4);
    const net = createNetwork(g);
    const a = cellsAdjacentToNet(net, g, netIdAt(net, g, 3, 3));
    expect(a.every((c) => Math.abs(c.x - 3) <= 1)).toBe(true);
  });
});
