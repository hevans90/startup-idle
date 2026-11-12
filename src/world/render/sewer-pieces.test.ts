/**
 * THE SEWERS' SURFACE PIECES, as solids on the pipe mesh: what each is made
 * of and in what order it is built, since a mesh paints in that order.
 * @see sewer-layer, plans/pipe-network.md phases 7 and 9
 */
import { describe, expect, test } from "bun:test";

import { HW } from "../iso";
import { CONTACT, MATERIAL, WORDS, ZT, pipeMesh, type PipeMesh } from "./pipe-mesh";
import { COVER_SURROUND, GRATE_SURROUND, cover, grate, headwall, pier, portal, surround } from "./sewer-layer";

const xs = (m: PipeMesh, from = 0, to = m.nv) => Array.from({ length: to - from }, (_, k) => m.f32[(from + k) * WORDS]);
const width = (m: PipeMesh, from = 0, to = m.nv) => Math.max(...xs(m, from, to)) - Math.min(...xs(m, from, to));
const colours = (m: PipeMesh) => new Set(Array.from({ length: m.nv }, (_, v) => m.u32[v * WORDS + 5] & 0xffffff));
const materials = (m: PipeMesh) => new Set(Array.from({ length: m.nv }, (_, v) => m.f32[v * WORDS + 8]));
const alphas = (m: PipeMesh) => new Set(Array.from({ length: m.nv }, (_, v) => m.u32[v * WORDS + 5] >>> 24));

describe("the sewers' surface pieces", () => {
  test("a cover and a grate are each set in a concrete surround, wider than the ironwork and built first", () => {
    for (const [piece, half] of [[cover, COVER_SURROUND], [grate, GRATE_SURROUND]] as const) {
      const alone = pipeMesh(), set = pipeMesh();
      surround(alone, 1, 5, 5, 2, half);
      piece(set, 1, 5, 5, 2);
      expect(set.nv).toBeGreaterThan(alone.nv);
      // The surround's vertices are the first written, and nothing after them is wider.
      for (let k = 0; k < alone.nv * WORDS; k++) expect(set.f32[k]).toBe(alone.f32[k]);
      expect(width(set, alone.nv)).toBeLessThan(width(set, 0, alone.nv));
      // A square of it, half a tile or so across: (u − v)·HW from corner to corner.
      expect(width(alone)).toBeCloseTo((half + 0.018) * 4 * HW, 3);
    }
  });

  test("a pier stands on a footing, with its contact on the ground under it", () => {
    const m = pipeMesh();
    pier(m, 1, 5, 5, 0, 3 * ZT);
    expect(alphas(m).has(Math.round(CONTACT * 255))).toBe(true);
    expect(materials(m).has(MATERIAL.concrete)).toBe(true);
    // Too low to stand a pier under: nothing.
    const none = pipeMesh();
    pier(none, 1, 5, 5, 0, 0.01);
    expect(none.nv).toBe(0);
  });

  test("a portal is a concrete collar wider than its tube, a coping on it, and the dark the tube comes out of", () => {
    const m = pipeMesh(), r = 0.15;
    portal(m, 1, 5, 5, 1, 1, 0, r);
    expect(materials(m).has(MATERIAL.concrete)).toBe(true);
    expect(colours(m).size).toBe(3);
    // Across a tube along u it is wide in v: more than the tube's own width on the screen.
    expect(width(m)).toBeGreaterThan(2 * r * HW);
    // Facing away from the camera, the dark of its mouth is not drawn.
    const away = pipeMesh();
    portal(away, 1, 5, 5, 1, -1, 0, r);
    expect(away.nv).toBeLessThan(m.nv);
  });

  test("a headwall has an apron out to the bank's edge and a stain where it pours — down its face too, where that shows", () => {
    const toward = pipeMesh(), away = pipeMesh();
    headwall(toward, 1, 5, 5, 2, 1, 0, 0.09);
    headwall(away, 1, 5, 5, 2, -1, 0, 0.09);
    // The stain is a colour of its own, in both; toward the camera there is more of it: the wall's face as well as the apron.
    // Concrete, its darker coping and pipe, the stain, and the dark of the bore.
    expect(colours(toward).size).toBe(4);
    const count = (m: PipeMesh, c: number) => Array.from({ length: m.nv }, (_, v) => m.u32[v * WORDS + 5] & 0xffffff).filter((k) => k === c).length;
    const shared = [...colours(toward)].filter((c) => colours(away).has(c));
    expect(shared.some((c) => count(toward, c) > count(away, c) && count(away, c) > 0)).toBe(true);
    // The apron reaches the tile's edge on the side it pours: half a tile out from the middle.
    expect(Math.max(...xs(toward)) / HW).toBeGreaterThan(0.5 - 0.2 - 0.01);
  });
});
