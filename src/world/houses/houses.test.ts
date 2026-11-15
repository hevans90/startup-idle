import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Texture } from "pixi.js";

import { HALF_STEPS_PER_M } from "../agents/cars/models";
import { HEIGHT_UNIT } from "../iso";
import type { HousesSheet } from "./houses-format";
import { housePieces, houseTint, type HouseLook, type HousePart } from "./houses-sheet";
import { HOUSE_FLOORS, HOUSE_KITS } from "./kits";
import { HOUSES, houseOf } from "./models";

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
});

describe("the baked sheet", () => {
  test("has every kit's parts as the models have them: `bun run bake:houses` was run", () => {
    const sheet: HousesSheet = JSON.parse(readFileSync("public/isometric_assets/derived/houses.json", "utf8"));
    for (const h of HOUSES) {
      const k = sheet.kits[h.id];
      expect(k).toBeDefined();
      expect(k.mids.length).toBe(h.parts().mids.length);
      for (const f of [k.ground, ...k.mids, k.roof]) expect(f.length).toBe(3 + 4 * sheet.layers);
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

  test("keeps its colour: the same building is always tinted the same, and a street of them is not all one", () => {
    expect(houseTint("intern.t0", 7)).toBe(houseTint("intern.t0", 7));
    expect(new Set(Array.from({ length: 40 }, (_, k) => houseTint("intern.t0", k))).size).toBeGreaterThan(2);
    expect(houseOf("intern.t0")!.tints).toContain(houseTint("intern.t0", 3));
  });
});
