import { describe, expect, test } from "bun:test";
import { createGrid, idx } from "../grid";
import { chevronAt, detailFor, roadAxis, spaceWords, type Word } from "./mains-layer";
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

describe("a main's frame over a road", () => {
  test("stands at the edges of the way the road runs; none at a junction or off the road", () => {
    const g = createGrid(8, 8);
    for (let x = 1; x <= 6; x++) g.paved[idx(g, x, 3)] = 1;     // a road along u
    for (let y = 4; y <= 6; y++) g.paved[idx(g, 4, y)] = 1;     // a spur along v off it
    expect(roadAxis(g, 2, 3)).toBe("u");
    expect(roadAxis(g, 4, 5)).toBe("v");
    expect(roadAxis(g, 4, 3)).toBeNull();                      // the junction
    expect(roadAxis(g, 2, 2)).toBeNull();                      // grass
  });
});

describe("levels of detail, kept", () => {
  test("crossing a zoom threshold shows one set of meshes and hides another; coming back, the first set is the same one", async () => {
    const { Container } = await import("pixi.js");
    const { createBandLayer } = await import("./bands");
    const { createMainsLayer } = await import("./mains-layer");
    const { DIR } = await import("../../iso/dir");
    const g = createGrid(12, 6);
    for (let x = 2; x <= 8; x++) g.main[idx(g, x, 2)] = (x > 2 ? DIR.N : 0) | (x < 8 ? DIR.S : 0);
    g.rev++;
    const bands = createBandLayer(g.w, g.h), layer = createMainsLayer(bands, new Container());
    const all = () => bands.dynamicOf.flatMap((t) => t.children.slice());
    const shown = () => all().filter((c) => c.visible);
    // Far off first, then near, then far again: `zoom` scales a tile's width on the screen.
    layer.sync(g, 1, 0.1);
    const far = shown();
    expect(far.length).toBeGreaterThan(0);
    layer.sync(g, 1, 4);
    const near = shown();
    expect(near.length).toBeGreaterThan(0);
    for (const c of far) { expect(c.destroyed).toBe(false); expect(c.visible).toBe(false); expect(near).not.toContain(c); }
    layer.sync(g, 1, 0.1);
    expect(shown()).toEqual(far);
    for (const c of near) { expect(c.destroyed).toBe(false); expect(c.visible).toBe(false); }
    // Lay a pipe, and every level goes: built again for the map as it now is.
    g.main[idx(g, 9, 2)] = DIR.N;
    g.rev++;
    layer.sync(g, 1, 0.1);
    for (const c of [...far, ...near]) expect(c.destroyed).toBe(true);
    layer.destroy();
  });
});

