import { describe, expect, test } from "bun:test";

import { createGrid, idx } from "./grid";
import { HILL_DISCOUNT, buyable, landDiscount, landPrice, ownsTile, parcelOf, parcelRect, ruggedness, startingLand } from "./land";

describe("land", () => {
  test("a map is four by four parcels, the last row and column taking what is left", () => {
    const g = createGrid(50, 50);
    expect(parcelOf(g, 0, 0)).toBe(0);
    expect(parcelOf(g, 49, 0)).toBe(3);
    expect(parcelOf(g, 0, 49)).toBe(12);
    expect(parcelRect(g, 15)).toEqual({ x0: 39, y0: 39, x1: 50, y1: 50 });
  });

  test("a company starts with the block its street runs through", () => {
    const g = createGrid(64, 64);
    for (let x = 0; x < 64; x++) g.paved[idx(g, x, 10)] = 1;
    expect(startingLand(g)).toEqual([1, 2, 5, 6]);
    // With no road at all, the middle.
    expect(startingLand(createGrid(64, 64))).toEqual([5, 6, 9, 10]);
  });

  test("a founder who has done this before starts with more, beside the block, by the road", () => {
    const g = createGrid(64, 64);
    for (let x = 0; x < 64; x++) g.paved[idx(g, x, 10)] = 1;
    const more = startingLand(g, 2);
    expect(more.length).toBe(6);
    expect(more).toEqual(expect.arrayContaining([1, 2, 5, 6]));
    // Along the street, not off it: the top row's ends.
    expect(more).toEqual(expect.arrayContaining([0, 3]));
  });

  test("owns its own land, all of it with no list, and buys only next to what it has", () => {
    const g = createGrid(64, 64);
    expect(ownsTile(g, [5], 20, 20)).toBe(true);
    expect(ownsTile(g, [5], 40, 20)).toBe(false);
    expect(ownsTile(g, null, 40, 20)).toBe(true);
    expect(buyable([5], 6)).toBe(true);
    expect(buyable([5], 10)).toBe(false);
    expect(buyable([5], 5)).toBe(false);
  });

  test("each parcel costs more than the last", () => {
    expect(landPrice(0, 0)).toBe(400);
    expect(landPrice(1, 0)).toBe(1000);
    expect(landPrice(0, 100)).toBe(4500);
    expect(landPrice(2, 100)).toBeGreaterThan(landPrice(1, 100));
  });
});

describe("hilly land", () => {
  test("level ground is full price, and the more rugged, the cheaper, up to the most hills take off", () => {
    const g = createGrid(20, 20);
    expect(ruggedness(g)).toBe(0);
    expect(landDiscount(g)).toBe(0);
    for (let i = 0; i < g.height.length; i++) g.height[i] = (i % 2) * 2;
    g.rev++;
    expect(ruggedness(g)).toBe(1);
    expect(landDiscount(g)).toBe(HILL_DISCOUNT);
  });
});
