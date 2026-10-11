import { describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, idx, type Structure } from "../grid";
import { createNetwork } from "../roads/network";
import { createTown, stepTown } from "../agents/town";
import { createWaterField } from "../water/field";
import { HAUL_LOAD, SLUDGED, overflow, sludgeAt, sludgedHouses, sendSludgeTrucks, stepHaulers } from "./sludge";

describe("the sludge", () => {
  test("pours over the pit's rim, and a house right against it is under sludge", () => {
    const g = createGrid(20, 20);
    fillTerrain(g, 1);
    const pit: Structure = { id: 1, def: "slop-pit", x: 8, y: 8, w: 3, h: 3 };
    const house: Structure = { id: 2, def: "kit:intern.t0", x: 12, y: 9, w: 1, h: 1, residents: 2 };
    g.structures.set(1, pit); g.structures.set(2, house);
    const field = createWaterField(g);
    overflow(field, g, pit, 2);
    expect(sludgeAt(field, 11, 9)).toBeGreaterThan(SLUDGED);
    expect(sludgeAt(field, 3, 3)).toBe(0);
    expect([...sludgedHouses(field, g)]).toEqual([2]);
  });

  test("never onto a building beside the pit, whose roof would shed it like a fountain", () => {
    const g = createGrid(20, 20);
    fillTerrain(g, 1);
    const pit: Structure = { id: 1, def: "slop-pit", x: 8, y: 8, w: 3, h: 3 };
    const studio: Structure = { id: 2, def: "studio", x: 11, y: 8, w: 3, h: 2 };
    g.structures.set(1, pit); g.structures.set(2, studio);
    for (const s of [pit, studio]) {
      for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) g.structureAt[idx(g, x, y)] = s.id;
    }
    const field = createWaterField(g);
    overflow(field, g, pit, 2);
    expect(sludgeAt(field, 11, 8)).toBe(0);
    expect(sludgeAt(field, 11, 9)).toBe(0);
    expect(sludgeAt(field, 7, 9)).toBeGreaterThan(0);
  });

  test("stops pouring where it already lies deep", () => {
    const g = createGrid(20, 20);
    fillTerrain(g, 1);
    const pit: Structure = { id: 1, def: "slop-pit", x: 8, y: 8, w: 3, h: 3 };
    g.structures.set(1, pit);
    const field = createWaterField(g);
    for (let k = 0; k < 200; k++) overflow(field, g, pit, 1);
    expect(sludgeAt(field, 7, 9)).toBeLessThan(4);
  });
});

describe("sludge trucks", () => {
  test("drive in from the edge of the map, each take a load, and drive away", () => {
    const g = createGrid(30, 12);
    fillTerrain(g, 1);
    for (let x = 0; x < g.w; x++) g.paved[idx(g, x, 5)] = 1;
    const pit: Structure = { id: 1, def: "slop-pit", x: 14, y: 2, w: 3, h: 3 };
    g.structures.set(1, pit);
    for (let y = 2; y < 5; y++) for (let x = 14; x < 17; x++) g.structureAt[idx(g, x, y)] = 1;
    const net = createNetwork(g), town = createTown();
    expect(sendSludgeTrucks(town, g, net, pit, 3)).toBe(3);
    let hauled = 0, back = 0;
    for (let k = 0; k < 30 * 60; k++) {
      stepTown(town, g, net, 0, 1 / 30);
      stepHaulers(town, g, net, (p) => { hauled += p; }, () => { back++; });
      town.arrived.length = 0;
    }
    expect(hauled).toBe(3 * HAUL_LOAD);
    expect(back).toBe(3);
  });
});
