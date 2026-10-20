import { describe, expect, test } from "bun:test";

import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, type Grid } from "../grid";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { GRACE_MS, createCutaway, occludersOf, tileRect, type Rect } from "./cutaway";

/** Flat ground and a building at each of these tiles. */
function town(at: [number, number][]): Grid {
  const g = createGrid(24, 24);
  fillTerrain(g, 1);
  for (const [x, y] of at) commit(g, createHistory(), placeCommand(g, { ...structureDef("kit:intern.t2")!, placement: undefined }, x, y)!);
  return g;
}
/** A building drawn `tall` half steps high off its tile. */
const tallAs = (g: Grid, tall: number) => (id: number): Rect | null => {
  const s = g.structures.get(id);
  return s ? tileRect(g, s, 1, tall) : null;
};

describe("seeing behind", () => {
  test("a tall building in front of the focus is in the way; one behind it, or off to the side, is not", () => {
    const g = town([[12, 12], [10, 10], [12, 7]]);
    const [front, behind, aside] = [...g.structures.values()].map((s) => s.id);
    const focus = [{ x: 11, y: 11 }];
    const got = occludersOf(g, focus, 1, tallAs(g, 12));
    expect(got.has(front)).toBe(true);
    expect(got.has(behind)).toBe(false);
    expect(got.has(aside)).toBe(false);
  });

  test("a short one in front does not reach up over the focus", () => {
    const g = town([[14, 14]]);
    expect(occludersOf(g, [{ x: 11, y: 11 }], 1, tallAs(g, 1)).size).toBe(0);
  });

  test("the building the focus is on is never in its own way", () => {
    const g = town([[12, 12]]);
    expect(occludersOf(g, [{ x: 12, y: 12 }], 1, tallAs(g, 12)).size).toBe(0);
  });

  test("down at once, and up again only once its grace is over", () => {
    const c = createCutaway();
    expect(c.set(new Set([1, 2]), 0).collapse.sort()).toEqual([1, 2]);
    expect(c.set(new Set([1]), 100).collapse).toEqual([]);
    expect(c.tick(100 + GRACE_MS - 1).raise).toEqual([]);
    expect(c.tick(100 + GRACE_MS).raise).toEqual([2]);
    // Back in the way before its grace was out: never stood up.
    c.set(new Set([]), 1000);
    c.set(new Set([1]), 1000 + GRACE_MS / 2);
    expect(c.tick(1000 + GRACE_MS * 2).raise).toEqual([]);
    expect(c.has(1)).toBe(true);
  });
});
