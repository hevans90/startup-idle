/**
 * The corner rule.
 *
 * Two of these matter. The first is what the rule DOES, which the mesh builder
 * depends on. The second is that the two shader dialects are still the same
 * program — the whole reason the rule lives in one file is that it was written
 * out three times and the third one was wrong.
 */
import { describe, expect, test } from "bun:test";

import { cornerRuleSource, resolveCorner, resolveSide } from "./corner-rule";

describe("what height a corner is drawn at", () => {
  test("on level ground it is simply the mean of what meets there", () => {
    // Four columns on one bed, no low group at all.
    const c = resolveCorner(10 + 11 + 12 + 13, 4, 0, 0, 0);
    expect(c.high).toBeCloseTo(11.5, 6);
    // A corner with nothing below it answers the same either way.
    expect(c.low).toBe(c.high);
  });

  test("a sheet on a plateau and the lake below its cliff stay apart", () => {
    // The case the split exists for. The lake's surface is at 3 and the
    // plateau's floor at 10 — seven half steps of AIR between them — so they
    // are two bodies of water and no single height serves both. Averaged, the
    // sheet's edge runs down into the rock.
    const c = resolveCorner(10.5, 1, 3 + 3 + 3, 3, 10);
    expect(c.high).toBeCloseTo(10.5, 6);
    expect(c.low).toBeCloseTo(3, 6);
  });

  test("but a dip in the bed under one pool is one body, at one height", () => {
    // Drowned under twenty half steps, the water on the low bed reaches well
    // over the high one: there is no air anywhere and it is one sheet. Split,
    // the columns either side of the dip draw the same corner at two heights
    // differing by the surface's own ripple, and a corner that does not agree
    // with itself is a crack — nine pixels of grass through the water.
    const c = resolveCorner(30.2, 1, 30.0 + 29.9 + 30.1, 3, 10);
    expect(c.high).toBe(c.low);
    // And it is the mean over ALL of them, not either group's own.
    expect(c.high).toBeCloseTo((30.2 + 30.0 + 29.9 + 30.1) / 4, 6);
  });

  test("the low water reaching exactly the high bed is already one body", () => {
    // The boundary goes to merged: at equality there is no air left.
    const c = resolveCorner(12, 1, 10, 1, 10);
    expect(c.high).toBe(c.low);
  });
});

describe("how far down the side of a body of water reaches", () => {
  /** A corner at one height, which is every corner on level ground. */
  const flat = (h: number, bed: number) => [h, h, bed] as const;

  test("down to its own bed, and no further, over dry ground", () => {
    // It used to run down to whatever the NEIGHBOUR stood on, so a pond on a
    // plateau painted itself over the whole cliff beneath it — and the higher
    // the ground, the more of the cliff it covered, because the excess was
    // exactly the height of the drop.
    const s = resolveSide(10, 0, false, ...flat(12, 10), ...flat(12, 10));
    expect(s.floorA).toBe(10);
    expect(s.topA).toBe(12);
  });

  test("down to the corner the NEIGHBOUR draws, when there is water there", () => {
    // Matched end for end to what is actually drawn next door, it cannot leave
    // a gap by construction. The rule it replaced — skip the side wherever the
    // water next door reaches this column's bed — tore along every step of a
    // staircase: 2.7% of the ground under interior water showed through.
    const s = resolveSide(10, 8, true, ...flat(11, 8), ...flat(11, 8));
    // The neighbour on bed 8 draws this corner at 11, so the side stops there.
    expect(s.floorA).toBe(11);
    expect(s.topA).toBe(11);
  });

  test("and a side that is not there comes back flat, not missing", () => {
    // A neighbour standing higher than this column's surface hides nothing and
    // is hidden by nothing: the face has no height. Flat rather than absent so
    // the shader can draw it regardless and make no fragments.
    const s = resolveSide(0, 20, true, ...flat(24, 20), ...flat(24, 20));
    expect(s.topA).toBe(s.floorA);
    expect(s.topB).toBe(s.floorB);
  });

  test("each end answers for itself", () => {
    // One end against deep water and the other against a dry drop is the
    // ordinary case at the corner of a pool, and the face is a wedge.
    const s = resolveSide(10, 6, true, 14, 14, 10, 11, 11, 6);
    expect(s.floorA).not.toBe(s.floorB);
  });
});

describe("the two shader dialects are the same program", () => {
  /**
   * Both, reduced to what they have in common.
   *
   * Types are the only thing allowed to differ. Declaration keywords collapse
   * to one token, and a function header collapses to its NAME and the NAMES of
   * its parameters in order — so a renamed function, a reordered parameter or
   * any change at all to a body still fails. Everything else has to match
   * character for character: every expression, every constant, every branch.
   * WGSL and GLSL cannot drift apart while this holds.
   */
  const skeleton = (src: string) =>
    src
      // fn name(a: T, b: T) -> T {
      .replace(/fn (\w+)\(([^)]*)\)\s*->\s*[^{]*\{/g, (_m, name: string, args: string) =>
        `HEAD ${name}(${args.split(",").map((a) => a.split(":")[0].trim()).join(",")}) {`)
      // T name(T a, T b) {
      .replace(/\b(?:float|vec4|int|bool|void)\s+(\w+)\(([^)]*)\)\s*\{/g, (_m, name: string, args: string) =>
        `HEAD ${name}(${args.split(",").map((a) => a.trim().split(/\s+/).pop()).join(",")}) {`)
      .replace(/vec4<f32>/g, "vec4")
      .replace(/\b(var|let|float|int)\b/g, "T")
      .replace(/\s+/g, " ")
      .trim();

  test("they differ in nothing but their keywords", () => {
    expect(skeleton(cornerRuleSource("glsl"))).toBe(skeleton(cornerRuleSource("wgsl")));
  });

  test("and each is written in its own language, not the other's", () => {
    const wgsl = cornerRuleSource("wgsl"), glsl = cornerRuleSource("glsl");
    expect(wgsl).toContain("fn cornerOf(vx: i32, vy: i32) -> vec4<f32>");
    expect(wgsl).toContain("fn resolveSide(bed: f32, bedJ: f32, wetJ: bool");
    expect(glsl).toContain("vec4 cornerOf(int vx, int vy)");
    expect(glsl).toContain("vec4 resolveSide(float bed, float bedJ, bool wetJ");
    expect(glsl).not.toContain("<f32>");
    expect(wgsl).not.toContain("float ");
  });

  test("and both carry the merge, which is the thing that went missing", () => {
    for (const d of ["wgsl", "glsl"] as const) {
      expect(cornerRuleSource(d)).toContain("nHi > 0.0 && nLo > 0.0 && mLo >= bed");
    }
  });
});
