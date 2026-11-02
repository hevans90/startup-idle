import { describe, expect, test } from "bun:test";
import { chevronAt, detailFor, spaceWords, type Word } from "./mains-layer";
import { BEND_R, ZT, cellPaths } from "./pipe-mesh";

describe("the Water overlay's numbers", () => {
  const word = (text: string, x: number, y: number, rank: number): Word => ({ text, colour: 0xffffff, at: [x, y], rank });

  test("where two would meet, the one that matters more is kept", () => {
    const out = spaceWords([word("head +1.0", 100, 100, 0), word("dry", 110, 104, 3), word("97%", 400, 100, 2)], 1);
    expect(out.map((w) => w.text)).toEqual(["dry", "97%"]);
  });

  test("zoomed in, the same numbers are far enough apart to all stand", () => {
    // A screen pixel is a fifth of a unit: the 10 units between them are 50 px.
    const out = spaceWords([word("100%", 100, 100, 2), word("98%", 100, 110, 2)], 0.2);
    expect(out).toHaveLength(2);
    expect(spaceWords([word("100%", 100, 100, 2), word("98%", 100, 110, 2)], 2)).toHaveLength(1);
  });
});

describe("how much detail a main is drawn in", () => {
  test("by how wide a tile is on the screen", () => {
    expect(detailFor(5)).toBe("far");
    expect(detailFor(60)).toBe("mid");
    expect(detailFor(132)).toBe("near");
  });

  test("a zoom resting near a threshold stays in the tier it was in", () => {
    // Just under the near threshold: near stays near, mid stays mid.
    expect(detailFor(95, "near")).toBe("near");
    expect(detailFor(95, "mid")).toBe("mid");
    // Just over it, from mid: not yet.
    expect(detailFor(105, "mid")).toBe("mid");
    expect(detailFor(115, "mid")).toBe("near");
    // And round the far threshold the same way.
    expect(detailFor(38, "mid")).toBe("mid");
    expect(detailFor(42, "far")).toBe("far");
    expect(detailFor(30, "mid")).toBe("far");
  });
});

describe("the overlay's arrows", () => {
  test("sit on the tube: past the middle of a bend, pointing along it out the way it leaves", () => {
    const bend = cellPaths(5, 5, 0.2, [{ dx: -1, dy: 0, zf: 1 }, { dx: 0, dy: 1, zf: 1 }], 0.1);
    const on = chevronAt(bend, 5, 5.5)!;
    expect(on).not.toBeNull();
    const [p, t] = on;
    // On the arc, not at the cell's middle the tube never passes through.
    expect(Math.hypot(p[0] - (5 - BEND_R), p[1] - (5 + BEND_R))).toBeCloseTo(BEND_R, 1);
    // Heading on toward the face it leaves by.
    expect(t[1]).toBeGreaterThan(0);
  });

  test("on a climbing run, at the tube's own height there", () => {
    const run = cellPaths(5, 5, 2 * ZT, [{ dx: -1, dy: 0, zf: 1 }, { dx: 1, dy: 0, zf: 4 }], 0.1);
    const [p, t] = chevronAt(run, 5.5, 5)!;
    expect(p[0]).toBeCloseTo(5.14, 2);
    expect(p[2]).toBeGreaterThan(2 * ZT);
    expect(p[2]).toBeLessThan(4 * ZT);
    expect(t[2]).toBeGreaterThan(0);
    // Leaving the other way, it points back down.
    expect(chevronAt(run, 4.5, 5)![1][2]).toBeLessThan(0);
  });

  test("a face the cell has no length to gets none", () => {
    expect(chevronAt(cellPaths(5, 5, 0, [{ dx: 1, dy: 0, zf: 0 }], 0.1), 5, 4.5)).toBeNull();
  });
});
