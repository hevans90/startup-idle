/**
 * A PUMP HOUSE lifts water from the pool beside it up the pipe that meets it,
 * as far as `PUMP_HEAD` and no further, and only while it is paid for.
 * @see runPumps
 */
import { afterEach, describe, expect, test } from "bun:test";

import { PUMP_HEAD } from "../../game/cooling";
import { DIR } from "../../iso/dir";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx, setHeight, type Grid } from "../grid";
import { structureDef } from "../structures/def";
import { placeCommand, validatePlacement } from "../structures/place";
import { resetCooling, stepCooling, tankFor } from "../projects/cooling";
import { createWaterField, pourAt, setWaterEdge, stepWater } from "./field";
import { layPipe, runPipes, type Pumps } from "./pipes";

afterEach(resetCooling);

/**
 * A pond at x 1–2, a pump house at x 3, pipe from x 4 to 8, and a Data Centre
 * at x 9–11 standing `rise` half steps up. S is x+1, N is x-1.
 */
function rig(rise: number) {
  const g = createGrid(14, 10);
  fillTerrain(g, 1);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 14; x++) setHeight(g, x, y, x >= 6 ? rise : 0);
  for (let y = 0; y < 10; y++) for (const x of [1, 2]) g.pool[idx(g, x, y)] = 1;
  const h = createHistory();
  commit(g, h, placeCommand(g, structureDef("pump")!, 3, 5)!);
  commit(g, h, placeCommand(g, { ...structureDef("datacentre")!, placement: undefined }, 9, 4)!);
  const dc = [...g.structures.values()].find((s) => s.def === "datacentre")!.id;
  const f = createWaterField(g);
  setWaterEdge(f, false);
  for (let y = 0; y < 10; y++) for (const x of [1, 2]) pourAt(f, x, y, 6, 1);
  layPipe(g, 4, 5, DIR.N);
  for (let x = 5; x < 8; x++) layPipe(g, x, 5, DIR.S);
  layPipe(g, 8, 5, DIR.S);
  stepCooling(g, 0, false, 0);
  tankFor(dc)!.level = 0;
  return { g, f, dc };
}
const live = (g: Grid, f: ReturnType<typeof createWaterField>, secs: number, pumps?: Pumps) => {
  for (let n = 0; n < Math.round(secs * 60); n++) { runPipes(f, g, 1 / 60, pumps); stepWater(f, 1 / 60); }
};

describe("a pump house", () => {
  test("stands only beside water", () => {
    const g = createGrid(8, 8);
    fillTerrain(g, 1);
    g.pool[idx(g, 2, 3)] = 1;
    expect(validatePlacement(g, structureDef("pump")!, 3, 3).ok).toBe(true);
    expect(validatePlacement(g, structureDef("pump")!, 5, 5).ok).toBe(false);
  });

  test("lifts water up to a Data Centre above the pond", () => {
    const { g, f, dc } = rig(PUMP_HEAD / 2);
    live(g, f, 10);
    expect(tankFor(dc)!.level).toBeGreaterThan(0);
  });

  test("but not past its lift", () => {
    const { g, f, dc } = rig(PUMP_HEAD + 12);
    live(g, f, 10);
    expect(tankFor(dc)!.level).toBe(0);
  });

  test("and not while it goes unpaid; paid, it runs, a second's upkeep a frame at a time", () => {
    const { g, f, dc } = rig(PUMP_HEAD / 2);
    live(g, f, 10, { pay: () => false });
    expect(tankFor(dc)!.level).toBe(0);
    let paidFor = 0;
    live(g, f, 2, { pay: (s) => { paidFor += s; return true; } });
    expect(paidFor).toBeGreaterThan(0);
    expect(paidFor).toBeLessThanOrEqual(2 + 1e-9);
  });
});
