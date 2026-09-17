/**
 * Placement rules and the place/demolish commands.
 *
 * Pure over a grid, with no renderer anywhere — which is the point of splitting
 * definitions from rendering. The rules are where the bugs live.
 */
import { describe, expect, test } from "bun:test";

import {
  PatchBuilder, commit, createHistory, redo, undo,
} from "../edit/commands";
import {
  VOID, createGrid, fillTerrain, idx, setHeight, setPaved, structureOf, type Grid,
} from "../grid";
import { RAMP, packRamp } from "../iso";
import { registerStructureDef, structureDef, type StructureDef } from "./def";
import { demolishCommand, medianHeight, placeCommand, validatePlacement } from "./place";

const GRASS = 1;
const fresh = (w = 12, h = 12) => {
  const g = createGrid(w, h);
  fillTerrain(g, GRASS);
  return { g, hist: createHistory() };
};

const KIT = structureDef("kit:intern.t0")!;
/**
 * A big footprint that clears its ground. The slop pit used to be this; it is a
 * POOL now, so the tests that need a multi-cell clearing structure register
 * their own rather than depending on whatever content happens to ship.
 */
const PIT: StructureDef = {
  id: "test:yard",
  name: "yard",
  footprint: { w: 5, h: 5 },
  render: { kind: "custom", rendererId: "none" },
  clearsTerrain: true,
};
registerStructureDef(PIT);
/** A 2×2 that does NOT level the ground, for the uneven-ground rule. */
const RIGID: StructureDef = {
  id: "test:rigid",
  name: "rigid",
  footprint: { w: 2, h: 2 },
  render: { kind: "custom", rendererId: "none" },
  placement: { autoFlatten: false },
};

describe("definitions", () => {
  test("every building kit is placeable as a 1x1", () => {
    expect(KIT.footprint).toEqual({ w: 1, h: 1 });
    expect(structureDef("kit:10x_dev.landmark")).not.toBeNull();
  });
});

describe("medianHeight", () => {
  test("is a height the ground actually has", () => {
    expect(medianHeight([0, 2, 4])).toBe(2);
    expect(medianHeight([4, 0, 2])).toBe(2);
  });
  test("takes the LOWER median on an even count, so it is total", () => {
    expect(medianHeight([0, 2])).toBe(0);
    expect(medianHeight([0, 2, 4, 6])).toBe(2);
  });
  test("an empty footprint is height zero rather than NaN", () => {
    expect(medianHeight([])).toBe(0);
  });
});

describe("validatePlacement", () => {
  test("plain ground is fine", () => {
    const { g } = fresh();
    expect(validatePlacement(g, KIT, 4, 4).ok).toBe(true);
  });

  test("off the map is refused, and says which cells", () => {
    const { g } = fresh(6, 6);
    const check = validatePlacement(g, PIT, 4, 4);          // 5x5 from (4,4)
    expect(check.ok).toBe(false);
    expect(check.cells.filter((c) => !c.ok).length).toBeGreaterThan(0);
    expect(check.cells[0].ok).toBe(true);                    // (4,4) itself is on-map
  });

  test("void ground is refused — there is nothing to build on", () => {
    const { g } = fresh();
    g.terrain[idx(g, 4, 4)] = VOID;
    expect(validatePlacement(g, KIT, 4, 4).reason).toBe("no ground");
  });

  test("a road is not a foundation, unless the def says so", () => {
    const { g } = fresh();
    setPaved(g, 4, 4, 1);
    expect(validatePlacement(g, KIT, 4, 4).reason).toBe("on a road");
    const paveable = { ...KIT, placement: { allowOnPaved: true } };
    expect(validatePlacement(g, paveable, 4, 4).ok).toBe(true);
  });

  test("an occupied cell is refused", () => {
    const { g, hist } = fresh();
    commit(g, hist, placeCommand(g, KIT, 4, 4)!);
    expect(validatePlacement(g, KIT, 4, 4).reason).toBe("occupied");
  });

  test("uneven ground blocks only when nothing will level it", () => {
    const { g } = fresh();
    setHeight(g, 5, 5, 4);
    expect(validatePlacement(g, RIGID, 4, 4).reason).toBe("uneven ground");
    expect(validatePlacement(g, { ...RIGID, placement: {} }, 4, 4).ok).toBe(true);
  });

  test("uneven ground blames the whole footprint, not one cell", () => {
    const { g } = fresh();
    setHeight(g, 5, 5, 4);
    const check = validatePlacement(g, RIGID, 4, 4);
    expect(check.cells.every((c) => !c.ok)).toBe(true);
  });
});

describe("placeCommand", () => {
  test("stamps the footprint with the structure's ID", () => {
    const { g, hist } = fresh();
    commit(g, hist, placeCommand(g, PIT, 3, 3)!);
    const s = structureOf(g, 5, 5)!;
    expect(s.def).toBe(PIT.id);
    expect(s.x).toBe(3);
    for (const [x, y] of [[3, 3], [7, 7], [3, 7], [7, 3]] as const) {
      expect(g.structureAt[idx(g, x, y)]).toBe(s.id);
    }
    expect(g.structureAt[idx(g, 2, 3)]).toBe(-1);            // just outside
  });

  test("levels the footprint to its median in the SAME command", () => {
    const { g, hist } = fresh();
    for (const [x, y, v] of [[4, 4, 0], [5, 4, 2], [4, 5, 2], [5, 5, 6]] as const) {
      setHeight(g, x, y, v);
    }
    commit(g, hist, placeCommand(g, { ...RIGID, placement: {} }, 4, 4)!);
    for (const [x, y] of [[4, 4], [5, 4], [4, 5], [5, 5]] as const) {
      expect(g.height[idx(g, x, y)]).toBe(2);                // lower median
    }
  });

  test("levelling clears any ramp under the footprint", () => {
    const { g, hist } = fresh();
    g.ramp[idx(g, 4, 4)] = packRamp(RAMP.N, 2);
    commit(g, hist, placeCommand(g, KIT, 4, 4)!);
    expect(g.ramp[idx(g, 4, 4)]).toBe(RAMP.NONE);
  });

  test("an excavation leaves the terrain DATA alone — hiding is the renderer's job", () => {
    const { g, hist } = fresh();
    commit(g, hist, placeCommand(g, PIT, 3, 3)!);
    // Zeroing it would lose the material, so demolishing could never put the
    // ground back and every pit would leave a permanent hole.
    expect(g.terrain[idx(g, 5, 5)]).toBe(GRASS);
    expect(PIT.clearsTerrain).toBe(true);
  });

  test("refuses where validation refuses", () => {
    const { g } = fresh(6, 6);
    expect(placeCommand(g, PIT, 4, 4)).toBeNull();
  });

  test("ids are handed out in order and never reused", () => {
    const { g, hist } = fresh();
    commit(g, hist, placeCommand(g, KIT, 1, 1)!);
    commit(g, hist, placeCommand(g, KIT, 2, 2)!);
    const ids = [...g.structures.keys()];
    expect(new Set(ids).size).toBe(2);
    expect(g.nextStructureId).toBeGreaterThan(Math.max(...ids));
  });
});

describe("undo", () => {
  const snapshot = (g: Grid) => ({
    terrain: [...g.terrain], height: [...g.height],
    ramp: [...g.ramp], structureAt: [...g.structureAt],
    structures: [...g.structures.values()],
  });

  test("ONE undo reverses the placement AND the flattening", () => {
    const { g, hist } = fresh();
    setHeight(g, 5, 5, 4);
    const before = snapshot(g);
    commit(g, hist, placeCommand(g, { ...RIGID, placement: {} }, 4, 4)!);
    expect(hist.past.length).toBe(1);
    undo(g, hist);
    expect(snapshot(g)).toEqual(before);
    expect(g.height[idx(g, 5, 5)]).toBe(4);                  // the hill is back
  });

  test("redo restores the record under its ORIGINAL id", () => {
    const { g, hist } = fresh();
    commit(g, hist, placeCommand(g, KIT, 4, 4)!);
    const id = structureOf(g, 4, 4)!.id;
    undo(g, hist);
    expect(structureOf(g, 4, 4)).toBeNull();
    redo(g, hist);
    expect(structureOf(g, 4, 4)!.id).toBe(id);
  });

  test("undoing a pit frees every one of its cells", () => {
    const { g, hist } = fresh();
    commit(g, hist, placeCommand(g, PIT, 3, 3)!);
    undo(g, hist);
    expect(g.structures.size).toBe(0);
    expect([...g.structureAt].every((v) => v === -1)).toBe(true);
  });
});

describe("demolishCommand", () => {
  test("lifts the record and frees every cell", () => {
    const { g, hist } = fresh();
    commit(g, hist, placeCommand(g, PIT, 3, 3)!);
    const id = structureOf(g, 5, 5)!.id;
    commit(g, hist, demolishCommand(g, id)!);
    expect(g.structures.size).toBe(0);
    expect(g.structureAt[idx(g, 5, 5)]).toBe(-1);
    expect(validatePlacement(g, PIT, 3, 3).ok).toBe(true);   // buildable again
  });

  test("undoing a demolish puts the same structure back", () => {
    const { g, hist } = fresh();
    commit(g, hist, placeCommand(g, KIT, 4, 4)!);
    const id = structureOf(g, 4, 4)!.id;
    commit(g, hist, demolishCommand(g, id)!);
    undo(g, hist);
    expect(structureOf(g, 4, 4)!.id).toBe(id);
  });

  test("demolishing nothing is null, not a crash", () => {
    const { g } = fresh();
    expect(demolishCommand(g, 99)).toBeNull();
  });

  test("it frees only ITS cells, not a neighbour's", () => {
    const { g, hist } = fresh();
    commit(g, hist, placeCommand(g, KIT, 4, 4)!);
    commit(g, hist, placeCommand(g, KIT, 5, 4)!);
    const first = structureOf(g, 4, 4)!.id;
    commit(g, hist, demolishCommand(g, first)!);
    expect(g.structureAt[idx(g, 4, 4)]).toBe(-1);
    expect(structureOf(g, 5, 4)).not.toBeNull();
  });
});

describe("a command with no cell writes still carries its record", () => {
  test("build() is not null just because the layers did not move", () => {
    const { g } = fresh();
    const b = new PatchBuilder(g);
    b.addStructure({ id: 7, def: "kit:intern.t0", x: 0, y: 0, w: 1, h: 1 });
    expect(b.build("record only")).not.toBeNull();
  });
});
