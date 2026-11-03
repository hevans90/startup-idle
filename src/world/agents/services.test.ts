import { describe, expect, test } from "bun:test";

import { housingCapacity } from "../../game/housing";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx, type Grid } from "../grid";
import { createNetwork } from "../roads/network";
import { structureDef } from "../structures/def";
import { placeCommand, validatePlacement } from "../structures/place";
import { placesOf } from "./roads";
import {
  CONCIERGE_REACH, DECLINE_AFTER, GROW_AFTER, RANGE, coverageOf, createEvolution, growthShort, needsMet, needsShort, serviceIn, stepEvolution,
} from "./services";
import { moodsOf } from "./mood";
import { GROW_AT, MOOD, NEED_MOOD } from "./mood-rules";

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
const moods = (g: Grid) => moodsOf(g, new Map(), cover(g));
const run = (g: Grid, seconds: number, e = createEvolution()) => {
  const changed: number[] = [];
  for (let k = 0; k < seconds; k++) changed.push(...stepEvolution(e, g, moods(g), cover(g), 1));
  return changed;
};

describe("services", () => {
  test("meet their need at the homes within reach along the roads, and no further", () => {
    const { g, ids } = street([["cafe", 10], ["kit:vibe_coder.t0", 10 + RANGE], ["kit:vibe_coder.t0", 10 + RANGE + 4]]);
    const c = cover(g);
    expect([...(c.get(ids[1]) ?? [])]).toEqual(["coffee"]);
    expect(c.get(ids[2])).toBeUndefined();
  });

  test("a shop in a house's ground floor meets its need there and along the road", () => {
    const { g, ids } = street([["kit:intern.t0", 10], ["kit:intern.t0", 14], ["kit:intern.t0", 14 + RANGE + 2]]);
    g.structures.get(ids[0])!.shop = "bakery";
    const c = cover(g);
    expect([...(c.get(ids[0]) ?? [])]).toEqual(["food"]);
    expect([...(c.get(ids[1]) ?? [])]).toEqual(["food"]);
    expect(c.get(ids[2])).toBeUndefined();
    expect(serviceIn(g.structures.get(ids[0])!)).toBe("bakery");
  });

  test("a park goes anywhere, and off the roads meets the need for quiet round it across the grass", () => {
    const { g, ids } = street([["kit:intern.t0", 10], ["kit:intern.t0", 12 + RANGE + 2]]);
    const park = structureDef("park")!, cafe = structureDef("cafe")!;
    // Off the road, three rows back from it: a park may stand there, a café may not.
    expect(validatePlacement(g, park, 10, 0, { needsRoad: true }).ok).toBe(true);
    expect(validatePlacement(g, cafe, 10, 0, { needsRoad: true }).ok).toBe(false);
    commit(g, createHistory(), placeCommand(g, park, 10, 0)!);
    const c = cover(g);
    expect([...(c.get(ids[0]) ?? [])]).toEqual(["quiet"]);
    expect(c.get(ids[1])).toBeUndefined();
  });

  test("a service with a Holo-Concierge reaches further — and only that one", () => {
    const { g, ids } = street([["cafe", 10], ["kit:vibe_coder.t0", 10 + RANGE + 3], ["kit:vibe_coder.t0", 10 + RANGE + CONCIERGE_REACH + 1]]);
    const c = coverageOf(g, placesOf(g, createNetwork(g)), (s) => (s.def === "cafe" ? CONCIERGE_REACH : 0));
    expect([...(c.get(ids[1]) ?? [])]).toEqual(["coffee"]);
    expect(c.get(ids[2])).toBeUndefined();
  });

  test("a full house with a need met, desirable enough for the next tier, grows, for nothing, and gains beds", () => {
    const { g, ids } = street([["cafe", 10], ["kit:vibe_coder.t0", 13]]);
    const before = housingCapacity(g).vibe_coder, e = createEvolution();
    run(g, GROW_AFTER - 1, e);
    expect(g.structures.get(ids[1])!.def).toBe("kit:vibe_coder.t0");
    expect(run(g, 2, e)).toEqual([ids[1]]);
    const s = g.structures.get(ids[1])!;
    expect(s.def).toBe("kit:vibe_coder.t1");
    expect(s.grown).toBe(1);
    expect(housingCapacity(g).vibe_coder).toBeGreaterThan(before);
  });

  test("a need met is only its kind's: a café does nothing for an intern's house", () => {
    const { g, ids } = street([["cafe", 10], ["kit:intern.t0", 13]]);
    run(g, GROW_AFTER + 5);
    expect(g.structures.get(ids[1])!.def).toBe("kit:intern.t0");
    expect(needsMet(g.structures.get(ids[1])!, cover(g))).toEqual([]);
  });

  test("a house grows past II only with a second need met, and says which it lacks", () => {
    const { g, ids } = street([["cafe", 10], ["kit:vibe_coder.t1", 13]]);
    const s = g.structures.get(ids[1])!;
    expect(needsShort(s, cover(g))).toEqual(["scene"]);
    s.shop = "vape";
    expect(needsShort(s, cover(g))).toBeNull();
  });

  test("a house that is not full does not grow, and says how far it is from it", () => {
    const { g, ids } = street([["cafe", 10], ["kit:vibe_coder.t1", 13]]);
    g.structures.get(ids[1])!.residents = 5;
    // Coffee's points: vibe coders do not mind the crowding.
    const s = g.structures.get(ids[1])!;
    expect(growthShort(s, moods(g).get(s.id))).toBe(GROW_AT.t2 - NEED_MOOD.vibe_coder);
    g.structures.get(ids[1])!.residents = 1;
    run(g, GROW_AFTER + 5);
    expect(g.structures.get(ids[1])!.def).toBe("kit:vibe_coder.t1");
  });

  test("a house that grew declines when it loses its need, and its extra people move out", () => {
    const { g, ids } = street([["cafe", 10], ["kit:vibe_coder.t0", 13]]);
    const e = createEvolution();
    run(g, GROW_AFTER + 1, e);
    const s = g.structures.get(ids[1])!;
    s.residents = 5;
    // The café comes down.
    g.structures.delete(ids[0]);
    run(g, DECLINE_AFTER + 1, e);
    expect(s.def).toBe("kit:vibe_coder.t0");
    expect(s.grown).toBeUndefined();
    expect(s.residents).toBe(2);
  });

  test("only those who need quiet mind crowding, and a park takes it away", () => {
    const { g, ids } = street([["kit:10x_dev.t1", 16], ["kit:vibe_coder.t1", 20]]);
    const dev = g.structures.get(ids[0])!, vibe = g.structures.get(ids[1])!;
    expect(growthShort(dev, moods(g).get(dev.id))).toBe(GROW_AT.t2 - (MOOD.noServices + MOOD.crowded));
    expect(growthShort(vibe, moods(g).get(vibe.id))).toBe(GROW_AT.t2 - MOOD.noServices);
    commit(g, createHistory(), placeCommand(g, structureDef("park")!, 13, 3)!);
    expect(growthShort(dev, moods(g).get(dev.id))).toBe(GROW_AT.t2 - NEED_MOOD["10x_dev"]);
  });

  test("a house bought at a tier never declines below it", () => {
    const { g, ids } = street([["kit:intern.t2", 13]]);
    g.structures.get(ids[0])!.residents = 12;
    run(g, DECLINE_AFTER * 2);
    expect(g.structures.get(ids[0])!.def).toBe("kit:intern.t2");
  });
});
