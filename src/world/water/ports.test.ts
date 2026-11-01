import { afterEach, describe, expect, test } from "bun:test";

import { DIR } from "../../iso/dir";
import { commit, createHistory } from "../edit/commands";
import { MAIN_END, createGrid, fillTerrain, idx, type Grid } from "../grid";
import { resetCooling } from "../projects/cooling";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { layMain, mainsToPorts, outletBuilding, planMain, routeMain } from "./mains";
import { inletOpen, keepsPorts, portTileSet, portsOf } from "./ports";

afterEach(resetCooling);

/** A dry map with a Data Centre on x 10–12, y 10–12: its inlets at (13, 11), the S face, and (11, 13), the W. */
function town() {
  const g = createGrid(24, 24);
  fillTerrain(g, 1);
  commit(g, createHistory(), placeCommand(g, { ...structureDef("datacentre")!, placement: undefined }, 10, 10)!);
  const dc = [...g.structures.values()].find((s) => s.def === "datacentre")!;
  return { g, dc };
}
const dry = () => false;
const at = (g: Grid, x: number, y: number) => idx(g, x, y);

describe("a building's ports", () => {
  test("are the tiles in front of the nozzles on its camera-facing faces", () => {
    const { g, dc } = town();
    expect(portsOf(g, dc).map((p) => [p.x, p.y])).toEqual([[13, 11], [11, 13]]);
  });

  test("are the only place a main feeds it: an outlet there, a wall elsewhere refused", () => {
    const { g, dc } = town();
    const ok = planMain(g, [{ x: 17, y: 11 }, { x: 16, y: 11 }, { x: 15, y: 11 }, { x: 14, y: 11 }, { x: 13, y: 11 }], dry);
    expect("cells" in ok && ok.cells[ok.cells.length - 1].end).toBe(MAIN_END.outlet);
    expect(outletBuilding(g, at(g, 13, 11))).toBe(dc.id);
    expect(planMain(g, [{ x: 13, y: 15 }, { x: 13, y: 14 }, { x: 13, y: 13 }, { x: 13, y: 12 }], dry)).toEqual({ refused: "Join the Data Centre at one of its inlets" });
    expect(outletBuilding(g, at(g, 13, 12))).toBe(-1);
  });

  test("catch a drag that ends on the building or against its wall: it snaps to the nearest inlet", () => {
    const { g } = town();
    expect(routeMain(g, { x: 17, y: 12 }, { x: 12, y: 12 }, dry)?.at(-1)).toEqual({ x: 13, y: 11 });
    expect(routeMain(g, { x: 9, y: 17 }, { x: 9, y: 12 }, dry)?.at(-1)).toEqual({ x: 11, y: 13 });
  });

  test("take the old mains: one ended against the wall is run on round to an inlet, its old end a length of run", () => {
    const { g, dc } = town();
    // Laid as the old rules let it: into the N face, away from any inlet.
    const cells = [{ x: 5, y: 11 }, { x: 6, y: 11 }, { x: 7, y: 11 }, { x: 8, y: 11 }, { x: 9, y: 11 }];
    layMain(g, cells.map((c, k) => ({
      ...c, join: (k > 0 ? DIR.N : 0) | (k < cells.length - 1 ? DIR.S : 0),
      end: k === 0 ? MAIN_END.cap : k === cells.length - 1 ? MAIN_END.outlet : 0,
    })));
    expect(outletBuilding(g, at(g, 9, 11))).toBe(-1);
    expect(mainsToPorts(g, dry)).toBe(true);
    expect(g.mainEnd[at(g, 9, 11)]).toBe(0);
    const outlets = [...g.mainEnd.keys()].filter((i) => g.mainEnd[i] === MAIN_END.outlet);
    expect(outlets.map((i) => outletBuilding(g, i))).toEqual([dc.id]);
    expect(mainsToPorts(g, dry)).toBe(false);
  });

  test("are open to a main while one has no building on it", () => {
    const { g } = town();
    expect(inletOpen(g, "ai-node", 5, 5, 1, 1)).toBe(true);
    // A house on each: the node's inlets at (6, 5) and (5, 6) are both covered.
    for (const [x, y] of [[6, 5], [5, 6]]) commit(g, createHistory(), placeCommand(g, { ...structureDef("kit:intern.t0")!, placement: undefined }, x, y)!);
    expect(inletOpen(g, "ai-node", 5, 5, 1, 1)).toBe(false);
    expect(inletOpen(g, "kit:intern.t0", 5, 5, 1, 1)).toBe(true);
  });
});

describe("a site that keeps the ports", () => {
  test("covers no building's port, slop or water, and leaves one of its own open", () => {
    const g = createGrid(24, 24);
    fillTerrain(g, 1);
    commit(g, createHistory(), placeCommand(g, { ...structureDef("office-vibe")!, placement: undefined }, 10, 10)!);
    const office = [...g.structures.values()].find((s) => s.def === "office-vibe")!;
    const slop = portsOf(g, office).find((p) => p.port.fluid === "slop")!;
    const taken = portTileSet(g);
    expect(taken.has(slop.i)).toBe(true);
    // A lot on the slop port is refused; one a tile further on is not.
    expect(keepsPorts(g, taken, "kit:intern.t0", slop.x, slop.y, 1, 1)).toBe(false);
    expect(keepsPorts(g, taken, "kit:intern.t0", slop.x + 1, slop.y + 1, 1, 1)).toBe(true);
  });
});
