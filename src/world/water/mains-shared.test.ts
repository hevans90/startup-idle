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
import { createGrid, fillTerrain, idx, setHeight, type Grid } from "../grid";
import { resetCooling, stepCooling } from "../projects/cooling";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { createWaterField, setWaterEdge } from "./field";
import { findMains, layMain, planMain, solveMain } from "./mains";
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
