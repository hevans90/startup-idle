import { describe, expect, test } from "bun:test";

import { createGrid } from "../grid";
import { emittersWanted } from "./disaster-fx";
import { conditionAlpha, conditionsOf } from "./lights";

const town = () => {
  const g = createGrid(12, 12);
  g.structures.set(1, { id: 1, def: "datacentre", x: 2, y: 2, w: 2, h: 2 });
  g.structures.set(2, { id: 2, def: "kit:intern.t1", x: 6, y: 6, w: 1, h: 1 });
  g.structures.set(3, { id: 3, def: "kit:intern.t0", x: 8, y: 8, w: 1, h: 1 });
  return g;
};

describe("disasters you can see", () => {
  test("each cause glows its own way, and a flood not at all: its water shows it", () => {
    const g = town();
    const list = conditionsOf(g, [[1, "heat"], [2, "closed"], [3, "flood"]], [{ x: 5, y: 0 }]);
    expect(list.map((c) => c.kind)).toEqual(["heat", "closed", "works"]);
    expect(list[0]).toMatchObject({ x: 2, y: 2, w: 2, h: 2 });
    expect(list[2]).toMatchObject({ x: 5, y: 0, w: 1, h: 1 });
  });

  test("a building gone is not glowed over", () => {
    expect(conditionsOf(town(), [[99, "heat"]], [])).toEqual([]);
  });

  test("heat pulses, the works' lamp blinks, closed stays put", () => {
    const at = (kind: "heat" | "closed" | "works") => Array.from({ length: 20 }, (_, k) => conditionAlpha(kind, k / 20));
    const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    expect(spread(at("heat"))).toBeGreaterThan(0.3);
    expect(spread(at("works"))).toBeGreaterThan(0.7);
    expect(spread(at("closed"))).toBe(0);
  });

  test("steam off what overheated, haze off what drinks only while the heatwave is on", () => {
    const g = town();
    const calm = emittersWanted(g, [[1, "heat"], [2, "closed"]], false, [1, 3]);
    expect([...calm.keys()]).toEqual(["steam:1"]);
    const hot = emittersWanted(g, [[1, "heat"]], true, [1, 3]);
    expect([...hot.keys()].sort()).toEqual(["haze:1", "haze:3", "steam:1"]);
  });

  test("a fire: smoke while it smoulders; flames, smoke and embers once caught, and no steam off it", () => {
    const g = town();
    const smoulder = emittersWanted(g, [[1, "heat"]], false, [], undefined, { burning: [], smouldering: [1] });
    expect([...smoulder.keys()]).toEqual(["smoulder:1"]);
    const burning = emittersWanted(g, [[1, "heat"]], false, [], undefined, { burning: [1, 2], smouldering: [] });
    expect([...burning.keys()].sort()).toEqual(["embers:1", "embers:2", "flames:1", "flames:2", "smoke:1", "smoke:2"]);
  });

  test("a building on fire flickers instead of whatever else glows on it", () => {
    const list = conditionsOf(town(), [[1, "heat"], [2, "closed"]], [], undefined, [1]);
    expect(list.map((c) => [c.kind, c.x])).toEqual([["fire", 2], ["closed", 6]]);
    const at = Array.from({ length: 30 }, (_, k) => conditionAlpha("fire", k / 30));
    expect(Math.max(...at) - Math.min(...at)).toBeGreaterThan(0.3);
  });

  test("a building being built gives off no haze, and a gone one no steam", () => {
    const g = town();
    g.structures.set(4, { id: 4, def: "datacentre", x: 9, y: 2, w: 2, h: 2, build: { left: 10 } as never });
    expect([...emittersWanted(g, [[99, "heat"]], true, [4]).keys()]).toEqual([]);
  });
});
