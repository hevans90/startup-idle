import { describe, expect, test } from "bun:test";

import { clickTakesOver, opensSomething } from "./opens";

describe("what on the map can be clicked", () => {
  test("a finished building that opens something, and the Data Centre", () => {
    expect(opensSomething("garage", undefined)).toBe(true);
    expect(opensSomething("hq", undefined)).toBe(true);
    expect(opensSomething("datacentre", undefined)).toBe(true);
  });

  test("not one still building, nor one that opens nothing, nor a house", () => {
    expect(opensSomething("datacentre", { done: 1, need: 100 })).toBe(false);
    expect(opensSomething("townhall", undefined)).toBe(false);
    expect(opensSomething("kit:intern.t0", undefined)).toBe(false);
  });

  test("takes the click from every tool but the one for pulling buildings down", () => {
    expect(clickTakesOver("paintRoad")).toBe(true);
    expect(clickTakesOver("placeStructure")).toBe(true);
    expect(clickTakesOver("inspect")).toBe(true);
    expect(clickTakesOver("demolish")).toBe(false);
  });
});
