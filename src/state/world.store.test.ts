/**
 * Store-level tests for the editor.
 *
 * The serializer has its own round-trip coverage; what this file guards is the
 * WIRING between it and the store — the seam where a saved map's palette went
 * missing because the load path destructured only the grid.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import Decimal from "break_infinity.js";

import { useMoneyStore } from "./money.store";

import { deserializeWorld, serializeWorld, toJSON } from "../world/io/serialize";
import {
  DIRT, GRASS, INITIAL_TERRAIN_PALETTE, SAND, WOODS, drainDirty, getNetwork, readoutFromUrl, startAutosave,
  useWorldStore,
} from "./world.store";
import { loadSaved } from "../world/io/world-save";
import { createGrid, fillTerrain, idx, setHeight, setInflow } from "../world/grid";
import { componentCount } from "../world/roads/network";
import { DEFAULT_GEN, GEN_SLIDERS } from "../world/gen/params";
import { generatePlayableMap } from "../world/gen/generate-map";
import { RAMP, rampDir, rampRise } from "../world/iso";
import { COLUMNS_PER_TILE, SOLID_LIFT, pourAt } from "../world/water/field";

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
    // Appended past the built-in materials, wherever those happen to end.
    const next = INITIAL_TERRAIN_PALETTE.length;
    const m = s().selectFrame("buildingTiles_003.png");
    expect(m).toBe(next);

    s().beginStroke({ x: 2, y: 2 });
    s().endStroke();
    expect(s().grid.terrain[2 * 8 + 2]).toBe(next);

    roundTrip();

    // the index is meaningless without the palette that gave it meaning
    expect(s().palette[next]).toBe("buildingTiles_003.png");
    expect(s().grid.terrain[2 * 8 + 2]).toBe(next);
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
    expect(s().material).toBe(INITIAL_TERRAIN_PALETTE.length + 1);

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

/**
 * THE SIZE IS A GENERATION SETTING, and the reason it is worth a test is that
 * it is the one setting `generateMap` cannot apply: the grid is allocated
 * before there is anything to generate into it. If `generateWorld` stopped
 * reading it, the slider would move, the panel would show the new number, and
 * pressing generate would quietly hand back a map of the old size — which
 * looks like the button not working rather than like a bug.
 */
describe("the map is generated at the size the settings ask for", () => {
  test("a changed size is what the next generate builds", () => {
    s().setGenParam("size", 32);
    s().generateWorld(7);
    expect(s().grid.w).toBe(32);
    expect(s().grid.h).toBe(32);

    s().setGenParam("size", 96);
    s().generateWorld(7);
    expect(s().grid.w).toBe(96);
  });

  test("a caller that names a size still gets it", () => {
    s().setGenParam("size", 96);
    s().generateWorld(7, 16);
    expect(s().grid.w).toBe(16);
  });

  test("and a nonsense size is clamped rather than obeyed", () => {
    s().setGenParam("size", 4);
    expect(s().gen.size).toBe(16);
    s().setGenParam("size", 9999);
    // The top of the slider, wherever the renderer's own limits put it.
    expect(s().gen.size).toBe(
      GEN_SLIDERS.find((x) => x.key === "size")!.max,
    );
  });

  test("resetting the settings puts it back", () => {
    s().setGenParam("size", 16);
    s().resetGenParams();
    expect(s().gen.size).toBe(DEFAULT_GEN.size);
  });
});

/**
 * `?readout=0`, which is the one query flag here that turns something OFF.
 *
 * The others are bare presence flags — `?gpucheck`, `?fixture=` — because
 * what they name is off by default. The cell readout is on by default, so
 * the interesting request is to take it away, and a presence flag cannot
 * express that.
 */
describe("the cell readout's query flag", () => {
  test("is on when nothing asks otherwise", () => {
    expect(readoutFromUrl("")).toBe(true);
    expect(readoutFromUrl("?world=1")).toBe(true);
  });

  test("and off when something does", () => {
    expect(readoutFromUrl("?readout=0")).toBe(false);
    expect(readoutFromUrl("?readout=false")).toBe(false);
    expect(readoutFromUrl("?readout=off")).toBe(false);
    expect(readoutFromUrl("?world=1&readout=0")).toBe(false);
  });

  test("and a typo leaves it ON rather than quietly taking it away", () => {
    // The failure modes are not symmetric. A readout that will not go away
    // is a nuisance you can see; one that silently never appears looks like
    // the editor being broken, and you would go looking in the renderer.
    expect(readoutFromUrl("?readout=nope")).toBe(true);
    expect(readoutFromUrl("?readout=")).toBe(true);
    expect(readoutFromUrl("?readout")).toBe(true);
    expect(readoutFromUrl("?reedout=0")).toBe(true);
  });
});

describe("autosave", () => {
  test("water poured after the last edit is saved when the tab is left", () => {
    // Pouring is not an edit: it bumps no revision and queues no save. The
    // flush on leaving wrote only a save an edit had queued, so a lake filled
    // after the last edit was never written, and the map came back with the
    // water as it stood at that edit. @see startAutosave
    const on: Record<string, () => void> = {};
    const doc = globalThis.document as unknown as Record<string, unknown>;
    const g0 = globalThis as unknown as Record<string, unknown>;
    const was = { add: doc.addEventListener, remove: doc.removeEventListener, window: g0.window };
    const listen = { addEventListener: (k: string, f: () => void) => { on[k] = f; }, removeEventListener: () => {} };
    Object.assign(doc, listen);
    g0.window = listen;
    try {
      const g = createGrid(8, 8);
      fillTerrain(g, GRASS);
      for (let y = 3; y <= 4; y++) for (let x = 3; x <= 4; x++) setHeight(g, x, y, -6);
      s().loadGrid(g, [...INITIAL_TERRAIN_PALETTE]);
      const stop = startAutosave();
      jest.runAllTimers();                     // the first save, of the dry map
      expect(loadSaved()!.grid.pool[idx(g, 3, 3)]).toBe(0);

      pourAt(s().getWaterField()!, 3, 3, 8, 1);
      on.pagehide();
      expect(loadSaved()!.grid.pool[idx(g, 3, 3)]).toBeGreaterThan(0);
      stop();
    } finally {
      doc.addEventListener = was.add;
      doc.removeEventListener = was.remove;
      g0.window = was.window;
    }
  });
});

describe("a seaport under play rules", () => {
  /**
   * A river across the map, rows 6 to 9, and a road along row 3 — so a port at
   * row 4 is on the bank and has frontage, as play rules need.
   */
  const harbour = () => {
    const g = createGrid(24, 16);
    fillTerrain(g, 1);
    for (let y = 6; y <= 9; y++) for (let x = 0; x < g.w; x++) { g.pool[idx(g, x, y)] = 4; g.fluid[idx(g, x, y)] = 1; }
    for (let x = 0; x < g.w; x++) g.paved[idx(g, x, 3)] = 1;
    for (let y = 6; y <= 9; y++) setInflow(g, 0, y, 4);   // a river, not a long lake
    s().loadGrid(g);
    s().setTool("placeStructure");
    s().setStructureDef("seaport");
    s().setPlaying(true);
  };
  const money = (n: number) => useMoneyStore.setState({ money: new Decimal(n) });
  const port = () => [...s().grid.structures.values()].find((p) => p.def.startsWith("seaport"));

  afterEach(() => s().setPlaying(false));

  test("is bought, then upgraded for the step up, a tier at a time", () => {
    harbour();
    money(5000);
    s().commitStructure({ x: 8, y: 4 });
    expect(port()?.def).toBe("seaport");
    expect(useMoneyStore.getState().money.toNumber()).toBe(5000 - 240);
    s().commitStructure({ x: 8, y: 4 });
    expect(port()?.def).toBe("seaport-2");
    expect(useMoneyStore.getState().money.toNumber()).toBe(5000 - 640);
    s().commitStructure({ x: 8, y: 4 });
    expect(port()?.def).toBe("seaport-3");
    // Built a tier at a time, it costs what the top tier does outright.
    expect(useMoneyStore.getState().money.toNumber()).toBe(5000 - 1440);
  });

  test("and is refused, with nothing spent, when the money is not there", () => {
    harbour();
    money(239);
    s().commitStructure({ x: 8, y: 4 });
    expect(port()).toBeUndefined();
    expect(useMoneyStore.getState().money.toNumber()).toBe(239);
    money(300);
    s().commitStructure({ x: 8, y: 4 });
    expect(port()?.def).toBe("seaport");
    s().commitStructure({ x: 8, y: 4 });                 // 400 for the step up: short
    expect(port()?.def).toBe("seaport");
    expect(useMoneyStore.getState().money.toNumber()).toBe(60);
  });
});

describe("the land chosen when founding", () => {
  test("is the land founded: the preview's map and the game's are the same map", () => {
    // As the founder screen previews it. @see MapSetup
    const params = { ...DEFAULT_GEN, size: 48, relief: 30, rivers: 2, trees: 0.5 };
    const preview = createGrid(params.size, params.size);
    const report = generatePlayableMap(preview, { seed: 1234567, material: GRASS, dirt: DIRT, sand: SAND, woods: WOODS, params });
    // As the company's map makes it from the choice. @see useFoundWorld
    s().generateWorld(report.seed, params.size, params);
    const g = s().grid;
    expect([g.w, g.h]).toEqual([48, 48]);
    expect([...g.height]).toEqual([...preview.height]);
    expect([...g.terrain]).toEqual([...preview.terrain]);
    expect([...g.paved]).toEqual([...preview.paved]);
    expect([...g.pool]).toEqual([...preview.pool]);
  });
});

describe("the slop pit", () => {
  test("opens once, on the map, beside the studio", () => {
    s().resize(24, 24);
    const g = s().grid;
    fillTerrain(g, GRASS);
    s().loadGrid(g, s().palette);
    const studio = { id: 900, def: "studio", x: 4, y: 4, w: 3, h: 2 };
    s().grid.structures.set(studio.id, studio);
    s().openSlopPit();
    const pits = [...s().grid.structures.values()].filter((x) => x.def === "slop-pit");
    expect(pits.length).toBe(1);
    expect(Math.hypot(pits[0].x - 5, pits[0].y - 5)).toBeLessThan(6);
    s().openSlopPit();
    expect([...s().grid.structures.values()].filter((x) => x.def === "slop-pit").length).toBe(1);
  });
});
