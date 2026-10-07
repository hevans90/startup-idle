import { describe, expect, test } from "bun:test";

import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx, setHeight, type Grid } from "../grid";
import { createNetwork } from "../roads/network";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { carLine, placesOf, routeBetween, walkLine } from "./roads";
import { createTown, stepTown, wanted } from "./town";

const pave = (g: Grid, x: number, y: number) => { g.paved[idx(g, x, y)] = 1; };

/** A two-lane road along rows 4 and 5, edge to edge. */
function avenue(w = 20, h = 12) {
  const g = createGrid(w, h);
  fillTerrain(g, 1);
  for (let x = 0; x < w; x++) { pave(g, x, 4); pave(g, x, 5); }
  return g;
}

/** Houses along both sides of a road. */
function street(g: Grid, xs: number[]) {
  const history = createHistory();
  const kit = structureDef("kit:intern.t0")!;
  for (const x of xs) {
    for (const y of [3, 6]) {
      const cmd = placeCommand(g, kit, x, y);
      if (cmd) commit(g, history, cmd);
    }
  }
}

describe("routes", () => {
  test("keep to the right-hand lane of a wide road, both ways", () => {
    const g = avenue();
    // East, the right is +y: row 5. West, it is row 4.
    const east = routeBetween(g, { x: 1, y: 4 }, { x: 18, y: 4 })!;
    expect(east.slice(2, -2).every((c) => c.y === 5)).toBe(true);
    const west = routeBetween(g, { x: 18, y: 5 }, { x: 1, y: 5 })!;
    expect(west.slice(2, -2).every((c) => c.y === 4)).toBe(true);
  });

  test("do not climb a step the road cannot", () => {
    const g = createGrid(12, 6);
    fillTerrain(g, 1);
    for (let x = 0; x < 12; x++) pave(g, x, 2);
    for (let x = 6; x < 12; x++) setHeight(g, x, 2, 4);
    expect(routeBetween(g, { x: 1, y: 2 }, { x: 10, y: 2 })).toBeNull();
  });

  test("a car keeps right of a lone lane's middle; a person walks its kerb", () => {
    const g = createGrid(12, 6);
    fillTerrain(g, 1);
    for (let x = 0; x < 12; x++) pave(g, x, 2);
    const path = routeBetween(g, { x: 1, y: 2 }, { x: 10, y: 2 })!;
    const car = carLine(g, path), walk = walkLine(g, path);
    expect(car[4].y).toBeCloseTo(2.22, 6);            // right of +x is +y
    expect(Math.abs(walk[4].y - 2)).toBeCloseTo(0.38, 6);
    // On the wide road the cell is the lane.
    const a = avenue();
    expect(carLine(a, routeBetween(a, { x: 1, y: 5 }, { x: 10, y: 5 })!)[4].y).toBe(5);
  });
});

describe("the town", () => {
  test("has a door for each building and a gateway for each road off the map", () => {
    const g = avenue();
    street(g, [4, 8, 12]);
    const places = placesOf(g, createNetwork(g));
    expect(places.filter((p) => p.kind === "door")).toHaveLength(6);
    expect(places.filter((p) => p.kind === "gateway")).toHaveLength(4);
    expect(wanted(places)).toEqual({ cars: 12, people: 12 });
    // An empty map, or a road with nowhere to go, has nobody on it.
    expect(wanted([])).toEqual({ cars: 0, people: 0 });
  });

  test("goes about its business: on the road, never into each other, and getting where it is going", () => {
    const g = avenue(24, 12);
    // And a side street, so there is a junction to get through.
    for (let y = 6; y < 12; y++) { pave(g, 11, y); pave(g, 12, y); }
    street(g, [4, 8, 16, 20]);
    const net = createNetwork(g);
    const t = createTown();
    let arrived = 0, closest = Infinity, offRoad = 0, seenCars = 0;
    for (let k = 0; k < 120 * 30; k++) {
      const before = new Set(t.movers.map((m) => m.id));
      stepTown(t, g, net, 0, 1 / 30);
      const after = new Set(t.movers.map((m) => m.id));
      for (const id of before) if (!after.has(id)) arrived++;
      const cars = t.movers.filter((m) => m.kind === "car");
      seenCars = Math.max(seenCars, cars.length);
      for (const m of t.movers) {
        const cx = Math.round(m.x), cy = Math.round(m.y);
        const onMap = cx >= 0 && cy >= 0 && cx < g.w && cy < g.h;
        if (onMap && g.paved[idx(g, cx, cy)] === 0) offRoad++;
      }
      // Two cars in one lane, one behind the other, never closer than nose to tail.
      for (const a of cars) {
        for (const b of cars) {
          if (a === b || a.pushing > 0 || b.pushing > 0) continue;
          const same = Math.cos(a.heading - b.heading) > 0.9;
          if (same) closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
        }
      }
    }
    expect(seenCars).toBeGreaterThan(5);
    expect(offRoad).toBe(0);
    expect(closest).toBeGreaterThan(0.3);
    // Two minutes of trips, finishing all the way through: no gridlock.
    expect(arrived).toBeGreaterThan(40);
  });

  test("lets go of people and cars whose road is taken up", () => {
    const g = avenue();
    street(g, [4, 8, 12]);
    const t = createTown();
    const net = createNetwork(g);
    for (let k = 0; k < 90; k++) stepTown(t, g, net, 0, 1 / 30);
    expect(t.movers.length).toBeGreaterThan(0);
    g.paved.fill(0);
    stepTown(t, g, net, 1, 1 / 30);
    expect(t.movers.length).toBe(0);
  });
});
