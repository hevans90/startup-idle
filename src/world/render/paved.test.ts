/**
 * The paved overlay: a sprite per paved cell in its band's paved tier, its
 * texture the painter's for the cell's look. The painting itself is
 * road-paint's; here a stand-in hands back a texture per key.
 */
import { describe, expect, test } from "bun:test";
import { Texture } from "pixi.js";

import { createGrid, fillTerrain, setPaved } from "../grid";
import { bandOf } from "../iso";
import { createBandLayer } from "./bands";
import { buildPaved, createPavedLayer, lodPaved, pavedCount, refreshLooks, snowPaved, syncPaved } from "./paved";
import type { RoadPainter } from "./road-paint";

/** A painter that paints nothing: one texture a key, and the keys it was asked for. */
function standIn() {
  const made = new Map<string, Texture>(), snowOf = new Map<string, number>();
  const painter = {
    textureFor(key: string, _c: unknown, _r: boolean, _l = 0, snow = 0) { let t = made.get(key); if (!t) { made.set(key, (t = new Texture({ source: Texture.WHITE.source }))); snowOf.set(key, snow); } return t; },
    peek: (key: string) => made.get(key),
    keep() {}, flush() {}, evict: () => false,
  } as unknown as RoadPainter;
  return { painter, made, snowOf };
}

const setup = (w = 12, h = 12, paints = true) => {
  const grid = createGrid(w, h);
  fillTerrain(grid, 1);
  const bl = createBandLayer(w, h);
  const { painter, made, snowOf } = standIn();
  const pl = createPavedLayer(grid, 1, undefined, paints ? painter : null);
  return { grid, bl, pl, made, snowOf };
};

describe("the paved overlay", () => {
  test("an unpaved cell has no sprite; a paved one has one in its band's PAVED tier", () => {
    const { grid, bl, pl } = setup();
    setPaved(grid, 4, 4, 1);
    buildPaved(pl, bl, grid);
    expect(pavedCount(pl)).toBe(1);
    expect(pl.sprites[4 * 12 + 4]!.parent).toBe(bl.pavedOf[bandOf(4, 4)]);
    expect(pl.sprites[0]).toBeNull();
  });

  test("erasing removes the sprite, so the ground reappears", () => {
    const { grid, bl, pl } = setup();
    setPaved(grid, 4, 4, 1);
    buildPaved(pl, bl, grid);
    setPaved(grid, 4, 4, 0);
    syncPaved(pl, bl, grid, 4, 4);
    expect(pavedCount(pl)).toBe(0);
  });

  test("the look follows the neighbours: the middle of a run and its end are painted differently", () => {
    const { grid, bl, pl, made } = setup();
    for (let y = 2; y <= 8; y++) setPaved(grid, 5, y, 1);
    buildPaved(pl, bl, grid);
    const tex = (y: number) => pl.sprites[y * 12 + 5]!.texture;
    expect(tex(2)).not.toBe(tex(5));
    expect(made.size).toBeGreaterThan(1);
  });

  test("with nothing to paint on, roads are not drawn and nothing throws", () => {
    const { grid, bl, pl } = setup(12, 12, false);
    setPaved(grid, 4, 4, 1);
    buildPaved(pl, bl, grid);
    expect(pavedCount(pl)).toBe(0);
  });
});

describe("snow on the roads", () => {
  const view = { left: -1e6, top: -1e6, right: 1e6, bottom: 1e6 };
  test("painted into each road's own tile, a few a frame, each keeping its tile till then; and back to bare again", () => {
    const { grid, bl, pl, snowOf } = setup();
    for (let y = 2; y <= 8; y++) setPaved(grid, 5, y, 1);
    buildPaved(pl, bl, grid);
    const bare = pl.sprites[5 * 12 + 5]!.texture;
    snowPaved(pl, grid, 3);
    // Not yet painted: the tile it had.
    expect(pl.sprites[5 * 12 + 5]!.texture).toBe(bare);
    expect(lodPaved(pl, grid, 0, view, 1e9)).toBe(true);
    const key = pl.frames[5 * 12 + 5]!;
    expect(key).toContain("❄70");
    expect(snowOf.get(key)).toBeGreaterThan(0);
    expect(pl.sprites[5 * 12 + 5]!.texture).not.toBe(bare);
    // A road laid while it lies, laid with its snow.
    setPaved(grid, 5, 9, 1);
    refreshLooks(pl, grid);
    for (let y = 8; y <= 9; y++) syncPaved(pl, bl, grid, 5, y);
    expect(pl.frames[9 * 12 + 5]).toContain("❄70");
    // Two steps that paint the same, one tile.
    snowPaved(pl, grid, 5);
    const full = pl.frames[5 * 12 + 5];
    snowPaved(pl, grid, 6);
    expect(pl.frames[5 * 12 + 5]).toBe(full);
    snowPaved(pl, grid, 0);
    lodPaved(pl, grid, 0, view, 1e9);
    expect(pl.sprites[5 * 12 + 5]!.texture).toBe(bare);
  });

  test("with nothing to paint on, nothing throws", () => {
    const { grid, bl, pl } = setup(12, 12, false);
    setPaved(grid, 4, 4, 1);
    buildPaved(pl, bl, grid);
    expect(() => snowPaved(pl, grid, 4)).not.toThrow();
  });
});
