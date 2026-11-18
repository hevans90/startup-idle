import { describe, expect, test } from "bun:test";

import { createTown, stepTown } from "../agents/town";
import { placesOf } from "../agents/roads";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx } from "../grid";
import { createNetwork } from "../roads/network";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { sendHome } from "../lines/line-loads";
import { FLEET_OF, fleetFree, fleetSize, isYard, offRoad, queueYardLoad, stepYard, yardQueued } from "./fleet";

/** A road along row 5 edge to edge, the Garage north of it and a house far along it. */
function town() {
  const g = createGrid(40, 12);
  fillTerrain(g, 1);
  for (let x = 0; x < g.w; x++) g.paved[idx(g, x, 5)] = 1;
  const h = createHistory();
  commit(g, h, placeCommand(g, structureDef("garage")!, 2, 2)!);
  commit(g, h, placeCommand(g, structureDef("kit:intern.t0")!, 30, 4)!);
  const net = createNetwork(g), t = createTown(), places = placesOf(g, net);
  const yard = places.find((p) => p.structure !== undefined && g.structures.get(p.structure)!.def === "garage")!;
  const door = places.find((p) => p.structure !== undefined && g.structures.get(p.structure)!.def !== "garage")!;
  return { g, net, t, yard, door };
}

describe("the company's lorries", () => {
  test("a yard keeps so many; with no yard built there are none", () => {
    const { g } = town();
    expect(fleetSize(g)).toBe(FLEET_OF.garage);
    const bare = createGrid(8, 8);
    expect(fleetSize(bare)).toBe(0);
  });

  test("a load is one of the fleet's lorries: out of its bay, loaded, onto the road — the same lorry — and home into its bay again", () => {
    const { g, net, t, yard, door } = town();
    expect(isYard(g, yard)).toBe(true);
    expect(isYard(g, door)).toBe(false);
    expect(fleetFree(g, t)).toBe(FLEET_OF.garage);
    expect(queueYardLoad(g, t, yard, door, { site: 7, role: "truck" }, "pallets")).toBe(true);
    expect(queueYardLoad(g, t, yard, door, { site: 7, role: "truck" }, "pallets")).toBe(true);
    expect(yardQueued(t, "truck").get(7)).toBe(2);
    expect(fleetFree(g, t)).toBe(FLEET_OF.garage - 2);
    const mine = new Set(t.fleet.map((f) => f.m.id));
    let onRoad = 0, arrived = 0, legs = 0, jump = 0;
    const was = new Map<number, { x: number; y: number }>();
    for (let k = 0; k < 30 * 240 && (arrived < 2 || fleetFree(g, t) < FLEET_OF.garage); k++) {
      stepYard(t, g, 1 / 30);
      stepTown(t, g, net, 0, 1 / 30);
      // WHEREVER IT IS — in the yard, on a leg, on the road — it is somewhere, and next to where it was.
      for (const m of [...t.movers.filter((q) => mine.has(q.id)), ...offRoad(t).filter((q) => mine.has(q.id))]) {
        const p = was.get(m.id);
        if (p) jump = Math.max(jump, Math.hypot(m.x - p.x, m.y - p.y));
        was.set(m.id, { x: m.x, y: m.y });
      }
      onRoad = Math.max(onRoad, t.movers.filter((m) => m.fleet).length);
      legs = Math.max(legs, t.legs.length);
      for (const m of [...t.arrived]) {
        if (m.job?.role !== "truck") continue;
        arrived++;
        t.arrived.splice(t.arrived.indexOf(m), 1);
        sendHome(t, g, placesOf(g, net), m, door);
      }
    }
    expect(onRoad).toBeGreaterThan(0);
    expect(legs).toBeGreaterThan(0);
    expect(arrived).toBe(2);
    // Home, both: the fleet whole again.
    expect(fleetFree(g, t)).toBe(FLEET_OF.garage);
    // Never taken up and put down: no lorry moved more than a lorry moves in a frame.
    expect(jump).toBeLessThan(0.35);
  });
});
