import { describe, expect, test } from "bun:test";

import { TERRAIN_NAMES, terrainName, treesIn } from "./terrain-names";

describe("what the ground is called", () => {
  test("its own names stand; the old sheet's frames are read as what they were; anything else is grass", () => {
    for (const n of TERRAIN_NAMES) expect(terrainName(n)).toBe(n);
    expect(terrainName("landscapeTiles_083.png")).toBe("dirt");
    expect(terrainName("landscapeTiles_067_trees3.png")).toBe("wood3");
    expect(terrainName("cityTiles_010.png")).toBe("grass");
    expect(terrainName(null)).toBeNull();
    expect(treesIn("wood2")).toBe(2);
    expect(treesIn("sand")).toBe(0);
  });
});
