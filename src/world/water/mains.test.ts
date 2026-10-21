import { afterEach, describe, expect, test } from "bun:test";

import { mainFlow } from "../../game/mains";
import { commit, createHistory } from "../edit/commands";
import { MAIN_END, createGrid, fillTerrain, idx, setHeight, type Grid } from "../grid";
import { resetCooling, stepCooling, tankFor } from "../projects/cooling";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { createWaterField } from "./field";
import { findMains, layMain, mainReportAt, planMain, runMains, solveMain } from "./mains";

afterEach(resetCooling);

/** A lake down the west edge, its surface `rise` half steps over the ground; a Data Centre at x 20. */
function lakeside(rise: number) {
  const g = createGrid(30, 12);
  fillTerrain(g, 1);
  for (let y = 0; y < 12; y++) for (let x = 0; x < 30; x++) setHeight(g, x, y, x <= 3 ? rise - 6 : 0);
  for (let y = 0; y < 12; y++) for (let x = 0; x <= 3; x++) g.pool[idx(g, x, y)] = 6;
  commit(g, createHistory(), placeCommand(g, { ...structureDef("datacentre")!, placement: undefined }, 20, 4)!);
  const dc = [...g.structures.values()].find((s) => s.def === "datacentre")!;
  return { g, dc };
}
const wetOf = (g: Grid) => (x: number, y: number) => g.pool[idx(g, x, y)] > 0;
const row = (y: number, x0: number, x1: number) => Array.from({ length: x1 - x0 + 1 }, (_, k) => ({ x: x0 + k, y }));
const lay = (g: Grid, cells: { x: number; y: number }[], pump = false) => {
  const p = planMain(g, cells, wetOf(g), pump);
  if ("refused" in p) throw new Error(p.refused);
  layMain(g, p.cells);
  return p;
};

describe("a water main", () => {
  test("is fitted at its ends: an intake by the water, an outlet by the building, a cap anywhere else", () => {
    const { g } = lakeside(5);
    const p = lay(g, row(5, 4, 19));
    expect(p.cells[0].end).toBe(MAIN_END.intake);
    expect(p.cells[p.cells.length - 1].end).toBe(MAIN_END.outlet);
    const capped = planMain(g, row(9, 8, 12), wetOf(g));
    expect("cells" in capped && capped.cells.map((c) => c.end)).toEqual([MAIN_END.cap, 0, 0, 0, MAIN_END.cap]);
  });

  test("is joined only where it was laid: two runs side by side are two networks, and a run ended on one joins it", () => {
    const { g } = lakeside(5);
    lay(g, row(5, 4, 19));
    lay(g, row(6, 4, 19));
    expect(findMains(g).list.length).toBe(2);
    // Across the other's middle: refused. Ended on it: one network.
    expect(planMain(g, [{ x: 10, y: 4 }, { x: 10, y: 5 }, { x: 10, y: 6 }, { x: 10, y: 7 }], wetOf(g))).toEqual({ refused: "End the run on the other main to join it" });
    lay(g, [{ x: 10, y: 8 }, { x: 10, y: 7 }, { x: 10, y: 6 }]);
    expect(findMains(g).list.length).toBe(2);
    expect(findMains(g).of[idx(g, 10, 8)]).toBe(findMains(g).of[idx(g, 4, 6)]);
  });

  test("carries water downhill into the building's tank, and takes it out of the lake", () => {
    const { g, dc } = lakeside(5);
    lay(g, row(5, 4, 19));
    const field = createWaterField(g);
    stepCooling(g, 10, false, 0.01);
    Object.assign(tankFor(dc.id)!, { level: 0 });
    const before = [...field.columns.depth].reduce((a, b) => a + b, 0);
    runMains(field, g, 1);
    const r = mainReportAt(g, 10, 5)!;
    expect(r.state).toBe("flowing");
    expect(r.flow).toBeCloseTo(mainFlow(r.head, 16), 5);
    expect(tankFor(dc.id)!.level).toBeCloseTo(r.flow, 5);
    const after = [...field.columns.depth].reduce((a, b) => a + b, 0);
    expect(before - after).toBeCloseTo(r.flow, 3);
  });

  test("says when the water is too low to reach the building, and a pump lifts it — paid for while it runs", () => {
    const { g, dc } = lakeside(-2);
    lay(g, row(5, 4, 19));
    const field = createWaterField(g);
    stepCooling(g, 10, false, 0.01);
    Object.assign(tankFor(dc.id)!, { level: 0 });
    runMains(field, g, 1);
    expect(mainReportAt(g, 10, 5)!.state).toBe("no-head");
    g.mainEnd[idx(g, 4, 5)] = MAIN_END.pump;
    g.rev++;
    let paid = 0;
    runMains(field, g, 1, { pay: (s) => ((paid += s), true) });
    expect(mainReportAt(g, 10, 5)!.state).toBe("flowing");
    expect(paid).toBe(1);
    runMains(field, g, 1, { pay: () => false });
    expect(mainReportAt(g, 10, 5)!.state).toBe("unpaid");
  });

  test("an intake whose water has gone is dry, and pours nothing anywhere", () => {
    const { g } = lakeside(5);
    lay(g, row(5, 4, 19));
    const field = createWaterField(g);
    field.columns.depth.fill(0);
    runMains(field, g, 1);
    expect(mainReportAt(g, 10, 5)!.state).toBe("dry");
    expect([...field.columns.depth].reduce((a, b) => a + b, 0)).toBe(0);
    expect(solveMain(g, field, findMains(g).list[0]).capacity).toBe(0);
  });
});
