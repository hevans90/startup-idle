import { afterEach, describe, expect, test } from "bun:test";

import { PROCESS_RATE, processorUse, refineryBonus, setProcessorUse } from "../../game/processors";
import { PROJECTS, gateParts } from "../../game/projects";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx, setHeight, type Grid } from "../grid";
import { resetCooling } from "../projects/cooling";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { createWaterField } from "../water/field";
import { layMain, planMain, runMains } from "../water/mains";
import { foulingIn } from "../water/pollution";
import { processorBusy, stepSlop, tanksOf } from "./tanks";

afterEach(() => { resetCooling(); setProcessorUse({ refinery: 0, dataplant: 0, contentfarm: 0 }); });

/**
 * A lake down the west edge; a vibe office on x 10–11, y 3–4, its slop port
 * at (12, 4); a refinery on x 14–15, y 6–7, its inlets at (16, 7) and (15, 8).
 */
function works() {
  const g = createGrid(24, 14);
  fillTerrain(g, 1);
  for (let y = 0; y < 14; y++) for (let x = 0; x < 24; x++) setHeight(g, x, y, x <= 3 ? -2 : 2);
  for (let y = 0; y < 14; y++) for (let x = 0; x <= 3; x++) g.pool[idx(g, x, y)] = 4;
  commit(g, createHistory(), placeCommand(g, { ...structureDef("office-vibe")!, placement: undefined }, 10, 3)!);
  commit(g, createHistory(), placeCommand(g, { ...structureDef("refinery")!, placement: undefined }, 14, 6)!);
  const office = [...g.structures.values()].find((s) => s.def === "office-vibe")!;
  const refinery = [...g.structures.values()].find((s) => s.def === "refinery")!;
  return { g, office, refinery, field: createWaterField(g) };
}
const wetOf = (g: Grid) => (x: number, y: number) => g.pool[idx(g, x, y)] > 0;
function sewer(g: Grid, cells: { x: number; y: number }[]) {
  const p = planMain(g, cells, wetOf(g), false, true);
  if ("refused" in p) throw new Error(p.refused);
  layMain(g, p.cells, true);
}
/** From the office's port down x = 12 and along y = 8 to the refinery's west inlet. */
const toRefinery = [{ x: 12, y: 4 }, { x: 12, y: 5 }, { x: 12, y: 6 }, { x: 12, y: 7 }, { x: 12, y: 8 }, { x: 13, y: 8 }, { x: 14, y: 8 }, { x: 15, y: 8 }];

describe("a slop processor", () => {
  test("is opened by a project of its own, the later ones after the Data Centre and the Boardroom", () => {
    const by = (id: string) => PROJECTS.find((p) => p.id === id)!;
    expect(by("refinery").grants).toBe("refinery");
    expect(by("dataplant").gate.after).toBe("datacentre");
    expect(by("contentfarm").gate.after).toBe("boardroom");
    expect(gateParts(by("dataplant").gate, {}, new Set()).map((p) => p.kind)).toEqual(["built"]);
  });

  test("fed by a sewer, takes the slop and is busy by how much it gets", () => {
    const { g, office, refinery, field } = works();
    sewer(g, toRefinery);
    const desks = new Map([[office.id, { used: 1 }]]);
    for (let k = 0; k < 60; k++) { runMains(field, g, 1); stepSlop(g, field, desks, PROCESS_RATE / 2, 1); }
    expect(processorBusy(refinery.id)).toBeCloseTo(0.5, 1);
    expect(processorUse("refinery")).toBeCloseTo(0.5, 1);
    expect(refineryBonus()).toBeGreaterThan(1.05);
    expect(tanksOf(g).get(office.id)!.level).toBeLessThan(1);
    expect(foulingIn(field)).toBe(0);
  });

  test("full, it backs the sewer up: what it cannot take stays in the tanks, and spills from them", () => {
    const { g, office, refinery, field } = works();
    sewer(g, toRefinery);
    const desks = new Map([[office.id, { used: 1 }]]);
    for (let k = 0; k < 400; k++) { runMains(field, g, 1); stepSlop(g, field, desks, PROCESS_RATE * 2, 1); }
    expect(processorBusy(refinery.id)).toBeCloseTo(1, 2);
    expect(tanksOf(g).get(office.id)!.spilling).toBe(true);
  });
});
