/**
 * Store-level tests for the editor.
 *
 * The serializer has its own round-trip coverage; what this file guards is the
 * WIRING between it and the store — the seam where a saved map's palette went
 * missing because the load path destructured only the grid.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import { deserializeWorld, serializeWorld, toJSON } from "../world/io/serialize";
import {
  DIRT, GRASS, INITIAL_TERRAIN_PALETTE, drainDirty, getNetwork, useWorldStore,
} from "./world.store";
import { componentCount } from "../world/roads/network";
import { RAMP, rampDir, rampRise } from "../world/iso";
import { COLUMNS_PER_TILE, SOLID_LIFT } from "../world/water/field";

const s = () => useWorldStore.getState();

/** Save exactly what the edit panel saves, then load it exactly as it loads. */
function roundTrip() {
  const json = toJSON(serializeWorld(s().grid, { terrain: s().palette, paved: [null] }));
  const { grid, palette } = deserializeWorld(JSON.parse(json));
  s().loadGrid(grid, palette.terrain);
}

describe("world store", () => {
  beforeEach(() => {
    s().resize(8, 8);
    useWorldStore.setState({ palette: [...INITIAL_TERRAIN_PALETTE], material: GRASS });
  });

  test("a browser-picked frame survives save and load", () => {
    const m = s().selectFrame("buildingTiles_003.png");
    expect(m).toBe(3);

    s().beginStroke({ x: 2, y: 2 });
    s().endStroke();
    expect(s().grid.terrain[2 * 8 + 2]).toBe(3);

    roundTrip();

    // the index is meaningless without the palette that gave it meaning
    expect(s().palette[3]).toBe("buildingTiles_003.png");
    expect(s().grid.terrain[2 * 8 + 2]).toBe(3);
  });

  test("selectFrame reuses an index rather than appending twice", () => {
    const a = s().selectFrame("vehicleTiles_001.png");
    const b = s().selectFrame("vehicleTiles_001.png");
    expect(b).toBe(a);
    expect(s().palette.length).toBe(INITIAL_TERRAIN_PALETTE.length + 1);
  });

  test("loading a shorter palette clamps the selected material", () => {
    s().selectFrame("buildingTiles_003.png");
    s().selectFrame("buildingTiles_004.png");
    expect(s().material).toBe(4);

    // a map saved before those frames existed
    s().loadGrid(s().grid, [...INITIAL_TERRAIN_PALETTE]);
    expect(s().material).toBe(INITIAL_TERRAIN_PALETTE.length - 1);
    expect(s().palette.length).toBe(INITIAL_TERRAIN_PALETTE.length);
  });

  test("loading clears history, so a fresh map cannot be undone into the old one", () => {
    s().setMaterial(DIRT); // painting grass onto grass is a no-op and adds no history
    s().beginStroke({ x: 1, y: 1 });
    s().endStroke();
    expect(s().undoDepth).toBe(1);

    roundTrip();
    expect(s().undoDepth).toBe(0);
    expect(s().redoDepth).toBe(0);
  });
});

describe("derived ramps", () => {
  beforeEach(() => {
    s().resize(12, 12);
    useWorldStore.setState({ palette: [...INITIAL_TERRAIN_PALETTE], material: GRASS });
  });

  /** Raise y >= 6 by `rise` half-steps, then pave the whole column. */
  const roadOntoStep = (rise: number) => {
    s().setTool("raise");
    s().setBrushRadius(0);
    s().setHeightStep(rise);
    for (let y = 6; y <= 9; y++) { s().beginStroke({ x: 4, y }); s().endStroke(); }
    s().setTool("paintRoad");
    for (let y = 2; y <= 9; y++) { s().beginStroke({ x: 4, y }); s().endStroke(); }
  };
  const at = (x: number, y: number) => s().grid.ramp[y * 12 + x];

  test("paving across a FULL step puts a ramp on the LOWER cell, facing up", () => {
    roadOntoStep(2);
    // (4,5) is the last cell at height 0; (4,6) is the step
    expect(rampDir(at(4, 5))).toBe(RAMP.W);      // W is (0,+1), toward (4,6)
    expect(rampRise(at(4, 5))).toBe(2);
    expect(rampDir(at(4, 6))).toBe(RAMP.NONE);   // the upper cell stays flat
    expect(s().netComponents).toBe(1);           // and the road is joined
  });

  test("no tool, no direction to choose — the ramp just appears", () => {
    roadOntoStep(2);
    // nothing in the store selects a ramp any more
    expect("rampDir" in s()).toBe(false);
    expect(rampDir(at(4, 5))).not.toBe(RAMP.NONE);
  });

  test("a HALF step is not bridged — there is no paved half-ramp art", () => {
    roadOntoStep(1);
    expect(rampDir(at(4, 5))).toBe(RAMP.NONE);
    expect(s().netComponents).toBe(2);
  });

  test("a step of two or more is not bridged either", () => {
    s().setTool("raise");
    s().setBrushRadius(0);
    s().setHeightStep(2);
    for (let y = 6; y <= 9; y++) {
      s().beginStroke({ x: 4, y }); s().endStroke();
      s().beginStroke({ x: 4, y }); s().endStroke();      // two full steps
    }
    s().setTool("paintRoad");
    for (let y = 2; y <= 9; y++) { s().beginStroke({ x: 4, y }); s().endStroke(); }
    expect(rampDir(at(4, 5))).toBe(RAMP.NONE);
    expect(s().netComponents).toBe(2);
  });

  test("a cell facing TWO higher neighbours is not bridged — one ramp, one direction", () => {
    s().setTool("raise");
    s().setBrushRadius(0);
    s().setHeightStep(2);
    for (const [x, y] of [[4, 5], [5, 4]] as const) { s().beginStroke({ x, y }); s().endStroke(); }
    s().setTool("paintRoad");
    for (const [x, y] of [[4, 4], [4, 5], [5, 4]] as const) { s().beginStroke({ x, y }); s().endStroke(); }
    expect(rampDir(at(4, 4))).toBe(RAMP.NONE);
  });

  test("ONE undo takes the road AND its ramp", () => {
    roadOntoStep(2);
    expect(rampDir(at(4, 5))).not.toBe(RAMP.NONE);
    // the last stroke paved (4,9); undo back to before (4,5) was paved
    while (s().undoDepth && s().grid.paved[5 * 12 + 4]) s().doUndo();
    expect(s().grid.paved[5 * 12 + 4]).toBe(0);
    expect(rampDir(at(4, 5))).toBe(RAMP.NONE);
  });

  test("erasing the road takes the ramp with it", () => {
    roadOntoStep(2);
    s().setTool("eraseRoad");
    s().beginStroke({ x: 4, y: 5 });
    s().endStroke();
    expect(rampDir(at(4, 5))).toBe(RAMP.NONE);
    expect(s().grid.paved[5 * 12 + 4]).toBe(0);
  });

  test("levelling the ground takes the ramp too", () => {
    roadOntoStep(2);
    expect(rampDir(at(4, 5))).not.toBe(RAMP.NONE);
    s().setTool("lower");
    s().setHeightStep(2);
    for (let y = 6; y <= 9; y++) { s().beginStroke({ x: 4, y }); s().endStroke(); }
    expect(rampDir(at(4, 5))).toBe(RAMP.NONE);
    expect(s().netComponents).toBe(1);
  });

  test("raising a cell UNDER a road ramps both approaches automatically", () => {
    s().setTool("paintRoad");
    s().setBrushRadius(0);
    for (let y = 2; y <= 8; y++) { s().beginStroke({ x: 4, y }); s().endStroke(); }
    expect(s().netComponents).toBe(1);

    s().setTool("raise");
    s().setHeightStep(2);
    s().beginStroke({ x: 4, y: 5 });
    s().endStroke();

    // the two neighbours each ramp up toward the raised cell, so it stays joined
    expect(rampDir(at(4, 4))).toBe(RAMP.W);
    expect(rampDir(at(4, 6))).toBe(RAMP.E);
    expect(rampDir(at(4, 5))).toBe(RAMP.NONE);
    expect(s().netComponents).toBe(1);
  });

  test("a staircase ramps continuously, every cell to the next one up", () => {
    s().setTool("raise");
    s().setBrushRadius(0);
    s().setHeightStep(2);
    for (let y = 3; y <= 8; y++) {
      for (let k = 3; k <= y; k++) { s().beginStroke({ x: 4, y }); s().endStroke(); }
    }
    s().setTool("paintRoad");
    for (let y = 2; y <= 8; y++) { s().beginStroke({ x: 4, y }); s().endStroke(); }
    for (let y = 2; y <= 7; y++) expect(rampDir(at(4, y))).toBe(RAMP.W);
    expect(s().netComponents).toBe(1);
  });
});

describe("road network", () => {
  beforeEach(() => { s().resize(12, 12); });

  const paveRun = (x: number, y0: number, y1: number) => {
    s().setTool("paintRoad");
    s().setBrushRadius(0);
    for (let y = y0; y <= y1; y++) { s().beginStroke({ x, y }); s().endStroke(); }
  };

  test("the mirrored component count tracks the graph, not just the graph", () => {
    // The mirror is what the UI renders, and a stale mirror is invisible in the
    // graph's own tests — this is the seam that actually broke.
    expect(s().netComponents).toBe(0);
    paveRun(4, 2, 8);
    expect(s().netComponents).toBe(1);
    expect(componentCount(getNetwork()!)).toBe(1);

    s().setTool("eraseRoad");
    s().beginStroke({ x: 4, y: 5 });
    s().endStroke();
    expect(s().netComponents).toBe(2);
    expect(componentCount(getNetwork()!)).toBe(2);
  });

  test("undo and redo of a road edit both re-mirror", () => {
    paveRun(4, 2, 8);
    s().setTool("eraseRoad");
    s().beginStroke({ x: 4, y: 5 });
    s().endStroke();
    expect(s().netComponents).toBe(2);

    s().doUndo();
    expect(s().netComponents).toBe(1);
    expect(componentCount(getNetwork()!)).toBe(1);

    s().doRedo();
    expect(s().netComponents).toBe(2);
  });

  test("raising half a road auto-ramps the join, so it stays ONE network", () => {
    paveRun(4, 2, 8);
    expect(s().netComponents).toBe(1);

    s().setTool("raise");
    s().setHeightStep(2);
    for (let y = 6; y <= 8; y++) { s().beginStroke({ x: 4, y }); s().endStroke(); }

    // the last flat cell derives a ramp up to the step — no tool involved
    expect(rampDir(s().grid.ramp[5 * 12 + 4])).toBe(RAMP.W);
    expect(s().netComponents).toBe(1);
  });

  test("a DIAGONAL line drag lays one connected road, not a string of squares", () => {
    s().setTool("paintRoad");
    s().setBrush("line");
    s().setBrushRadius(0);
    s().beginStroke({ x: 2, y: 2 });
    s().updateStroke({ x: 8, y: 6 });
    s().endStroke();

    // Bresenham would have left 7 cells touching only at their corners, which
    // this engine does not treat as adjacent: 7 components and no corner art.
    expect(s().netComponents).toBe(1);
    expect(componentCount(getNetwork()!)).toBe(1);
    expect(s().grid.paved[2 * 12 + 8]).toBe(1);      // the bend itself is paved
  });

  test("a height edit a ramp CANNOT bridge still splits the road", () => {
    paveRun(4, 2, 8);
    s().setTool("raise");
    s().setHeightStep(1);                 // half step: no paved ramp art
    s().beginStroke({ x: 4, y: 5 });
    s().endStroke();
    expect(rampDir(s().grid.ramp[4 * 12 + 4])).toBe(RAMP.NONE);
    expect(s().netComponents).toBe(3);    // the raised cell is stranded
  });

  test("a fresh map has no networks", () => {
    paveRun(4, 2, 8);
    expect(s().netComponents).toBe(1);
    s().resize(8, 8);
    expect(s().netComponents).toBe(0);
  });
});

describe("dirty accumulation", () => {
  beforeEach(() => { s().resize(12, 12); drainDirty(s().grid); });

  /**
   * The failure this guards: several commits inside ONE task collapse into a
   * single React re-render. When each commit overwrote the dirty set the
   * renderer saw only the last one's cells, so every earlier edit was in the
   * grid and absent from the screen — silently.
   */
  test("edits made back-to-back all survive to a single drain", () => {
    s().setTool("paintRoad");
    s().setBrushRadius(0);
    for (let y = 2; y <= 8; y++) { s().beginStroke({ x: 4, y }); s().endStroke(); }

    const drained = drainDirty(s().grid);
    const keys = new Set(drained.map((c) => `${c.x},${c.y}`));
    for (let y = 2; y <= 8; y++) expect(keys.has(`4,${y}`)).toBe(true);
  });

  test("draining twice yields nothing the second time", () => {
    s().setTool("paintRoad");
    s().beginStroke({ x: 4, y: 4 });
    s().endStroke();
    expect(drainDirty(s().grid).length).toBeGreaterThan(0);
    expect(drainDirty(s().grid)).toEqual([]);
  });

  test("a height edit contributes its NEIGHBOURS too", () => {
    s().setTool("raise");
    s().beginStroke({ x: 5, y: 5 });
    s().endStroke();
    const keys = new Set(drainDirty(s().grid).map((c) => `${c.x},${c.y}`));
    for (const k of ["5,5", "4,5", "6,5", "5,4", "5,6"]) expect(keys.has(k)).toBe(true);
  });

  test("a resize clears it — the scene rebuilds wholesale", () => {
    s().setTool("paintRoad");
    s().beginStroke({ x: 4, y: 4 });
    s().endStroke();
    s().resize(8, 8);
    expect(drainDirty(s().grid)).toEqual([]);
  });

  test("undo marks dirty as well, so reverting redraws", () => {
    s().setTool("paintRoad");
    s().beginStroke({ x: 4, y: 4 });
    s().endStroke();
    drainDirty(s().grid);
    s().doUndo();
    const keys = new Set(drainDirty(s().grid).map((c) => `${c.x},${c.y}`));
    expect(keys.has("4,4")).toBe(true);
  });

  /**
   * THE SOLVER'S BED IS NOT THE TERRAIN. A built-on cell stands `SOLID_LIFT`
   * above its ground, so placing and demolishing move the bed without moving
   * the height — and `demolishCommand` writes `structureAt` and nothing else,
   * which is how a demolish stayed invisible to every one of these paths at
   * once. One test per path because they were three separate omissions.
   */
  describe("a structure moves the water's bed", () => {
    /** The bed under a tile, read at the tile's first column. */
    const bedAt = (x: number, y: number) => {
      const f = s().getWaterField();
      if (!f) throw new Error("no water field");
      const c = f.columns;
      return c.ground[(y * COLUMNS_PER_TILE) * c.nx + x * COLUMNS_PER_TILE];
    };

    /** Place, and refuse to go on if the bed did not move — so the tests
     *  below cannot pass by nothing ever having happened. */
    const place = (x: number, y: number) => {
      const before = bedAt(x, y);
      s().setTool("place");
      s().commitStructure({ x, y });
      expect(bedAt(x, y)).toBe(before + SOLID_LIFT);
      return before;
    };

    beforeEach(() => {
      s().setStructureDef("kit:intern.t0");
    });

    /**
     * ON FLAT GROUND A PLACE WRITES `structureAt` AND NOTHING ELSE. The
     * levelling patch is there, but `build` drops a cell whose before equals
     * its after — so the command that lifts the bed carries no height patch at
     * all, and the predicate that decides whether to re-read the bed never saw
     * it. Building beside water simply did not move the bed.
     */
    test("placing lifts it", () => {
      place(3, 3);
    });

    test("demolishing drops it back", () => {
      const before = place(3, 3);
      s().setTool("demolish");
      s().commitStructure({ x: 3, y: 3 });
      expect(bedAt(3, 3)).toBe(before);
    });

    test("undo drops it back", () => {
      const before = place(3, 3);
      s().doUndo();
      expect(bedAt(3, 3)).toBe(before);
    });

    test("redo lifts it again", () => {
      const before = place(3, 3);
      s().doUndo();
      s().doRedo();
      expect(bedAt(3, 3)).toBe(before + SOLID_LIFT);
    });
  });
});
