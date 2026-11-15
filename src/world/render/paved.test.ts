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
import { buildPaved, createPavedLayer, pavedCount, syncPaved } from "./paved";
import type { RoadPainter } from "./road-paint";

/** A painter that paints nothing: one texture a key, and the keys it was asked for. */
function standIn() {
  const made = new Map<string, Texture>();
  const painter = {
    textureFor(key: string) { let t = made.get(key); if (!t) made.set(key, (t = new Texture({ source: Texture.WHITE.source }))); return t; },
    peek: (key: string) => made.get(key),
    keep() {}, flush() {}, evict: () => false,
  } as unknown as RoadPainter;
  return { painter, made };
}

const setup = (w = 12, h = 12, paints = true) => {
  const grid = createGrid(w, h);
  fillTerrain(grid, 1);
  const bl = createBandLayer(w, h);
  const { painter, made } = standIn();
  const pl = createPavedLayer(grid, 1, undefined, paints ? painter : null);
  return { grid, bl, pl, made };
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
