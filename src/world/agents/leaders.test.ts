import { describe, expect, test } from "bun:test";

import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx } from "../grid";
import { createNetwork } from "../roads/network";
import { placeCommand } from "../structures/place";
import { structureDef } from "../structures/def";
import { AT_WORK, createLeaders, stepLeaders } from "./leaders";
import { createTown, stepTown } from "./town";

describe("team leaders on the map", () => {
  test("walk from a home of their kind to work, stay a while, and walk home", () => {
    const g = createGrid(30, 12);
    fillTerrain(g, 1);
    for (let x = 0; x < g.w; x++) g.paved[idx(g, x, 5)] = 1;
    const history = createHistory();
    commit(g, history, placeCommand(g, structureDef("kit:intern.t1")!, 3, 4)!);
    commit(g, history, placeCommand(g, structureDef("garage")!, 22, 4)!);
    for (const s of g.structures.values()) if (s.def.startsWith("kit")) s.residents = 3;
    const net = createNetwork(g), town = createTown(), L = createLeaders();
    const seats = [{ id: "tl_1", role: "intern" as const }];
    const seen: string[] = [];
    for (let k = 0; k < 30 * 120; k++) {
      stepTown(town, g, net, 0, 1 / 30);
      stepLeaders(L, town, g, net, seats, 1 / 30);
      town.arrived.length = 0;
      const out = town.movers.some((m) => m.job?.role === "leader");
      const where = out ? "out" : L.at.get("tl_1")?.place ?? "?";
      if (seen[seen.length - 1] !== where) seen.push(where);
    }
    expect(seen.slice(0, 5)).toEqual(["home", "out", "work", "out", "home"]);
    expect(AT_WORK).toBeGreaterThan(0);
  });

  test("a leader gone leaves the map", () => {
    const g = createGrid(10, 10), net = createNetwork(g), town = createTown(), L = createLeaders();
    L.at.set("gone", { place: "home", wait: 1 });
    stepLeaders(L, town, g, net, [], 1);
    expect(L.at.size).toBe(0);
  });
});
