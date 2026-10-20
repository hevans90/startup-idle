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
import { placeCommand } from "../../structures/place";
import { placesOf } from "../../agents/roads";
import { seat } from "../../agents/commute";
import { moodsOf } from "../../agents/mood";
import { coverageOf, createEvolution, stepEvolution, tierOf } from "../../agents/services";
import { cloneGrid, settledTown } from "./town-model";

/** A street along row 8, a workplace for `who` on it, three of its lots — desks for them all at III — and these services. */
function town(services: string[], who: "intern" | "10x_dev" = "intern", lot = "t0"): Grid {
  const g = createGrid(30, 16);
  fillTerrain(g, 1);
  for (let x = 1; x < 29; x++) g.paved[idx(g, x, 8)] = 1;
  const h = createHistory();
  const put = (def: string, x: number, y: number) => commit(g, h, placeCommand(g, { ...structureDef(def)!, placement: undefined }, x, y)!);
  if (who === "intern") put("office-intern", 4, 6); else put("office-10x", 4, 5);
  for (const x of [8, 9, 10]) put(`kit:${who}.${lot}`, x, 9);
  // Each on the street: its foot on the row above it.
  services.forEach((sv, k) => put(sv, 13 + 3 * k, 8 - structureDef(sv)!.footprint.h));
  return g;
}

/** The town under the game's own rules: everyone home, moods felt, growth, for `secs`. */
function live(g: Grid, secs: number) {
  const e = createEvolution();
  for (let t = 0; t < secs; t += 5) {
    for (const s of g.structures.values()) { const h = housedBy(s.def); if (h) s.residents = h.slots; }
    const places = placesOf(g, createNetwork(g));
    const moods = moodsOf(g, seat(g, places).commutes, coverageOf(g, places), 0);
    stepEvolution(e, g, moods, 5);
  }
  return g;
}
const tiersOf = (g: Grid) => [...g.structures.values()].filter((s) => housedBy(s.def)).map((s) => tierOf(s.def)).sort();
const modelTiers = (g: Grid) => [...settledTown(cloneGrid(g)).tiers.values()].sort();

describe("the town model, against the game", () => {
  test("a café and a gym but no park: grown to II and no higher — crowding stops it", () => {
    const g = town(["cafe", "gym"]);
    expect(modelTiers(g)).toEqual(["t1", "t1", "t1"]);
    expect(tiersOf(live(g, 300))).toEqual(modelTiers(town(["cafe", "gym"])));
  });

  test("lots past the desks at III: the people without one hold the furthest back — as the game does", () => {
    const g = town(["park", "cafe"]);
    const h = createHistory();
    commit(g, h, placeCommand(g, { ...structureDef("kit:intern.t0")!, placement: undefined }, 11, 9)!);
    commit(g, h, placeCommand(g, { ...structureDef("kit:intern.t0")!, placement: undefined }, 12, 9)!);
    const model = modelTiers(g);
    expect(model).toContain("t2");
    expect(model.some((t) => t !== "t2")).toBe(true);
    expect(tiersOf(live(cloneGrid(g), 900))).toEqual(model);
  });

  test("a park and a café: grown to III", () => {
    const g = town(["park", "cafe"]);
    expect(modelTiers(g)).toEqual(["t2", "t2", "t2"]);
    expect(tiersOf(live(g, 300))).toEqual(modelTiers(town(["park", "cafe"])));
  });

  test("never below the tier a house was bought at", () => {
    const g = town([], "intern", "t1");
    expect(modelTiers(g)).toEqual(["t1", "t1", "t1"]);
  });

  test("10x devs do not move into a house under their mood", () => {
    const sad = settledTown(cloneGrid(town([], "10x_dev")));
    expect(sad.work).toBe(0);
    const glad = settledTown(cloneGrid(town(["park", "cafe"], "10x_dev")));
    expect(glad.work).toBeGreaterThan(0);
  });

  test("income follows mood: the same beds earn more in a happier town", () => {
    const plain = settledTown(cloneGrid(town(["cafe"])));
    const happy = settledTown(cloneGrid(town(["park", "cafe", "gym"])));
    expect(happy.moodByKind.intern!).toBeGreaterThan(plain.moodByKind.intern!);
    expect(happy.income / happy.work).toBeGreaterThan(plain.income / plain.work);
  });
});
