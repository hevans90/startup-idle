import { describe, expect, test } from "bun:test";
import { RAMP, createGrid, fillTerrain, rampAt, setHeight, setPaved, setRamp, setTerrain } from "../grid";
import { commit, createHistory } from "../edit/commands";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import {
  WORLD_FILE_VERSION, WorldFileError, deserializeWorld, fromJSON,
  serializeWorld, toJSON,
} from "./serialize";

const PAL = { terrain: [null, "grass.png", "dirt.png"], paved: [null, "road.png"] };

function sample(w = 12, h = 9) {
  const g = createGrid(w, h);
  fillTerrain(g, 1);
  setTerrain(g, 3, 4, 2);
  setTerrain(g, 0, 0, 0);          // a void cell
  setHeight(g, 5, 5, 6);
  setHeight(g, 6, 6, -4);          // negative, to exercise Int8
  setPaved(g, 2, 2, 1);
  return g;
}

describe("round trip", () => {
  test("every layer survives exactly", () => {
    const g = sample();
    const { grid } = deserializeWorld(serializeWorld(g, PAL));
    expect(grid.w).toBe(g.w);
    expect(grid.h).toBe(g.h);
    expect([...grid.terrain]).toEqual([...g.terrain]);
    expect([...grid.height]).toEqual([...g.height]);
    expect([...grid.paved]).toEqual([...g.paved]);
  });

  test("through JSON text too", () => {
    const g = sample();
    const { grid } = fromJSON(toJSON(serializeWorld(g, PAL)));
    expect([...grid.terrain]).toEqual([...g.terrain]);
    expect([...grid.height]).toEqual([...g.height]);
  });

  test("negative heights survive (Int8, not Uint8)", () => {
    const g = createGrid(4, 4);
    setHeight(g, 1, 1, -128);
    setHeight(g, 2, 2, 127);
    const { grid } = deserializeWorld(serializeWorld(g, PAL));
    expect(grid.height[1 * 4 + 1]).toBe(-128);
    expect(grid.height[2 * 4 + 2]).toBe(127);
  });

  test("the height range is recomputed on load, not trusted", () => {
    const g = sample();
    const { grid } = deserializeWorld(serializeWorld(g, PAL));
    expect(grid.minHeight).toBe(-4);
    expect(grid.maxHeight).toBe(6);
  });

  test("structureAt is reset to empty", () => {
    const { grid } = deserializeWorld(serializeWorld(sample(), PAL));
    expect([...grid.structureAt].every((v) => v === -1)).toBe(true);
  });

  test("the palette travels with the file", () => {
    const { palette } = deserializeWorld(serializeWorld(sample(), PAL));
    expect(palette.terrain).toEqual(PAL.terrain);
    expect(palette.paved).toEqual(PAL.paved);
  });

  /** base64 keeps a big map small — JSON number arrays would not. */
  test("a 64² map encodes compactly", () => {
    const g = createGrid(64, 64);
    fillTerrain(g, 1);
    const json = toJSON(serializeWorld(g, PAL));
    expect(json.length).toBeLessThan(40_000);   // vs ~100k+ as decimal text
    const { grid } = fromJSON(json);
    expect([...grid.terrain]).toEqual([...g.terrain]);
  });

  test("a large map survives the base64 chunking path", () => {
    const g = createGrid(128, 128);
    for (let i = 0; i < g.terrain.length; i++) g.terrain[i] = i % 3;
    const { grid } = deserializeWorld(serializeWorld(g, PAL));
    expect([...grid.terrain]).toEqual([...g.terrain]);
  });
});

describe("rejects malformed files", () => {
  const bad = (f: unknown) => () => deserializeWorld(f);
  test("non-objects", () => {
    expect(bad(null)).toThrow(WorldFileError);
    expect(bad("nope")).toThrow(WorldFileError);
  });
  test("wrong version", () => {
    const f = serializeWorld(sample(), PAL);
    expect(bad({ ...f, version: 99 })).toThrow(/unsupported version/);
  });
  test("bad size", () => {
    const f = serializeWorld(sample(), PAL);
    expect(bad({ ...f, w: 0 })).toThrow(/bad size/);
    expect(bad({ ...f, h: 4.5 })).toThrow(/bad size/);
  });
  test("missing layers", () => {
    const f = serializeWorld(sample(), PAL);
    expect(bad({ ...f, height: undefined })).toThrow(/missing layer/);
  });
  test("version is stamped", () => {
    expect(serializeWorld(sample(), PAL).version).toBe(WORLD_FILE_VERSION);
  });
});

describe("palette index 0 stays VOID", () => {
  /** If index 0 were a material, every other index would shift by one. */
  test("a file claiming otherwise is corrected", () => {
    const f = serializeWorld(sample(), PAL);
    const { palette } = deserializeWorld({
      ...f,
      palette: { terrain: ["oops.png", "grass.png"], paved: ["oops.png"] },
    });
    expect(palette.terrain[0]).toBeNull();
    expect(palette.paved[0]).toBeNull();
  });
});

describe("ramp layer", () => {
  test("round-trips, so a labelled ramp survives a save", () => {
    const grid = createGrid(6, 6, 1);
    setRamp(grid, 2, 3, RAMP.E);
    setRamp(grid, 4, 1, RAMP.W);
    const { grid: back } = fromJSON(toJSON(serializeWorld(grid, PAL)));
    expect(rampAt(back, 2, 3)).toBe(RAMP.E);
    expect(rampAt(back, 4, 1)).toBe(RAMP.W);
    expect(rampAt(back, 0, 0)).toBe(RAMP.NONE);
  });

  test("a file written before ramps existed still opens, entirely level", () => {
    const grid = createGrid(6, 6, 1);
    setRamp(grid, 2, 3, RAMP.E);
    const file = serializeWorld(grid, PAL);
    delete file.ramp;
    const { grid: back } = deserializeWorld(JSON.parse(JSON.stringify(file)));
    expect(back.ramp.some((v) => v !== 0)).toBe(false);
  });
});

describe("structures", () => {
  test("survive a round trip, and the layer is rebuilt from them", () => {
    const g = createGrid(8, 8);
    fillTerrain(g, 1);
    const hist = createHistory();
    commit(g, hist, placeCommand(g, structureDef("pit")!, 2, 2)!);
    commit(g, hist, placeCommand(g, structureDef("kit:intern.t0")!, 0, 7)!);

    const back = fromJSON(toJSON(serializeWorld(g, { terrain: [null, "a"], paved: [null] }))).grid;
    expect([...back.structures.values()]).toEqual([...g.structures.values()]);
    // structureAt is NOT in the file — stamping the records must reproduce it
    expect([...back.structureAt]).toEqual([...g.structureAt]);
  });

  test("the next id clears every id in the file, so nothing aliases", () => {
    const g = createGrid(8, 8);
    fillTerrain(g, 1);
    const hist = createHistory();
    commit(g, hist, placeCommand(g, structureDef("kit:intern.t0")!, 1, 1)!);
    const back = fromJSON(toJSON(serializeWorld(g, { terrain: [null, "a"], paved: [null] }))).grid;
    expect(back.nextStructureId).toBeGreaterThan(
      Math.max(...[...back.structures.keys()]),
    );
  });

  test("a file with no structures loads as a map with none", () => {
    const g = createGrid(4, 4);
    const file = serializeWorld(g, { terrain: [null], paved: [null] });
    delete file.structures;
    expect(fromJSON(toJSON(file)).grid.structures.size).toBe(0);
  });

  test("one unreadable record is skipped, not fatal for the whole map", () => {
    const g = createGrid(6, 6);
    fillTerrain(g, 1);
    const file = serializeWorld(g, { terrain: [null, "a"], paved: [null] });
    file.structures = [
      { id: 1, def: "kit:intern.t0", x: 1, y: 1, w: 1, h: 1 },
      { id: 2, def: 7, x: 2, y: 2, w: 1, h: 1 } as never,   // def is not a string
    ];
    const back = fromJSON(toJSON(file)).grid;
    expect(back.structures.size).toBe(1);
    expect(back.terrain[0]).toBe(1);                        // the rest of the map survived
  });
});
