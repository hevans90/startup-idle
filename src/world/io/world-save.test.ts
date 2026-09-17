/**
 * The map surviving a reload.
 *
 * This is load-bearing rather than convenient: the housing a player builds gates
 * who they can hire, so a map that failed to come back would leave a save file
 * holding employees with nowhere to live. Every failure mode here is therefore
 * tested for what it does to the NEXT load, not merely for not throwing.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import { clearSaved, hasSaved, loadSaved, saveNow, saveSoon } from "./world-save";
import { serializeWorld } from "./serialize";
import { createGrid, fillTerrain, idx, setHeight } from "../grid";
import { createWaterField, pourAt } from "../water/field";
import { layPipe } from "../water/pipes";
import { DIR } from "../../iso/dir";

const PALETTE = { terrain: [null, "grass.png"], paved: [null] } as const;

/** A map with something on every layer worth losing. */
function world(w = 8, h = 8) {
  const grid = createGrid(w, h);
  fillTerrain(grid, 1);
  setHeight(grid, 2, 2, 6);
  grid.paved[idx(grid, 3, 3)] = 1;
  layPipe(grid, 5, 5, DIR.E);
  const field = createWaterField(grid);
  pourAt(field, 1, 1, 4, 1);
  return { grid, field };
}

const save = (w: ReturnType<typeof world>) => {
  saveSoon(() => serializeWorld(w.grid, PALETTE, w.field));
  saveNow();                                    // flush the debounce
};

describe("the map comes back", () => {
  beforeEach(() => { clearSaved(); localStorage.clear(); });

  test("nothing saved is not an error, it is a new world", () => {
    expect(hasSaved()).toBe(false);
    expect(loadSaved()).toBeNull();
  });

  test("a saved map round-trips its layers", () => {
    const w = world();
    save(w);
    expect(hasSaved()).toBe(true);

    const back = loadSaved();
    expect(back).not.toBeNull();
    const g = back!.grid;
    expect(g.w).toBe(8);
    expect(g.h).toBe(8);
    expect(g.height[idx(g, 2, 2)]).toBe(6);
    expect(g.paved[idx(g, 3, 3)]).toBe(1);
    expect(g.pipe[idx(g, 5, 5)]).toBe(DIR.E);
    expect(back!.palette.terrain[1]).toBe("grass.png");
  });

  /**
   * THE WATER IS SAVED AS DEPTH, not as a running simulation — which is the
   * whole reason an absence is cheap. What must survive is that there IS water
   * there, because that is what a building will one day be supplied by.
   */
  test("standing water survives as depth", () => {
    const w = world();
    save(w);
    const g = loadSaved()!.grid;
    expect(g.pool[idx(g, 1, 1)]).toBeGreaterThan(0);
  });

  test("clearing forgets it", () => {
    save(world());
    clearSaved();
    expect(hasSaved()).toBe(false);
    expect(loadSaved()).toBeNull();
  });
});

describe("saving is debounced, because a drag is hundreds of edits", () => {
  beforeEach(() => { clearSaved(); localStorage.clear(); });

  test("queuing does not write until it is flushed", () => {
    const w = world();
    saveSoon(() => serializeWorld(w.grid, PALETTE, w.field));
    expect(hasSaved()).toBe(false);             // still waiting
    saveNow();
    expect(hasSaved()).toBe(true);
  });

  /**
   * The thunk is what makes a drag cheap: whatever arrives while the debounce
   * is waiting, only the LAST one is ever serialised.
   */
  test("only the last queued map is serialised", () => {
    const w = world();
    let made = 0;
    for (let n = 0; n < 50; n++) {
      saveSoon(() => { made++; return serializeWorld(w.grid, PALETTE, w.field); });
    }
    expect(made).toBe(0);
    saveNow();
    expect(made).toBe(1);
  });

  test("flushing with nothing queued does nothing and does not throw", () => {
    expect(() => saveNow()).not.toThrow();
    expect(hasSaved()).toBe(false);
  });
});

describe("a bad save starts a new world rather than a blank screen", () => {
  beforeEach(() => { clearSaved(); localStorage.clear(); });

  test("unparseable JSON is refused, not thrown", () => {
    localStorage.setItem("world-map", "{ this is not json");
    expect(() => loadSaved()).not.toThrow();
    expect(loadSaved()).toBeNull();
  });

  test("a map from a future version is refused, not thrown", () => {
    const w = world();
    const file = { ...serializeWorld(w.grid, PALETTE, w.field), version: 99 };
    localStorage.setItem("world-map", JSON.stringify(file));
    expect(() => loadSaved()).not.toThrow();
    expect(loadSaved()).toBeNull();
  });

  test("a truncated payload is refused, not thrown", () => {
    const w = world();
    const raw = JSON.stringify(serializeWorld(w.grid, PALETTE, w.field));
    localStorage.setItem("world-map", raw.slice(0, raw.length >> 1));
    expect(() => loadSaved()).not.toThrow();
    expect(loadSaved()).toBeNull();
  });

  /**
   * A REFUSED LOAD MUST NOT DELETE THE SAVE. The map may be readable by a
   * later build; throwing it away on the first version that cannot parse it
   * turns a recoverable problem into a lost city.
   */
  test("and it leaves the bad payload alone", () => {
    localStorage.setItem("world-map", "{ broken");
    loadSaved();
    expect(localStorage.getItem("world-map")).toBe("{ broken");
  });
});
