import { describe, expect, test } from "bun:test";

import { DIR } from "../../iso/dir";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx, setHeight } from "../grid";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { gamePipeRun, isPort } from "./pipes";

/** Water down column 2, a Data Centre at x 10..12, y 5..7. S is x+1, N is x-1. */
function town() {
  const g = createGrid(16, 12);
  fillTerrain(g, 1);
  for (let y = 0; y < 12; y++) g.pool[idx(g, 2, y)] = 1;
  commit(g, createHistory(), placeCommand(g, { ...structureDef("datacentre")!, placement: undefined }, 10, 5)!);
  return g;
}
const row = (x0: number, x1: number, y: number) => Array.from({ length: x1 - x0 + 1 }, (_, k) => ({ x: x0 + k, y }));

describe("a run of pipe laid in the game", () => {
  test("draws from the water at one end and feeds the Data Centre at the other, closed between", () => {
    const g = town();
    const run = gamePipeRun(g, row(3, 9, 6));
    if ("refused" in run) throw new Error(run.refused);
    expect(run[0].facing).toBe(DIR.N);                       // at the water, x 2
    expect(run[run.length - 1].facing).toBe(DIR.S);          // into the Data Centre, x 10
    for (const c of run) g.pipe[idx(g, c.x, c.y)] = c.facing;
    const ports = run.filter((c) => isPort(g, c.x, c.y)).map((c) => c.x);
    expect(ports).toEqual([3, 9]);
  });

  test("caps an end with nothing to face, rather than spilling", () => {
    const g = town();
    const run = gamePipeRun(g, row(5, 8, 2));
    if ("refused" in run) throw new Error(run.refused);
    for (const c of run) g.pipe[idx(g, c.x, c.y)] = c.facing;
    expect(run.filter((c) => isPort(g, c.x, c.y))).toEqual([]);
  });

  test("joins pipe already laid", () => {
    const g = town();
    g.pipe[idx(g, 4, 9)] = DIR.N;
    const run = gamePipeRun(g, row(5, 7, 9));
    if ("refused" in run) throw new Error(run.refused);
    expect(run[0].facing).toBe(DIR.N);
  });

  test("goes neither through a building nor in the water, and a lone tile needs something to face", () => {
    const g = town();
    expect(gamePipeRun(g, row(8, 11, 6))).toHaveProperty("refused");
    expect(gamePipeRun(g, row(2, 4, 3))).toHaveProperty("refused");
    expect(gamePipeRun(g, [{ x: 6, y: 1 }])).toHaveProperty("refused");
    expect(gamePipeRun(g, [{ x: 3, y: 1 }])).not.toHaveProperty("refused");
  });

  test("goes down to the water's floor at its water end, and never climbs after", () => {
    const g = town();
    // The water's bed at -4, a bank at 2, a dip to -6 halfway, then up to 0.
    for (let y = 0; y < 12; y++) setHeight(g, 2, y, -4);
    for (const [x, h] of [[3, 2], [4, 2], [5, -6], [6, 0], [7, 0], [8, 0], [9, 0]] as const) setHeight(g, x, 6, h);
    const run = gamePipeRun(g, row(3, 9, 6));
    if ("refused" in run) throw new Error(run.refused);
    expect(run.map((c) => c.z)).toEqual([-4, -4, -6, -6, -6, -6, -6]);
  });
});
