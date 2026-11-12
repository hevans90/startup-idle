/**
 * WHAT THE TUBES ARE TOLD, and the one way the pipes are run: the water in a
 * main at a tile as the solver holds it (`mainLiveAt`), every network's
 * report in one list (`pipeReports`), and one frame of all of them
 * (`stepPipes`). @see plans/pipe-network.md §5
 */
import { afterEach, describe, expect, test } from "bun:test";

import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx, setHeight, type Grid } from "../grid";
import { pipeGraph } from "../pipes/graph";
import { pipeReports } from "../pipes/reports";
import { stepPipes } from "../pipes/tick";
import { resetCooling, stepCooling, tankFor } from "../projects/cooling";
import { tanksOf } from "../slop/tanks";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { createWaterField, setWaterEdge, stepWater, type WaterField } from "./field";
import { layMain, mainLiveAt, mainReportsFor, planMain, runMains } from "./mains";

afterEach(resetCooling);

const RUN = 20, Y = 5;
/** A lake on a bank, a Data Centre twenty tiles off, and no main yet. @see mains-capacity.test */
function yard(): { g: Grid; f: WaterField; dc: number; lay: () => void } {
  const g = createGrid(RUN + 12, 12);
  fillTerrain(g, 1);
  for (let y = 0; y < 12; y++) for (let x = 0; x < g.w; x++) setHeight(g, x, y, x <= 3 ? -1 : x === 4 ? 7 : 0);
  for (let y = 0; y < 12; y++) for (let x = 0; x <= 3; x++) g.pool[idx(g, x, y)] = 6;
  commit(g, createHistory(), placeCommand(g, { ...structureDef("datacentre")!, placement: undefined }, 4 + RUN - 2, 2)!);
  const dc = [...g.structures.values()].find((s) => s.def === "datacentre")!.id;
  const f = createWaterField(g);
  setWaterEdge(f, false);
  stepCooling(g, 0, false, 0);
  const lay = () => {
    const plan = planMain(g, Array.from({ length: RUN }, (_, k) => ({ x: 4 + k, y: Y })), (x, y) => g.pool[idx(g, x, y)] > 0, false);
    if ("refused" in plan) throw new Error(plan.refused);
    layMain(g, plan.cells);
  };
  return { g, f, dc, lay };
}
const frames = (g: Grid, f: WaterField, n: number) => { for (let k = 0; k < n; k++) { runMains(f, g, 1 / 60); stepWater(f, 1 / 60); } };
const at = (g: Grid, x: number) => mainLiveAt(g, idx(g, x, Y));

describe("the water in a main, a tile at a time", () => {
  test("nothing is said of a tile with no solved main on it", () => {
    const { g, f, lay } = yard();
    lay();
    expect(at(g, 10)).toBeNull();
    frames(g, f, 1);
    expect(at(g, 10)).not.toBeNull();
    expect(mainLiveAt(g, idx(g, 10, Y + 3))).toBeNull();
  });

  test("a main laid on a map already running starts empty and fills from its intake", () => {
    const { g, f, dc, lay } = yard();
    frames(g, f, 2);
    lay();
    tankFor(dc)!.capacity = 1e9;
    frames(g, f, 20);
    const near = at(g, 6)!, far = at(g, 20)!;
    expect(near.fill).toBeGreaterThan(far.fill);
    expect(far.fill).toBeLessThan(0.5);
    // Running away from the lake: east, along the run.
    expect(near.flow).toBeGreaterThan(0);
    expect(near.dir).toEqual([1, 0]);
    frames(g, f, 60 * 6);
    expect(at(g, 20)!.fill).toBeGreaterThan(0.95);
  });

  test("flowing, every tile of the run carries what the main delivers, node or not", () => {
    const { g, f, dc, lay } = yard();
    lay();
    const t = tankFor(dc)!;
    for (let k = 0; k < 60 * 12; k++) { t.capacity = 1e9; t.level = 0; runMains(f, g, 1 / 60); stepWater(f, 1 / 60); }
    const report = [...mainReportsFor(g).values()][0], graph = pipeGraph(g);
    expect(report.flow).toBeGreaterThan(0.5);
    for (let x = 6; x < 4 + RUN - 2; x++) {
      const live = at(g, x)!;
      expect(live.fill).toBeGreaterThan(0.95);
      expect(live.flow / report.flow).toBeCloseTo(1, 1);
      expect(live.dir).toEqual([1, 0]);
    }
    // Both kinds of tile were asked: the graph's nodes, and the runs between them.
    const kinds = new Set(Array.from({ length: RUN - 4 }, (_, k) => graph.nodeAt.main[idx(g, 6 + k, Y)] >= 0));
    expect(kinds.size).toBe(2);
  }, 20_000);

  test("a tank full, the water stands in the pipe: full, and going nowhere", () => {
    const { g, f, dc, lay } = yard();
    lay();
    const t = tankFor(dc)!;
    t.capacity = 1; t.level = 1;
    // Its water rocks in it a little for ever; evened out, that is nothing — under what a window shows as moving.
    frames(g, f, 60 * 12);
    for (let k = 0; k < 4; k++) {
      frames(g, f, 30);
      const live = at(g, 12)!;
      expect(live.fill).toBeGreaterThan(0.95);
      expect(live.flow).toBeLessThan(0.04);
    }
  });
});

describe("every pipe, one call and one list", () => {
  /** A lake down the west edge, a vibe office, its connection to the lake. @see slop/tanks.test */
  function street() {
    const g = createGrid(24, 14);
    fillTerrain(g, 1);
    for (let y = 0; y < 14; y++) for (let x = 0; x < 24; x++) setHeight(g, x, y, x <= 3 ? -2 : 2);
    for (let y = 0; y < 14; y++) for (let x = 0; x <= 3; x++) g.pool[idx(g, x, y)] = 4;
    commit(g, createHistory(), placeCommand(g, { ...structureDef("office-vibe")!, placement: undefined }, 10, 3)!);
    const a = [...g.structures.values()].find((s) => s.def === "office-vibe")!;
    const cells = [...Array.from({ length: 9 }, (_, k) => ({ x: 4 + k, y: 6 })), { x: 12, y: 5 }, { x: 12, y: 4 }];
    const p = planMain(g, cells, (x, y) => g.pool[idx(g, x, y)] > 0, false, true);
    if ("refused" in p) throw new Error(p.refused);
    layMain(g, p.cells, true);
    return { g, a, f: createWaterField(g) };
  }

  test("one frame runs the mains and then the slop: a tank is made into and drained down its connection", () => {
    const { g, a, f } = street();
    const desks = new Map([[a.id, { used: 1 }]]);
    for (let k = 0; k < 200; k++) stepPipes(g, f, 1, { slop: { desks, perCoder: 0.5 } });
    const t = tanksOf(g).get(a.id)!;
    expect(t.rate).toBe(0.5);
    expect(t.spilling).toBe(false);
    expect(t.level).toBeLessThan(1);
    const rows = pipeReports(g);
    expect(rows.map((r) => r.kind)).toEqual(["connection"]);
    expect(rows[0].report.state).toBe("flowing");
    expect(rows[0].report.flow).toBeCloseTo(0.5, 2);
  });

  test("with no slop handed in, none is made or moved", () => {
    const { g, a, f } = street();
    for (let k = 0; k < 20; k++) stepPipes(g, f, 1);
    expect(tanksOf(g).get(a.id)).toBeUndefined();
    expect(pipeReports(g)[0].report.flow).toBe(0);
  });

  test("a water main and a connection on one map are both in the list, each with a tile of its own", () => {
    const { g, f } = street();
    const p = planMain(g, Array.from({ length: 6 }, (_, k) => ({ x: 4 + k, y: 11 })), (x, y) => g.pool[idx(g, x, y)] > 0, false);
    if ("refused" in p) throw new Error(p.refused);
    layMain(g, p.cells);
    stepPipes(g, f, 1 / 60);
    const rows = pipeReports(g);
    expect(rows.map((r) => r.kind).sort()).toEqual(["connection", "main"]);
    for (const r of rows) expect(r.layer).toBe("main");
    expect(new Set(rows.map((r) => r.cell)).size).toBe(2);
  });
});
