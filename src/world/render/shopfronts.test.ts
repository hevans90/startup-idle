import { describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, idx } from "../grid";
import { SERVICE_IDS } from "../agents/needs";
import { SHOP_NAMES, shopName } from "../agents/shop-names";
import { lightsOf } from "./lights";
import { FRONT_TALL, SHOP_LOOK, movingOf, shopKeyOf, shopfrontsOf, spansOf } from "./shopfronts";
import { HALF_STEPS_PER_M, TILES_PER_M } from "../agents/cars/models";
import { HOUSES, SHOP_PLAN, shopGround } from "../houses/models";

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

  test("on its own house's wall, whatever the kit: the face's plane and length, its height its ground floor's", () => {
    for (const h of HOUSES) for (const street of ["front", "side"] as const) {
      const g = house(street);
      g.structures.get(1)!.def = `kit:${h.id}`;
      const fr = shopfrontsOf(g)[0], [out, along] = fr.face === "v" ? [h.hy, h.hx] : [h.hx, h.hy];
      expect(fr.wall.at, h.id).toBeCloseTo(0.5 + out * TILES_PER_M, 9);
      expect(fr.wall.hi - fr.wall.lo, h.id).toBeCloseTo(2 * along * TILES_PER_M, 9);
      // The front, cornice and all, fits under the first floor.
      expect(FRONT_TALL * fr.wall.zk, h.id).toBeCloseTo(h.ground * HALF_STEPS_PER_M, 9);
    }
  });

  test("on a kit's house, its front is baked into the ground floor it is drawn with: that face, the door at the same end", () => {
    for (const street of ["front", "side"] as const) for (const id of [1, 2]) {
      const g = house(street);
      const s = g.structures.get(1)!;
      g.structures.delete(1); s.id = id; g.structures.set(id, s);
      const fr = shopfrontsOf(g)[0];
      expect(fr.baked).toBe(true);
      expect(shopKeyOf(fr)).toBe(`${fr.face}${id % 2}`);
      // The drawn door's span is the baked one's.
      expect(spansOf(fr).door).toEqual(SHOP_PLAN.spans(shopKeyOf(fr)[1] === "1").door);
    }
    // A building that is no kit has its whole front drawn.
    const g = house("front");
    g.structures.get(1)!.def = "cinema";
    expect(shopfrontsOf(g)[0]?.baked ?? false).toBe(false);
  });

  test("the baked front stands on its kit's wall, in its ground floor, the door where the plan says", () => {
    for (const h of HOUSES) for (const key of ["v0", "v1", "u0", "u1"] as const) {
      const tris = shopGround(h, key), ax = key[0] === "v" ? 1 : 0, along = 1 - ax, at = key[0] === "v" ? h.hy : h.hx, half = key[0] === "v" ? h.hx : h.hy;
      const paint = tris.filter((t) => t.mat === "paint");
      expect(paint.length, h.id).toBeGreaterThan(0);
      for (const t of paint) for (const v of t.p) {
        expect(v[2], h.id).toBeLessThanOrEqual(h.ground + 1e-6);
        expect(v[ax], h.id).toBeGreaterThanOrEqual(at - 1e-6);
        expect(v[ax], h.id).toBeLessThanOrEqual(at + 0.7);
      }
      // No window or door of the house's own left on that face.
      expect(tris.some((t) => (t.mat === "pane" || t.mat === "glass") && t.p.every((v) => v[ax] >= at - 1e-6) && Math.max(...t.p.map((v) => v[2])) > 0.2 && t.p.some((v) => {
        const f = (v[along] + half) / (2 * half), { door, win } = SHOP_PLAN.spans(key[1] === "1");
        return !(f >= door[0] - 0.05 && f <= door[1] + 0.05) && !(f >= win[0] - 0.05 && f <= win[1] + 0.05);
      })), `${h.id} ${key}`).toBe(false);
    }
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
