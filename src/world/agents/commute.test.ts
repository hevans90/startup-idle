import { afterEach, describe, expect, test } from "bun:test";

import { attendance, setProjectReader } from "../../game/projects";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx } from "../grid";
import { createNetwork } from "../roads/network";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import {
  FREE, STRANDED, WORST, commuteEfficiency, commuteFactor, commutesOf, liveCommutes,
} from "./commute";
import { placesOf } from "./roads";

/** A road along row 5, 40 long; things placed on its north side. */
function street(things: [string, number][], gapAt?: number) {
  const g = createGrid(40, 10);
  fillTerrain(g, 1);
  for (let x = 0; x < g.w; x++) if (x !== gapAt) g.paved[idx(g, x, 5)] = 1;
  const h = createHistory();
  for (const [def, x] of things) {
    const cmd = placeCommand(g, structureDef(def)!, x, 4 - (structureDef(def)!.footprint.h - 1))!;
    for (const s of cmd.structures!.added) if (def.startsWith("kit:")) s.residents = 2;
    commit(g, h, cmd);
  }
  const net = createNetwork(g);
  const ids = [...g.structures.values()].map((s) => s.id);
  return { g, net, ids, commutes: commutesOf(g, placesOf(g, net)) };
}

afterEach(() => setProjectReader(() => ({ built: new Set(), away: {} }))());

describe("the way to work", () => {
  test("costs nothing near, a little a tile beyond, and never below its worst", () => {
    expect(commuteEfficiency(0)).toBe(1);
    expect(commuteEfficiency(FREE)).toBe(1);
    expect(commuteEfficiency(FREE + 8)).toBeCloseTo(0.9, 9);
    expect(commuteEfficiency(500)).toBe(WORST);
    expect(commuteEfficiency(null)).toBe(STRANDED);
  });

  test("is along the roads to the NEAREST workplace of the house's kind", () => {
    // Garage at 2, an intern office at 30; houses at 6 and 26.
    const { commutes, ids } = street([["garage", 2], ["office-intern", 30], ["kit:intern.t0", 6], ["kit:intern.t0", 26]]);
    const [garage, office, near, far] = ids;
    expect(commutes.get(near)!.to).toBe(garage);
    expect(commutes.get(far)!.to).toBe(office);
    expect(commutes.get(near)!.tiles).toBeLessThan(6);
  });

  test("is not to another kind's workplace, and with no road there it is stranded", () => {
    const { commutes, ids } = street([["studio", 2], ["kit:intern.t0", 20]]);
    expect(commutes.get(ids[1])).toEqual({ tiles: null, eff: STRANDED, to: null });
    const cut = street([["garage", 2], ["kit:intern.t0", 20]], 10);
    expect(cut.commutes.get(cut.ids[1])!.tiles).toBeNull();
  });

  test("averages over everyone, people working remotely in full", () => {
    const { g, commutes, ids } = street([["garage", 0], ["kit:intern.t0", 38]]);
    const eff = commutes.get(ids[1])!.eff;
    expect(eff).toBeLessThan(1);
    // Two living here at `eff`, two remote at one.
    expect(commuteFactor(g, commutes, { intern: 4 }, { intern: 2 }).intern).toBeCloseTo((2 * eff + 2) / 4, 9);
    // Remote beds nobody fills count for nothing.
    expect(commuteFactor(g, commutes, { intern: 3 }, { intern: 5 }).intern).toBeCloseTo((2 * eff + 3) / 5, 9);
  });

  test("is felt by the economy, with the people away", () => {
    const stop = setProjectReader(() => ({ built: new Set(), away: { intern: 2 }, commute: { intern: 0.8 } }));
    expect(attendance("intern", 10)).toBeCloseTo(0.8 * 0.8, 9);
    stop();
    expect(attendance("intern", 10)).toBe(1);
  });

  test("is worked out again when a workplace opens, though that is not an edit", () => {
    const { g, net, ids } = street([["garage", 2], ["kit:intern.t0", 20]]);
    const garage = g.structures.get(ids[0])!;
    garage.build = { done: 0, need: 1, delivered: 0, deliveries: 1, cost: 0, priority: 2, updatedAt: 0 };
    expect(liveCommutes(g, net).get(ids[1])!.tiles).toBeNull();
    delete garage.build;
    expect(liveCommutes(g, net).get(ids[1])!.tiles).not.toBeNull();
  });
});
