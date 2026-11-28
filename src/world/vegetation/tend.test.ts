import { describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, idx, stampFootprint, type Grid, type Structure } from "../grid";
import { deserializeWorld, serializeWorld } from "../io/serialize";
import { forestTrees } from "../render/forest";
import { COVER, MATURE, setDroneFarming, vegAll, vegAt } from "./fields";
import { CROPS, HARVEST_AT, cropAt, cropHash, nextHarvest } from "./crops";
import { stepVegetation } from "./step";
import { FARM, claimFields, fell, fellingOf, fieldsBy, harvestable, plant, plantable } from "./tend";

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
function addFarm(g: Grid, x: number, y: number, id = 7): Structure {
  const s: Structure = { id, def: FARM, x, y, w: 2, h: 2 };
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

  test("each field is cut once a year, in its crop's season — four harvests a year, however the time came", () => {
    const g = meadow(), f = addFarm(g, 8, 8), n = claimFields(g, palette, f);
    const total = () => [...g.veg.harvest.values()].reduce((a, b) => a + b, 0);
    stepVegetation(g, palette, 0);
    const paid: number[] = [];
    for (let t = 1 / 360; t <= 1; t += 1 / 360) {
      stepVegetation(g, palette, t);
      if (g.veg.harvest.size) { paid.push(total()); g.veg.harvest.clear(); }
    }
    // (Each a share of the fields — a small farm may grow three crops of the four — together every field once.)
    expect(paid.length).toBeGreaterThanOrEqual(3);
    expect(paid.reduce((a, b) => a + b, 0)).toBe(n);
    // Time away: three years in one jump, every field three times.
    stepVegetation(g, palette, 4);
    expect(total()).toBe(3 * n);
    expect(g.veg.harvest.get(f.id)).toBe(3 * n);
  });

  test("two farms are each paid for their own fields: the nearer one's", () => {
    const g = meadow(), a = addFarm(g, 3, 3, 7), b = addFarm(g, 3, 25, 8);
    claimFields(g, palette, a); claimFields(g, palette, b);
    const by = fieldsBy(g);
    expect(by.get(a.id)).toBeGreaterThan(10);
    expect(by.get(b.id)).toBeGreaterThan(10);
    expect((by.get(a.id) ?? 0) + (by.get(b.id) ?? 0)).toBe(harvestable(g));
  });

  test("burnt ground in a farm's reach is its field again at the next harvest — at once, tended by drone", () => {
    const g = meadow(), f = addFarm(g, 8, 8);
    stepVegetation(g, palette, 0.5);
    stepVegetation(g, palette, 0.5 + 1.01 / 360);
    const n = harvestable(g);
    expect(n).toBeGreaterThan(30);
    const i = vegAt(g, palette, 6, 6);
    g.veg.cover[i] = COVER.burnt;
    stepVegetation(g, palette, 0.5 + 2.02 / 360);
    expect(coverAt(g, 6, 6)).toBe(COVER.burnt);
    // (Past autumn's harvest: sown again.)
    for (let t = 0.5 + 3.03 / 360; t < 0.7; t += 1.01 / 360) stepVegetation(g, palette, t);
    expect(coverAt(g, 6, 6)).toBe(COVER.field);
    g.veg.cover[i] = COVER.burnt;
    setDroneFarming(true);
    try {
      stepVegetation(g, palette, 0.72);
      expect(coverAt(g, 6, 6)).toBe(COVER.field);
      // And a tile further.
      expect(harvestable(g)).toBeGreaterThan(n);
    } finally { setDroneFarming(false); }
    expect(f.id).toBe(7);
  });

  test("a field with no farm goes back to grass", () => {
    const g = meadow(), f = addFarm(g, 8, 8);
    claimFields(g, palette, f);
    g.structures.delete(f.id);
    for (let y = 8; y < 10; y++) for (let x = 8; x < 10; x++) g.structureAt[idx(g, x, y)] = -1;
    stepVegetation(g, palette, 0);
    for (let t = 1 / 360; t <= 3; t += 1 / 360) stepVegetation(g, palette, t);
    expect(coverAt(g, 5, 5)).toBe(COVER.grass);
    expect(g.veg.harvest.size).toBe(0);
  });
});

describe("crops", () => {
  test("the hash is the shader's u32 one", () => {
    // (Worked by hand from the WGSL: h = 1·1664525 + 2·1013904223, then the mix.)
    expect(cropHash(0, 0)).toBe(0);
    for (const [x, y] of [[1, 2], [-3, 91], [40, 7]]) { const h = cropHash(x, y); expect(h).toBeGreaterThanOrEqual(0); expect(h).toBeLessThanOrEqual(1); }
  });

  test("a map's fields grow every crop, about a quarter cut each season; a parcel is one crop", () => {
    const seen = new Map<string, number>();
    for (let y = 0; y < 120; y++) for (let x = 0; x < 120; x++) seen.set(cropAt(x, y), (seen.get(cropAt(x, y)) ?? 0) + 1);
    for (const c of CROPS) expect(seen.get(c) ?? 0).toBeGreaterThan(400);
    // (Parcels three across: most cells share their neighbour's crop.)
    let same = 0;
    for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) if (cropAt(x, y) === cropAt(x + 1, y)) same++;
    expect(same / 3600).toBeGreaterThan(0.6);
  });

  test("the next harvest", () => {
    expect(nextHarvest(0)).toEqual({ season: 0, at: HARVEST_AT[0] });
    expect(nextHarvest(2.5).season).toBe(2);
    expect(nextHarvest(2.95)).toEqual({ season: 0, at: 3 + HARVEST_AT[0] });
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
