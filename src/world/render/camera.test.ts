import { describe, expect, test } from "bun:test";
import { HEIGHT_UNIT, HH, MAX_RISE, TILE_DIAMOND_H, cellToWorld } from "../iso";
import { createGrid, setHeight } from "../grid";
import { boundsCentre, visibleBandRange, worldBounds } from "./camera";

describe("worldBounds", () => {
  test("spans the map's extreme cells", () => {
    const g = createGrid(8, 6);
    const b = worldBounds(g, 1, 0);
    expect(b.minX).toBeCloseTo(cellToWorld(0, 5, 0, 1).wx, 6);
    expect(b.maxX).toBeCloseTo(cellToWorld(7, 0, 0, 1).wx, 6);
  });

  test("is symmetric about x for a square map", () => {
    const b = worldBounds(createGrid(16, 16), 1, 0);
    expect(b.minX).toBeCloseTo(-b.maxX, 6);
  });

  test("a square map is about 2:1, matching the diamond projection", () => {
    const b = worldBounds(createGrid(64, 64), 1, 0);
    const ratio = (b.maxX - b.minX) / (b.maxY - b.minY);
    expect(ratio).toBeGreaterThan(1.6);
    expect(ratio).toBeLessThan(2.4);
  });

  test("grows upward for a hill and downward for a pit", () => {
    const flat = worldBounds(createGrid(8, 8), 1, 0);
    const hilly = createGrid(8, 8); setHeight(hilly, 4, 4, 8);
    const pitted = createGrid(8, 8); setHeight(pitted, 4, 4, -6);
    expect(worldBounds(hilly, 1, 0).minY).toBeLessThan(flat.minY);
    expect(worldBounds(pitted, 1, 0).maxY).toBeGreaterThan(flat.maxY);
  });

  test("scales", () => {
    const a = worldBounds(createGrid(10, 10), 1, 0);
    const b = worldBounds(createGrid(10, 10), 2, 0);
    expect(b.maxX - b.minX).toBeCloseTo((a.maxX - a.minX) * 2, 6);
  });

  test("boundsCentre is the midpoint", () => {
    const c = boundsCentre({ minX: -10, maxX: 30, minY: 0, maxY: 100 });
    expect(c).toEqual({ x: 10, y: 50 });
  });
});

describe("visibleBandRange", () => {
  const g = createGrid(64, 64);

  test("a tall view covers every band", () => {
    const b = worldBounds(g, 1, 0);
    const { lo, hi } = visibleBandRange(g, 1, b.minY, b.maxY);
    expect(lo).toBeLessThanOrEqual(0);
    expect(hi).toBeGreaterThanOrEqual(126); // bandCount(64,64) - 1
  });

  test("a narrow view covers far fewer bands than the map has", () => {
    const { lo, hi } = visibleBandRange(g, 1, 1000, 1400);
    expect(hi - lo).toBeLessThan(30);
    expect(lo).toBeGreaterThan(20);
  });

  test("a band inside the returned range really can intersect the view", () => {
    const top = 900, bottom = 1300;
    const { lo, hi } = visibleBandRange(g, 1, top, bottom);
    // the band whose own row is mid-view must be included
    const mid = Math.round(((top + bottom) / 2) / HH);
    expect(mid).toBeGreaterThanOrEqual(lo);
    expect(mid).toBeLessThanOrEqual(hi);
  });

  test("widens for elevation — a raised distant band stays in range", () => {
    const flatRange = visibleBandRange(g, 1, 500, 800);
    const tall = createGrid(64, 64);
    setHeight(tall, 10, 10, 40); // 20 full steps
    const tallRange = visibleBandRange(tall, 1, 500, 800);
    expect(tallRange.hi).toBeGreaterThan(flatRange.hi);
    // and by roughly the lift expressed in bands
    expect(tallRange.hi - flatRange.hi).toBeGreaterThanOrEqual(
      Math.floor((40 * HEIGHT_UNIT) / HH) - 1,
    );
  });

  test("widens downward for a pit", () => {
    const pit = createGrid(64, 64);
    setHeight(pit, 10, 10, -20);
    expect(visibleBandRange(pit, 1, 500, 800).lo)
      .toBeLessThan(visibleBandRange(g, 1, 500, 800).lo);
  });
});

describe("ramp headroom", () => {
  test("bounds and cull range allow for a ramp rising above the tallest base", () => {
    const g = createGrid(16, 16, 1);
    setHeight(g, 4, 4, 10);
    const b = worldBounds(g, 1, 0);
    // the tallest BASE alone would put the top at −10 · HEIGHT_UNIT − TILE_DIAMOND_H/2
    const baseOnly = -10 * HEIGHT_UNIT - TILE_DIAMOND_H / 2;
    expect(b.minY).toBeLessThan(baseOnly);
    expect(b.minY).toBeCloseTo(baseOnly - MAX_RISE * HEIGHT_UNIT, 6);

    const flat = createGrid(16, 16, 1);
    const withHill = visibleBandRange(g, 1, 0, 500);
    const withoutHill = visibleBandRange(flat, 1, 0, 500);
    expect(withHill.hi).toBeGreaterThan(withoutHill.hi);
  });
});
