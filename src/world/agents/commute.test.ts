import { afterEach, describe, expect, test } from "bun:test";

import { attendance, setProjectReader } from "../../game/projects";
import { commit, createHistory } from "../edit/commands";
import { RAMP, createGrid, fillTerrain, idx, packRamp, setHeight, setPaved } from "../grid";
import { createNetwork } from "../roads/network";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import {
  CLIMB, DESKLESS, DESKS, FREE, STRANDED, WORST, commuteEfficiency, walkFrom, commuteFactor, commutesOf, joinsOf, liveCommutes, liveSeating, seat,
} from "./commute";
import { placesOf } from "./roads";
import { FIXTURE_SIZE, applyFixture } from "../debug/fixtures";

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
    const { commutes, ids } = street([["garage", 0], ["office-intern", 30], ["kit:intern.t0", 6], ["kit:intern.t0", 26]]);
    const [garage, office, near, far] = ids;
    expect(commutes.get(near)!.to).toBe(garage);
    expect(commutes.get(far)!.to).toBe(office);
    expect(commutes.get(near)!.tiles).toBeLessThan(6);
  });

  test("is not to another kind's workplace, and with no road there it is stranded", () => {
    const { commutes, ids } = street([["studio", 2], ["kit:intern.t0", 20]]);
    expect(commutes.get(ids[1])).toEqual({ tiles: null, eff: STRANDED, to: null, deskless: 0 });
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

describe("desks", () => {
  test("the nearest take them first; past the last desk, people work without one", () => {
    // The garage at the west end, and twelve houses of two along the street: 24 people, 20 desks.
    const { g, net, ids } = street([["garage", 0], ...Array.from({ length: 12 }, (_, k) => ["kit:intern.t0", 5 + k * 2] as [string, number])]);
    const { commutes, desks } = seat(g, placesOf(g, net));
    expect(desks.get(ids[0])).toEqual({ used: DESKS.garage, of: DESKS.garage });
    // The nearest ten houses are seated; the farthest two are not.
    expect(commutes.get(ids[1])!.deskless).toBe(0);
    expect(commutes.get(ids[12])!.deskless).toBe(2);
    expect(commutes.get(ids[12])!.eff).toBeCloseTo(DESKLESS, 6);
  });

  test("an office takes the overflow, nearest first", () => {
    const things: [string, number][] = [["garage", 0], ...Array.from({ length: 12 }, (_, k) => ["kit:intern.t0", 5 + k * 2] as [string, number]), ["office-intern", 32]];
    const { g, net, ids } = street(things);
    const { commutes, desks } = seat(g, placesOf(g, net));
    const office = ids[ids.length - 1];
    expect(desks.get(office)!.used).toBeGreaterThan(0);
    for (const id of ids.slice(1, 13)) expect(commutes.get(id)!.deskless).toBe(0);
    // The far end's people sit at the office beside them, not the garage.
    expect(commutes.get(ids[12])!.to).toBe(office);
  });
});


describe("a hill town's walk", () => {
  test("counts every step of road up or down a level as CLIMB", () => {
    const g = createGrid(30, 10);
    fillTerrain(g, 1);
    for (let x = 0; x < g.w; x++) {
      g.paved[idx(g, x, 5)] = 1;
      g.height[idx(g, x, 5)] = x >= 10 ? 1 : 0;
    }
    // The ramp up at 9, rising toward +x (the grid's south).
    g.ramp[idx(g, 9, 5)] = packRamp(RAMP.S, 1);
    const walk = walkFrom(g, [idx(g, 0, 5)]);
    expect(walk[idx(g, 8, 5)]).toBe(8);
    expect(walk[idx(g, 20, 5)]).toBe(20 + CLIMB - 1);
  });
});

describe("the roads' joins, worked out once", () => {
  test("a walk by them is the walk without them, from any road of a town", () => {
    const n = FIXTURE_SIZE.bigtown ?? 48;
    const g = createGrid(n, n, 1);
    applyFixture(g, "bigtown", 1);
    const joins = joinsOf(g);
    let tried = 0;
    for (let i = 0; i < g.paved.length; i += 97) {
      if (!g.paved[i]) continue;
      tried++;
      expect([...walkFrom(g, [i], joins)]).toEqual([...walkFrom(g, [i])]);
    }
    expect(tried).toBeGreaterThan(8);
  });
});

describe("who sits where, kept", () => {
  test("is kept through an edit off the roads, and worked out again for one on them: as it would be afresh", () => {
    const n = FIXTURE_SIZE.bigtown ?? 48;
    const g = createGrid(n, n, 1);
    applyFixture(g, "bigtown", 1);
    const net = createNetwork(g);
    const j = (v: unknown) => JSON.stringify(v, (_k, x) => (x instanceof Map ? [...x] : x));
    const was = liveSeating(g, net);
    expect(was.commutes.size).toBeGreaterThan(10);
    // A tile of open ground, nowhere near a road or a building, raised.
    let far = -1;
    for (let i = 0; i < n * n && far < 0; i++) {
      const x = i % n, y = (i / n) | 0;
      let clear = x > 3 && y > 3 && x < n - 4 && y < n - 4;
      for (let dy = -3; dy <= 3 && clear; dy++) for (let dx = -3; dx <= 3 && clear; dx++) { const k = (y + dy) * n + x + dx; if (g.paved[k] || g.structureAt[k] >= 0) clear = false; }
      if (clear) far = i;
    }
    expect(far).toBeGreaterThanOrEqual(0);
    setHeight(g, far % n, (far / n) | 0, g.height[far] + 1);
    expect(liveSeating(g, net)).toBe(was);
    // A road cut: a cell of it taken up.
    let cut = -1;
    for (let i = 0; i < n * n && cut < 0; i++) if (g.paved[i] && !g.deck[i] && g.paved[i - 1] && g.paved[i + 1]) cut = i;
    setPaved(g, cut % n, (cut / n) | 0, 0);
    const net2 = createNetwork(g), now = liveSeating(g, net2);
    expect(now).not.toBe(was);
    expect(j(now)).toBe(j(seat(g, placesOf(g, net2))));
  });
});
