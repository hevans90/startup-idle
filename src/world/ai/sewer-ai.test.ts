import { afterEach, describe, expect, test } from "bun:test";

import { setSlopMaking } from "../../game/slop";
import { commit, createHistory } from "../edit/commands";
import { MAIN_END, createGrid, fillTerrain, idx, setHeight, type Grid } from "../grid";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { layMain, planMain } from "../water/mains";
import { neededSewer, routeSewer } from "./sewer-ai";

afterEach(() => setSlopMaking(0));

/** A lake down the west edge; a vibe office on x 10–11, y 3–4, its slop port at (12, 4). */
function street() {
  const g = createGrid(24, 16);
  fillTerrain(g, 1);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 24; x++) setHeight(g, x, y, x <= 3 ? -2 : 2);
  for (let y = 0; y < 16; y++) for (let x = 0; x <= 3; x++) g.pool[idx(g, x, y)] = 4;
  commit(g, createHistory(), placeCommand(g, { ...structureDef("office-vibe")!, placement: undefined }, 10, 3)!);
  return g;
}
const wetOf = (g: Grid) => (x: number, y: number) => g.pool[idx(g, x, y)] > 0;
const end = (g: Grid, cells: { x: number; y: number }[]) => {
  const p = planMain(g, cells, wetOf(g), false, true);
  if ("refused" in p) throw new Error(p.refused);
  return p.cells[p.cells.length - 1].end;
};

describe("the AI's sewers", () => {
  test("with no refinery, run from the slop port to the water for an outfall", () => {
    const g = street();
    const cells = routeSewer(g, { x: 12, y: 4 }, wetOf(g))!;
    expect(cells[0]).toEqual({ x: 12, y: 4 });
    expect(cells[cells.length - 1].x).toBe(4);
    expect(end(g, cells)).toBe(MAIN_END.outfall);
  });

  test("with a refinery in reach, go to its inlet instead, though the water is nearer", () => {
    const g = street();
    commit(g, createHistory(), placeCommand(g, { ...structureDef("refinery")!, placement: undefined }, 18, 8)!);
    const cells = routeSewer(g, { x: 12, y: 4 }, wetOf(g))!;
    expect(end(g, cells)).toBe(MAIN_END.outlet);
  });

  test("onto a sewer already laid, joining it", () => {
    const g = street();
    const trunk = planMain(g, Array.from({ length: 10 }, (_, k) => ({ x: 4 + k, y: 10 })), wetOf(g), false, true);
    if ("refused" in trunk) throw new Error(trunk.refused);
    layMain(g, trunk.cells, true);
    const cells = routeSewer(g, { x: 12, y: 4 }, wetOf(g))!;
    expect(cells[cells.length - 1].y).toBe(10);
  });

  test("are only wanted while there is slop", () => {
    const g = street();
    expect(neededSewer(g)).toBeNull();
    setSlopMaking(1);
    expect(neededSewer(g)?.cells.length).toBeGreaterThan(1);
  });
});
