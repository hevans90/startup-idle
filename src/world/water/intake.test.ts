/**
 * A PIPE INTO A DATA CENTRE: the end that opens onto a building that drinks
 * pours into its tank, and what it pours came out of the pool at the other
 * end. @see intakeOf, game/cooling
 */
import { afterEach, describe, expect, test } from "bun:test";

import { DIR } from "../../iso/dir";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, setHeight, type Grid } from "../grid";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { allTanks, resetCooling, stepCooling, tankFor } from "../projects/cooling";
import { createWaterField, pourAt, setWaterEdge, stepWater, totalVolume } from "./field";
import { intakeOf, layPipe, runPipes } from "./pipes";

afterEach(resetCooling);

/** A puddle on a terrace, a Data Centre below it, and a pipe from one to the other. */
function rig(into = true) {
  const g = createGrid(14, 12);
  fillTerrain(g, 1);
  for (let y = 0; y < 12; y++) for (let x = 0; x < 14; x++) setHeight(g, x, y, x < 6 ? 20 : 0);
  commit(g, createHistory(), placeCommand(g, { ...structureDef("datacentre")!, placement: undefined }, 7, 5)!);
  const dc = [...g.structures.values()].find((s) => s.def === "datacentre")!.id;
  const f = createWaterField(g);
  setWaterEdge(f, false);
  layPipe(g, 4, 6, DIR.N);                   // under the puddle: S is x+1, so N is x-1
  layPipe(g, 5, 6, DIR.S);
  layPipe(g, 6, 6, into ? DIR.S : DIR.W);    // into the Data Centre at x 7 — or off to the side
  for (let y = 5; y <= 7; y++) for (let x = 1; x <= 3; x++) pourAt(f, x, y, 8, 1);
  // Its tank, made and emptied: tanks start full.
  stepCooling(g, 0, false, 0);
  tankFor(dc)!.level = 0;
  return { g, f, dc };
}
const live = (g: Grid, f: ReturnType<typeof createWaterField>, secs: number) => {
  for (let n = 0; n < Math.round(secs * 60); n++) { runPipes(f, g, 1 / 60); stepWater(f, 1 / 60); }
};

describe("a pipe into a Data Centre", () => {
  test("knows the building it opens onto", () => {
    const { g, dc } = rig();
    expect(intakeOf(g, 6, 6, DIR.S)).toBe(dc);
    expect(intakeOf(g, 5, 6, DIR.S)).toBe(-1);
  });

  test("fills its tank, with water that came out of the pool", () => {
    const { g, f, dc } = rig();
    const before = totalVolume(f, g);
    live(g, f, 6);
    const got = tankFor(dc)!.level;
    expect(got).toBeGreaterThan(0);
    // Nothing made, nothing lost: what the tank holds left the map's water.
    expect(totalVolume(f, g) + got).toBeCloseTo(before, 2);
  });

  test("takes no more than its tank has room for, and backs up", () => {
    const { g, f, dc } = rig();
    live(g, f, 20);
    const t = tankFor(dc)!;
    expect(t.level).toBeLessThanOrEqual(t.capacity + 1e-9);
  });

  test("a pipe that does not open onto it fills nothing", () => {
    const { g, f, dc } = rig(false);
    live(g, f, 6);
    expect(tankFor(dc)!.level).toBe(0);
    expect(allTanks().size).toBe(1);
  });
});
