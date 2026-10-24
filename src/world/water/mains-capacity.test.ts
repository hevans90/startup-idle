/**
 * WHAT ONE MAIN CARRIES, measured as the game runs it: water a second into a
 * Data Centre's tank, kept emptied, out of a lake the water simulation keeps
 * level — down a gravity run, and up a pump's — so `WATER_PER_AGENT` can be
 * set against it. The plan's bar, kept from the old pipes: a 20-tile gravity
 * run with the water two and a half slabs above the Data Centre's floor feeds
 * sixteen agents or more; one pump's about twelve; a widened bore twice what
 * it did. And the singularity fixture's mains, turned from its old pipes, each
 * cooling what it was laid to. `BALANCE=1` prints the flows, `SWEEP=1` the
 * gravity runs over length and height. @see game/mains, plans/pipes-overhaul.md §6
 */
import { afterEach, describe, expect, test } from "bun:test";

import { DRY_AGENTS, PUMP_HEAD, WATER_PER_AGENT } from "../../game/cooling";
import { applyFixture } from "../debug/fixtures";
import { commit, createHistory } from "../edit/commands";
import { MAIN_BORE, createGrid, fillTerrain, idx, setHeight, type Grid } from "../grid";
import { allTanks, resetCooling, stepCooling, tankFor } from "../projects/cooling";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { createWaterField, setWaterEdge, stepWater } from "./field";
import { findMains, layMain, mainReports, pipesToMains, planMain, runMains } from "./mains";

afterEach(resetCooling);

/** Water a second a main delivers, `run` tiles long, the water `rise` above (or below, negative) the Data Centre's floor. */
function flow(run: number, rise: number, pump: boolean, wide = false): number {
  const w = run + 12, g = createGrid(w, 12);
  fillTerrain(g, 1);
  const lake = { x0: 0, x1: 3 };
  // Its bank a slab over its water, so the lake holds its level: the run starts on it and comes down.
  for (let y = 0; y < 12; y++) for (let x = 0; x < w; x++) setHeight(g, x, y, x <= lake.x1 ? rise - 6 : x === lake.x1 + 1 ? Math.max(rise, 0) + 2 : 0);
  for (let y = 0; y < 12; y++) for (let x = lake.x0; x <= lake.x1; x++) g.pool[idx(g, x, y)] = 6;
  const dcX = lake.x1 + 1 + run;
  commit(g, createHistory(), placeCommand(g, { ...structureDef("datacentre")!, placement: undefined }, dcX, 4)!);
  const dc = [...g.structures.values()].find((s) => s.def === "datacentre")!.id;
  const cells = Array.from({ length: run }, (_, k) => ({ x: lake.x1 + 1 + k, y: 5 }));
  const plan = planMain(g, cells, (x, y) => g.pool[idx(g, x, y)] > 0, pump);
  if ("refused" in plan) throw new Error(plan.refused);
  layMain(g, plan.cells);
  if (wide) { for (const c of plan.cells) g.main[idx(g, c.x, c.y)] |= MAIN_BORE; g.rev++; }
  const f = createWaterField(g);
  setWaterEdge(f, false);
  stepCooling(g, 0, false, 0);
  // A tank as big as it gets, emptied every frame: what arrives is all it can carry.
  const t = tankFor(dc)!;
  let got = 0;
  for (let n = 0; n < 60 * 30; n++) {
    t.capacity = 1e9; t.level = 0;
    runMains(f, g, 1 / 60);
    stepWater(f, 1 / 60);
    if (n >= 60 * 10) got += t.level;
  }
  return got / 20;
}
const agents = (perSecond: number) => Math.floor(perSecond / WATER_PER_AGENT + 1e-9) + DRY_AGENTS;

describe("what one main carries", () => {
  const gravity = flow(20, 5, false);
  const pumped = flow(20, -(PUMP_HEAD / 2), true);
  const wide = flow(20, 5, false, true);
  if (process.env.SWEEP) for (const [run, rise] of [[10, 3], [20, 3], [40, 3], [20, 5], [20, 8], [20, 12], [60, 5]]) console.log(`run ${run} rise ${rise}: ${flow(run, rise, false).toFixed(3)}/s`);
  if (process.env.BALANCE) console.log(`gravity ${gravity.toFixed(2)}/s → ${agents(gravity)} agents · pumped ${pumped.toFixed(2)}/s → ${agents(pumped)} · wide ${wide.toFixed(2)}/s → ${agents(wide)}`);

  test("a gravity run feeds sixteen agents or more", () => {
    expect(agents(gravity)).toBeGreaterThanOrEqual(16);
  });

  test("a pump's run feeds about twelve", () => {
    expect(agents(pumped)).toBeGreaterThanOrEqual(11);
    expect(agents(pumped)).toBeLessThanOrEqual(13);
  });

  test("a widened bore carries twice as much", () => {
    expect(wide / gravity).toBeCloseTo(2, 1);
  });
});

describe("the singularity fixture's mains", () => {
  /** The fixture, entered into play: its old pipes made mains, its water settled, its tanks run. */
  function played(): { g: Grid; reports: ReturnType<typeof mainReports> } {
    const g = createGrid(64, 64, 1);
    applyFixture(g, "singularity", 1);
    pipesToMains(g);
    const f = createWaterField(g);
    stepCooling(g, 40, false, 0);
    for (let n = 0; n < 60 * 20; n++) {
      stepWater(f, 1 / 60);
      for (const t of allTanks().values()) t.level = 0;
      runMains(f, g, 1 / 60);
    }
    return { g, reports: mainReports() };
  }

  test("each carries water, a pump's or gravity's, into the building it was laid to", () => {
    const { g, reports } = played();
    const list = [...reports.values()];
    if (process.env.BALANCE) {
      for (const r of list) {
        const into = r.outlets.map((o) => g.structures.get(o.building)?.def ?? "nothing").join(", ");
        console.log(`${r.length} tiles → ${into}: ${r.state}, head ${(r.head / 2).toFixed(1)} slabs, ${r.flow.toFixed(2)}/s, ${Math.floor(r.flow / WATER_PER_AGENT)} agents${r.outlets.some((o) => o.pumped) ? " (pumped)" : ""}`);
      }
    }
    expect(findMains(g).list.length).toBeGreaterThanOrEqual(2);
    // The ones laid to a building, each carrying: the spire's is left a tile short, for the player to finish.
    const laid = list.filter((r) => r.outlets.some((o) => o.building >= 0));
    expect(laid.length).toBeGreaterThanOrEqual(2);
    for (const r of laid) expect(r.state).toBe("flowing");
  });
});
