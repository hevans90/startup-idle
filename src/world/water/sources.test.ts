/**
 * Springs and drains.
 *
 * A pour is a volume, placed once. A spring is a RATE, and that is the whole
 * difference: what a pour makes runs out, and what a spring makes is a standing
 * flow. A drain is the same mechanism backwards, and between them a map has
 * somewhere for water to come from and somewhere for it to go, which a map
 * with neither does not — it is a bathtub with the plug in.
 */
import { describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, idx, setHeight, sourceAt } from "../grid";
import {
  COLUMNS_PER_TILE, OPEN_EDGE_DEFAULT, SOURCE_RATE, createWaterField, depthAt, pourAt,
  runSources, setWaterEdge, stepWater, totalVolume, waterEdgeIsOpen, wetTiles,
} from "./field";
import { fluidIndexOf } from "./materials";

const flat = (w = 24, h = 24) => {
  const g = createGrid(w, h);
  fillTerrain(g, 1);
  return g;
};

/**
 * A field with its edge walled in.
 *
 * Every test here counts water, and a map lets water off its edge by default —
 * so left open, what these measure is the boundary as much as the tap. The
 * edge has its own tests.
 */
const tank = (g: ReturnType<typeof flat>) => {
  const f = createWaterField(g);
  setWaterEdge(f, false);
  return f;
};

const spring = (g: ReturnType<typeof flat>, x: number, y: number, rate = SOURCE_RATE) => {
  g.source[idx(g, x, y)] = rate;
};

/** Run the world for `seconds`, sources and flow together, as the scene does. */
function live(field: ReturnType<typeof createWaterField>, g: ReturnType<typeof flat>, seconds: number) {
  for (let n = 0; n < Math.round(seconds * 60); n++) {
    runSources(field, g, 1 / 60);
    stepWater(field, 1 / 60);
  }
}

describe("a spring", () => {
  test("puts out its rate a second, whatever the column resolution", () => {
    // The rate is over the TILE. Turning the detail up must not turn the tap up
    // with it, and it would if each column took the full rate.
    const g = flat();
    spring(g, 12, 12);
    const f = tank(g);
    live(f, g, 10);
    expect(totalVolume(f) / (COLUMNS_PER_TILE * COLUMNS_PER_TILE))
      .toBeCloseTo(SOURCE_RATE * 10, 1);
  });

  test("keeps producing, so what it makes does not run out", () => {
    const g = flat();
    spring(g, 12, 12);
    const f = tank(g);
    live(f, g, 5);
    const early = totalVolume(f);
    live(f, g, 5);
    expect(totalVolume(f)).toBeCloseTo(early * 2, 0);
  });

  test("a pour does the opposite: it arrives once and that is all of it", () => {
    const g = flat();
    const f = tank(g);
    pourAt(f, 12, 12, 6, 1);
    const placed = totalVolume(f);
    live(f, g, 10);
    expect(totalVolume(f)).toBeCloseTo(placed, 3);
  });

  test("it runs downhill from where it stands", () => {
    const g = flat(32, 8);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 32; x++) setHeight(g, x, y, Math.round((30 - x) * 0.6));
    }
    spring(g, 2, 4);
    const f = tank(g);
    live(f, g, 20);
    // Most of it is downhill of the spring, not sitting on it.
    let above = 0, below = 0;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 32; x++) {
        if (x < 8) above += depthAt(f, x, y);
        else below += depthAt(f, x, y);
      }
    }
    expect(below).toBeGreaterThan(above * 2);
  });

  test("it carries the fluid the layer says it does", () => {
    const g = flat();
    const slop = fluidIndexOf("slop");
    spring(g, 12, 12);
    g.fluid[idx(g, 12, 12)] = slop;
    const f = tank(g);
    live(f, g, 3);
    const i = 12 * COLUMNS_PER_TILE * f.columns.nx + 12 * COLUMNS_PER_TILE;
    expect(f.columns.material[i]).toBe(slop);
  });
});

describe("a drain", () => {
  test("takes water away at its rate, once there is water standing on it", () => {
    const g = flat();
    const f = tank(g);
    for (let y = 8; y <= 16; y++) for (let x = 8; x <= 16; x++) pourAt(f, x, y, 60, 1);
    g.source[idx(g, 12, 12)] = -SOURCE_RATE;
    live(f, g, 5);                                  // let the pour settle over it
    const held = totalVolume(f);
    live(f, g, 5);
    const perSecond = (held - totalVolume(f)) / (COLUMNS_PER_TILE * COLUMNS_PER_TILE) / 5;
    expect(perSecond).toBeCloseTo(SOURCE_RATE, 0);
  });

  test("but only as fast as water reaches it", () => {
    // A drain is a rate it can take, not a rate it can conjure. Sitting in a
    // shallow pool it empties its own tile in a moment and then runs at
    // whatever the flow brings, which is the difference between a plughole and
    // a vacuum.
    const g = flat();
    const f = tank(g);
    for (let y = 10; y <= 14; y++) for (let x = 10; x <= 14; x++) pourAt(f, x, y, 20, 1);
    const held = totalVolume(f);
    g.source[idx(g, 12, 12)] = -SOURCE_RATE;
    live(f, g, 5);
    const gone = (held - totalVolume(f)) / (COLUMNS_PER_TILE * COLUMNS_PER_TILE);
    expect(gone).toBeGreaterThan(0);
    expect(gone).toBeLessThan(SOURCE_RATE * 5);
  });

  test("and cannot take what is not there", () => {
    const g = flat();
    g.source[idx(g, 12, 12)] = -SOURCE_RATE;
    const f = tank(g);
    live(f, g, 10);
    expect(totalVolume(f)).toBe(0);
    expect(f.columns.depth.every((d) => d >= 0)).toBe(true);
  });

  test("a spring and a drain together reach a standing flow rather than filling up", () => {
    // The point of having both. Without an outlet a source is a tap left
    // running in a sealed room, and the map fills until it is a lake.
    const g = flat(32, 12);
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 32; x++) setHeight(g, x, y, Math.round((30 - x) * 0.5));
    }
    spring(g, 2, 6);
    g.source[idx(g, 30, 6)] = -SOURCE_RATE;
    const f = tank(g);
    live(f, g, 30);
    const a = totalVolume(f);
    live(f, g, 30);
    // Still holding about as much thirty seconds later: what comes in leaves.
    expect(Math.abs(totalVolume(f) - a)).toBeLessThan(a * 0.25);
    expect(wetTiles(f)).toBeGreaterThan(10);        // and there IS a flow
  });
});

describe("the edge of the map", () => {
  test("is open by default, so a river has somewhere to end", () => {
    expect(OPEN_EDGE_DEFAULT).toBe(true);
    expect(waterEdgeIsOpen(createWaterField(flat()))).toBe(true);
  });

  test("a spring runs off it instead of filling the world", () => {
    const g = flat(24, 12);
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 24; x++) setHeight(g, x, y, Math.round((22 - x) * 0.5));
    }
    spring(g, 2, 6);
    const open = createWaterField(g), walled = tank(g);
    live(open, g, 60);
    live(walled, g, 60);
    expect(totalVolume(open)).toBeLessThan(totalVolume(walled) * 0.5);
  });
});

describe("the layer", () => {
  test("reads back what was written, and nothing outside the map", () => {
    const g = flat(8, 8);
    spring(g, 3, 4);
    g.source[idx(g, 5, 5)] = -SOURCE_RATE;
    expect(sourceAt(g, 3, 4)).toBe(SOURCE_RATE);
    expect(sourceAt(g, 5, 5)).toBe(-SOURCE_RATE);
    expect(sourceAt(g, 0, 0)).toBe(0);
    expect(sourceAt(g, -1, 4)).toBe(0);
    expect(sourceAt(g, 8, 4)).toBe(0);
  });

  test("a fresh grid has no springs", () => {
    expect(flat().source.every((r) => r === 0)).toBe(true);
  });
});
