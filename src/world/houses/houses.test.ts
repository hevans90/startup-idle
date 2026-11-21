import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Texture } from "pixi.js";

import { HALF_STEPS_PER_M } from "../agents/cars/models";
import { HEIGHT_UNIT } from "../iso";
import type { HousesSheet } from "./houses-format";
import { housePieces, houseTint, type HouseLook, type HousePart } from "./houses-sheet";
import { HOUSE_FLOORS, HOUSE_KITS } from "./kits";
import { HOUSES, houseOf, snowOver } from "./models";

describe("the houses, as models", () => {
  test("there is one for every kit, in the kits' order", () => {
    expect(HOUSES.map((h) => h.id)).toEqual([...HOUSE_KITS]);
    for (const h of HOUSES) expect(h.floors).toBe(HOUSE_FLOORS[h.id]);
  });

  test("each has a ground floor and a roof, and a floor to stack if it grows past one", () => {
    for (const h of HOUSES) {
      const p = h.parts();
      expect(p.ground.length).toBeGreaterThan(0);
      expect(p.roof.length).toBeGreaterThan(0);
      if (h.floors > 1) expect(p.mids.length).toBeGreaterThan(0);
      // Upper floors and the roof stand on the ground floor, never under it.
      for (const t of [...p.mids.flat(), ...p.roof]) for (const v of t.p) expect(v[2]).toBeGreaterThanOrEqual(h.ground - 0.5);
      // And nothing leaves the plot: a tile is 11.1 m across.
      for (const t of [...p.ground, ...p.mids.flat(), ...p.roof]) for (const v of t.p) { expect(Math.abs(v[0])).toBeLessThanOrEqual(5.55); expect(Math.abs(v[1])).toBeLessThanOrEqual(5.55); }
    }
  });

  test("each says where its walls are, as it is modelled: the faces a shop's front and a mural are drawn on", () => {
    for (const h of HOUSES) {
      // The ground floor's own walls, up to the first floor: the faces at ±hx and ±hy, and none out past them.
      // (A storey's height of it: not a planter or a step that happens to stand in the same plane.)
      const tall = (t: { p: readonly (readonly number[])[] }) => Math.max(...t.p.map((v) => v[2])) - Math.min(...t.p.map((v) => v[2])) > 1.5;
      const walls = h.parts().ground.filter((t) => ["wall", "stone", "ashlar", "interior"].includes(t.mat) && tall(t) && t.p.every((v) => v[2] <= h.ground + 1e-6));
      const at = (k: 0 | 1, d: number) => walls.some((t) => t.p.every((v) => Math.abs(v[k] - d) < 1e-6));
      expect(at(0, h.hx), `${h.id} +x`).toBe(true);
      expect(at(1, h.hy), `${h.id} +y`).toBe(true);
      const faces = walls.filter((t) => t.p.every((v) => Math.abs(v[0] - h.hx) < 1e-6));
      // (A pier may stand a little proud of the face; no more.)
      expect(Math.max(...faces.flatMap((t) => t.p.map((v) => v[1]))), h.id).toBeLessThanOrEqual(h.hy + 0.2);
    }
  });
});

describe("the baked sheet", () => {
  test("has every kit's parts as the models have them: `bun run bake:houses` was run", () => {
    const sheet: HousesSheet = JSON.parse(readFileSync("public/isometric_assets/derived/houses.json", "utf8"));
    for (const h of HOUSES) {
      const k = sheet.kits[h.id];
      expect(k).toBeDefined();
      expect(k.mids.length).toBe(h.parts().mids.length);
      for (const f of [k.ground, ...k.mids, k.roof]) expect(f.length).toBe(3 + 4 * sheet.layers);
      // And its ground floor with a shop in it, on each face, the door at each end.
      expect(Object.keys(k.shop ?? {}).sort()).toEqual(["u0", "u1", "v0", "v1"]);
    }
  });
});

describe("a house in the game", () => {
  const part = (): HousePart => ({ tex: [Texture.WHITE, Texture.WHITE], anchor: [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }] });
  const look: HouseLook = { ground: part(), mids: [part(), part()], roof: part() };

  test("is its ground floor, a floor for each storey over it and its roof, each lifted a storey", () => {
    const storey = houseOf("intern.t2")!.storey * HALF_STEPS_PER_M * HEIGHT_UNIT;
    const lifts = (floors: number) => housePieces(look, "intern.t2", floors, 0).filter((p) => p.walls).map((p) => p.lift / storey);
    expect(lifts(1)).toEqual([0, 0]);
    expect(lifts(3).map((l) => Math.round(l * 1000) / 1000)).toEqual([0, 0, 1, 2]);
    // The walls first in each part, the rest over them.
    expect(housePieces(look, "intern.t2", 2, 0).map((p) => p.walls)).toEqual([true, false, true, false, true, false]);
  });

  test("with a shop in it, its ground floor is the shop's, and the shop's paint is tinted apart from its walls", () => {
    const paint = (): HousePart => ({ tex: [Texture.WHITE, Texture.WHITE, Texture.WHITE], anchor: [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }] });
    const shop = paint();
    const withShop: HouseLook = { ...look, shop: { v0: shop } };
    const ps = housePieces(withShop, "intern.t2", 2, 0, "v0");
    expect(ps.slice(0, 3).map((p) => [!!p.walls, !!p.paint])).toEqual([[true, false], [false, true], [false, false]]);
    expect(ps[1].tex).toBe(shop.tex[1]);
    // No shop, or none baked for that face: the plain ground floor.
    expect(housePieces(withShop, "intern.t2", 2, 0, null)[0].tex).toBe(look.ground.tex[0]);
    expect(housePieces(withShop, "intern.t2", 2, 0, "u1")[0].tex).toBe(look.ground.tex[0]);
  });

  test("its roof's snow last of all, lifted with the roof", () => {
    const snowy: HouseLook = { ...look, snow: { tex: [Texture.EMPTY, Texture.WHITE], anchor: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }] } };
    const ps = housePieces(snowy, "intern.t2", 3, 0), roof = ps[ps.length - 2], snow = ps[ps.length - 1];
    expect(snow.snow).toBe(true);
    expect(snow.walls).toBe(false);
    expect(snow.lift).toBe(roof.lift);
    expect(housePieces(look, "intern.t2", 3, 0).some((p) => p.snow)).toBe(false);
  });

  test("keeps its colour: the same building is always tinted the same, and a street of them is not all one", () => {
    expect(houseTint("intern.t0", 7)).toBe(houseTint("intern.t0", 7));
    expect(new Set(Array.from({ length: 40 }, (_, k) => houseTint("intern.t0", k))).size).toBeGreaterThan(2);
    expect(houseOf("intern.t0")!.tints).toContain(houseTint("intern.t0", 3));
  });
});

describe("snow on a roof", () => {
  test("lies on what faces the sky, lifted off it, and nowhere else", () => {
    for (const h of HOUSES) {
      const roof = h.parts().roof, snow = snowOver(roof);
      expect(snow.length).toBeGreaterThan(0);
      for (const t of snow) {
        expect(t.mat).toBe("snow");
        expect(t.n[2]).toBeGreaterThanOrEqual(0.42);
      }
      // Each over a face of the roof turned up, a little above it.
      const up = roof.filter((t) => t.n[2] >= 0.42 && t.mat !== "pane");
      expect(snow.length).toBe(up.length);
      snow.forEach((t, k) => expect(t.p[0][2]).toBeGreaterThan(up[k].p[0][2]));
    }
    // A wall, a window: none.
    expect(snowOver([{ p: [[0, 0, 0], [1, 0, 0], [1, 0, 1]], mat: "wall", n: [0, 1, 0] }])).toEqual([]);
  });

  test("the sheet has each kit's", () => {
    const sheet = JSON.parse(readFileSync("public/isometric_assets/derived/houses.json", "utf8")) as HousesSheet;
    for (const h of HOUSES) expect(sheet.kits[h.id].snow?.length).toBeGreaterThan(3);
  });
});
