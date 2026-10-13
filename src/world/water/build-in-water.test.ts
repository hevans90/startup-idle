/**
 * A building put down in standing water takes the water's place.
 *
 * To the water a building is a block `SOLID_LIFT` high. The water standing
 * where it went down used to stay in those columns — on top of the block —
 * and went over every side of it at once: a geyser over the new building.
 */
import { describe, expect, test } from "bun:test";

import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx } from "../grid";
import { placeCommand } from "../structures/place";
import { structureDef } from "../structures/def";
import { COLUMNS_PER_TILE, createWaterField, setWaterEdge, stepWater, syncGround } from "./field";

describe("building in water", () => {
  test("the building's footprint gives up its water, and none is thrown over it", () => {
    const g = createGrid(24, 24);
    fillTerrain(g, 1);
    // A pond three half steps deep across the middle of the map.
    for (let y = 6; y < 18; y++) for (let x = 6; x < 18; x++) g.pool[idx(g, x, y)] = 3;
    const f = createWaterField(g);
    setWaterEdge(f, false);
    for (let n = 0; n < 30; n++) stepWater(f, 1 / 60);

    const def = structureDef("studio")!;
    const cmd = placeCommand(g, def, 10, 10)!;
    commit(g, createHistory(), cmd);
    syncGround(f, g);

    const c = f.columns;
    const solid = (cx: number, cy: number) => {
      const tx = Math.floor(cx / COLUMNS_PER_TILE), ty = Math.floor(cy / COLUMNS_PER_TILE);
      return tx >= 10 && tx < 10 + def.footprint.w && ty >= 10 && ty < 10 + def.footprint.h;
    };
    let wetOnTop = 0;
    for (let cy = 0; cy < c.ny; cy++) for (let cx = 0; cx < c.nx; cx++) {
      if (solid(cx, cy) && c.depth[cy * c.nx + cx] > 0) wetOnTop++;
    }
    expect(wetOnTop).toBe(0);

    // And as the water runs, nothing stands higher than the pond did.
    for (let n = 0; n < 120; n++) {
      stepWater(f, 1 / 60);
      let highest = -Infinity;
      for (let k = 0; k < c.nx * c.ny; k++) if (c.depth[k] > 0.01) highest = Math.max(highest, c.ground[k] + c.depth[k]);
      // A slosh off the new wall, at most: not the top of a block `SOLID_LIFT` up.
      expect(highest).toBeLessThan(5);
    }
  });
});
