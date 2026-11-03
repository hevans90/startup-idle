import { describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, idx } from "../grid";
import { SERVICE_IDS } from "../agents/needs";
import { SHOP_NAMES, shopName } from "../agents/shop-names";
import { lightsOf } from "./lights";
import { SHOP_LOOK, movingOf, shopfrontsOf } from "./shopfronts";

/** A house at (5, 5), a shop in it, and the street where it is asked for. */
function house(street: "front" | "side" | "behind", shop = "bar") {
  const g = createGrid(12, 12);
  fillTerrain(g, 1);
  const at = { front: [5, 6], side: [6, 5], behind: [5, 4] }[street];
  g.paved[idx(g, at[0], at[1])] = 1;
  g.structures.set(1, { id: 1, def: "kit:intern.t1", x: 5, y: 5, w: 1, h: 1, shop });
  return g;
}

describe("the shops' names", () => {
  test("every service has a pool of distinct names", () => {
    for (const sv of SERVICE_IDS) {
      expect(SHOP_NAMES[sv].length).toBeGreaterThanOrEqual(4);
      expect(new Set(SHOP_NAMES[sv]).size).toBe(SHOP_NAMES[sv].length);
    }
  });

  test("a building's shop keeps its name, and a street of them is not all one name", () => {
    expect(shopName("bar", 17)).toBe(shopName("bar", 17));
    expect(SHOP_NAMES.bar).toContain(shopName("bar", 17));
    expect(new Set(Array.from({ length: 12 }, (_, k) => shopName("bar", k))).size).toBeGreaterThan(3);
  });
});

describe("the shops' fronts", () => {
  test("on the face toward the street, or the lit face where the street is behind", () => {
    expect(shopfrontsOf(house("front"))[0].face).toBe("v");
    expect(shopfrontsOf(house("side"))[0].face).toBe("u");
    expect(shopfrontsOf(house("behind"))[0].face).toBe("v");
  });

  test("only a finished house with a shop has one; a café's steam and a cinema's marquee move", () => {
    const g = house("front", "cafe");
    g.structures.set(2, { id: 2, def: "kit:intern.t1", x: 7, y: 5, w: 1, h: 1 });
    g.structures.set(3, { id: 3, def: "cinema", x: 1, y: 1, w: 2, h: 2 });
    g.structures.set(4, { id: 4, def: "gym", x: 8, y: 8, w: 2, h: 2 });
    expect(shopfrontsOf(g).map((f) => f.id)).toEqual([1]);
    expect(movingOf(g).map((m) => [m.id, m.sv])).toEqual([[1, "cafe"], [3, "cinema"]]);
  });

  test("at night each sign glows in its own colour, a neon one brighter", () => {
    const g = house("front", "bar");
    g.structures.set(3, { id: 3, def: "doctor", x: 1, y: 1, w: 2, h: 1 });
    const signs = lightsOf(g).filter((l) => l.kind === "sign");
    expect(signs.map((l) => [l.tint, !!l.neon])).toEqual([[SHOP_LOOK.bar.glow, true], [SHOP_LOOK.doctor.glow, false]]);
  });
});
