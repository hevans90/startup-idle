/**
 * THE SLOP LOADER: a berth fitting that gives a port a slop inlet on each
 * end, a tank the sewer fills, and a barge that empties it.
 * @see slop-loader, plans/seaports.md "Left to do, after the pipes"
 */
import { describe, expect, test } from "bun:test";

import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx, setHeight, type Grid } from "../grid";
import { stepSlop, tanksOf } from "../slop/tanks";
import { SEAPORTS, structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { createWaterField } from "../water/field";
import { layMain, planMain, runMains } from "../water/mains";
import { foulingIn } from "../water/pollution";
import { portsOf } from "../water/ports";
import { lookOf } from "./cargo";
import { FITTINGS, fitsTier, fitting } from "./fittings";
import { BARGE_HOLDS, LOADER_HOLDS, LOADER_RATE, bargeLoad, bargeTakes, loaderFill, loaderLevel } from "./slop-loader";
import { workOf } from "./traffic";

/**
 * A lake down the west edge; a tier two port on x 4–5, y 5–7, its quay on the
 * water to its west, so its landward wall faces east; a vibe office on
 * x 10–11, y 3–4, its slop port at (12, 4).
 */
function harbour(fit: string[] = ["trade", "slop"]) {
  const g = createGrid(24, 14);
  fillTerrain(g, 1);
  for (let y = 0; y < 14; y++) for (let x = 0; x < 24; x++) setHeight(g, x, y, x <= 3 ? -2 : 2);
  for (let y = 0; y < 14; y++) for (let x = 0; x <= 3; x++) g.pool[idx(g, x, y)] = 4;
  commit(g, createHistory(), placeCommand(g, { ...structureDef("office-vibe")!, placement: undefined }, 10, 3)!);
  const office = [...g.structures.values()].find((s) => s.def === "office-vibe")!;
  // Set down by hand, facing the lake: placing one is the quay's own business. @see quay.test
  const id = g.nextStructureId++;
  const port = { id, def: SEAPORTS[1].id, kind: "", x: 4, y: 5, w: 2, h: 3, facing: "N" as const, fit } as never as import("../grid").Structure;
  g.structures.set(id, port);
  for (let y = 5; y <= 7; y++) for (let x = 4; x <= 5; x++) g.structureAt[idx(g, x, y)] = id;
  g.rev++;
  return { g, office, port, field: createWaterField(g) };
}
const wetOf = (g: Grid) => (x: number, y: number) => g.pool[idx(g, x, y)] > 0;

describe("the slop loader", () => {
  test("is a berth fitting of a port with two berths or more, once sewers are open; its barge is the lighter, and no crane works it", () => {
    const f = fitting("slop");
    expect(f.id).toBe("slop");
    expect(FITTINGS.includes(f)).toBe(true);
    expect(fitsTier(f, 1)).toBe(false);
    expect(fitsTier(f, 2)).toBe(true);
    expect(f.needs).toBe("sewers");
    // It earns nothing: the barge bills.
    expect(f.pay).toBe(0);
    expect(lookOf(0, "slop", false, false)).toBe("lighter");
    expect(workOf("lighter", "slop", 1, 20)).toBeNull();
  });

  test("gives its port a slop inlet on each end, at the corner away from the water, and only while fitted", () => {
    const { g, port } = harbour();
    const inlets = portsOf(g, port).filter((p) => p.port.fluid === "slop" && p.port.dir === "in");
    // Facing N (x − 1, the lake): its landward column is x = 5, and its ends are off y = 5 and y = 7.
    expect(inlets.map((p) => [p.x, p.y])).toEqual([[5, 4], [5, 8]]);
    expect(inlets.map((p) => p.port.face)).toEqual(["E", "W"]);
    // Neither is on the landward wall, where the port's road runs.
    expect(inlets.some((p) => p.x === 6)).toBe(false);
    port.fit = ["trade", "trade"];
    expect(portsOf(g, port).length).toBe(0);
  });

  test("a sewer ended on it fills its tank, as fast as it loads and no fuller than it holds; nothing goes in the water", () => {
    const { g, office, port, field } = harbour();
    const run = [{ x: 12, y: 4 }, { x: 12, y: 5 }, { x: 12, y: 6 }, { x: 12, y: 7 }, { x: 12, y: 8 }, { x: 11, y: 8 }, { x: 10, y: 8 }, { x: 9, y: 8 }, { x: 8, y: 8 }, { x: 7, y: 8 }, { x: 6, y: 8 }, { x: 5, y: 8 }];
    const p = planMain(g, run, wetOf(g), false, true);
    if ("refused" in p) throw new Error(p.refused);
    layMain(g, p.cells, true);
    const desks = new Map([[office.id, { used: 1 }]]);
    // Made twice as fast as one loader loads: it takes its rate, and the rest stays in the office's tank.
    for (let k = 0; k < 20; k++) { runMains(field, g, 1); stepSlop(g, field, desks, LOADER_RATE * 2, 1); }
    expect(loaderLevel(g, port.id)).toBeGreaterThan(LOADER_RATE * 20 * 0.8);
    expect(loaderLevel(g, port.id)).toBeLessThanOrEqual(LOADER_RATE * 20 + 1e-6);
    for (let k = 0; k < 200; k++) { runMains(field, g, 1); stepSlop(g, field, desks, LOADER_RATE * 2, 1); }
    expect(loaderLevel(g, port.id)).toBeCloseTo(LOADER_HOLDS, 4);
    expect(loaderFill(g, port)).toBeCloseTo(1, 4);
    // Full, it backs the sewer up into the office's tank.
    expect(tanksOf(g).get(office.id)!.spilling).toBe(true);
    // A barge takes a hold of it, and the sewer runs again.
    expect(bargeLoad(g, port.id)).toBe(BARGE_HOLDS);
    expect(bargeTakes(g, port.id)).toBe(BARGE_HOLDS);
    expect(loaderLevel(g, port.id)).toBeCloseTo(LOADER_HOLDS - BARGE_HOLDS, 4);
    const lake = foulingIn(field);
    runMains(field, g, 1); stepSlop(g, field, desks, LOADER_RATE * 2, 1);
    expect(loaderLevel(g, port.id)).toBeGreaterThan(LOADER_HOLDS - BARGE_HOLDS);
    // Refitted, what it held is put on the ground by the port: none is lost.
    const held = loaderLevel(g, port.id);
    port.fit = ["trade", "trade"];
    g.rev++;
    runMains(field, g, 1); stepSlop(g, field, desks, 0, 1);
    expect(loaderLevel(g, port.id)).toBe(0);
    expect(foulingIn(field) - lake).toBeGreaterThan(held * 0.4);
  });
});
