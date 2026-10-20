/**
 * WHAT ONE PIPE CARRIES: water a second into a Data Centre's tank, kept
 * emptied, down a gravity run and up a pump's — so `WATER_PER_AGENT` can be
 * set against it. The plan's bar: one gravity run, the water two and a half
 * slabs above the Data Centre's floor, feeds sixteen agents; one pump's about
 * twelve. Measured: a gravity run carries a good deal more with height — 0.15
 * a second three half steps up, 0.95 five up. `BALANCE=1` prints the flows,
 * `SWEEP=1` the gravity runs over length and height. @see game/cooling
 */
import { afterEach, describe, expect, test } from "bun:test";

import { DRY_AGENTS, PUMP_HEAD, WATER_PER_AGENT } from "../../game/cooling";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx, setHeight } from "../grid";
import { resetCooling, stepCooling, tankFor } from "../projects/cooling";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { createWaterField, pourAt, setWaterEdge, stepWater } from "./field";
import { gamePipeRun, layPipe, runPipes } from "./pipes";

afterEach(resetCooling);

/** Water a second a run delivers, `run` tiles long, the water `rise` above (or below, negative) the Data Centre's floor. */
function flow(run: number, rise: number, pump: boolean): number {
  const w = run + 12, g = createGrid(w, 12);
  fillTerrain(g, 1);
  const lake = { x0: 0, x1: 3 };
  const floor = 0, bed = rise - 6;
  for (let y = 0; y < 12; y++) for (let x = 0; x < w; x++) setHeight(g, x, y, x <= lake.x1 ? bed : floor);
  for (let y = 0; y < 12; y++) for (let x = lake.x0; x <= lake.x1; x++) g.pool[idx(g, x, y)] = 6;
  const h = createHistory();
  const dcX = lake.x1 + 2 + run + (pump ? 1 : 0);
  commit(g, h, placeCommand(g, { ...structureDef("datacentre")!, placement: undefined }, dcX, 4)!);
  const dc = [...g.structures.values()].find((s) => s.def === "datacentre")!.id;
  let x0 = lake.x1 + 1;
  if (pump) { commit(g, h, placeCommand(g, structureDef("pump")!, x0, 5)!); x0++; }
  const cells = Array.from({ length: dcX - x0 }, (_, k) => ({ x: x0 + k, y: 5 }));
  const laid = gamePipeRun(g, cells);
  if ("refused" in laid) throw new Error(laid.refused);
  for (const c of laid) layPipe(g, c.x, c.y, c.facing, c.z);
  const f = createWaterField(g);
  setWaterEdge(f, false);
  for (let y = 0; y < 12; y++) for (let x = lake.x0; x <= lake.x1; x++) pourAt(f, x, y, 6, 1);
  stepCooling(g, 0, false, 0);
  // A tank as big as it gets, emptied every frame: what arrives is all it can carry.
  const t = tankFor(dc)!;
  let got = 0;
  for (let n = 0; n < 60 * 40; n++) {
    t.capacity = 1e9; t.level = 0;
    runPipes(f, g, 1 / 60);
    stepWater(f, 1 / 60);
    if (n >= 60 * 20) got += t.level;
  }
  return got / 20;
}
const agents = (perSecond: number) => Math.floor(perSecond / WATER_PER_AGENT) + DRY_AGENTS;

describe("what one pipe carries", () => {
  const gravity = flow(20, 5, false);
  const pumped = flow(20, -(PUMP_HEAD / 2), true);
  if (process.env.SWEEP) for (const [run, rise] of [[10, 3], [20, 3], [40, 3], [20, 5], [20, 8], [20, 12]]) console.log(`run ${run} rise ${rise}: ${flow(run, rise, false).toFixed(3)}/s`);
  if (process.env.BALANCE) console.log(`gravity ${gravity.toFixed(2)}/s → ${agents(gravity)} agents · pumped ${pumped.toFixed(2)}/s → ${agents(pumped)} agents`);

  test("a gravity run feeds sixteen agents or more", () => {
    expect(agents(gravity)).toBeGreaterThanOrEqual(16);
  });

  test("a pump's run feeds about twelve", () => {
    expect(agents(pumped)).toBeGreaterThanOrEqual(11);
    expect(agents(pumped)).toBeLessThanOrEqual(13);
  });
});
