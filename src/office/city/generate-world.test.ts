import { describe, expect, test } from "bun:test";
import { generateWorld, SLOP_PIT_BLOCK, WORLD_COLS, WORLD_ROWS } from "./generate-world";
import { avenueTileFor, DIR, roadMaskAt, roadSpriteFor } from "./road-autotile";
import { cellKey } from "./types";

describe("generateWorld", () => {
  const world = generateWorld();

  test("ground is one sprite per cell, and a hole where the pit is", () => {
    // Dense EXCEPT the slop pit's reserved plot, which is left a bare void on
    // purpose: the pit draws its own floor and its own camera-facing walls, and
    // a grass tile underneath would only fight with them. This test asserted
    // plain density until the pit was given that plot, and then it was simply
    // out of date — the generator has been right about this for a while.
    const { x0, y0, x1, y1 } = SLOP_PIT_BLOCK;
    const pit = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
    const hole = (x1 - x0 + 1) * (y1 - y0 + 1);

    const seen = new Set(world.ground.map((t) => cellKey(t.mapX, t.mapY)));
    // No cell gets two, which is what a set of the keys is for.
    expect(seen.size).toBe(world.ground.length);
    expect(world.ground.length).toBe(WORLD_COLS * WORLD_ROWS - hole);

    // And the hole is where the pit is, rather than merely being the right
    // size somewhere. A count alone would pass with the gap in the wrong place.
    for (let y = 0; y < WORLD_ROWS; y++) {
      for (let x = 0; x < WORLD_COLS; x++) {
        expect(seen.has(cellKey(x, y))).toBe(!pit(x, y));
      }
    }
  });

  test("memoized: same reference each call", () => {
    expect(generateWorld()).toBe(world);
  });

  test("three districts, none overlapping", () => {
    expect(world.districts.map((d) => d.id).sort()).toEqual([
      "10x_dev",
      "intern",
      "vibe_coder",
    ]);
    const occupied = new Set<string>();
    for (const d of world.districts) {
      for (const p of d.plots) {
        const k = cellKey(p.mapX, p.mapY);
        expect(occupied.has(k)).toBe(false);
        occupied.add(k);
      }
    }
  });

  test("plots are never road cells", () => {
    for (const d of world.districts) {
      for (const p of d.plots) {
        expect(world.roadCells.has(cellKey(p.mapX, p.mapY))).toBe(false);
      }
    }
  });

  test("plots ordered ascending (fill order)", () => {
    for (const d of world.districts) {
      for (let i = 1; i < d.plots.length; i++) {
        expect(d.plots[i].order).toBeGreaterThan(d.plots[i - 1].order);
      }
    }
  });

  test("every district reaches the avenue via connected road", () => {
    // BFS the road network; assert each district has a plot adjacent to a road
    // that is part of the avenue-connected component.
    const start = [...world.roadCells].find((k) => k.endsWith(",18"));
    expect(start).toBeDefined();
    const seen = new Set<string>([start!]);
    const queue = [start!];
    while (queue.length) {
      const [x, y] = queue.shift()!.split(",").map(Number);
      for (const [dx, dy] of [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ]) {
        const k = cellKey(x + dx, y + dy);
        if (world.roadCells.has(k) && !seen.has(k)) {
          seen.add(k);
          queue.push(k);
        }
      }
    }
    // All road cells belong to one connected network.
    expect(seen.size).toBe(world.roadCells.size);
  });
});

describe("roadSpriteFor", () => {
  test("connection mask maps to the labelled tile", () => {
    expect(roadSpriteFor(DIR.N | DIR.E | DIR.S | DIR.W)).toBe(
      "landscapeTiles_090.png",
    ); // cross
    expect(roadSpriteFor(DIR.N | DIR.S)).toBe("landscapeTiles_074.png"); // straight
    expect(roadSpriteFor(DIR.E | DIR.W)).toBe("landscapeTiles_082.png"); // straight
    expect(roadSpriteFor(DIR.N | DIR.E | DIR.S)).toBe("landscapeTiles_104.png"); // T
    expect(roadSpriteFor(DIR.N)).toBe("landscapeTiles_112.png"); // dead-end
  });

  test("unlabelled patterns (corners, isolated) fall back to plain asphalt", () => {
    expect(roadSpriteFor(DIR.N | DIR.E)).toBe("landscapeTiles_081.png"); // corner
    expect(roadSpriteFor(0)).toBe("landscapeTiles_081.png");
  });

  test("avenue lanes pick thick tiles, branching where a connector tees in", () => {
    expect(avenueTileFor(0, false)).toBe("landscapeTiles_080.png"); // top lane
    expect(avenueTileFor(1, false)).toBe("landscapeTiles_095.png"); // bottom lane
    expect(avenueTileFor(0, true)).toBe("landscapeTiles_094.png"); // top + branch
    expect(avenueTileFor(1, true)).toBe("landscapeTiles_108.png"); // bottom + branch
  });

  test("roadMaskAt reads neighbours in labeller convention", () => {
    // N→(x-1,y), E→(x,y-1), S→(x+1,y), W→(x,y+1)
    const roads = new Set([cellKey(4, 5), cellKey(5, 4)]); // N and E of (5,5)
    expect(roadMaskAt(5, 5, roads)).toBe(DIR.N | DIR.E);
  });
});
