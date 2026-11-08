import { describe, expect, test } from "bun:test";

import { Container, Graphics } from "pixi.js";

import { createGrid } from "../grid";
import type { RenderCtx } from "../structures/render";
import { DECAL_FADE_MS, createDecals, decalAlpha, decalTiles, decalsWanted, drawDecal } from "./decals";

const town = () => {
  const g = createGrid(12, 12);
  g.structures.set(1, { id: 1, def: "kit:intern.t1", x: 4, y: 4, w: 2, h: 2 });
  g.structures.set(2, { id: 2, def: "kit:intern.t0", x: 6, y: 4, w: 1, h: 1 });
  for (const s of g.structures.values()) for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) g.structureAt[y * g.w + x] = s.id;
  return g;
};

describe("marks on the ground", () => {
  test("a scorch for what burnt out, cracks for what a quake damaged, nothing for the rest", () => {
    expect([...decalsWanted([[1, "fire"], [2, "quake"], [3, "flood"], [4, "heat"]]).keys()]).toEqual(["scorch:1", "crack:2"]);
  });

  test("under the building and round it, but not under the building next door", () => {
    const tiles = decalTiles(town(), town().structures.get(1)!);
    expect(tiles.filter((t) => t.inner)).toHaveLength(4);
    // A 4x4 square less its middle, less the two of building 2's next door (6,4) — (6,5) is open.
    expect(tiles.filter((t) => !t.inner)).toHaveLength(12 - 1);
    expect(tiles.some((t) => t.x === 6 && t.y === 4)).toBe(false);
  });

  test("a tile's mark is the same each time it is drawn", () => {
    const a = new Graphics(), b = new Graphics();
    drawDecal(a, "crack", 42, false, { u: 1, v: 0 });
    drawDecal(b, "crack", 42, false, { u: 1, v: 0 });
    expect(a.bounds.rectangle).toEqual(b.bounds.rectangle);
  });

  test("solid while damaged, fading once rebuilt, then gone", () => {
    expect(decalAlpha("scorch", null)).toBe(1);
    expect(decalAlpha("scorch", DECAL_FADE_MS.scorch / 2)).toBeCloseTo(0.5);
    expect(decalAlpha("crack", DECAL_FADE_MS.crack)).toBeNull();
  });

  test("put down once, faded without a child added or taken, taken up when gone", () => {
    const g = town(), layer = new Container();
    const ctx = { bands: { pavedOf: Array.from({ length: 64 }, () => layer) }, textures: {}, grid: g, scale: 1 } as unknown as RenderCtx;
    let changes = 0;
    layer.on("childAdded", () => changes++);
    layer.on("childRemoved", () => changes++);
    const d = createDecals();
    d.sync(ctx, [[1, "fire"]], 0);
    const n = layer.children.length;
    expect(n).toBe(15);
    d.sync(ctx, [[1, "fire"]], 1000);
    d.sync(ctx, [], 2000);
    d.sync(ctx, [], 2000 + DECAL_FADE_MS.scorch / 2);
    expect(changes).toBe(n);
    expect(layer.children[0].alpha).toBeCloseTo(0.5);
    d.sync(ctx, [], 2000 + DECAL_FADE_MS.scorch);
    expect(layer.children).toHaveLength(0);
  });
});
