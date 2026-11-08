import { describe, expect, test } from "bun:test";

import { Container, Texture } from "pixi.js";

import { createGrid } from "../grid";
import type { RenderCtx } from "../structures/render";
import { DECAL_FADE_MS, crackAt, cracksOf, createDecals, decalAlpha, decalTiles, decalsWanted, paintTile, scorchAt } from "./decals";

const town = () => {
  const g = createGrid(12, 12);
  g.structures.set(1, { id: 1, def: "kit:intern.t1", x: 4, y: 4, w: 2, h: 2 });
  g.structures.set(2, { id: 2, def: "kit:intern.t0", x: 6, y: 4, w: 1, h: 1 });
  for (const s of g.structures.values()) for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) g.structureAt[y * g.w + x] = s.id;
  return g;
};
const foot = { x: 4, y: 4, w: 2, h: 2 };

describe("marks on the ground", () => {
  test("a scorch for what burnt out, cracks for what a quake damaged, nothing for the rest", () => {
    expect([...decalsWanted([[1, "fire"], [2, "quake"], [3, "flood"], [4, "heat"]]).keys()]).toEqual(["scorch:1", "crack:2"]);
  });

  test("under the building and two tiles round it, but not under the building next door", () => {
    const tiles = decalTiles(town(), town().structures.get(1)!);
    expect(tiles.filter((t) => t.inner)).toHaveLength(4);
    expect(tiles.filter((t) => !t.inner)).toHaveLength(36 - 4 - 1);
    expect(tiles.some((t) => t.x === 6 && t.y === 4)).toBe(false);
  });

  test("a scorch is black against the building and gone past its reach", () => {
    // Averaged round the building, so the soot's tongues don't decide it.
    const ring = (d: number) => {
      let a = 0;
      for (let k = 0; k < 24; k++) { const t = (k / 24) * Math.PI * 2; a += scorchAt(foot, 9, 4.5 + Math.cos(t) * (1 + d), 4.5 + Math.sin(t) * (1 + d)).a; }
      return a / 24;
    };
    expect(ring(0.1)).toBeGreaterThan(0.7);
    expect(ring(0.1)).toBeGreaterThan(ring(0.9));
    expect(ring(3.2)).toBe(0);
  });

  test("cracks run out from the footprint's edge, the same each time, and are dark down their middle", () => {
    const segs = cracksOf(foot, 5);
    expect(cracksOf(foot, 5)).toEqual(segs);
    const first = segs[0];
    expect(Math.hypot(first.ax - 4.5, first.ay - 4.5)).toBeLessThan(1.5);
    const mx = (first.ax + first.bx) / 2, my = (first.ay + first.by) / 2;
    expect(crackAt(foot, segs, 5, mx, my).a).toBeGreaterThan(0.8);
    expect(crackAt(foot, segs, 5, 9, 9).a).toBe(0);
  });

  test("a tile's pixels fill its diamond and leave its corners clear; a tile with nothing on it has none", () => {
    const px = paintTile(0, 0, () => ({ r: 10, g: 10, b: 10, a: 1 }))!;
    const alpha = (x: number, y: number) => px.data[(y * px.w + x) * 4 + 3];
    expect(alpha(px.w / 2, px.h / 2)).toBe(255);
    expect(alpha(1, 1)).toBe(0);
    expect(paintTile(0, 0, () => ({ r: 0, g: 0, b: 0, a: 0 }))).toBeNull();
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
    const d = createDecals({ texture: () => Texture.WHITE, later: (fn) => fn() });
    d.sync(ctx, [[1, "fire"]], 0);
    const n = layer.children.length;
    expect(n).toBeGreaterThan(8);
    d.sync(ctx, [[1, "fire"]], 1000);
    d.sync(ctx, [], 2000);
    d.sync(ctx, [], 2000 + DECAL_FADE_MS.scorch / 2);
    expect(changes).toBe(n);
    expect(layer.children[0].alpha).toBeCloseTo(0.5);
    d.sync(ctx, [], 2000 + DECAL_FADE_MS.scorch);
    expect(layer.children).toHaveLength(0);
  });
});
