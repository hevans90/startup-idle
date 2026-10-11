import { describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, idx, type Structure } from "../grid";
import { createNetwork } from "../roads/network";
import { createTown, stepTown } from "../agents/town";
import { createWaterField, stepWater } from "../water/field";
import { HAUL_LOAD, SLUDGED, overflow, sludgeAt, sludgedHouses, sendSludgeTrucks, stepHaulers, syncPit } from "./sludge";

/** A map with a full pit at 8,8 and, optionally, more buildings, each on its cells. */
function pitMap(...more: Structure[]) {
  const g = createGrid(20, 20);
  fillTerrain(g, 1);
  g.height.fill(4);
  const pit: Structure = { id: 1, def: "slop-pit", x: 8, y: 8, w: 3, h: 3 };
  for (const s of [pit, ...more]) {
    g.structures.set(s.id, s);
    for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) g.structureAt[idx(g, x, y)] = s.id;
  }
  return { g, pit, field: createWaterField(g) };
}

describe("the sludge", () => {
  test("stands in the pit as deep as the pit is full, and follows it", () => {
    const { pit, field } = pitMap();
    let level = syncPit(null, field, pit, 50);
    expect(sludgeAt(field, 9, 9)).toBeCloseTo(1.5 * 0.85, 3);
    level = syncPit(level, field, pit, 100);
    expect(sludgeAt(field, 9, 9)).toBeCloseTo(3 * 0.85, 3);
    syncPit(level, field, pit, 0);
    expect(sludgeAt(field, 9, 9)).toBe(0);
  });

  test("in the pit, full, it is on nobody's doorstep", () => {
    const house: Structure = { id: 2, def: "kit:intern.t0", x: 11, y: 9, w: 1, h: 1, residents: 2 };
    const { g, pit, field } = pitMap(house);
    syncPit(null, field, pit, 100);
    for (let k = 0; k < 120; k++) stepWater(field, 1 / 30);
    expect([...sludgedHouses(field, g)]).toEqual([]);
  });

  test("overflowing, it brims over the rim onto open ground — never over a building", () => {
    const studio: Structure = { id: 2, def: "studio", x: 11, y: 8, w: 3, h: 2 };
    const house: Structure = { id: 3, def: "kit:intern.t0", x: 9, y: 12, w: 1, h: 1, residents: 2 };
    const { g, pit, field } = pitMap(studio, house);
    syncPit(null, field, pit, 100);
    for (let k = 0; k < 30 * 8; k++) {
      overflow(field, pit, 1 / 30);
      stepWater(field, 1 / 30);
    }
    expect(sludgeAt(field, 7, 9)).toBeGreaterThan(SLUDGED);
    expect(sludgeAt(field, 9, 11)).toBeGreaterThan(SLUDGED);
    // Nothing stands on the studio's roof: to the water it is a wall.
    for (let y = 8; y < 10; y++) for (let x = 11; x < 14; x++) expect(sludgeAt(field, x, y)).toBe(0);
    expect([...sludgedHouses(field, g)]).toEqual([3]);
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
