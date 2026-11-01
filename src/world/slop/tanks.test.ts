import { describe, expect, test } from "bun:test";

import { SLOP_FROM, SLOP_PER_CODER, TANK_SECONDS, slopMade } from "../../game/slop";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx, setHeight, type Grid } from "../grid";
import { resetCooling } from "../projects/cooling";
import { sludgeAt } from "../events/sludge";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { createWaterField } from "../water/field";
import { layMain, planMain, runMains } from "../water/mains";
import { pollute, pollutionOf, restorePollution } from "../water/pollution";
import { fromJSON, serializeWorld, toJSON } from "../io/serialize";
import { getWater, useWorldStore } from "../../state/world.store";
import { stepSlop, tanksOf } from "./tanks";

/** A lake down the west edge; two vibe offices on dry ground, the first's slop port at (12, 4). */
function street() {
  const g = createGrid(24, 14);
  fillTerrain(g, 1);
  for (let y = 0; y < 14; y++) for (let x = 0; x < 24; x++) setHeight(g, x, y, x <= 3 ? -2 : 2);
  for (let y = 0; y < 14; y++) for (let x = 0; x <= 3; x++) g.pool[idx(g, x, y)] = 4;
  for (const [x, y] of [[10, 3], [10, 9]]) commit(g, createHistory(), placeCommand(g, { ...structureDef("office-vibe")!, placement: undefined }, x, y)!);
  const [a, b] = [...g.structures.values()].filter((s) => s.def === "office-vibe");
  return { g, a, b, field: createWaterField(g) };
}
const wetOf = (g: Grid) => (x: number, y: number) => g.pool[idx(g, x, y)] > 0;
const pollution = (f: ReturnType<typeof createWaterField>) => pollutionOf(f.columns).mass.reduce((n, m) => n + m, 0);

describe("slop", () => {
  test("is made from the fiftieth vibe coder on, less by happy ones", () => {
    expect(slopMade(SLOP_FROM - 1, 0)).toBe(0);
    expect(slopMade(100, 0)).toBeCloseTo(100 * SLOP_PER_CODER, 9);
    expect(slopMade(100, 40)).toBeLessThan(slopMade(100, 0));
    expect(slopMade(100, 0, 1.2)).toBeCloseTo(1.2 * slopMade(100, 0), 9);
  });

  test("fills each workplace's tank by who sits at its desks", () => {
    const { g, a, b, field } = street();
    stepSlop(g, field, new Map([[a.id, { used: 30 }], [b.id, { used: 10 }]]), 1, 10);
    const t = tanksOf(g);
    expect(t.get(a.id)!.level).toBeCloseTo(7.5, 6);
    expect(t.get(b.id)!.level).toBeCloseTo(2.5, 6);
    expect(t.get(a.id)!.capacity).toBeCloseTo(0.75 * TANK_SECONDS, 6);
    expect(t.get(a.id)!.spilling).toBe(false);
  });

  test("full, spills at its port: sludge on the street", () => {
    const { g, a, field } = street();
    const desks = new Map([[a.id, { used: 1 }]]);
    for (let k = 0; k < 2 * TANK_SECONDS + 20; k++) stepSlop(g, field, desks, 1, 1);
    expect(tanksOf(g).get(a.id)!.spilling).toBe(true);
    expect(sludgeAt(field, 12, 4)).toBeGreaterThan(0);
    expect(pollution(field)).toBe(0);
  });

  test("a sewer from its port to the lake drains it, out of the outfall into the water", () => {
    resetCooling();
    const { g, a, field } = street();
    const cells = [...Array.from({ length: 9 }, (_, k) => ({ x: 4 + k, y: 6 })), { x: 12, y: 5 }, { x: 12, y: 4 }];
    const p = planMain(g, cells, wetOf(g), false, true);
    if ("refused" in p) throw new Error(p.refused);
    layMain(g, p.cells, true);
    const desks = new Map([[a.id, { used: 1 }]]);
    for (let k = 0; k < 2 * TANK_SECONDS + 20; k++) { runMains(field, g, 1); stepSlop(g, field, desks, 0.5, 1); }
    const t = tanksOf(g).get(a.id)!;
    expect(t.spilling).toBe(false);
    expect(t.level).toBeLessThan(1);
    expect(pollution(field)).toBeGreaterThan(50);
    expect(sludgeAt(field, 12, 4)).toBe(0);
  });
});

describe("a workplace with its slop port built over", () => {
  test("still spills, out of the nearest gap round it", async () => {
    const { spillAt } = await import("./tanks");
    const { g, a } = street();
    expect(spillAt(g, a)).toEqual({ x: 12, y: 4 });
    commit(g, createHistory(), placeCommand(g, { ...structureDef("kit:intern.t0")!, placement: undefined }, 12, 4)!);
    const at = spillAt(g, a)!;
    expect(g.structureAt[idx(g, at.x, at.y)]).toBe(-1);
    expect(Math.abs(at.x - 12) + Math.abs(at.y - 4)).toBe(1);
  });
});

describe("saved with the map", () => {
  test("the slop in the water and what each tank holds come back with the file", () => {
    const { g, a, field } = street();
    pollute(field, 2, 5, 3);
    tanksOf(g).set(a.id, { level: 40, capacity: 0, rate: 0, spilling: false });
    const loaded = fromJSON(toJSON(serializeWorld(g, { terrain: [null], paved: [null] }, field)));
    const next = createWaterField(loaded.grid);
    restorePollution(next, loaded.grid);
    expect(pollution(next)).toBeCloseTo(3, 5);
    expect(pollutionOf(next.columns).mass[5 * loaded.grid.w + 2]).toBeCloseTo(3, 5);
    expect(tanksOf(loaded.grid).get(a.id)!.level).toBe(40);
  });

  test("a map loaded into the game brings its pollution onto the water made for it", () => {
    const { g, field } = street();
    pollute(field, 2, 5, 3);
    const loaded = fromJSON(toJSON(serializeWorld(g, { terrain: [null], paved: [null] }, field)));
    useWorldStore.getState().loadGrid(loaded.grid, loaded.palette.terrain, loaded.boats);
    expect(pollution(getWater())).toBeCloseTo(3, 5);
  });

  test("a clean map writes neither", () => {
    const { g, field } = street();
    const f = serializeWorld(g, { terrain: [null], paved: [null] }, field);
    expect(f.pollution).toBeUndefined();
    expect(f.slopTanks).toBeUndefined();
  });

  test("a loaded tank keeps what it holds until slop is being made", () => {
    const { g, a, field } = street();
    tanksOf(g).set(a.id, { level: 40, capacity: 0, rate: 0, spilling: false });
    stepSlop(g, field, null, 0, 1);
    expect(tanksOf(g).get(a.id)!.level).toBe(40);
    expect(tanksOf(g).get(a.id)!.spilling).toBe(false);
  });
});
