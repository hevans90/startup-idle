import { describe, expect, test } from "bun:test";
import { Texture } from "pixi.js";
import { bandOf, cellToWorld, spriteY } from "../iso";
import { VOID, createGrid, fillTerrain, idx, setHeight, setTerrain } from "../grid";
import { createBandLayer } from "./bands";
import {
  TILE_BLEED, buildTerrain, createTerrainLayer, spriteCount, syncCell,
  syncCellAndNeighbours,
} from "./terrain";

const GRASS = 1, DIRT = 2;
const PALETTE = [null, "grass.png", "dirt.png"] as const;
// Two distinguishable stand-in textures with different frame heights.
const TEX: Record<string, Texture> = {
  "grass.png": new Texture({ source: Texture.EMPTY.source, frame: { x: 0, y: 0, width: 132, height: 99 } as never }),
  "dirt.png":  new Texture({ source: Texture.EMPTY.source, frame: { x: 0, y: 0, width: 132, height: 83 } as never }),
};

function setup(w = 6, h = 6, fill = GRASS) {
  const grid = createGrid(w, h);
  fillTerrain(grid, fill);
  const bl = createBandLayer(w, h);
  const tl = createTerrainLayer(grid, PALETTE, 1);
  return { grid, bl, tl };
}

describe("buildTerrain", () => {
  test("one sprite per non-void cell", () => {
    const { grid, bl, tl } = setup(6, 6);
    buildTerrain(tl, bl, grid, TEX);
    expect(spriteCount(tl)).toBe(36);
  });

  test("each sprite lands in the band matching its cell", () => {
    const { grid, bl, tl } = setup(6, 6);
    buildTerrain(tl, bl, grid, TEX);
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) {
      const s = tl.sprites[idx(grid, x, y)]!;
      expect(s.parent).toBe(bl.staticOf[bandOf(x, y)]);
    }
  });

  test("void cells get no sprite", () => {
    const { grid, bl, tl } = setup(4, 4, VOID);
    buildTerrain(tl, bl, grid, TEX);
    expect(spriteCount(tl)).toBe(0);
  });

  test("an unknown material is skipped rather than throwing", () => {
    const { grid, bl, tl } = setup(3, 3);
    setTerrain(grid, 1, 1, 99); // not in the palette
    expect(() => buildTerrain(tl, bl, grid, TEX)).not.toThrow();
    expect(tl.sprites[idx(grid, 1, 1)]).toBeNull();
    expect(spriteCount(tl)).toBe(8);
  });
});

describe("positioning", () => {
  test("x is the diamond centre; y accounts for the frame skirt", () => {
    const { grid, bl, tl } = setup(5, 5);
    buildTerrain(tl, bl, grid, TEX);
    for (const [x, y] of [[0, 0], [2, 1], [4, 4]] as const) {
      const s = tl.sprites[idx(grid, x, y)]!;
      const { wx, wy } = cellToWorld(x, y, 0, 1);
      expect(s.x).toBeCloseTo(wx, 6);
      expect(s.y).toBeCloseTo(spriteY(wy, 99, 1), 6); // grass frame is 99 tall
    }
  });

  test("height lifts the sprite up-screen", () => {
    const { grid, bl, tl } = setup(5, 5);
    buildTerrain(tl, bl, grid, TEX);
    const i = idx(grid, 2, 2);
    const flatY = tl.sprites[i]!.y;
    setHeight(grid, 2, 2, 2); // one full step
    syncCell(tl, bl, grid, TEX, 2, 2);
    expect(tl.sprites[i]!.y).toBeCloseTo(flatY - 33, 6);
  });

  test("bleed is applied", () => {
    const { grid, bl, tl } = setup(3, 3);
    buildTerrain(tl, bl, grid, TEX);
    expect(tl.sprites[0]!.scale.x).toBeCloseTo(TILE_BLEED, 6);
  });

  test("a shorter frame sits higher, from its own skirt", () => {
    const { grid, bl, tl } = setup(3, 3);
    buildTerrain(tl, bl, grid, TEX);
    const i = idx(grid, 1, 1);
    setTerrain(grid, 1, 1, DIRT); // 83px frame => 17px skirt
    syncCell(tl, bl, grid, TEX, 1, 1);
    const { wy } = cellToWorld(1, 1, 0, 1);
    expect(tl.sprites[i]!.y).toBeCloseTo(spriteY(wy, 83, 1), 6);
  });
});

describe("syncCell reconciles in place", () => {
  test("changing material swaps the texture, keeping the same Sprite", () => {
    const { grid, bl, tl } = setup(4, 4);
    buildTerrain(tl, bl, grid, TEX);
    const i = idx(grid, 2, 2);
    const before = tl.sprites[i];
    setTerrain(grid, 2, 2, DIRT);
    syncCell(tl, bl, grid, TEX, 2, 2);
    expect(tl.sprites[i]).toBe(before);              // same object, no churn
    expect(tl.sprites[i]!.texture).toBe(TEX["dirt.png"]);
  });

  test("setting a cell to void removes its sprite", () => {
    const { grid, bl, tl } = setup(4, 4);
    buildTerrain(tl, bl, grid, TEX);
    setTerrain(grid, 1, 2, VOID);
    syncCell(tl, bl, grid, TEX, 1, 2);
    expect(tl.sprites[idx(grid, 1, 2)]).toBeNull();
    expect(spriteCount(tl)).toBe(15);
  });

  test("restoring a voided cell re-adds it to the right band", () => {
    const { grid, bl, tl } = setup(4, 4);
    buildTerrain(tl, bl, grid, TEX);
    setTerrain(grid, 1, 2, VOID); syncCell(tl, bl, grid, TEX, 1, 2);
    setTerrain(grid, 1, 2, GRASS); syncCell(tl, bl, grid, TEX, 1, 2);
    expect(tl.sprites[idx(grid, 1, 2)]!.parent).toBe(bl.staticOf[bandOf(1, 2)]);
    expect(spriteCount(tl)).toBe(16);
  });

  test("out-of-bounds is a no-op", () => {
    const { grid, bl, tl } = setup(3, 3);
    buildTerrain(tl, bl, grid, TEX);
    expect(() => syncCell(tl, bl, grid, TEX, -1, 0)).not.toThrow();
    expect(spriteCount(tl)).toBe(9);
  });

  test("an edit does not disturb the root band order", () => {
    const { grid, bl, tl } = setup(6, 6);
    buildTerrain(tl, bl, grid, TEX);
    const before = bl.root.children.map((c) => c.zIndex);
    setTerrain(grid, 3, 3, DIRT);
    syncCell(tl, bl, grid, TEX, 3, 3);
    expect(bl.root.children.map((c) => c.zIndex)).toEqual(before);
  });
});

describe("syncCellAndNeighbours", () => {
  test("touches the cell plus its four orthogonal neighbours", () => {
    const { grid, bl, tl } = setup(5, 5);
    buildTerrain(tl, bl, grid, TEX);
    for (const [x, y] of [[2, 2], [1, 2], [3, 2], [2, 1], [2, 3]] as const) {
      setTerrain(grid, x, y, DIRT);
    }
    syncCellAndNeighbours(tl, bl, grid, TEX, 2, 2);
    for (const [x, y] of [[2, 2], [1, 2], [3, 2], [2, 1], [2, 3]] as const) {
      expect(tl.sprites[idx(grid, x, y)]!.texture).toBe(TEX["dirt.png"]);
    }
  });
  test("clips at the map edge without throwing", () => {
    const { grid, bl, tl } = setup(3, 3);
    buildTerrain(tl, bl, grid, TEX);
    expect(() => syncCellAndNeighbours(tl, bl, grid, TEX, 0, 0)).not.toThrow();
  });
});
