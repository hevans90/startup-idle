import { describe, expect, test } from "bun:test";

import { createTown, stepTown } from "../agents/town";
import { placesOf } from "../agents/roads";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx } from "../grid";
import { createNetwork } from "../roads/network";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { FLEET_OF, fleetBusy, fleetFree, fleetSize, isYard, queueYardLoad, stepYard, yardQueued } from "./fleet";

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

  test("a load is put on a lorry under the crane, one after another; the lorry is out till it is home", () => {
    const { g, net, t, yard, door } = town();
    expect(isYard(g, yard)).toBe(true);
    expect(isYard(g, door)).toBe(false);
    queueYardLoad(g, t, yard, door, { site: 7, role: "truck" });
    queueYardLoad(g, t, yard, door, { site: 7, role: "truck" });
    expect(yardQueued(t, "truck").get(7)).toBe(2);
    // (The second waits for the crane: it is loaded after the first.)
    expect(t.yard[1].left).toBeGreaterThan(t.yard[0].left);
    expect(fleetBusy(g, t)).toBe(2);
    expect(fleetFree(g, t)).toBe(FLEET_OF.garage - 2);
    let out = 0, arrived = 0;
    for (let k = 0; k < 30 * 90 && arrived < 2; k++) {
      stepYard(t, g, 1 / 30);
      stepTown(t, g, net, 0, 1 / 30);
      out = Math.max(out, t.movers.filter((m) => m.fleet).length);
      arrived += t.arrived.filter((m) => m.job?.role === "truck").length;
      t.arrived.length = 0;
    }
    expect(out).toBeGreaterThan(0);
    expect(arrived).toBe(2);
    // (Nothing sent home here: they are simply there, and the fleet is whole again.)
    expect(fleetFree(g, t)).toBe(FLEET_OF.garage);
  });
});
