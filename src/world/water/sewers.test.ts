import { afterEach, describe, expect, test } from "bun:test";

import { commit, createHistory } from "../edit/commands";
import { MAIN_END, MAIN_SEWER, MAIN_STUB, createGrid, fillTerrain, idx, setHeight, type Grid } from "../grid";
import { resetCooling } from "../projects/cooling";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { createWaterField } from "./field";
import { findMains, layMain, mainReportAt, planMain, routeMain, runMains, sewerStubs } from "./mains";

afterEach(resetCooling);

/** A lake down the west edge; a vibe office on x 10–11, y 3–4, its slop port at (12, 4). */
function street() {
  const g = createGrid(24, 12);
  fillTerrain(g, 1);
  for (let y = 0; y < 12; y++) for (let x = 0; x < 24; x++) setHeight(g, x, y, x <= 3 ? -2 : 2);
  for (let y = 0; y < 12; y++) for (let x = 0; x <= 3; x++) g.pool[idx(g, x, y)] = 4;
  commit(g, createHistory(), placeCommand(g, { ...structureDef("office-vibe")!, placement: undefined }, 10, 3)!);
  const office = [...g.structures.values()].find((s) => s.def === "office-vibe")!;
  return { g, office };
}
const wetOf = (g: Grid) => (x: number, y: number) => g.pool[idx(g, x, y)] > 0;
/** A run along y = 6 from x 4 to `x1`, and up x = `x1` to (x1, 4): from the bank to in front of the port. */
const toPort = (x1 = 12) => [
  ...Array.from({ length: x1 - 4 + 1 }, (_, k) => ({ x: 4 + k, y: 6 })),
  { x: x1, y: 5 }, { x: x1, y: 4 },
];
const laySewer = (g: Grid, cells: { x: number; y: number }[]) => {
  const p = planMain(g, cells, wetOf(g), false, true);
  if ("refused" in p) throw new Error(p.refused);
  layMain(g, p.cells, true);
  return p;
};

describe("a sewer", () => {
  test("is fitted at its ends: an outfall at the water, a drain at the workplace's slop port", () => {
    const { g, office } = street();
    const p = laySewer(g, toPort());
    expect(p.cells[0].end).toBe(MAIN_END.outfall);
    expect(p.cells[p.cells.length - 1].end).toBe(MAIN_END.drain);
    const net = findMains(g).list[0];
    expect(net.sewer).toBe(true);
    expect(net.outfalls).toEqual([idx(g, 4, 6)]);
    runMains(createWaterField(g), g, 1 / 60);
    const r = mainReportAt(g, 4, 6)!;
    expect(r.state).toBe("flowing");
    expect(r.sewer?.sources).toEqual([office.id]);
  });

  test("never joins a water main, and joins a building only at its slop port", () => {
    const { g } = street();
    const main = planMain(g, [{ x: 4, y: 9 }, { x: 5, y: 9 }, { x: 6, y: 9 }], wetOf(g));
    if ("refused" in main) throw new Error(main.refused);
    layMain(g, main.cells);
    expect(planMain(g, [{ x: 6, y: 7 }, { x: 6, y: 8 }, { x: 6, y: 9 }], wetOf(g), false, true)).toEqual({ refused: "A sewer and a water main never join" });
    expect(planMain(g, [{ x: 14, y: 3 }, { x: 13, y: 3 }, { x: 12, y: 3 }], wetOf(g), false, true)).toEqual({ refused: "Join the Vibe studio at its slop port" });
  });

  test("dragged onto the workplace, snaps to its slop port", () => {
    const { g } = street();
    expect(routeMain(g, { x: 6, y: 8 }, { x: 10, y: 3 }, wetOf(g), true)?.at(-1)).toEqual({ x: 12, y: 4 });
  });

  test("takes a workplace whose port is beside it by a stub of its own, and the stub goes with it", () => {
    const { g, office } = street();
    // A trunk past the front of the office, a tile clear of its port.
    laySewer(g, [...Array.from({ length: 10 }, (_, k) => ({ x: 4 + k, y: 6 })), { x: 13, y: 5 }, { x: 13, y: 4 }]);
    expect(sewerStubs(g)).toBe(true);
    const port = idx(g, 12, 4);
    expect(g.main[port] & (MAIN_SEWER | MAIN_STUB)).toBe(MAIN_SEWER | MAIN_STUB);
    expect(g.mainEnd[port]).toBe(MAIN_END.drain);
    expect(g.mainEnd[idx(g, 13, 4)]).toBe(0);
    runMains(createWaterField(g), g, 1 / 60);
    expect(mainReportAt(g, 4, 6)?.sewer?.sources).toEqual([office.id]);
    expect(sewerStubs(g)).toBe(false);
    // The trunk taken up: the stub with it.
    for (let i = 0; i < g.main.length; i++) if (i !== port) { g.main[i] = 0; g.mainEnd[i] = 0; }
    expect(sewerStubs(g)).toBe(true);
    expect(g.main[port]).toBe(0);
    expect(g.mainEnd[port]).toBe(0);
  });
});
