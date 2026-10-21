import { describe, expect, test } from "bun:test";

import { housingCapacity } from "../../game/housing";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx, type Grid } from "../grid";
import { createNetwork } from "../roads/network";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { placesOf } from "./roads";
import {
  CONCIERGE_REACH, DECLINE_AFTER, GROW_AFTER, RANGE, coverageOf, createEvolution, growthShort, stepEvolution,
} from "./services";
import { moodsOf } from "./mood";
import { GROW_AT, MOOD } from "./mood-rules";

/** A road along row 5, 40 long; things placed on its north side, houses full. */
function street(things: [string, number][]) {
  const g = createGrid(40, 10);
  fillTerrain(g, 1);
  for (let x = 0; x < g.w; x++) g.paved[idx(g, x, 5)] = 1;
  const h = createHistory();
  for (const [def, x] of things) {
    const d = structureDef(def)!;
    const cmd = placeCommand(g, d, x, 5 - d.footprint.h)!;
    for (const s of cmd.structures!.added) if (def.startsWith("kit:")) s.residents = 2;
    commit(g, h, cmd);
  }
  return { g, ids: [...g.structures.values()].map((s) => s.id) };
}
const cover = (g: Grid) => coverageOf(g, placesOf(g, createNetwork(g)));
/** Every house's desirability — no commute here: nobody works anywhere. */
const moods = (g: Grid) => moodsOf(g, new Map(), cover(g), 0);
const run = (g: Grid, seconds: number, e = createEvolution()) => {
  const changed: number[] = [];
  for (let k = 0; k < seconds; k++) changed.push(...stepEvolution(e, g, moods(g), 1));
  return changed;
};

describe("services", () => {
  test("serve the homes within reach along the roads, and no further", () => {
    const { g, ids } = street([["cafe", 10], ["kit:intern.t0", 10 + RANGE], ["kit:intern.t0", 10 + RANGE + 4]]);
    const c = cover(g);
    expect([...(c.get(ids[1]) ?? [])]).toEqual(["cafe"]);
    expect(c.get(ids[2])).toBeUndefined();
  });

  test("a service with a Holo-Concierge reaches further — and only that one", () => {
    const { g, ids } = street([["cafe", 10], ["kit:intern.t0", 10 + RANGE + 3], ["kit:intern.t0", 10 + RANGE + CONCIERGE_REACH + 1]]);
    const c = coverageOf(g, placesOf(g, createNetwork(g)), (s) => (s.def === "cafe" ? CONCIERGE_REACH : 0));
    expect([...(c.get(ids[1]) ?? [])]).toEqual(["cafe"]);
    expect(c.get(ids[2])).toBeUndefined();
  });

  test("a full house desirable enough for the next tier grows, for nothing, and gains beds", () => {
    const { g, ids } = street([["cafe", 10], ["kit:intern.t0", 13]]);
    const before = housingCapacity(g).intern, e = createEvolution();
    run(g, GROW_AFTER - 1, e);
    expect(g.structures.get(ids[1])!.def).toBe("kit:intern.t0");
    expect(run(g, 2, e)).toEqual([ids[1]]);
    const s = g.structures.get(ids[1])!;
    expect(s.def).toBe("kit:intern.t1");
    expect(s.grown).toBe(1);
    expect(housingCapacity(g).intern).toBeGreaterThan(before);
  });

  test("a house that is not full does not grow, and says how far it is from it", () => {
    const { g, ids } = street([["cafe", 10], ["kit:intern.t1", 13]]);
    g.structures.get(ids[1])!.residents = 5;
    // A café's +4, and the crowding III would bring with no park.
    const s = g.structures.get(ids[1])!;
    expect(growthShort(s, moods(g).get(s.id))).toBe(GROW_AT.t2 - (MOOD.cafe + MOOD.crowded));
    g.structures.get(ids[1])!.residents = 1;
    run(g, GROW_AFTER + 5);
    expect(g.structures.get(ids[1])!.def).toBe("kit:intern.t1");
  });

  test("a house that grew declines when it is no longer desirable, and its extra people move out", () => {
    const { g, ids } = street([["cafe", 10], ["kit:intern.t0", 13]]);
    const e = createEvolution();
    run(g, GROW_AFTER + 1, e);
    const s = g.structures.get(ids[1])!;
    s.residents = 5;
    // The café comes down.
    g.structures.delete(ids[0]);
    run(g, DECLINE_AFTER + 1, e);
    expect(s.def).toBe("kit:intern.t0");
    expect(s.grown).toBeUndefined();
    expect(s.residents).toBe(2);
  });

  test("a park takes the crowding away: a dense house beside one is not counted against", () => {
    const { g, ids } = street([["cafe", 10], ["park", 13], ["kit:intern.t1", 16]]);
    const s = g.structures.get(ids[2])!;
    expect(growthShort(s, moods(g).get(s.id))).toBe(Math.max(0, GROW_AT.t2 - (MOOD.cafe + MOOD.park)));
  });

  test("a house bought at a tier never declines below it", () => {
    const { g, ids } = street([["kit:intern.t2", 13]]);
    g.structures.get(ids[0])!.residents = 12;
    run(g, DECLINE_AFTER * 2);
    expect(g.structures.get(ids[0])!.def).toBe("kit:intern.t2");
  });
});
