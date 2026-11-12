/**
 * EVERY PIPE AT A GLANCE. The plan's guard: the list's rows equal the
 * networks' reports. And: trouble sorts to the top; a tank that will run dry
 * inside a minute and a sewer nearly at what it carries show amber before
 * they fail; what has gone wrong is a fault for the town's problems, and a
 * pipe not finished is not. @see overview, plans/pipe-network.md phase 16
 */
import { afterEach, describe, expect, test } from "bun:test";

import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx, setHeight, type Grid } from "../grid";
import { resetCooling, stepCooling, tankFor } from "../projects/cooling";
import { overlayLine } from "../render/mains-layer";
import { stepSewers, type SewerHooks } from "../sewers/flow";
import { planLateral, planSewer, routeSewer } from "../sewers/lay";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { createWaterField, setWaterEdge, stepWater, type WaterField } from "../water/field";
import { layMain, planMain, runMains } from "../water/mains";
import { DRY_WITHIN, NEARLY_FULL, pipeFaults, pipeRows } from "./overview";
import { pipeReports } from "./reports";

afterEach(resetCooling);

const wetOf = (g: Grid) => (x: number, y: number) => g.pool[idx(g, x, y)] > 0;
/** A lake on a bank and a Data Centre twenty tiles off, a main between; `water` false, the lake is empty. */
function watered(water = true): { g: Grid; f: WaterField; dc: number } {
  const g = createGrid(32, 12);
  fillTerrain(g, 1);
  for (let y = 0; y < 12; y++) for (let x = 0; x < 32; x++) setHeight(g, x, y, x <= 3 ? -1 : x === 4 ? 7 : 0);
  for (let y = 0; y < 12; y++) for (let x = 0; x <= 3; x++) g.pool[idx(g, x, y)] = 6;
  commit(g, createHistory(), placeCommand(g, { ...structureDef("datacentre")!, placement: undefined }, 22, 2)!);
  const dc = [...g.structures.values()].find((s) => s.def === "datacentre")!.id;
  const plan = planMain(g, Array.from({ length: 20 }, (_, k) => ({ x: 4 + k, y: 5 })), wetOf(g), false);
  if ("refused" in plan) throw new Error(plan.refused);
  layMain(g, plan.cells);
  if (!water) { g.pool.fill(0); g.rev++; }
  const f = createWaterField(g);
  setWaterEdge(f, false);
  stepCooling(g, 0, false, 0);
  return { g, f, dc };
}
const frames = (g: Grid, f: WaterField, n: number) => { for (let k = 0; k < n; k++) { runMains(f, g, 1 / 60); stepWater(f, 1 / 60); } };

describe("the pipe list", () => {
  test("a row for every network's report, saying what the report says", () => {
    const { g, f, dc } = watered();
    // And a second main, a stub going nowhere.
    const stub = planMain(g, [0, 1, 2].map((k) => ({ x: 10, y: 8 + k })), wetOf(g), false);
    if ("refused" in stub) throw new Error(stub.refused);
    layMain(g, stub.cells);
    tankFor(dc)!.capacity = 1e9;
    frames(g, f, 60 * 8);
    const rows = pipeRows(g), reports = pipeReports(g);
    expect(rows.length).toBe(reports.length);
    expect(rows.length).toBe(2);
    for (const rep of reports) {
      const row = rows.find((r) => r.cell === rep.cell && r.kind === rep.kind)!;
      expect(row.state).toBe(rep.report.state);
      expect(row.flow).toBe(rep.report.flow);
      expect(row.capacity).toBe(rep.report.capacity);
      expect(row.share).toBeCloseTo(rep.report.capacity > 0 ? Math.min(1, rep.report.flow / rep.report.capacity) : 0, 6);
    }
    // What it joins, in plain words.
    expect(rows.find((r) => r.state === "flowing")!.joins).toBe("Water → Data Centre");
    expect(rows.find((r) => r.state !== "flowing")!.joins).toBe("No water → nothing");
  }, 20_000);

  test("trouble sorts to the top", () => {
    const { g, f, dc } = watered();
    const stub = planMain(g, [0, 1, 2].map((k) => ({ x: 10, y: 8 + k })), wetOf(g), false);
    if ("refused" in stub) throw new Error(stub.refused);
    layMain(g, stub.cells);
    tankFor(dc)!.capacity = 1e9;
    frames(g, f, 60 * 4);
    const rows = pipeRows(g);
    expect(rows[0].tone).toBe("bad");
    expect(rows[rows.length - 1].tone).toBe("good");
  }, 20_000);
});

describe("warned of before it fails", () => {
  test("a tank that will run dry inside a minute at its present rate: amber, with the time", () => {
    const { g, f, dc } = watered();
    const t = tankFor(dc)!;
    t.capacity = 1e9;
    frames(g, f, 60 * 8);
    const flow = pipeRows(g)[0].flow;
    expect(flow).toBeGreaterThan(0.5);
    // Drinking a little faster than the main brings it, with a few seconds' worth left.
    t.demand = flow + 0.1; t.level = 2;
    const row = pipeRows(g)[0];
    expect(row.tone).toBe("warn");
    expect(row.warning).toBe("A tank it feeds runs dry in 0:20");
    expect(row.fault).toBe(false);
    // With plenty in it, or the main keeping up, nothing is said.
    t.level = (flow + 0.1 - flow) * DRY_WITHIN * 2 + 100;
    expect(pipeRows(g)[0].warning).toBeNull();
    t.level = 2; t.demand = flow * 0.5;
    expect(pipeRows(g)[0].tone).toBe("good");
  }, 20_000);

  test("a sewer nearly at what it carries: amber before it comes up in the street", () => {
    const g = createGrid(24, 14);
    fillTerrain(g, 1);
    for (let y = 0; y < 14; y++) for (let x = 0; x < 24; x++) setHeight(g, x, y, x <= 3 ? -2 : 2);
    for (let y = 0; y < 14; y++) for (let x = 0; x <= 3; x++) g.pool[idx(g, x, y)] = 4;
    commit(g, createHistory(), placeCommand(g, { ...structureDef("office-vibe")!, placement: undefined }, 10, 3)!);
    const a = [...g.structures.values()].find((s) => s.def === "office-vibe")!;
    const p = planSewer(g, routeSewer(g, { x: 3, y: 6 }, { x: 12, y: 6 }, wetOf(g))!, wetOf(g), { unit: 1, liftPrice: 1 });
    if ("refused" in p) throw new Error(p.refused);
    for (const c of p.cells) { const i = idx(g, c.x, c.y); g.sewer[i] = p.staged.sewer[i]; g.sewerFit[i] = p.staged.sewerFit[i]; }
    g.rev++;
    const lat = planLateral(g, [{ x: 12, y: 4 }, { x: 12, y: 5 }, { x: 12, y: 6 }], wetOf(g));
    if ("refused" in lat) throw new Error(lat.refused);
    layMain(g, lat.cells, true);
    const f = createWaterField(g);
    const hooks: SewerHooks = { pay: () => true, room: () => 0, take: () => {}, release: () => {}, backedUp: null };
    // A trickle: nothing to say. Then all its connection can send it: nearly full.
    const tank = { level: 0.2 };
    runMains(f, g, 1 / 30);
    for (let k = 0; k < 20; k++) { tank.level = 0.004; stepSewers(g, new Map([[a.id, tank]]), 1 / 30, hooks); }
    const trunk = () => pipeRows(g).find((r) => r.kind === "trunk")!;
    expect(trunk().warning).toBeNull();
    expect(trunk().joins).toBe("1 workplace → water");
    for (let k = 0; k < 6; k++) { tank.level = 100; stepSewers(g, new Map([[a.id, tank]]), 1 / 30, hooks); }
    expect(trunk().state).toBe("flowing");
    expect(trunk().share).toBeGreaterThan(NEARLY_FULL);
    expect(trunk().tone).toBe("warn");
    expect(trunk().warning).toBe("Nearly at what it carries");
  });
});

describe("pipe faults, for the town's problems", () => {
  test("a main whose water has gone is one; a pipe not finished is not", () => {
    const { g, f } = watered(false);
    const stub = planMain(g, [0, 1, 2].map((k) => ({ x: 10, y: 8 + k })), wetOf(g), false);
    if ("refused" in stub) throw new Error(stub.refused);
    layMain(g, stub.cells);
    frames(g, f, 5);
    const rows = pipeRows(g);
    expect(rows.map((r) => r.state).sort()).toEqual(["dry", "no-source"]);
    const faults = pipeFaults(g);
    expect(faults.length).toBe(1);
    expect(faults[0].state).toBe("dry");
    expect(faults[0].title).toBe("Dry intake");
    expect(faults[0].joins).toBe("Water → Data Centre");
  });

  test("a main that works is none", () => {
    const { g, f, dc } = watered();
    tankFor(dc)!.capacity = 1e9;
    frames(g, f, 60 * 4);
    expect(pipeFaults(g)).toEqual([]);
  }, 20_000);
});

describe("the view's line, not by colour alone", () => {
  test("whole while it works, broken where it needs help, dots where it has stopped", () => {
    expect(overlayLine("flowing")).toBe("whole");
    expect(overlayLine("full")).toBe("whole");
    expect(overlayLine("no-head")).toBe("broken");
    expect(overlayLine("unpaid")).toBe("broken");
    for (const s of ["dry", "burst", "backed-up", "no-source", "no-outlet"] as const) expect(overlayLine(s)).toBe("dots");
    expect(overlayLine(undefined)).toBe("whole");
  });
});
