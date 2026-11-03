/**
 * THE TOWN MODEL AGAINST THE GAME: a little town, settled by the model, and
 * the same town run under the game's own mood and growth for a few minutes —
 * the tiers must agree. @see settledTown, stepEvolution
 */
import { describe, expect, test } from "bun:test";

import { housedBy } from "../../../game/housing";
import { commit, createHistory } from "../../edit/commands";
import { createGrid, fillTerrain, idx, type Grid } from "../../grid";
import { createNetwork } from "../../roads/network";
import { structureDef } from "../../structures/def";
import { placeCommand, validatePlacement } from "../../structures/place";
import { placesOf } from "../../agents/roads";
import { seat } from "../../agents/commute";
import { moodsOf } from "../../agents/mood";
import { coverageOf, createEvolution, stepEvolution, tierOf } from "../../agents/services";
import { createTownServices, stepTown, type TownHands } from "../../agents/town-services";
import { cloneGrid, settledTown } from "./town-model";

type Town = { who?: "intern" | "10x_dev"; lot?: string; shop?: string; lots?: number };

/** A street along row 8, a workplace for `who` on it, `lots` of its lots (three) — desks for three at III — these services, and `shop` downstairs in the first lot. */
function town(services: string[], { who = "intern", lot = "t0", shop, lots = 3 }: Town = {}): Grid {
  const g = createGrid(30, 16);
  fillTerrain(g, 1);
  for (let x = 1; x < 29; x++) g.paved[idx(g, x, 8)] = 1;
  const h = createHistory();
  const put = (def: string, x: number, y: number) => commit(g, h, placeCommand(g, { ...structureDef(def)!, placement: undefined }, x, y)!);
  if (who === "intern") put("office-intern", 4, 6); else put("office-10x", 4, 5);
  for (const x of [8, 9, 10].slice(0, lots)) put(`kit:${who}.${lot}`, x, 9);
  if (shop) [...g.structures.values()].find((s) => s.x === 8 && s.y === 9)!.shop = shop;
  // Each on the street: its foot on the row above it.
  services.forEach((sv, k) => put(sv, 13 + 3 * k, 8 - structureDef(sv)!.footprint.h));
  return g;
}

/** The town under the game's own rules: everyone home, moods felt, services opened, growth, for `secs`. */
function live(g: Grid, secs: number) {
  const e = createEvolution(), t = createTownServices(), h = createHistory();
  const hands: TownHands = {
    canPlace: (def, x, y) => validatePlacement(g, structureDef(def)!, x, y, { needsRoad: true }).ok,
    place: (def, x, y) => { const cmd = placeCommand(g, structureDef(def)!, x, y, { needsRoad: true })!; commit(g, h, cmd); return cmd.structures!.added[0].id; },
    clear: () => {},
    rand: () => 0,
  };
  for (let s = 0; s < secs; s += 5) {
    for (const s of g.structures.values()) { const h = housedBy(s.def); if (h) s.residents = h.slots; }
    const net = createNetwork(g), places = placesOf(g, net), cover = coverageOf(g, places);
    stepTown(t, g, net, cover, 5, hands);
    const moods = moodsOf(g, seat(g, places).commutes, cover);
    stepEvolution(e, g, moods, cover, 5);
  }
  return g;
}
const tiersOf = (g: Grid) => [...g.structures.values()].filter((s) => housedBy(s.def)).map((s) => tierOf(s.def)).sort();
const modelTiers = (g: Grid) => [...settledTown(cloneGrid(g)).tiers.values()].sort();

describe("the town model, against the game", () => {
  test("the town opens what its people lack — food and nightlife — and they grow on it to III", () => {
    expect(modelTiers(town([]))).toEqual(["t2", "t2", "t2"]);
    expect(tiersOf(live(town([]), 600))).toEqual(["t2", "t2", "t2"]);
  });

  test("a lot alone is too few to open anything: a club grows it to II and no higher", () => {
    const g = town(["club"], { lots: 1 });
    expect(modelTiers(g)).toEqual(["t1"]);
    expect(tiersOf(live(g, 300))).toEqual(["t1"]);
  });

  test("and with a bakery downstairs too, to III; a café, not theirs, does nothing", () => {
    const g = town(["club"], { lots: 1, shop: "bakery" });
    expect(modelTiers(g)).toEqual(["t2"]);
    expect(tiersOf(live(g, 300))).toEqual(["t2"]);
    expect(modelTiers(town(["cafe"], { lots: 1 }))).toEqual(["t0"]);
  });

  test("lots past the desks at III: the people without one hold the furthest back — as the game does", () => {
    const g = town([]);
    const h = createHistory();
    commit(g, h, placeCommand(g, { ...structureDef("kit:intern.t0")!, placement: undefined }, 11, 9)!);
    commit(g, h, placeCommand(g, { ...structureDef("kit:intern.t0")!, placement: undefined }, 12, 9)!);
    const model = modelTiers(g);
    expect(model).toContain("t2");
    expect(model.some((t) => t !== "t2")).toBe(true);
    expect(tiersOf(live(cloneGrid(g), 900))).toEqual(model);
  });

  test("never below the tier a house was bought at", () => {
    expect(modelTiers(town([], { lot: "t1", lots: 1 }))).toEqual(["t1"]);
  });

  test("income follows mood: the same beds earn more in a happier town", () => {
    const plain = settledTown(cloneGrid(town([], { lots: 1, lot: "t2" })));
    const happy = settledTown(cloneGrid(town(["club"], { lots: 1, lot: "t2", shop: "bakery" })));
    expect(happy.moodByKind.intern!).toBeGreaterThan(plain.moodByKind.intern!);
    expect(happy.income / happy.work).toBeGreaterThan(plain.income / plain.work);
  });
});
