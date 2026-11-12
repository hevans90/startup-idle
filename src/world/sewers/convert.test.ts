import { describe, expect, test } from "bun:test";

import { commit, createHistory } from "../edit/commands";
import { MAIN_END, MAIN_SEWER, SEWER_FIT, createGrid, fillTerrain, idx, setHeight, type Grid } from "../grid";
import { resetCooling } from "../projects/cooling";
import { stepSlop, tanksOf } from "../slop/tanks";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { createWaterField } from "../water/field";
import { layMain, planMain, runMains, sewerStubs } from "../water/mains";
import { foulingIn } from "../water/pollution";
import { sewersUnderground } from "./convert";
import { lateralsOf, sewerReportsFor } from "./flow";
import { hasSewer, solveSewers } from "./solve";

/**
 * A lake down the west edge; two vibe offices, ports at (12, 4) and (12, 10);
 * an OLD above-ground sewer from the first's port down to the lake, and
 * along past the second, which a stub joins to it.
 */
function oldStreet(): { g: Grid; a: number; b: number } {
  const g = createGrid(24, 14);
  fillTerrain(g, 1);
  for (let y = 0; y < 14; y++) for (let x = 0; x < 24; x++) setHeight(g, x, y, x <= 3 ? -2 : 2);
  for (let y = 0; y < 14; y++) for (let x = 0; x <= 3; x++) g.pool[idx(g, x, y)] = 4;
  for (const [x, y] of [[10, 3], [10, 9]]) commit(g, createHistory(), placeCommand(g, { ...structureDef("office-vibe")!, placement: undefined }, x, y)!);
  const [a, b] = [...g.structures.values()].filter((s) => s.def === "office-vibe").map((s) => s.id);
  const wet = (x: number, y: number) => g.pool[idx(g, x, y)] > 0;
  // From the first's port, down x = 13 past the second's, then west along y = 12 to the lake.
  const cells = [{ x: 12, y: 4 }, { x: 13, y: 4 }, ...Array.from({ length: 8 }, (_, k) => ({ x: 13, y: 5 + k })), ...Array.from({ length: 9 }, (_, k) => ({ x: 12 - k, y: 12 }))];
  const p = planMain(g, cells, wet, false, true);
  if ("refused" in p) throw new Error(p.refused);
  layMain(g, p.cells, true);
  sewerStubs(g);
  return { g, a, b };
}

describe("an old above-ground sewer", () => {
  test("goes underground on the same tiles: its outfall kept, a manhole and a lateral for each workplace", () => {
    const { g, a, b } = oldStreet();
    expect(g.main[idx(g, 12, 10)] & MAIN_SEWER).toBeTruthy(); // the stub
    expect(sewersUnderground(g)).toBe(true);
    // The trunk, underground, where the old one ran.
    for (const [x, y] of [[13, 7], [8, 12], [4, 12]]) expect(hasSewer(g, idx(g, x, y))).toBe(true);
    expect(g.sewerFit[idx(g, 4, 12)]).toBe(SEWER_FIT.outfall);
    // Its old tubes up, but for the laterals: each from a port into a manhole beside it.
    expect(g.main[idx(g, 13, 7)]).toBe(0);
    const lats = lateralsOf(g);
    expect(lats.map((l) => l.sources).flat().sort()).toEqual([a, b].sort());
    for (const l of lats) {
      expect(l.node).not.toBeNull();
      expect(g.mainEnd[l.node!]).toBe(MAIN_END.drop);
      expect(solveSewers(g).drains[l.node!]).toBe(1);
    }
    // Twice is once.
    expect(sewersUnderground(g)).toBe(false);
  });

  test("converted, it drains both workplaces as it did", () => {
    resetCooling();
    const { g, a, b } = oldStreet();
    sewersUnderground(g);
    const field = createWaterField(g);
    const desks = new Map([[a, { used: 1 }], [b, { used: 1 }]]);
    for (let k = 0; k < 120; k++) { runMains(field, g, 1); stepSlop(g, field, desks, 0.4, 1); }
    expect(tanksOf(g).get(a)!.spilling).toBe(false);
    expect(tanksOf(g).get(b)!.spilling).toBe(false);
    expect(foulingIn(field)).toBeGreaterThan(0);
    expect([...sewerReportsFor(g).values()][0].state).toBe("flowing");
  });
});
