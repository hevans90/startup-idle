/**
 * THE MAINS ON THE DEVICE: the host packs its networks, grants each outlet
 * what its tank has room for, and takes what the device says it delivered.
 * Run here against the shader's own text (`shaderTwin`), on the same rig the
 * host's solver is measured on: the two carry the same, no tank is given
 * more than it holds however late the answers come, and no water is made or
 * lost between the lake, the pipe and the tank. @see fluid/gpu/pipes, plans/pipe-network.md §3
 */
import { afterEach, describe, expect, test } from "bun:test";

import { PUMP_HEAD } from "../../game/cooling";
import { shaderTwin, type Twin } from "../../fluid/gpu/pipes.test-kit";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx, setHeight, type Grid } from "../grid";
import { resetCooling, stepCooling, tankFor } from "../projects/cooling";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { createWaterField, setWaterEdge, stepWater, type WaterField } from "./field";
import { layMain, mainReports, planMain, runMains, waterInMains } from "./mains";

afterEach(resetCooling);

/** A lake, a bank, a main down it and a Data Centre at its end. @see mains-capacity.test */
function rig(run: number, rise: number, pump: boolean): { g: Grid; f: WaterField; dc: number } {
  const w = run + 12, g = createGrid(w, 12);
  fillTerrain(g, 1);
  for (let y = 0; y < 12; y++) for (let x = 0; x < w; x++) setHeight(g, x, y, x <= 3 ? rise - 6 : x === 4 ? Math.max(rise, 0) + 2 : 0);
  for (let y = 0; y < 12; y++) for (let x = 0; x <= 3; x++) g.pool[idx(g, x, y)] = 6;
  commit(g, createHistory(), placeCommand(g, { ...structureDef("datacentre")!, placement: undefined }, 4 + run - 2, 2)!);
  const dc = [...g.structures.values()].find((s) => s.def === "datacentre")!.id;
  const plan = planMain(g, Array.from({ length: run }, (_, k) => ({ x: 4 + k, y: 5 })), (x, y) => g.pool[idx(g, x, y)] > 0, pump);
  if ("refused" in plan) throw new Error(plan.refused);
  layMain(g, plan.cells);
  const f = createWaterField(g);
  setWaterEdge(f, false);
  stepCooling(g, 0, false, 0);
  return { g, f, dc };
}

/** Water a second into a tank kept emptied, on the device's twin or the host. */
function flow(rise: number, pump: boolean, device: boolean, late = 0): number {
  const { g, f, dc } = rig(20, rise, pump);
  if (device) f.columns.pipes = shaderTwin(f.columns, late).port;
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

const total = (f: WaterField) => f.columns.depth.reduce((n, d) => n + d, 0);
const delivered = (t: Twin) => { const o = t.offsets(); return t.buffer[o.delivered] + t.buffer[o.delivered + 1]; };
const heldOn = (t: Twin) => { const o = t.offsets(); let n = 0; for (let k = o.held; k < o.flow; k++) n += t.buffer[k]; return n; };

describe("the mains on the device", () => {
  test("a gravity run carries what the host's solver does", () => {
    const host = flow(5, false, false), device = flow(5, false, true);
    if (process.env.BALANCE) console.log(`host ${host.toFixed(4)} device ${device.toFixed(4)}`);
    expect(host).toBeGreaterThan(0.5);
    expect(device / host).toBeCloseTo(1, 2);
  }, 30_000);

  test("and a pump's run, answers three frames late", () => {
    const host = flow(-(PUMP_HEAD / 2), true, false), device = flow(-(PUMP_HEAD / 2), true, true, 3);
    expect(host).toBeGreaterThan(0.2);
    expect(device / host).toBeCloseTo(1, 2);
  }, 30_000);

  test("a tank is given what it has room for and no more, however late the answers", () => {
    const { g, f, dc } = rig(20, 5, false);
    const twin = shaderTwin(f.columns, 3);
    f.columns.pipes = twin.port;
    const t = tankFor(dc)!;
    t.capacity = 3; t.level = 0;
    let most = 0;
    for (let n = 0; n < 60 * 12; n++) { runMains(f, g, 1 / 60); stepWater(f, 1 / 60); most = Math.max(most, t.level); }
    expect(most).toBeLessThanOrEqual(3 + 1e-6);
    expect(t.level).toBeCloseTo(3, 4);
    // Every drop the device let out reached the tank: none in the air, none twice.
    expect(delivered(twin)).toBeCloseTo(3, 4);
    expect([...mainReports().values()][0].state).toBe("full");
  }, 30_000);

  test("no water is made or lost between the lake, the pipe and the tank", () => {
    const { g, f, dc } = rig(20, 5, false);
    const twin = shaderTwin(f.columns, 2);
    f.columns.pipes = twin.port;
    const t = tankFor(dc)!;
    t.capacity = 1e9; t.level = 0;
    runMains(f, g, 1 / 60);
    const before = total(f) + heldOn(twin) + delivered(twin);
    for (let n = 0; n < 60 * 8; n++) { runMains(f, g, 1 / 60); stepWater(f, 1 / 60); }
    expect(delivered(twin)).toBeGreaterThan(3);
    const after = total(f) + heldOn(twin) + delivered(twin);
    expect(Math.abs(after - before)).toBeLessThan(0.02);
    // The host's own count of what stands in the pipe follows the device's, a few frames behind.
    expect(waterInMains(g)).toBeCloseTo(heldOn(twin), 1);
  }, 30_000);

  test("a map edited is packed again, and the old network's answers are not taken for the new one's", () => {
    const { g, f, dc } = rig(20, 5, false);
    const twin = shaderTwin(f.columns, 3);
    f.columns.pipes = twin.port;
    const t = tankFor(dc)!;
    t.capacity = 1e9; t.level = 0;
    for (let n = 0; n < 120; n++) { runMains(f, g, 1 / 60); stepWater(f, 1 / 60); }
    expect(twin.loads()).toBe(1);
    const had = t.level;
    g.rev++;
    for (let n = 0; n < 4; n++) { runMains(f, g, 1 / 60); stepWater(f, 1 / 60); }
    expect(twin.loads()).toBe(2);
    // Four frames on, with nothing back yet for the new upload, the tank has not jumped.
    expect(t.level - had).toBeLessThan(0.2);
    for (let n = 0; n < 120; n++) { runMains(f, g, 1 / 60); stepWater(f, 1 / 60); }
    expect(t.level - had).toBeGreaterThan(1);
  }, 30_000);
});
