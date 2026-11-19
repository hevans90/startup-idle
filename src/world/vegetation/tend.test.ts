import { describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, idx, stampFootprint, type Grid, type Structure } from "../grid";
import { deserializeWorld, serializeWorld } from "../io/serialize";
import { forestTrees } from "../render/forest";
import { COVER, HARVEST, MATURE, vegAll, vegAt } from "./fields";
import { stepVegetation } from "./step";
import { FARM, claimFields, fell, fellingOf, harvestable, plant, plantable } from "./tend";

/** WHAT THE PLAYER DOES TO WHAT GROWS: felling, planting, farming. @see tend */
const palette = [null, "grass", "wood3", "wood1"] as const;
const GRASS = 1, WOOD3 = 2;
/** A 32² meadow with an 8×8 wood at 12–19. */
function meadow(): Grid {
  const g = createGrid(32, 32); fillTerrain(g, GRASS);
  for (let y = 12; y < 20; y++) for (let x = 12; x < 20; x++) g.terrain[idx(g, x, y)] = WOOD3;
  return g;
}
const coverAt = (g: Grid, x: number, y: number) => g.veg.cover[vegAt(g, palette, x, y)];
const box = (x0: number, y0: number, w: number, h: number) => Array.from({ length: w * h }, (_, k) => ({ x: x0 + (k % w), y: y0 + Math.floor(k / w) }));
function addFarm(g: Grid, x: number, y: number): Structure {
  const s: Structure = { id: 7, def: FARM, x, y, w: 2, h: 2 };
  g.structures.set(s.id, s); stampFootprint(g, s);
  return s;
}

describe("felling", () => {
  test("counts a wood's trees and their timber; leaves stumps on open ground, grass under what is built", () => {
    const g = meadow(), cells = box(12, 12, 2, 2);
    expect(fellingOf(g, palette, cells)).toEqual({ trees: 12, timber: 12 });
    // (Open meadow: nothing to fell.)
    expect(fellingOf(g, palette, box(2, 2, 3, 3)).trees).toBe(0);
    fell(g, palette, cells);
    expect(cells.map((c) => coverAt(g, c.x, c.y))).toEqual([COVER.stumps, COVER.stumps, COVER.stumps, COVER.stumps]);
    expect(g.veg.density[idx(g, 12, 12)]).toBe(3);
    expect(forestTrees(g, palette, 12, 12).every((t) => t.kind === "stump")).toBe(true);
    fell(g, palette, box(14, 14, 1, 1), true);
    expect(coverAt(g, 14, 14)).toBe(COVER.grass);
  });

  test("young trees are less timber; scrub and a hedge are felled but not sold", () => {
    const g = meadow();
    g.veg.age[vegAt(g, palette, 12, 12)] = MATURE / 2;
    expect(fellingOf(g, palette, [{ x: 12, y: 12 }]).timber).toBeCloseTo(1.5, 1);
    plant(g, palette, [{ x: 2, y: 2 }], "hedge");
    expect(fellingOf(g, palette, [{ x: 2, y: 2 }])).toEqual({ trees: 1, timber: 0 });
  });

  test("stumps rot back into grass in a year or two", () => {
    const g = meadow(), cells = box(12, 12, 8, 8);
    stepVegetation(g, palette, 0);
    fell(g, palette, cells);
    for (let t = 1 / 360; t <= 3; t += 1 / 360) stepVegetation(g, palette, t);
    expect(cells.filter((c) => coverAt(g, c.x, c.y) === COVER.stumps).length).toBeLessThan(8);
  });
});

describe("planting", () => {
  test("open ground takes it, a wood, a hedge already there and built ground do not", () => {
    const g = meadow();
    g.paved[idx(g, 4, 4)] = 1;
    plant(g, palette, [{ x: 6, y: 6 }], "hedge");
    const ok = plantable(g, palette, [{ x: 2, y: 2 }, { x: 4, y: 4 }, { x: 6, y: 6 }, { x: 13, y: 13 }], "row");
    expect(ok).toEqual([{ x: 2, y: 2 }]);
    expect(plantable(g, palette, [{ x: 6, y: 6 }], "hedge")).toEqual([]);
  });

  test("saplings grow up; a wood planted is a wood, a bed in flower from the first", () => {
    const g = meadow(), cells = box(2, 2, 3, 3);
    plant(g, palette, cells, "woods");
    plant(g, palette, [{ x: 8, y: 2 }], "bed");
    expect([coverAt(g, 2, 2), g.veg.density[idx(g, 2, 2)], g.veg.age[idx(g, 2, 2)]]).toEqual([COVER.wood, 1, 0]);
    expect(forestTrees(g, palette, 8, 2).filter((t) => t.kind === "flowers").length).toBe(9);
    stepVegetation(g, palette, 0);
    for (let t = 1 / 360; t <= 2.2; t += 1 / 360) stepVegetation(g, palette, t);
    expect(cells.every((c) => coverAt(g, c.x, c.y) === COVER.wood && g.veg.age[idx(g, c.x, c.y)] === MATURE)).toBe(true);
  });
});

describe("farms", () => {
  test("a farm claims the open ground in reach, not the wood", () => {
    const g = meadow();
    const f = addFarm(g, 8, 8);
    const n = claimFields(g, palette, f);
    expect(n).toBeGreaterThan(30);
    expect(coverAt(g, 5, 5)).toBe(COVER.field);
    expect(coverAt(g, 12, 12)).toBe(COVER.wood);
    expect(coverAt(g, 4, 4)).toBe(COVER.grass);
    expect(harvestable(g)).toBe(n);
  });

  test("its fields are cut once a year, as the calendar passes harvest, however the time came", () => {
    const g = meadow(), f = addFarm(g, 8, 8), n = claimFields(g, palette, f);
    stepVegetation(g, palette, 0);
    for (let t = 1 / 360; t <= 2; t += 1 / 360) stepVegetation(g, palette, t);
    expect(g.veg.harvest).toBe(2 * n);
    // Time away: three years in one jump, three harvests.
    g.veg.harvest = 0;
    stepVegetation(g, palette, 5);
    expect(g.veg.harvest).toBe(3 * n);
    expect(HARVEST).toBeGreaterThan(0);
  });

  test("a field with no farm goes back to grass", () => {
    const g = meadow(), f = addFarm(g, 8, 8);
    claimFields(g, palette, f);
    g.structures.delete(f.id);
    for (let y = 8; y < 10; y++) for (let x = 8; x < 10; x++) g.structureAt[idx(g, x, y)] = -1;
    stepVegetation(g, palette, 0);
    for (let t = 1 / 360; t <= 3; t += 1 / 360) stepVegetation(g, palette, t);
    expect(coverAt(g, 5, 5)).toBe(COVER.grass);
    expect(g.veg.harvest).toBe(0);
  });
});

describe("saved", () => {
  test("stumps, rows, hedges, beds and fields read back as they were; a save packed the old way still reads", () => {
    const g = meadow();
    fell(g, palette, box(12, 12, 2, 2));
    plant(g, palette, [{ x: 2, y: 2 }], "row"); plant(g, palette, [{ x: 3, y: 2 }], "hedge"); plant(g, palette, [{ x: 4, y: 2 }], "bed");
    claimFields(g, palette, addFarm(g, 24, 24));
    const file = serializeWorld(g, { terrain: [...palette], paved: [null] });
    const back = deserializeWorld(JSON.parse(JSON.stringify(file))).grid;
    expect([...back.veg.cover]).toEqual([...g.veg.cover]);
    expect([...back.veg.density]).toEqual([...g.veg.density]);
    // Phase 2's packing: cover in three bits, density above, and no `vegPack`.
    const old = meadow();
    vegAll(old, palette);
    const packed = old.veg.cover.map((c, i) => c | (old.veg.density[i] << 3));
    const f1 = { ...serializeWorld(old, { terrain: [...palette], paved: [null] }), veg: Buffer.from(packed).toString("base64"), vegPack: undefined };
    const read = deserializeWorld(JSON.parse(JSON.stringify(f1))).grid;
    expect([coverAt(read, 14, 14), read.veg.density[idx(read, 14, 14)]]).toEqual([COVER.wood, 3]);
    expect(coverAt(read, 2, 2)).toBe(COVER.grass);
  });
});

describe("the farms fixture", () => {
  test("two farms with their fields, a hedge, a row, beds, a young wood, stumps by a grown one", async () => {
    const { applyFixture, FIXTURE_SIZE } = await import("../debug/fixtures");
    const n = FIXTURE_SIZE.farms ?? 48, g = createGrid(n, n);
    applyFixture(g, "farms", 1);
    const count = (c: number) => { let k = 0; for (let i = 0; i < g.w * g.h; i++) if (g.veg.cover[i] === c) k++; return k; };
    expect([...g.structures.values()].filter((s) => s.def === FARM).length).toBe(2);
    expect(count(COVER.field)).toBeGreaterThan(60);
    expect(count(COVER.hedge)).toBe(12);
    expect(count(COVER.row)).toBe(13);
    expect(count(COVER.bed)).toBe(6);
    expect(count(COVER.stumps)).toBe(18);
    expect(count(COVER.wood)).toBeGreaterThan(100);
    expect(count(COVER.reeds)).toBeGreaterThan(5);
    expect(g.veg.age[idx(g, 20, 8)]).toBe(70);
    expect(harvestable(g)).toBe(count(COVER.field));
  });
});
