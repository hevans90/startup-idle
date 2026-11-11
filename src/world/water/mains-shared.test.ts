/**
 * TODAY'S FAULTS IN THE MAINS, PINNED (plans/pipe-network.md, phase 0): what
 * `solveMain` does now where a network is more than one intake, one run and
 * one outlet. Each test states the fault as it stands; the link-and-node
 * solver of phase 2 is to turn each one round, and these are then rewritten
 * to say what is right. The single-outlet numbers are the calibration and
 * are pinned elsewhere. @see mains-capacity.test
 */
import { afterEach, describe, expect, test } from "bun:test";

import { mainFlow } from "../../game/mains";
import { commit, createHistory } from "../edit/commands";
import { createGrid, edited, fillTerrain, idx, setHeight, type Grid } from "../grid";
import { allTanks, resetCooling, stepCooling } from "../projects/cooling";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { createWaterField, setWaterEdge, stepWater } from "./field";
import { totalWater } from "../../fluid/columns";
import { findMains, layMain, mainFillAt, mainReports, planMain, runMains, setPipeSolver, solveMain, waterInMains } from "./mains";
import { createPipeNets, findPipeNets } from "./pipe-net";
import { runPipes } from "./pipes";

afterEach(resetCooling);

const RUN = 20, RISE = 5;
/** A lake held `RISE` over the ground, its bank at x = 4, and a main from it along y = 5 to a Data Centre `RUN` tiles on. */
function yard(): { g: Grid; dcX: number } {
  const g = createGrid(RUN + 14, 14);
  fillTerrain(g, 1);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) setHeight(g, x, y, x <= 3 ? RISE - 6 : x === 4 ? RISE + 2 : 0);
  for (let y = 0; y < g.h; y++) for (let x = 0; x <= 3; x++) g.pool[idx(g, x, y)] = 6;
  const dcX = 4 + RUN;
  building(g, dcX - 2, 2);
  lay(g, Array.from({ length: RUN }, (_, k) => ({ x: 4 + k, y: 5 })));
  return { g, dcX };
}
const building = (g: Grid, x: number, y: number) =>
  commit(g, createHistory(), placeCommand(g, { ...structureDef("datacentre")!, placement: undefined }, x, y)!);
function lay(g: Grid, cells: { x: number; y: number }[]) {
  const plan = planMain(g, cells, (x, y) => g.pool[idx(g, x, y)] > 0);
  if ("refused" in plan) throw new Error(plan.refused);
  layMain(g, plan.cells);
}
const line = (x0: number, y0: number, x1: number, y1: number) => {
  const out: { x: number; y: number }[] = [];
  for (let x = x0, y = y0; ; x += Math.sign(x1 - x0), y += Math.sign(y1 - y0)) { out.push({ x, y }); if (x === x1 && y === y1) break; }
  return out;
};
function solved(g: Grid) {
  const f = createWaterField(g);
  setWaterEdge(f, false);
  stepCooling(g, 0, false, 0);
  const { list } = findMains(g);
  expect(list).toHaveLength(1);
  return solveMain(g, f, list[0]);
}

describe("today's faults in the mains, pinned", () => {
  test("the one run, one outlet main is the sum it was calibrated as", () => {
    const { g } = yard();
    const r = solved(g);
    expect(r.outlets).toHaveLength(1);
    expect(r.capacity).toBeCloseTo(mainFlow(r.head, RUN), 9);
    expect(r.head).toBeGreaterThan(0);
  });

  test("FAULT 1 — a shared trunk carries one pipe's worth to EACH outlet: two outlets, about twice the water", () => {
    const one = solved(yard().g);
    const { g, dcX } = yard();
    // A second Data Centre below the run, fed by a branch off the trunk four tiles short of the first.
    building(g, dcX - 2, 6);
    lay(g, [...line(dcX - 5, 5, dcX - 5, 9), ...line(dcX - 4, 9, dcX + 1, 9), ...line(dcX + 1, 8, dcX + 1, 7)]);
    const two = solved(g);
    expect(two.outlets.filter((o) => o.building >= 0)).toHaveLength(2);
    // Each outlet is handed the full flow of the head over the whole network's length, and they are summed.
    expect(two.capacity).toBeCloseTo(2 * mainFlow(two.head, two.length), 9);
    // The same single pipe out of the lake, and it brings well over one pipe's worth.
    expect(two.capacity).toBeGreaterThan(1.5 * one.capacity);
  });

  test("FAULT 2 — length is the whole network: a dead-end stub slows the outlet it is not on the way to", () => {
    const one = solved(yard().g);
    const { g } = yard();
    // Ten tiles of capped stub off the middle of the run, going nowhere.
    lay(g, line(12, 5, 12, 13).slice(0, 9));
    const stubbed = solved(g);
    expect(stubbed.length).toBe(one.length + 8);
    expect(stubbed.outlets).toHaveLength(1);
    expect(stubbed.capacity).toBeLessThan(one.capacity * 0.9);
  });

  test("FAULT 2 — and a near outlet is as slow as a far one", () => {
    const { g, dcX } = yard();
    building(g, dcX - 2, 6);
    lay(g, [...line(dcX - 5, 5, dcX - 5, 9), ...line(dcX - 4, 9, dcX + 1, 9), ...line(dcX + 1, 8, dcX + 1, 7)]);
    const r = solved(g);
    const [a, b] = r.outlets;
    // The first is 20 tiles from the lake and the second 30; both are given the same.
    expect(a.capacity).toBeCloseTo(b.capacity, 9);
  });
});

describe("the same maps, solved as flow (the switch on)", () => {
  /** Run a yard for `seconds`, its tanks emptied every frame; water a second into each Data Centre over the last half, and the field. */
  function played(g: Grid, seconds: number, f = createWaterField(g)) {
    setWaterEdge(f, false);
    stepCooling(g, 0, false, 0);
    const got = new Map<number, number>();
    const frames = seconds * 60;
    for (let n = 0; n < frames; n++) {
      for (const t of allTanks().values()) { t.capacity = 1e9; t.level = 0; }
      runMains(f, g, 1 / 60);
      // The lake keeps its level: left alone, the one column an intake draws from is drunk dry.
      stepWater(f, 1 / 60);
      if (n >= frames / 2) for (const [id, t] of allTanks()) got.set(id, (got.get(id) ?? 0) + t.level);
    }
    return { f, each: [...got.values()].map((v) => v / (seconds / 2)), report: [...mainReports().values()][0] };
  }
  const branch = (g: Grid, dcX: number) => {
    building(g, dcX - 2, 6);
    lay(g, [...line(dcX - 5, 5, dcX - 5, 9), ...line(dcX - 4, 9, dcX + 1, 9), ...line(dcX + 1, 8, dcX + 1, 7)]);
  };
  const on = <T>(run: () => T): T => { setPipeSolver(true); try { return run(); } finally { setPipeSolver(false); } };

  test("a shared trunk's water is shared: a second Data Centre brings more than one's and well under twice", () => on(() => {
    const one = played(yard().g, 6);
    resetCooling();
    const { g, dcX } = yard();
    branch(g, dcX);
    const two = played(g, 6);
    const sum = two.each.reduce((n, v) => n + v, 0);
    expect(two.each).toHaveLength(2);
    expect(sum).toBeGreaterThan(one.each[0] * 1.05);
    expect(sum).toBeLessThan(one.each[0] * 1.5);
    // The card's number is the steady flow, and what arrives is within a twentieth of it.
    expect(Math.abs(sum / two.report.capacity - 1)).toBeLessThan(0.05);
    expect(two.report.outlets.map((o) => o.capacity).reduce((n, v) => n + v, 0)).toBeCloseTo(two.report.capacity, 9);
  }));

  test("a dead-end stub costs the outlet nothing", () => on(() => {
    const one = played(yard().g, 6);
    resetCooling();
    const { g } = yard();
    lay(g, line(12, 5, 12, 13).slice(0, 9));
    expect(Math.abs(played(g, 6).report.capacity / one.report.capacity - 1)).toBeLessThan(0.005);
  }));

  test("a map first seen has its mains full; a main laid after starts empty and fills", () => on(() => {
    const { g, dcX } = yard();
    const f = createWaterField(g);
    const first = played(g, 1 / 6, f);
    // Ten frames in and it is already carrying: no dry spell after a load.
    expect(first.report.flow).toBeGreaterThan(first.report.capacity * 0.9);
    expect(mainFillAt(g, idx(g, dcX - 1, 5))).toBe(1);
    // A branch laid now has nothing in it.
    branch(g, dcX);
    runMains(f, g, 1 / 60);
    expect(mainFillAt(g, idx(g, dcX + 1, 7))).toBeLessThan(0.05);
    played(g, 4, f);
    expect(mainFillAt(g, idx(g, dcX + 1, 7))).toBe(1);
  }));

  test("no water is made or lost: the lake's, the tanks' and the pipes' add up, laying and lifting included", () => on(() => {
    const { g, dcX } = yard();
    const f = createWaterField(g);
    setWaterEdge(f, false);
    stepCooling(g, 0, false, 0);
    for (const t of allTanks().values()) { t.capacity = 1e9; t.level = 0; }
    const tanks = () => [...allTanks().values()].reduce((n, t) => n + t.level, 0);
    const all = () => totalWater(f.columns) + tanks() + waterInMains(g);
    runMains(f, g, 1 / 60);
    // From here on: the first frame fills the mains of a map just loaded, out of nothing.
    const start = all();
    for (let n = 0; n < 120; n++) runMains(f, g, 1 / 60);
    // To the water's own precision: its depths are single floats.
    expect(all()).toBeCloseTo(start, 4);
    branch(g, dcX);
    for (let n = 0; n < 240; n++) runMains(f, g, 1 / 60);
    // To the water's own precision: its depths are single floats.
    expect(all()).toBeCloseTo(start, 4);
    // The whole network lifted: what stood in it is on the ground.
    for (let i = 0; i < g.main.length; i++) { g.main[i] = 0; g.mainEnd[i] = 0; }
    edited(g);
    runMains(f, g, 1 / 60);
    expect(waterInMains(g)).toBe(0);
    // To the water's own precision: its depths are single floats.
    expect(all()).toBeCloseTo(start, 4);
  }));
});

describe("the editor's spouts in the game's tick", () => {
  test("a map with no spouts is left at once: nothing is found to run", () => {
    const { g } = yard();
    const f = createWaterField(g);
    expect(findPipeNets(g, createPipeNets(g.w, g.h)).count).toBe(0);
    // A pump that would throw if asked: with no pipe end to fill, none is.
    runPipes(f, g, 1 / 60, { pay: () => { throw new Error("a pump ran with no spouts"); } });
    expect(f.spilled).toBe(g.rev);
  });
});
