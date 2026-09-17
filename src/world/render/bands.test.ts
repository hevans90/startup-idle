import { describe, expect, test } from "bun:test";
import { Sprite, Texture } from "pixi.js";
import { bandCount, bandOf, cellToWorld, TILE_W } from "../iso";
import {
  createBandLayer, destroyBandLayer, setVisibleBands, visibleBandCount,
} from "./bands";

describe("createBandLayer", () => {
  test("one band per diagonal, each with a cliff, static, paved, structure and dynamic child", () => {
    const L = createBandLayer(8, 5);
    expect(L.bands.length).toBe(bandCount(8, 5)); // 12
    for (let b = 0; b < L.bands.length; b++) {
      expect(L.bands[b].zIndex).toBe(b);
      expect(L.bands[b].children.length).toBe(5);
      expect(L.bands[b].children[0]).toBe(L.cliffOf[b]);
      expect(L.bands[b].children[1]).toBe(L.staticOf[b]);
      expect(L.bands[b].children[2]).toBe(L.pavedOf[b]);
      expect(L.bands[b].children[3]).toBe(L.structureOf[b]);
      expect(L.bands[b].children[4]).toBe(L.dynamicOf[b]);
    }
  });

  test("static is unsorted; dynamic sorts; root sorted once", () => {
    const L = createBandLayer(4, 4);
    expect(L.root.sortableChildren).toBe(true);
    expect(L.staticOf[0].sortableChildren).toBe(false); // never re-sorts on add
    expect(L.dynamicOf[0].sortableChildren).toBe(true);
  });

  test("columns draw under static, and dynamic above it, within a band", () => {
    const L = createBandLayer(4, 4);
    const kids = L.bands[2].children;
    expect(kids.indexOf(L.cliffOf[2])).toBeLessThan(kids.indexOf(L.staticOf[2]));
    expect(kids.indexOf(L.staticOf[2])).toBeLessThan(kids.indexOf(L.pavedOf[2]));
    expect(kids.indexOf(L.pavedOf[2])).toBeLessThan(kids.indexOf(L.dynamicOf[2]));
  });

  test("bands are ordered nearest-last in the root", () => {
    const L = createBandLayer(6, 6);
    const z = L.root.children.map((c) => c.zIndex);
    expect(z).toEqual([...z].sort((a, b) => a - b));
  });
});

describe("the invariant bands rely on", () => {
  /**
   * If two cells in one band could overlap, unsorted static content would be
   * wrong. They cannot: neighbours are exactly TILE_W apart and level, and no
   * atlas frame exceeds 133px wide.
   */
  test("cells in a band are TILE_W apart, level, and so never overlap", () => {
    for (const band of [4, 7, 11]) {
      const cells: [number, number][] = [];
      for (let x = 0; x <= band; x++) cells.push([x, band - x]);
      for (let i = 1; i < cells.length; i++) {
        const a = cellToWorld(cells[i - 1][0], cells[i - 1][1], 0, 1);
        const b = cellToWorld(cells[i][0], cells[i][1], 0, 1);
        expect(Math.abs(a.wx - b.wx)).toBe(TILE_W);
        expect(a.wy).toBe(b.wy);
      }
    }
  });

  test("height never changes which band a cell is in", () => {
    for (const h of [-4, 0, 3, 9]) {
      expect(bandOf(5, 7)).toBe(12);
      // wx is height-independent, so the band assignment cannot shift
      expect(cellToWorld(5, 7, h, 1).wx).toBe(cellToWorld(5, 7, 0, 1).wx);
    }
  });
});

describe("culling", () => {
  test("shows only the requested range", () => {
    const L = createBandLayer(10, 10);
    setVisibleBands(L, 4, 8);
    expect(visibleBandCount(L)).toBe(5);
    for (let b = 0; b < L.bands.length; b++) {
      expect(L.bands[b].visible).toBe(b >= 4 && b <= 8);
    }
  });
  test("clamps out-of-range requests", () => {
    const L = createBandLayer(5, 5);
    setVisibleBands(L, -100, 100);
    expect([L.visibleLo, L.visibleHi]).toEqual([0, L.bands.length - 1]);
    expect(L.bands.every((b) => b.visible)).toBe(true);
  });
  test("is idempotent — repeat calls touch nothing", () => {
    const L = createBandLayer(6, 6);
    setVisibleBands(L, 2, 5);
    const before = L.bands.map((b) => b.visible);
    setVisibleBands(L, 2, 5);
    expect(L.bands.map((b) => b.visible)).toEqual(before);
  });
  test("a culled band keeps its children (visibility only)", () => {
    const L = createBandLayer(5, 5);
    L.staticOf[3].addChild(new Sprite(Texture.EMPTY));
    setVisibleBands(L, 0, 1);
    expect(L.bands[3].visible).toBe(false);
    expect(L.staticOf[3].children.length).toBe(1);
  });
});

describe("adding content never re-sorts the world", () => {
  test("root child order is unchanged after many static adds", () => {
    const L = createBandLayer(8, 8);
    const before = L.root.children.map((c) => c.zIndex);
    for (let b = 0; b < L.bands.length; b++) {
      for (let i = 0; i < 5; i++) L.staticOf[b].addChild(new Sprite(Texture.EMPTY));
    }
    expect(L.root.children.map((c) => c.zIndex)).toEqual(before);
  });
});

describe("destroyBandLayer", () => {
  test("tears down and empties the arrays", () => {
    const L = createBandLayer(4, 4);
    L.staticOf[0].addChild(new Sprite(Texture.EMPTY));
    destroyBandLayer(L);
    expect(L.bands.length).toBe(0);
    expect(L.staticOf.length).toBe(0);
    expect(L.dynamicOf.length).toBe(0);
  });
});

describe("scale", () => {
  test("a 64x64 map is 127 bands", () => {
    const L = createBandLayer(64, 64);
    expect(L.bands.length).toBe(127);
    expect(L.root.children.length).toBe(127);
    destroyBandLayer(L);
  });
});
