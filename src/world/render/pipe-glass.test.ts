/**
 * THE GLASS SECTIONS: where they go, the mesh a window is, what is written
 * into it each frame, and the shader's two dialects. What the shader makes
 * of it is looked at in the gallery (`?world=1&fixture=glass`).
 * @see pipe-glass, mains-layer glassSpans, plans/pipe-network.md phase 11
 */
import { describe, expect, test } from "bun:test";
import { Container, Mesh } from "pixi.js";

import { DIR, NEIGHBOUR } from "../../iso/dir";
import { applyFixture, GALLERY } from "../debug/fixtures";
import { MAIN_END, createGrid, idx, type Grid } from "../grid";
import { HW } from "../iso";
import { createBandLayer } from "./bands";
import { glassOverride, setGlassOverride } from "./glass-state";
import { GLASS_LONG, createMainsLayer, glassSpans } from "./mains-layer";
import { GLASS_WORDS, PANE_VERTS, glassFragmentGlsl, glassMesh, glassPane, glassShaderSource, writeGlass } from "./pipe-glass";

/** The join toward a step, by what the map calls that side. */
const toward = (dx: number, dy: number) => DIR[(["N", "E", "S", "W"] as const).find((sd) => NEIGHBOUR[sd][0] === dx && NEIGHBOUR[sd][1] === dy)!];
const BACK = toward(-1, 0), ON = toward(1, 0), UPV = toward(0, -1), DOWNV = toward(0, 1);

/** A main along u at row `y` from `x0`, `n` tiles, capped at both ends; at a height, or one a tile. */
function run(g: Grid, x0: number, y: number, n: number, height: (k: number) => number = () => 4) {
  for (let k = 0; k < n; k++) {
    const i = idx(g, x0 + k, y);
    g.main[i] = (k > 0 ? BACK : 0) | (k < n - 1 ? ON : 0);
    g.height[i] = height(k);
  }
  g.mainEnd[idx(g, x0, y)] = MAIN_END.cap;
  g.mainEnd[idx(g, x0 + n - 1, y)] = MAIN_END.cap;
  g.rev++;
}
const flat = () => { const g = createGrid(40, 12); g.height.fill(4); return g; };

describe("where the glass goes", () => {
  test("one window a tile and a half long in the middle of a straight run of four or more", () => {
    const g = flat();
    // Six tiles capped at both ends: the four between the caps are the straight run.
    run(g, 2, 3, 6);
    const spans = glassSpans(g), cells = [...spans.keys()].sort((a, b) => a - b);
    expect(cells.map((i) => i % g.w)).toEqual([3, 4, 5]);
    const total = cells.reduce((n, i) => n + spans.get(i)!.to - spans.get(i)!.from, 0);
    expect(total).toBeCloseTo(GLASS_LONG, 6);
    // The whole of its middle tile, and the quarter of each neighbour next to it.
    expect([spans.get(idx(g, 3, 3))!.from, spans.get(idx(g, 3, 3))!.to]).toEqual([0.25, 0.5]);
    expect([spans.get(idx(g, 4, 3))!.from, spans.get(idx(g, 4, 3))!.to]).toEqual([-0.5, 0.5]);
    expect([spans.get(idx(g, 5, 3))!.from, spans.get(idx(g, 5, 3))!.to]).toEqual([-0.5, -0.25]);
    // Each piece knows where the whole section begins and ends along the run.
    for (const i of cells) { expect(spans.get(i)!.lo).toBeCloseTo(4 - 0.75, 6); expect(spans.get(i)!.hi).toBeCloseTo(4 + 0.75, 6); }
  });

  test("a shorter run has none", () => {
    const g = flat();
    run(g, 2, 3, 5);
    expect(glassSpans(g).size).toBe(0);
  });

  test("a long run has one more every eight tiles, and never two that touch", () => {
    const g = flat();
    run(g, 2, 3, 30);
    const centres = [...glassSpans(g)].filter(([, s]) => s.from === -0.5 && s.to === 0.5).map(([i]) => i % g.w).sort((a, b) => a - b);
    expect(centres.length).toBe(3);
    for (let k = 1; k < centres.length; k++) expect(centres[k] - centres[k - 1]).toBe(8);
  });

  test("glass is a straight length: a run climbing evenly has one, a run with a kink in it has none there", () => {
    const even = flat(), kinked = flat();
    run(even, 2, 3, 6, (k) => 4 + k);
    run(kinked, 2, 3, 6, (k) => (k < 3 ? 4 : 4 + (k - 2) * 2));
    expect(glassSpans(even).size).toBe(3);
    expect(glassSpans(kinked).size).toBe(0);
  });

  test("a tee breaks a run", () => {
    const g = flat();
    run(g, 2, 3, 7);
    g.main[idx(g, 5, 3)] |= UPV | DOWNV;
    g.main[idx(g, 5, 4)] = UPV | DOWNV;
    g.main[idx(g, 5, 2)] = UPV | DOWNV;
    g.rev++;
    expect(glassSpans(g).size).toBe(0);
  });
});

describe("a window's mesh", () => {
  const at = (m: { f32: Float32Array }, v: number, k: number) => m.f32[v * GLASS_WORDS + k];

  test("is the half of the tube the camera sees, edge to edge, and starts dry", () => {
    const m = glassMesh();
    const pane = glassPane(m, 1, 3, 5, 0.4, 4.5, 5, 0.4, 0.1, 3, 4.5);
    expect(pane).toBe(0);
    expect(m.nv).toBe(PANE_VERTS);
    expect(m.ni).toBe((PANE_VERTS / 2 - 1) * 6);
    for (let v = 0; v < m.nv; v++) {
      // Across: nought at one edge to one at the other, the same at both ends of the window.
      expect(at(m, v, 5)).toBeCloseTo((v >> 1) / (PANE_VERTS / 2 - 1), 6);
      // Along: its place on the map the way it runs.
      expect(at(m, v, 6)).toBeCloseTo(v % 2 ? 4.5 : 3, 5);
      expect([at(m, v, 9), at(m, v, 12)]).toEqual([-1, -1]);
      expect([at(m, v, 13), at(m, v, 14)]).toEqual([3, 4.5]);
    }
  });

  test("carries the two heights the liquid's sum needs: its edge's and the way to the camera's, square to each other", () => {
    const m = glassMesh();
    glassPane(m, 1, 3, 5, 0.4, 4.5, 5, 0.4, 0.1, 3, 4.5);
    const e1h = at(m, 0, 7), e2h = at(m, 0, 8);
    // A level tube: its two across-directions are a unit pair in the plane that has all the height there is.
    expect(e1h * e1h + e2h * e2h).toBeCloseTo(1, 5);
    // Straight at the camera, the sight goes in at e2's height and out at its opposite: across the middle of the bore.
    expect(e2h).toBeGreaterThan(0);
    // The normal half way round is the one toward the camera, and its height is e2's.
    expect(at(m, PANE_VERTS / 2 - 1, 4)).toBeCloseTo(e2h, 5);
    for (let v = 0; v < m.nv; v++) { expect(at(m, v, 7)).toBe(e1h); expect(at(m, v, 8)).toBe(e2h); }
  });

  test("what it shows is written into its own vertices: each end's level on that end's ring", () => {
    const m = glassMesh();
    glassPane(m, 1, 3, 5, 0.4, 4.5, 5, 0.4, 0.1, 3, 4.5);
    glassPane(m, 1, 6, 5, 0.4, 7, 5, 0.4, 0.1, 6, 7);
    const before = m.f32.slice();
    writeGlass(m.f32, m.panes[1], { ends: [{ level: -0.5, film: 0.2 }, { level: 0.5, film: 0.6 }], carried: 3.25, speed: 0.75, slop: 0.4 });
    // The first window is untouched.
    for (let k = 0; k < PANE_VERTS * GLASS_WORDS; k++) expect(m.f32[k]).toBe(before[k]);
    for (let v = PANE_VERTS; v < 2 * PANE_VERTS; v++) {
      const second = v % 2 === 1;
      expect(at(m, v, 9)).toBe(second ? 0.5 : -0.5);
      expect(at(m, v, 12)).toBeCloseTo(second ? 0.6 : 0.2, 6);
      expect([at(m, v, 10), at(m, v, 11), at(m, v, 15)]).toEqual([3.25, Math.fround(0.4), 0.75]);
      // Where it is, and what it is, are as built.
      for (const k of [0, 1, 2, 3, 4, 5, 6, 7, 8, 13, 14]) expect(at(m, v, k)).toBe(before[v * GLASS_WORDS + k]);
    }
  });
});

describe("the glass shader", () => {
  test("both dialects build from the same lines", () => {
    const wgsl = glassShaderSource(), glsl = glassFragmentGlsl();
    expect(glsl).not.toContain("let ");
    for (const mark of ["depth", "body", "onto", "meniscus", "glitter", "foam", "bubble", "lump", "stood", "tide", "rim", "sun", "cut", "fine"]) {
      expect(wgsl).toContain(`let ${mark} =`);
      expect(glsl).toContain(`float ${mark} =`);
    }
    for (const vector of ["liquid", "wall", "inner", "wet", "col"]) expect(glsl).toContain(`vec3 ${vector} =`);
    const numbers = (s: string) => s.match(/-?\d+\.\d+/g);
    expect(numbers(glsl)).toEqual(numbers(wgsl.slice(wgsl.indexOf("fn mainFragment"))));
    expect(wgsl).toContain("@location(4) aC: vec3<f32>");
  });
});

describe("the gallery, shown", () => {
  test("every window is told its state, and showing it builds nothing: the same meshes, written in place", () => {
    const g = createGrid(48, 48);
    applyFixture(g, "glass", 1);
    expect(glassOverride()).not.toBeNull();
    const bands = createBandLayer(g.w, g.h), layer = createMainsLayer(bands, new Container());
    layer.sync(g, 1, 4);
    const groups = () => bands.dynamicOf.flatMap((t) => t.children.filter((c) => c.isRenderGroup));
    const before = groups(), meshes = before.flatMap((c) => c.children.slice());
    expect(meshes.length).toBeGreaterThan(20);
    const data = () => meshes.map((m) => ((m as Mesh).geometry.attributes.aPosition.buffer.data as Float32Array).slice());
    const built = data();
    layer.tick(g, 1, 1000);
    layer.tick(g, 1, 1500);
    expect(groups()).toEqual(before);
    expect(before.flatMap((c) => c.children.slice())).toEqual(meshes);
    const shown = data();
    // Positions as built; levels and how far the pattern has gone, not.
    let moved = 0, levels = new Set<number>();
    shown.forEach((d, k) => {
      for (let o = 0; o < d.length; o += GLASS_WORDS) {
        expect(d[o]).toBe(built[k][o]);
        if (d[o + 10] !== built[k][o + 10]) moved++;
        levels.add(Math.round(d[o + 9] * 100) / 100);
      }
    });
    expect(moved).toBeGreaterThan(100);
    // Empty, a quarter, a half and full are all on show.
    for (const want of [-1, -0.5, 0, 1.3]) expect(levels.has(want)).toBe(true);
    layer.destroy();
    setGlassOverride(null);
  });

  test("the gallery has a window on every one of its runs", () => {
    const g = createGrid(48, 48);
    applyFixture(g, "glass", 1);
    const centres = [...glassSpans(g)].filter(([, s]) => s.from === -0.5 && s.to === 0.5);
    const runs = GALLERY.fills.length * GALLERY.speeds.length * GALLERY.slops.length + GALLERY.slops.length + 3;
    expect(centres.length).toBe(runs);
    // Along u and along v both, and one climbing.
    expect(centres.some(([, s]) => s.ax === 1)).toBe(true);
    expect(centres.some(([, s]) => s.ay === 1)).toBe(true);
    expect(centres.some(([i]) => g.height[i] !== 4)).toBe(true);
    setGlassOverride(null);
    expect(HW).toBeGreaterThan(0);
  });
});
