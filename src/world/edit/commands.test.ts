import { describe, expect, test } from "bun:test";
import { createGrid, fillTerrain, idx, setHeight } from "../grid";
import {
  PatchBuilder, canRedo, canUndo, commit, createHistory, redo, redoLabel,
  touchedCells, undo, undoLabel,
} from "./commands";

const GRASS = 1, DIRT = 2;
const snapshot = (g: ReturnType<typeof createGrid>) => ({
  terrain: [...g.terrain], height: [...g.height], paved: [...g.paved],
});

function fresh(w = 6, h = 6) {
  const g = createGrid(w, h);
  fillTerrain(g, GRASS);
  return { g, hist: createHistory() };
}

describe("PatchBuilder", () => {
  test("builds nothing when values are unchanged", () => {
    const { g } = fresh();
    const b = new PatchBuilder(g);
    b.set("terrain", 1, 1, GRASS); // already grass
    expect(b.build("paint")).toBeNull();
  });

  test("ignores writes outside the map", () => {
    const { g } = fresh(4, 4);
    const b = new PatchBuilder(g);
    b.set("terrain", -1, 0, DIRT);
    b.set("terrain", 99, 0, DIRT);
    expect(b.size).toBe(0);
  });

  /** A stroke crossing itself must still undo to the original value. */
  test("re-touching a cell keeps the ORIGINAL before value", () => {
    const { g, hist } = fresh();
    const b = new PatchBuilder(g);
    b.set("terrain", 2, 2, DIRT);
    b.set("terrain", 2, 2, 3);
    b.set("terrain", 2, 2, DIRT);
    commit(g, hist, b.build("stroke")!);
    expect(g.terrain[idx(g, 2, 2)]).toBe(DIRT);
    undo(g, hist);
    expect(g.terrain[idx(g, 2, 2)]).toBe(GRASS); // not 3, not DIRT
  });

  test("groups multiple layers into one command", () => {
    const { g, hist } = fresh();
    const b = new PatchBuilder(g);
    b.set("terrain", 1, 1, DIRT);
    b.set("height", 1, 1, 2);
    const cmd = b.build("multi")!;
    expect(cmd.patches.length).toBe(2);
    commit(g, hist, cmd);
    expect(g.terrain[idx(g, 1, 1)]).toBe(DIRT);
    expect(g.height[idx(g, 1, 1)]).toBe(2);
  });
});

describe("undo / redo", () => {
  test("restores the grid byte-for-byte", () => {
    const { g, hist } = fresh(8, 8);
    const before = snapshot(g);
    const b = new PatchBuilder(g);
    for (let x = 0; x < 5; x++) b.set("terrain", x, 3, DIRT);
    commit(g, hist, b.build("line")!);
    expect(snapshot(g)).not.toEqual(before);
    undo(g, hist);
    expect(snapshot(g)).toEqual(before);
  });

  test("redo re-applies exactly", () => {
    const { g, hist } = fresh();
    const b = new PatchBuilder(g);
    b.set("terrain", 2, 2, DIRT);
    b.set("height", 2, 2, 1);
    commit(g, hist, b.build("edit")!);
    const after = snapshot(g);
    undo(g, hist);
    redo(g, hist);
    expect(snapshot(g)).toEqual(after);
  });

  /** A drag stroke is one command: fifty cells, one undo. */
  test("a whole stroke is a single undo step", () => {
    const { g, hist } = fresh(16, 16);
    const before = snapshot(g);
    const b = new PatchBuilder(g);
    for (let i = 0; i < 12; i++) b.set("terrain", i, i, DIRT);
    commit(g, hist, b.build("stroke")!);
    expect(hist.past.length).toBe(1);
    undo(g, hist);
    expect(snapshot(g)).toEqual(before);
    expect(canUndo(hist)).toBe(false);
  });

  test("many edits unwind in order", () => {
    const { g, hist } = fresh();
    const states = [snapshot(g)];
    for (const [x, v] of [[0, DIRT], [1, 3], [2, DIRT]] as const) {
      const b = new PatchBuilder(g);
      b.set("terrain", x, 0, v);
      commit(g, hist, b.build(`e${x}`)!);
      states.push(snapshot(g));
    }
    for (let i = states.length - 1; i > 0; i--) {
      expect(snapshot(g)).toEqual(states[i]);
      undo(g, hist);
    }
    expect(snapshot(g)).toEqual(states[0]);
  });

  test("a new edit clears the redo branch", () => {
    const { g, hist } = fresh();
    const b1 = new PatchBuilder(g); b1.set("terrain", 1, 1, DIRT);
    commit(g, hist, b1.build("a")!);
    undo(g, hist);
    expect(canRedo(hist)).toBe(true);
    const b2 = new PatchBuilder(g); b2.set("terrain", 2, 2, DIRT);
    commit(g, hist, b2.build("b")!);
    expect(canRedo(hist)).toBe(false);
  });

  test("undo/redo on empty history is a safe null", () => {
    const { g, hist } = fresh();
    expect(undo(g, hist)).toBeNull();
    expect(redo(g, hist)).toBeNull();
  });

  test("labels track the stack", () => {
    const { g, hist } = fresh();
    const b = new PatchBuilder(g); b.set("terrain", 1, 1, DIRT);
    commit(g, hist, b.build("paint dirt")!);
    expect(undoLabel(hist)).toBe("paint dirt");
    expect(redoLabel(hist)).toBeNull();
    undo(g, hist);
    expect(undoLabel(hist)).toBeNull();
    expect(redoLabel(hist)).toBe("paint dirt");
  });

  test("history is capped", () => {
    const { g } = fresh();
    const hist = createHistory(5);
    for (let i = 0; i < 12; i++) {
      const b = new PatchBuilder(g);
      b.set("terrain", i % 6, 0, (i % 3) + 1);
      const cmd = b.build(`e${i}`);
      if (cmd) commit(g, hist, cmd);
    }
    expect(hist.past.length).toBeLessThanOrEqual(5);
  });

  test("height edits round-trip, including negatives", () => {
    const { g, hist } = fresh();
    setHeight(g, 1, 1, 4);
    const before = snapshot(g);
    const b = new PatchBuilder(g);
    b.set("height", 1, 1, -6);
    commit(g, hist, b.build("dig")!);
    expect(g.height[idx(g, 1, 1)]).toBe(-6);
    undo(g, hist);
    expect(snapshot(g)).toEqual(before);
  });
});

describe("touchedCells", () => {
  test("maps flat indices back to x/y and de-duplicates", () => {
    const { g, hist } = fresh(5, 5);
    const b = new PatchBuilder(g);
    b.set("terrain", 1, 2, DIRT);
    b.set("height", 1, 2, 2);      // same cell, two layers
    b.set("terrain", 3, 4, DIRT);
    const touched = commit(g, hist, b.build("mix")!);
    const cells = touchedCells(g, touched);
    expect(cells).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }]);
  });
});

describe("peek", () => {
  test("sees a staged write before anything is applied", () => {
    const { g } = fresh(8, 8);
    const b = new PatchBuilder(g);
    expect(b.peek("paved", 2, 2)).toBe(0);
    b.set("paved", 2, 2, 1);
    expect(b.peek("paved", 2, 2)).toBe(1);
    expect(g.paved[2 * 8 + 2]).toBe(0);        // still unwritten
  });

  test("falls through to the grid where nothing is staged", () => {
    const { g } = fresh(8, 8);
    setHeight(g, 3, 3, 4);
    const b = new PatchBuilder(g);
    expect(b.peek("height", 3, 3)).toBe(4);
  });

  test("reflects the LATEST staged value when a cell is re-touched", () => {
    const { g } = fresh(8, 8);
    const b = new PatchBuilder(g);
    b.set("paved", 1, 1, 1);
    b.set("paved", 1, 1, 0);
    expect(b.peek("paved", 1, 1)).toBe(0);
  });

  test("off-map reads as 0 rather than throwing", () => {
    const b = new PatchBuilder(fresh(8, 8).g);
    expect(b.peek("paved", -1, 0)).toBe(0);
    expect(b.peek("height", 99, 0)).toBe(0);
  });
});
