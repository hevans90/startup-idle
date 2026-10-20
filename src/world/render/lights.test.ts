import { describe, expect, test } from "bun:test";

import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx } from "../grid";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { lightsOf } from "./lights";

describe("the town's lights", () => {
  test("a lived-in house glows, an empty one is dark; lamps at junctions and along streets", () => {
    const g = createGrid(16, 16);
    fillTerrain(g, 1);
    for (let x = 2; x < 14; x++) g.paved[idx(g, x, 8)] = 1;
    g.paved[idx(g, 6, 9)] = 1;
    for (const x of [4, 5]) commit(g, createHistory(), placeCommand(g, structureDef("kit:intern.t0")!, x, 7, { needsRoad: true })!);
    const [lived, empty] = [...g.structures.values()];
    lived.residents = 2;
    empty.residents = 0;
    const l = lightsOf(g);
    const windows = l.filter((x) => x.kind === "window");
    expect(windows.map((w) => w.x)).toEqual([lived.x]);
    const lamps = l.filter((x) => x.kind === "lamp");
    expect(lamps.some((p) => p.x === 6 && p.y === 8)).toBe(true);
    expect(lamps.length).toBeGreaterThan(2);
    expect(lamps.length).toBeLessThan(12);
  });
});
