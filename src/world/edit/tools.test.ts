import { describe, expect, test } from "bun:test";
import { createGrid } from "../grid";
import type { Cell } from "../iso";
import { expandCells, strokeCells, strokeFootprint, strokeLabel, type Stroke } from "./tools";

const g = createGrid(10, 8);
const mk = (p: Partial<Stroke>): Stroke => ({
  tool: "paintTerrain", brush: "point",
  anchor: { x: 0, y: 0 }, head: { x: 0, y: 0 }, ...p,
});

describe("point", () => {
  test("is the head cell only", () => {
    expect(strokeCells(g, mk({ anchor: { x: 1, y: 1 }, head: { x: 4, y: 3 } })))
      .toEqual([{ x: 4, y: 3 }]);
  });
});

describe("rect", () => {
  test("covers the block between anchor and head, inclusive", () => {
    const cells = strokeCells(g, mk({ brush: "rect", anchor: { x: 1, y: 1 }, head: { x: 3, y: 2 } }));
    expect(cells.length).toBe(6);
    expect(cells).toContainEqual({ x: 1, y: 1 });
    expect(cells).toContainEqual({ x: 3, y: 2 });
  });
  test("works dragged backwards", () => {
    const fwd = strokeCells(g, mk({ brush: "rect", anchor: { x: 1, y: 1 }, head: { x: 3, y: 3 } }));
    const back = strokeCells(g, mk({ brush: "rect", anchor: { x: 3, y: 3 }, head: { x: 1, y: 1 } }));
    expect(back.length).toBe(fwd.length);
    expect(new Set(back.map((c) => `${c.x},${c.y}`))).toEqual(new Set(fwd.map((c) => `${c.x},${c.y}`)));
  });
  test("a single-cell rect is one cell", () => {
    expect(strokeCells(g, mk({ brush: "rect", anchor: { x: 2, y: 2 }, head: { x: 2, y: 2 } })).length).toBe(1);
  });
});

describe("line", () => {
  /** The point of Bresenham here: a fast drag must not leave gaps. */
  test("is connected — every step moves at most one cell", () => {
    const cells = strokeCells(g, mk({ brush: "line", anchor: { x: 0, y: 0 }, head: { x: 9, y: 7 } }));
    for (let i = 1; i < cells.length; i++) {
      expect(Math.abs(cells[i].x - cells[i - 1].x)).toBeLessThanOrEqual(1);
      expect(Math.abs(cells[i].y - cells[i - 1].y)).toBeLessThanOrEqual(1);
    }
  });
  test("starts at the anchor and ends at the head", () => {
    const cells = strokeCells(g, mk({ brush: "line", anchor: { x: 2, y: 6 }, head: { x: 8, y: 1 } }));
    expect(cells[0]).toEqual({ x: 2, y: 6 });
    expect(cells[cells.length - 1]).toEqual({ x: 8, y: 1 });
  });
  test("a zero-length line is one cell", () => {
    expect(strokeCells(g, mk({ brush: "line", anchor: { x: 3, y: 3 }, head: { x: 3, y: 3 } })))
      .toEqual([{ x: 3, y: 3 }]);
  });
  test("axis-aligned lines are exact", () => {
    expect(strokeCells(g, mk({ brush: "line", anchor: { x: 0, y: 2 }, head: { x: 4, y: 2 } })).length).toBe(5);
    expect(strokeCells(g, mk({ brush: "line", anchor: { x: 2, y: 0 }, head: { x: 2, y: 5 } })).length).toBe(6);
  });
});

/**
 * A diagonal road drag used to lay cells that touched only at their corners —
 * lone squares with no corner art and no network, which is what "the line brush
 * doesn't paint the corners or respect line breaks" was describing.
 */
describe("road line bends instead of cutting the diagonal", () => {
  const road = (anchor: Cell, head: Cell) =>
    strokeCells(g, mk({ tool: "paintRoad", brush: "line", anchor, head }));

  test("every step is an EDGE step, so the run is actually connected", () => {
    const cells = road({ x: 0, y: 0 }, { x: 6, y: 4 });
    for (let i = 1; i < cells.length; i++) {
      const d = Math.abs(cells[i].x - cells[i - 1].x) + Math.abs(cells[i].y - cells[i - 1].y);
      expect(d).toBe(1);
    }
  });

  test("it bends exactly once", () => {
    const cells = road({ x: 0, y: 0 }, { x: 6, y: 4 });
    let bends = 0;
    for (let i = 2; i < cells.length; i++) {
      const ax = cells[i - 1].x - cells[i - 2].x, ay = cells[i - 1].y - cells[i - 2].y;
      const bx = cells[i].x - cells[i - 1].x, by = cells[i].y - cells[i - 1].y;
      if (ax !== bx || ay !== by) bends++;
    }
    expect(bends).toBe(1);
  });

  test("the LONG axis leads, so the corner lands near the pointer", () => {
    expect(road({ x: 0, y: 0 }, { x: 6, y: 2 })).toContainEqual({ x: 6, y: 0 });   // wide drag
    expect(road({ x: 0, y: 0 }, { x: 2, y: 6 })).toContainEqual({ x: 0, y: 6 });   // tall drag
  });

  test("it covers both legs, with the corner counted once", () => {
    const cells = road({ x: 1, y: 1 }, { x: 5, y: 3 });
    expect(cells.length).toBe(5 + 2);          // 5 across, 2 more down
    expect(new Set(cells.map((c) => `${c.x},${c.y}`)).size).toBe(cells.length);
  });

  test("starts at the anchor and ends at the head, dragged either way", () => {
    for (const [a, b] of [
      [{ x: 1, y: 6 }, { x: 7, y: 2 }],
      [{ x: 7, y: 2 }, { x: 1, y: 6 }],
    ] as const) {
      const cells = road(a, b);
      expect(cells[0]).toEqual(a);
      expect(cells[cells.length - 1]).toEqual(b);
    }
  });

  test("a straight drag is still just the straight run", () => {
    expect(road({ x: 0, y: 2 }, { x: 4, y: 2 }).length).toBe(5);
    expect(road({ x: 2, y: 0 }, { x: 2, y: 5 }).length).toBe(6);
    expect(road({ x: 3, y: 3 }, { x: 3, y: 3 })).toEqual([{ x: 3, y: 3 }]);
  });

  test("erasing road bends too — you unpave the shape you paved", () => {
    const a = { x: 0, y: 0 }, b = { x: 5, y: 3 };
    expect(strokeCells(g, mk({ tool: "eraseRoad", brush: "line", anchor: a, head: b })))
      .toEqual(road(a, b));
  });

  test("other tools keep the true diagonal — a terrain line is not a road", () => {
    const paint = strokeCells(g, mk({ brush: "line", anchor: { x: 0, y: 0 }, head: { x: 4, y: 4 } }));
    expect(paint.length).toBe(5);              // the diagonal itself, not an L
    expect(paint).toContainEqual({ x: 2, y: 2 });
  });
});

describe("clamping", () => {
  test("cells outside the map are pulled inside, never emitted off-map", () => {
    for (const brush of ["point", "rect", "line"] as const) {
      const cells = strokeCells(g, mk({ brush, anchor: { x: -20, y: -20 }, head: { x: 99, y: 99 } }));
      for (const c of cells) {
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.y).toBeGreaterThanOrEqual(0);
        expect(c.x).toBeLessThan(g.w);
        expect(c.y).toBeLessThan(g.h);
      }
    }
  });
  test("a rect dragged off both edges covers the whole map", () => {
    expect(strokeCells(g, mk({ brush: "rect", anchor: { x: -5, y: -5 }, head: { x: 50, y: 50 } })).length)
      .toBe(80);
  });
});

describe("strokeLabel", () => {
  test("names the action and pluralises", () => {
    expect(strokeLabel(mk({}), 1)).toBe("paint (1 cell)");
    expect(strokeLabel(mk({ brush: "rect" }), 12)).toBe("paint rect (12 cells)");
    expect(strokeLabel(mk({ tool: "erase" }), 3)).toBe("erase (3 cells)");
  });
});

describe("expandCells — brush size", () => {
  /** The behaviour the shape brushes could not give: ONE CLICK covering more
   *  than one tile. A radius-1 brush is 3x3. */
  test("radius 1 turns one cell into 9", () => {
    expect(expandCells(g, [{ x: 4, y: 4 }], 1).length).toBe(9);
  });
  test("radius 2 turns one cell into 25", () => {
    expect(expandCells(g, [{ x: 4, y: 4 }], 2).length).toBe(25);
  });
  test("radius 0 is a passthrough", () => {
    expect(expandCells(g, [{ x: 1, y: 1 }], 0)).toEqual([{ x: 1, y: 1 }]);
  });
  test("clips at the map edge instead of emitting off-map cells", () => {
    const cells = expandCells(g, [{ x: 0, y: 0 }], 2);
    expect(cells.length).toBe(9); // quarter of 25 survives the corner
    for (const c of cells) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
    }
  });
  test("deduplicates where footprints overlap along a stroke", () => {
    const line = strokeCells(g, mk({ brush: "line", anchor: { x: 2, y: 2 }, head: { x: 6, y: 2 } }));
    const fat = expandCells(g, line, 1);
    const keys = new Set(fat.map((c) => `${c.x},${c.y}`));
    expect(keys.size).toBe(fat.length);            // no repeats
    expect(fat.length).toBeLessThan(line.length * 9); // overlaps were merged
  });
  test("strokeFootprint combines shape and size", () => {
    const s = mk({ brush: "point", head: { x: 5, y: 5 } });
    expect(strokeFootprint(g, s, 0).length).toBe(1);
    expect(strokeFootprint(g, s, 1).length).toBe(9);
  });
});
