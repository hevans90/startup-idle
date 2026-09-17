import { describe, expect, test } from "bun:test";
import { bandCount, bandOf } from "./iso";
import {
  VOID, createGrid, fillTerrain, forEachInBand, heightAt, idx, inBounds,
  pavedAt, recomputeHeightRange, setFluid, setHeight, setPaved, setRamp,
  setTerrain, stampFootprint, structureAt, terrainAt,
} from "./grid";
import { RAMP } from "./iso";
import { layPipe } from "./water/pipes";
import { applyFixture } from "./debug/fixtures";
import { deserializeWorld, serializeWorld } from "./io/serialize";
import { PatchBuilder, commit, createHistory, redo, undo } from "./edit/commands";

describe("the map says when it has been edited", () => {
  // EVERY LIST BUILT OFF THE GRID HANGS FROM THIS. The springs, the pipe runs
  // and the cells a run joins are all walked once and kept until the map
  // changes, and what tells them it has changed is `rev` — so a mutator that
  // forgets to move it is a list that is quietly, permanently wrong. There is
  // no way to notice that from the inside, which is what this test is for.
  const moves = (what: string, run: (g: ReturnType<typeof createGrid>) => void) => {
    test(`${what} moves it`, () => {
      const g = createGrid(8, 8);
      const was = g.rev;
      run(g);
      expect(g.rev).toBeGreaterThan(was);
    });
  };

  moves("setTerrain", (g) => setTerrain(g, 1, 1, 3));
  moves("setPaved", (g) => setPaved(g, 1, 1, 1));
  moves("setRamp", (g) => setRamp(g, 1, 1, RAMP.N));
  moves("setHeight", (g) => setHeight(g, 1, 1, 4));
  moves("setFluid", (g) => setFluid(g, 1, 1, 1));
  moves("fillTerrain", (g) => fillTerrain(g, 2));
  moves("stampFootprint", (g) =>
    stampFootprint(g, { id: 7, x: 1, y: 1, w: 2, h: 2, kind: "" } as never));
  moves("layPipe", (g) => layPipe(g, 2, 2, 1));
  moves("a fixture", (g) => applyFixture(g, "pipes", 1));
  moves("a command", (g) => {
    const p = new PatchBuilder(g);
    p.set("source", 3, 3, 8);
    commit(g, createHistory(), p.build("tap")!);
  });
  moves("undo", (g) => {
    const p = new PatchBuilder(g);
    p.set("source", 3, 3, 8);
    const h = createHistory();
    commit(g, h, p.build("tap")!);
    const was = g.rev;
    undo(g, h);
    expect(g.rev).toBeGreaterThan(was);
  });
  moves("redo", (g) => {
    const p = new PatchBuilder(g);
    p.set("source", 3, 3, 8);
    const h = createHistory();
    commit(g, h, p.build("tap")!);
    undo(g, h);
    const was = g.rev;
    redo(g, h);
    expect(g.rev).toBeGreaterThan(was);
  });
  moves("loading a map", (g) => {
    setHeight(g, 1, 1, 5);
    const loaded = deserializeWorld(serializeWorld(g, { terrain: [null], paved: [null] }));
    // The loaded grid is a different object, so what is checked is that IT
    // reads as edited rather than as a grid nobody has touched.
    expect(loaded.grid.rev).toBeGreaterThan(0);
  });
});

describe("createGrid", () => {
  test("allocates every layer at the right size", () => {
    const g = createGrid(8, 5);
    expect([g.w, g.h]).toEqual([8, 5]);
    for (const a of [g.terrain, g.height, g.paved, g.structureAt]) {
      expect(a.length).toBe(40);
    }
  });
  test("void by default, structureAt empty is -1", () => {
    const g = createGrid(4, 4);
    expect([...g.terrain].every((v) => v === VOID)).toBe(true);
    expect([...g.structureAt].every((v) => v === -1)).toBe(true);
  });
  test("optional terrain fill", () => {
    expect([...createGrid(3, 3, 1).terrain].every((v) => v === 1)).toBe(true);
  });
  test("rejects a bad size", () => {
    expect(() => createGrid(0, 4)).toThrow();
    expect(() => createGrid(4.5, 4)).toThrow();
  });
});

describe("indexing", () => {
  test("idx round-trips", () => {
    const g = createGrid(7, 5);
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      const i = idx(g, x, y);
      expect(i).toBe(y * 7 + x);
      expect([i % 7, Math.floor(i / 7)]).toEqual([x, y]);
    }
  });
  test("inBounds rejects edges and negatives", () => {
    const g = createGrid(4, 3);
    expect(inBounds(g, 0, 0)).toBe(true);
    expect(inBounds(g, 3, 2)).toBe(true);
    for (const [x, y] of [[-1, 0], [0, -1], [4, 0], [0, 3]]) {
      expect(inBounds(g, x, y)).toBe(false);
    }
  });
});

describe("out-of-bounds reads are safe", () => {
  const g = createGrid(4, 4, 1);
  test("materials read as void, structures as -1", () => {
    expect(terrainAt(g, -1, 0)).toBe(VOID);
    expect(pavedAt(g, 99, 0)).toBe(VOID);
    expect(structureAt(g, 0, -5)).toBe(-1);
  });
  /** pickCell compares heights, so off-map MUST be null, never 0. */
  test("height reads as null, not 0", () => {
    expect(heightAt(g, 1, 1)).toBe(0);
    expect(heightAt(g, -1, 1)).toBeNull();
    expect(heightAt(g, 4, 1)).toBeNull();
  });
  test("writes off-map are ignored, not thrown", () => {
    expect(() => { setTerrain(g, -1, 0, 9); setHeight(g, 99, 0, 9); setPaved(g, 0, -1, 9); }).not.toThrow();
  });
});

describe("height range cache", () => {
  test("starts flat", () => {
    const g = createGrid(5, 5);
    expect([g.minHeight, g.maxHeight]).toEqual([0, 0]);
  });
  test("widens on raise and lower", () => {
    const g = createGrid(5, 5);
    setHeight(g, 1, 1, 4);
    setHeight(g, 2, 2, -3);
    expect([g.minHeight, g.maxHeight]).toEqual([-3, 4]);
  });
  test("rescans when the last cell at an extreme goes away", () => {
    const g = createGrid(5, 5);
    setHeight(g, 1, 1, 6);
    setHeight(g, 2, 2, 2);
    expect(g.maxHeight).toBe(6);
    setHeight(g, 1, 1, 0);            // removes the only 6
    expect(g.maxHeight).toBe(2);      // must have rescanned
  });
  test("keeps the extreme when another cell still holds it", () => {
    const g = createGrid(5, 5);
    setHeight(g, 1, 1, 5);
    setHeight(g, 3, 3, 5);
    setHeight(g, 1, 1, 0);
    expect(g.maxHeight).toBe(5);
  });
  test("recomputeHeightRange agrees with a from-scratch scan", () => {
    const g = createGrid(9, 9);
    for (let i = 0; i < g.height.length; i++) g.height[i] = ((i * 7) % 11) - 5;
    recomputeHeightRange(g);
    expect(g.minHeight).toBe(Math.min(...g.height));
    expect(g.maxHeight).toBe(Math.max(...g.height));
  });
  test("Int8 spans plenty of full steps", () => {
    const g = createGrid(2, 2);
    setHeight(g, 0, 0, 127);
    expect(heightAt(g, 0, 0)).toBe(127); // 63 full steps
    setHeight(g, 1, 1, -128);
    expect(heightAt(g, 1, 1)).toBe(-128);
  });
});

describe("forEachInBand", () => {
  test("visits exactly the cells with x + y === band, ascending in x", () => {
    const g = createGrid(6, 4);
    for (let b = 0; b < bandCount(6, 4); b++) {
      const got: [number, number][] = [];
      forEachInBand(g, b, (x, y) => got.push([x, y]));
      // every visited cell is in bounds and on the band
      for (const [x, y] of got) {
        expect(inBounds(g, x, y)).toBe(true);
        expect(bandOf(x, y)).toBe(b);
      }
      expect(got.map(([x]) => x)).toEqual([...got.map(([x]) => x)].sort((a, c) => a - c));
      // and nothing on the band was missed
      let expected = 0;
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (x + y === b) expected++;
      expect(got.length).toBe(expected);
    }
  });
  test("every cell is visited exactly once across all bands", () => {
    const g = createGrid(7, 5);
    const seen = new Set<string>();
    for (let b = 0; b < bandCount(7, 5); b++) {
      forEachInBand(g, b, (x, y) => seen.add(`${x},${y}`));
    }
    expect(seen.size).toBe(35);
  });
});

describe("fillTerrain", () => {
  test("sets every cell", () => {
    const g = createGrid(4, 4);
    fillTerrain(g, 3);
    expect([...g.terrain].every((v) => v === 3)).toBe(true);
  });
});
