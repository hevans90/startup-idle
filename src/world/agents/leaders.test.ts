import { describe, expect, test } from "bun:test";

import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx } from "../grid";
import { createNetwork } from "../roads/network";
import { placeCommand } from "../structures/place";
import { structureDef } from "../structures/def";
import { AT_WORK, createLeaders, leadershipOf, stepLeaders } from "./leaders";
import { CAFE_BOOST, deskPerks, deskShare } from "./desk-perks";
import { placesOf } from "./roads";
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
    const garage = [...g.structures.values()].find((s) => s.def === "garage")!.id;
    const seats = [{ id: "tl_1", role: "intern" as const, placedAt: garage }];
    const lead = leadershipOf(g, placesOf(g, net), seats, new Map());
    const seen: string[] = [];
    for (let k = 0; k < 30 * 120; k++) {
      stepTown(town, g, net, 0, 1 / 30);
      stepLeaders(L, town, g, net, seats, lead, 1 / 30);
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
    stepLeaders(L, town, g, net, [], { of: new Map(), leads: new Map() }, 1);
    expect(L.at.size).toBe(0);
  });
});

describe("who the leaders lead", () => {
  /** A street: intern houses at 3 and 14, the garage at 0 and an intern office at 17. */
  function street() {
    const g = createGrid(30, 12);
    fillTerrain(g, 1);
    for (let x = 0; x < g.w; x++) g.paved[idx(g, x, 5)] = 1;
    const history = createHistory();
    commit(g, history, placeCommand(g, structureDef("garage")!, 0, 4)!);
    commit(g, history, placeCommand(g, structureDef("kit:intern.t1")!, 4, 4)!);
    commit(g, history, placeCommand(g, structureDef("kit:intern.t1")!, 14, 4)!);
    commit(g, history, placeCommand(g, structureDef("office-intern")!, 17, 3)!);
    for (const s of g.structures.values()) if (s.def.startsWith("kit")) s.residents = 3;
    const id = (def: string, x: number) => [...g.structures.values()].find((s) => s.def === def && s.x === x)!.id;
    return { g, net: createNetwork(g), id };
  }

  test("a leader leads the building they were put in, and lives in the most desirable home of their kind", () => {
    const { g, net, id } = street();
    const fond = (house: number) => new Map([[house, { total: 20, parts: [] }]]);
    const at = (placedAt: number | null) => [{ id: "tl_1", role: "intern" as const, name: "Ada", placedAt }];
    const office = leadershipOf(g, placesOf(g, net), at(id("office-intern", 17)), fond(id("kit:intern.t1", 4)));
    expect(office.of.get("tl_1")).toEqual({ home: id("kit:intern.t1", 4), work: id("office-intern", 17) });
    expect(office.leads.get(id("office-intern", 17))).toEqual(["Ada"]);
    const garage = leadershipOf(g, placesOf(g, net), at(id("garage", 0)), fond(id("kit:intern.t1", 14)));
    expect(garage.of.get("tl_1")).toEqual({ home: id("kit:intern.t1", 14), work: id("garage", 0) });
  });

  test("put nowhere, in another kind's building or one that is gone, they lead nothing", () => {
    const { g, net, id } = street();
    const lead = (placedAt: number | null, role: "intern" | "vibe_coder" = "intern") => leadershipOf(g, placesOf(g, net), [{ id: "tl_1", role, placedAt }], new Map());
    expect(lead(null).of.size).toBe(0);
    expect(lead(id("garage", 0), "vibe_coder").of.size).toBe(0);
    expect(lead(99999).of.size).toBe(0);
  });

  test("a led workplace's desks are named on its card, with no share of their own: a leader's effect is the kind's", () => {
    const { g, net, id } = street();
    const lead = leadershipOf(g, placesOf(g, net), [{ id: "tl_1", role: "intern" as const, name: "Ada", placedAt: id("office-intern", 17) }], new Map());
    expect(deskPerks(g, lead, g.structures.get(id("office-intern", 17))!)).toEqual({ share: 0, why: ["Led by Ada"] });
    expect(deskShare(g, lead, new Map([[id("office-intern", 17), { used: 4 }]]), { intern: 10 }).intern ?? 0).toBe(0);
  });

  test("a café next door is a tenth more at a workplace's desks, and says so", () => {
    const { g, id } = street();
    const office = g.structures.get(id("office-intern", 17))!;
    const none = { of: new Map(), leads: new Map() };
    expect(deskPerks(g, none, office)).toEqual({ share: 0, why: [] });
    const history = createHistory();
    commit(g, history, placeCommand(g, structureDef("cafe")!, 20, 4)!);
    expect(deskPerks(g, none, office)).toEqual({ share: CAFE_BOOST, why: ["Café next door · +10%"] });
    expect(deskPerks(g, none, g.structures.get(id("garage", 0))!).share).toBe(0);
  });
});
