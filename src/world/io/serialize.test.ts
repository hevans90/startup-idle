import { describe, expect, test } from "bun:test";
import { DIR } from "../../iso/dir";
import {
  RAMP, createGrid, fillTerrain, idx, pipeAt, rampAt, setHeight, setPaved, setRamp, setTerrain,
  setSource, sourceAt,
} from "../grid";
import { commit, createHistory } from "../edit/commands";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import {
  createWaterField, depthAt, pourAt, setWaterEdge, stepWater, totalVolume,
} from "../water/field";
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
  g.pool[idx(g, 5, 5)] = 7;        // standing water, which a map is allowed to have
  g.fluid[idx(g, 5, 5)] = 1;
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
    expect([...grid.pool]).toEqual([...g.pool]);
  });

  test("a saved map keeps its water", () => {
    // It did not, and the reason it did not was that the grid had nowhere to
    // put a depth: `fluid` recorded WHICH fluid had been poured on a cell and
    // never how much, so every lake on a map went down the drain on save and
    // the map opened as the empty basin it had been carved out of.
    const g = sample();
    const { grid } = fromJSON(toJSON(serializeWorld(g, PAL)));
    expect(grid.pool[idx(grid, 5, 5)]).toBe(7);
    expect(grid.fluid[idx(grid, 5, 5)]).toBe(1);
  });

  test("saving a RUNNING world keeps the water where it has got to", () => {
    // Pouring is not an edit. It puts water into the running world rather than
    // into the grid, which is why it is not undoable and why the grid knows
    // nothing about it — so a file written from the grid alone comes back as
    // the empty basin the map started as, however long you spent filling it.
    const g = createGrid(12, 12);
    fillTerrain(g, 1);
    for (let y = 4; y <= 7; y++) for (let x = 4; x <= 7; x++) setHeight(g, x, y, -6);
    const field = createWaterField(g);
    setWaterEdge(field, false);
    pourAt(field, 5, 5, 40, 1);
    for (let n = 0; n < 120; n++) stepWater(field, 1 / 60);   // let it find its level

    // Without the field: the authored layer, which is nothing.
    const dry = deserializeWorld(serializeWorld(g, PAL)).grid;
    expect([...dry.pool].every((v) => v === 0)).toBe(true);

    // With it: the water as it stands.
    const wet = deserializeWorld(serializeWorld(g, PAL, field)).grid;
    expect([...wet.pool].some((v) => v > 0)).toBe(true);
    // And re-opening it puts that water back where it was. Near enough, and
    // the bound is the ROUNDING and not a number picked to pass: the layer
    // holds whole half steps, so a tile can be out by half of one, and the
    // depth that comes back is within that of the depth that went in.
    const again = createWaterField(wet);
    expect(depthAt(again, 5, 5)).toBeCloseTo(depthAt(field, 5, 5), 0);
    expect(depthAt(again, 5, 5)).toBeGreaterThan(1);
    // Whole-map volume the same way: every wet tile may lose half a step off
    // each of its columns, and nothing may be gained that was not there.
    const wetTiles = [...wet.pool].filter((v) => v > 0).length;
    const slack = wetTiles * 0.5 * 16;
    expect(Math.abs(totalVolume(again, wet) - totalVolume(field, g))).toBeLessThan(slack);
  });

  test("but the snapshot is only what is STANDING", () => {
    // A film thinner than half a half step rounds away, which is deliberate:
    // friction always leaves one on a flat plain, and a saved map that came
    // back with a millimetre of water over every tile would be worse than one
    // that came back dry.
    const g = createGrid(8, 8);
    fillTerrain(g, 1);
    const field = createWaterField(g);
    setWaterEdge(field, false);
    pourAt(field, 4, 4, 0.3, 1);                  // a smear, under half a step
    const { grid } = deserializeWorld(serializeWorld(g, PAL, field));
    expect([...grid.pool].every((v) => v === 0)).toBe(true);
  });

  test("and a file written before maps could hold any opens dry", () => {
    // Optional on read rather than a version bump, like `ramp`: a map from
    // before this is a valid map, and it is a dry one.
    const file = serializeWorld(sample(), PAL);
    delete (file as { pool?: string }).pool;
    const { grid } = deserializeWorld(file);
    expect([...grid.pool].every((v) => v === 0)).toBe(true);
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

  /**
   * base64 keeps a big map small — JSON number arrays would not.
   *
   * Five dense layers at 64²: terrain and paved and fluid as Uint16, height as
   * Int8, ramp as Uint8 — about 44KB of base64 all told, against several
   * hundred KB as decimal text. Every layer added costs its own share, which is
   * the price of the format being a plain dump; a run-length pass would mostly
   * erase it, since a typical map is almost entirely zeroes outside `terrain`.
   */
  test("a 64² map encodes compactly", () => {
    const g = createGrid(64, 64);
    fillTerrain(g, 1);
    const json = toJSON(serializeWorld(g, PAL));
    // Nine dense layers of 4,096 cells, base64. The budget is a guard against
    // a layer being written as something other than packed bytes, not a tight
    // fit — each one it gains costs about 5.5KB and it should be obvious in a
    // diff when one does.
    expect(json.length).toBeLessThan(70_000);
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

describe("pipe layer", () => {
  test("a pipe keeps the side it points out of", () => {
    // A facing, not a rate. Which side it sticks out of is the whole of what a
    // pipe is, so a file that lost it would reload a pipe pointing the wrong
    // way — which is a pipe filling the wrong pool.
    const grid = createGrid(6, 6, 1);
    grid.pipe[idx(grid, 2, 3)] = DIR.S;
    grid.pipe[idx(grid, 4, 1)] = DIR.W;
    const { grid: back } = fromJSON(toJSON(serializeWorld(grid, PAL)));
    expect(pipeAt(back, 2, 3)).toBe(DIR.S);
    expect(pipeAt(back, 4, 1)).toBe(DIR.W);
    expect(pipeAt(back, 0, 0)).toBe(0);
  });

  test("a file written before pipes existed still opens, with none", () => {
    const grid = createGrid(6, 6, 1);
    grid.pipe[idx(grid, 2, 3)] = DIR.S;
    const file = serializeWorld(grid, PAL);
    delete file.pipe;
    const { grid: back } = deserializeWorld(JSON.parse(JSON.stringify(file)));
    expect(back.pipe.some((v) => v !== 0)).toBe(false);
  });
});

describe("source layer", () => {
  test("springs and drains round-trip, signs and all", () => {
    // The water they produce does not survive a save and should not: depth is
    // live state. The TAP does, which is what makes a river reload as a river
    // rather than as the puddle it happened to be when you saved.
    const grid = createGrid(6, 6, 1);
    setSource(grid, 1, 2, 8);
    setSource(grid, 4, 4, -8);
    const { grid: back } = fromJSON(toJSON(serializeWorld(grid, PAL)));
    expect(sourceAt(back, 1, 2)).toBe(8);
    expect(sourceAt(back, 4, 4)).toBe(-8);
    expect(sourceAt(back, 0, 0)).toBe(0);
  });

  test("a file written before springs existed still opens, with none", () => {
    const grid = createGrid(6, 6, 1);
    setSource(grid, 1, 2, 8);
    const file = serializeWorld(grid, PAL);
    delete file.source;
    const { grid: back } = deserializeWorld(JSON.parse(JSON.stringify(file)));
    expect(back.source.some((v) => v !== 0)).toBe(false);
  });
});

describe("structures", () => {
  test("survive a round trip, and the layer is rebuilt from them", () => {
    const g = createGrid(8, 8);
    fillTerrain(g, 1);
    const hist = createHistory();
    commit(g, hist, placeCommand(g, structureDef("kit:intern.t1")!, 2, 2)!);
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
