import { describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, idx, recomputeHeightRange, type Grid } from "../grid";
import { deserializeWorld, serializeWorld } from "../io/serialize";
import { forestTrees } from "../render/forest";
import { COVER, MATURE, vegAt } from "./fields";
import { stepVegetation, vegStep, VEG_DT } from "./step";

/** WHAT GROWS: the fields from the ground, the years through them, the forest from them. @see fields, step */
const palette = [null, "grass", "wood3", "wood1", "dirt"] as const;
const GRASS = 1, WOOD3 = 2, WOOD1 = 3, DIRT = 4;
/** A 32² meadow with an 8×8 wood in the middle of it. */
function meadow(): Grid {
  const g = createGrid(32, 32); fillTerrain(g, GRASS);
  for (let y = 12; y < 20; y++) for (let x = 12; x < 20; x++) g.terrain[idx(g, x, y)] = WOOD3;
  return g;
}
const coverAt = (g: Grid, x: number, y: number) => g.veg.cover[vegAt(g, palette, x, y)];
const woodCells = (g: Grid) => { let n = 0; for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (coverAt(g, x, y) === COVER.wood) n++; return n; };
/** Run the calendar from 0 to `years`, a step every {@link VEG_DT}, as the frame loop would. */
function years(g: Grid, n: number, every = VEG_DT) { stepVegetation(g, palette, 0); for (let t = every; t <= n + 1e-9; t += every) stepVegetation(g, palette, t); }

describe("the vegetation fields", () => {
  test("taken from the ground: a woodN tile a mature wood of N, grass grass, reeds at the shore, bare dirt nothing", () => {
    const g = meadow();
    g.terrain[idx(g, 2, 2)] = WOOD1; g.terrain[idx(g, 3, 3)] = DIRT;
    for (let x = 0; x < 32; x++) g.pool[idx(g, x, 30)] = 2;
    let i = vegAt(g, palette, 14, 14);
    expect([g.veg.cover[i], g.veg.density[i], g.veg.age[i], g.veg.health[i]]).toEqual([COVER.wood, 3, MATURE, 255]);
    i = vegAt(g, palette, 2, 2);
    expect([g.veg.cover[i], g.veg.density[i]]).toEqual([COVER.wood, 1]);
    expect(coverAt(g, 3, 3)).toBe(COVER.none);
    expect(coverAt(g, 5, 5)).toBe(COVER.grass);
    const shore = Array.from({ length: 32 }, (_, x) => coverAt(g, x, 29)).filter((c) => c === COVER.reeds).length;
    expect(shore).toBeGreaterThan(8);
    expect(shore).toBeLessThan(32);
    // Painted over in the editor: taken afresh.
    g.terrain[idx(g, 14, 14)] = GRASS;
    expect(coverAt(g, 14, 14)).toBe(COVER.grass);
  });

  test("saved with the map and read back as they were; a map from before them taken from its ground", () => {
    const g = meadow();
    years(g, 0.05);
    g.veg.cover[vegAt(g, palette, 3, 3)] = COVER.scrub; g.veg.age[idx(g, 3, 3)] = 40;
    const file = serializeWorld(g, { terrain: [...palette], paved: [null] });
    const back = deserializeWorld(JSON.parse(JSON.stringify(file))).grid;
    expect([...back.veg.cover]).toEqual([...g.veg.cover]);
    expect([...back.veg.age]).toEqual([...g.veg.age]);
    expect(back.veg.t).toBeCloseTo(g.veg.t, 9);
    const old = deserializeWorld(JSON.parse(JSON.stringify({ ...file, veg: undefined, vegT: undefined }))).grid;
    expect(old.veg.cover[vegAt(old, palette, 14, 14)]).toBe(COVER.wood);
    expect(old.veg.t).toBe(-1);
  });
});

describe("the years", () => {
  test("the same map and the same years, the same woods; however the frames fell", () => {
    const a = meadow(), b = meadow();
    years(a, 3); years(b, 3);
    expect([...a.veg.cover]).toEqual([...b.veg.cover]);
    expect([...a.veg.density]).toEqual([...b.veg.density]);
  });

  test("a wood spreads over the years through scrub, its new trees grow up, and nothing seeds by a road, a building or the water", () => {
    const g = meadow();
    // A road along the wood's west side, a house to the north, a pond to the east.
    for (let y = 0; y < 32; y++) g.paved[idx(g, 9, y)] = 1;
    g.structureAt[idx(g, 15, 9)] = 7;
    for (let y = 12; y < 20; y++) g.pool[idx(g, 22, y)] = 2;
    const before = woodCells(g);
    years(g, 6, VEG_DT * 4);
    expect(woodCells(g)).toBeGreaterThan(before + 6);
    for (let y = 0; y < 32; y++) for (const x of [8, 9, 10]) expect([COVER.wood, COVER.scrub]).not.toContain(coverAt(g, x, y));
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) expect([COVER.wood, COVER.scrub]).not.toContain(coverAt(g, 15 + dx, 9 + dy));
    for (let y = 12; y < 20; y++) expect(coverAt(g, 22, y)).not.toBe(COVER.wood);
    // Some of what came up is grown by now, some still young.
    let young = 0, grown = 0;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const i = idx(g, x, y);
      if (g.veg.cover[i] !== COVER.wood || (x >= 12 && x < 20 && y >= 12 && y < 20)) continue;
      if (g.veg.age[i] === MATURE) grown++; else young++;
    }
    expect(grown + young).toBeGreaterThan(0);
    expect(grown).toBeGreaterThan(0);
  });

  test("time away caught up in a few steps: a wood spreads a few cells, never across the map", () => {
    const g = meadow();
    stepVegetation(g, palette, 0);
    stepVegetation(g, palette, 12);
    expect(g.veg.t).toBeCloseTo(12, 9);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const out = Math.max(12 - x, x - 19, 12 - y, y - 19, 0);
      if (out > 8) expect(coverAt(g, x, y)).not.toBe(COVER.wood);
    }
  });

  test("a calendar set back, or a map never stepped, starts from where it is", () => {
    const g = meadow();
    expect(stepVegetation(g, palette, 5)).toBe(false);
    expect(g.veg.t).toBe(5);
    expect(stepVegetation(g, palette, 2)).toBe(false);
    expect(g.veg.t).toBe(2);
    // One step's worth and no more: nothing.
    expect(vegStep(g, palette, 0, 1)).toBe(false);
  });
});

describe("the forest by its biome", () => {
  /** A slope from a valley at x = 0 to a height at x = 31, a river at the foot, woods all over. */
  function hill(): Grid {
    const g = createGrid(32, 32); fillTerrain(g, WOOD3);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) g.height[idx(g, x, y)] = Math.round(x / 2);
    for (let y = 0; y < 32; y++) { g.terrain[idx(g, 0, y)] = GRASS; g.pool[idx(g, 0, y)] = 2; }
    recomputeHeightRange(g);
    return g;
  }
  const kinds = (g: Grid, x0: number, x1: number) => {
    const n = new Map<string, number>();
    for (let y = 2; y < 30; y++) for (let x = x0; x < x1; x++) for (const t of forestTrees(g, palette, x, y)) n.set(t.kind, (n.get(t.kind) ?? 0) + 1);
    return n;
  };

  test("willow and poplar by the water, pines on the height, broadleaves in the valley", () => {
    const g = hill();
    const shore = kinds(g, 1, 3), high = kinds(g, 27, 31), valley = kinds(g, 5, 9);
    expect((shore.get("willow") ?? 0) + (shore.get("poplar") ?? 0)).toBeGreaterThan(20);
    expect(shore.get("pine") ?? 0).toBe(0);
    expect(high.get("pine") ?? 0).toBeGreaterThan((high.get("oak") ?? 0) * 4);
    expect((valley.get("oak") ?? 0) + (valley.get("lime") ?? 0)).toBeGreaterThan(valley.get("pine") ?? 0);
  });

  test("a young wood's trees are small; scrub is shrubs; reeds and heather where the ground is those", () => {
    const g = meadow();
    const big = Math.max(...forestTrees(g, palette, 15, 15).map((t) => t.size));
    for (let y = 12; y < 20; y++) for (let x = 12; x < 20; x++) g.veg.age[vegAt(g, palette, x, y)] = 0;
    const small = Math.max(...forestTrees(g, palette, 15, 15).map((t) => t.size));
    expect(small).toBeLessThan(big * 0.6);
    const s = vegAt(g, palette, 4, 4); g.veg.cover[s] = COVER.scrub;
    const scrub = forestTrees(g, palette, 4, 4);
    expect(scrub.filter((t) => t.kind === "shrub").length).toBeGreaterThan(0);
    const r = vegAt(g, palette, 6, 4); g.veg.cover[r] = COVER.reeds;
    expect(forestTrees(g, palette, 6, 4).every((t) => t.kind === "reeds")).toBe(true);
    expect(forestTrees(g, palette, 6, 4).length).toBeGreaterThanOrEqual(3);
  });
});
