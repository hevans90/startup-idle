import { describe, expect, test } from "bun:test";

import { PUMP_HEAD } from "../../game/cooling";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx, setHeight, type Grid } from "../grid";
import { structureDef } from "../structures/def";
import { placeCommand, validatePlacement } from "../structures/place";
import { gamePipeRun } from "../water/pipes";
import { routePipe } from "./pipe-route";

/** Water down column 1 standing `top` high; a Data Centre at x 10–12, y 6–8 on ground `floor`. */
function town(top: number, floor = 0) {
  const g = createGrid(16, 16);
  fillTerrain(g, 1);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) setHeight(g, x, y, x >= 8 ? floor : 0);
  for (let y = 0; y < 16; y++) { setHeight(g, 1, y, -4); g.pool[idx(g, 1, y)] = top + 4; }
  commit(g, createHistory(), placeCommand(g, { ...structureDef("datacentre")!, placement: undefined }, 10, 6)!);
  return { g, dc: [...g.structures.values()].find((s) => s.def === "datacentre")! };
}
const wet = (g: Grid) => (x: number, y: number) => g.pool[idx(g, x, y)] > 0;
const surface = (g: Grid) => (x: number, y: number) => g.height[idx(g, x, y)] + g.pool[idx(g, x, y)];
const mine = () => true;

describe("a pipe's route", () => {
  test("is a gravity run where the water stands above the building, valid for the Pipe tool", () => {
    const { g, dc } = town(2, 0);
    const r = routePipe(g, dc, mine, wet(g), surface(g))!;
    expect(r.pump).toBeNull();
    expect(r.pipe[0].x).toBe(2);                         // beside the water
    const end = r.pipe[r.pipe.length - 1];
    expect(end.x === 9 || end.y === 5 || end.y === 9).toBe(true);
    expect(gamePipeRun(g, r.pipe, wet(g))).not.toHaveProperty("refused");
  });

  test("ends at a pump house where the water stands below it, within a pump's lift", () => {
    const { g, dc } = town(-1, 2);
    const r = routePipe(g, dc, mine, wet(g), surface(g))!;
    expect(r.pump).toEqual({ x: 2, y: r.pump!.y });
    expect(validatePlacement(g, structureDef("pump")!, r.pump!.x, r.pump!.y).ok).toBe(true);
  });

  test("is none where a pump cannot lift it", () => {
    const { g, dc } = town(-1, PUMP_HEAD + 4);
    expect(routePipe(g, dc, mine, wet(g), surface(g))).toBeNull();
  });

  test("goes round buildings, and only over the company's land", () => {
    const { g, dc } = town(2, 0);
    // A wall of houses from y 0 to 13 at x 6, leaving a gap at the bottom.
    for (let y = 0; y < 14; y++) commit(g, createHistory(), placeCommand(g, { ...structureDef("kit:intern.t0")!, placement: undefined }, 6, y)!);
    const r = routePipe(g, dc, mine, wet(g), surface(g))!;
    expect(r.pipe.every((c) => c.x !== 6 || c.y >= 14)).toBe(true);
    expect(routePipe(g, dc, (x) => x >= 6, wet(g), surface(g))).toBeNull();
  });
});
