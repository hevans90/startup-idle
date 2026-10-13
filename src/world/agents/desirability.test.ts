import { describe, expect, test } from "bun:test";

import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx } from "../grid";
import { createNetwork } from "../roads/network";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { desireAt, desireMapsOf } from "./desirability";
import { MOOD, WATER_VIEW } from "./mood-rules";
import { RANGE } from "./services";
import { placesOf } from "./roads";

/** A road along row 5, 40 long, with what is asked for on its north side. */
function street(things: [string, number][]) {
  const g = createGrid(40, 12);
  fillTerrain(g, 1);
  for (let x = 0; x < g.w; x++) g.paved[idx(g, x, 5)] = 1;
  const h = createHistory();
  for (const [def, x] of things) {
    const d = structureDef(def)!;
    commit(g, h, placeCommand(g, d, x, 5 - d.footprint.h)!);
  }
  return g;
}
const maps = (g: ReturnType<typeof street>) => desireMapsOf(g, placesOf(g, createNetwork(g)));
const why = (d: ReturnType<typeof desireAt>) => d!.parts.map((p) => p.why).sort();

describe("desirability", () => {
  test("an empty tile beside the road gets what a house there would: a café in reach", () => {
    const g = street([["cafe", 10]]);
    const d = desireAt(g, maps(g), 12, 4, "intern");
    expect(why(d)).toEqual(["café"]);
    expect(d!.total).toBe(MOOD.cafe);
  });

  test("out of a service's reach, a tile has nothing", () => {
    const g = street([["cafe", 2]]);
    const d = desireAt(g, maps(g), 2 + RANGE + 6, 4, "intern");
    expect(why(d)).toEqual(["no services"]);
  });

  test("with no road beside it there is no door, and nothing to say", () => {
    const g = street([]);
    expect(desireAt(g, maps(g), 12, 1, "intern")).toBeNull();
  });

  test("water in view counts", () => {
    const g = street([["cafe", 10]]);
    g.pool[idx(g, 13, 2)] = 3;
    const d = desireAt(g, maps(g), 12, 4, "intern");
    expect(why(d)).toEqual(["café", "water view"]);
    expect(d!.total).toBe(MOOD.cafe + WATER_VIEW);
  });

  test("a long way from work costs, and a workplace near does not", () => {
    const near = street([["garage", 12]]);
    expect(why(desireAt(near, maps(near), 15, 4, "intern"))).not.toContain("long commute");
    const far = street([["garage", 0]]);
    expect(why(desireAt(far, maps(far), 38, 4, "intern"))).toContain("long commute");
  });
});
