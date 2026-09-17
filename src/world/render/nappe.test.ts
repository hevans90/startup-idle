/**
 * The nappe's rules, and the one copy of them.
 *
 * `fluid/gpu/sheet` builds the sheets on the device and used to carry its own
 * hand-typed WGSL copy of all of this — every constant retyped as a literal,
 * nothing comparing the two. What these guard is that the shader is PRINTED
 * from the statements here, so a change to one of the constants below cannot
 * reach the host and miss the device.
 */
import { describe, expect, test } from "bun:test";

import {
  AERATED, FALL_REACH, FRAY, SPRAYED, breakingAt, sheetAt, sheetRuleSource, thinAt,
} from "./nappe";
import { SHADES, SHOW_DEPTH, SOLID_FLOOR, SOLID_RANGE, TINTS } from "./water";
import { BREAK } from "../../fluid/falls";

describe("the sheet's rules as arithmetic", () => {
  test("a sheet leaves its lip at full thickness and thins from there", () => {
    expect(thinAt(0)).toBe(1);
    expect(thinAt(FALL_REACH)).toBeCloseTo(1 / Math.SQRT2, 12);
    expect(thinAt(-5)).toBe(1);                     // above the lip is not a fall
  });

  test("breaking starts at BREAK and is complete one BREAK later", () => {
    expect(breakingAt(BREAK)).toBe(0);
    expect(breakingAt(BREAK * 2)).toBe(1);
    expect(breakingAt(BREAK * 10)).toBe(1);         // and does not keep going
    expect(breakingAt(0)).toBe(0);
  });

  test("a sheet loses body to fraying and gains white, both bounded", () => {
    const near = sheetAt(2, 0);
    expect(near.body).toBeCloseTo(2, 12);           // at the lip it is the lip
    expect(near.white).toBe(0);
    const far = sheetAt(2, BREAK * 4);
    expect(far.body).toBeLessThan(near.body);
    expect(far.white).toBeGreaterThan(0);
    expect(far.white).toBeLessThanOrEqual(1);
  });
});

/**
 * THE GENERATED SOURCE. These cannot check that the WGSL computes the same
 * numbers — that needs a device — so they check the thing that actually went
 * wrong, which is a constant getting retyped and then drifting.
 */
describe("the sheet's rules as shader source", () => {
  const src = sheetRuleSource();

  test("every constant comes from the statement, not from a literal", () => {
    for (const v of [FALL_REACH, BREAK, FRAY, SPRAYED, AERATED,
                     SOLID_FLOOR, SOLID_RANGE, SHOW_DEPTH]) {
      const wgsl = Number.isInteger(v) ? `${v}.0` : `${v}`;
      expect(src).toContain(wgsl);
    }
    // The two ramp lengths arrive already decremented, as the shader wants.
    expect(src).toContain(`${SHADES - 1}.0`);
    expect(src).toContain(`${TINTS - 1}.0`);
  });

  test("it declares what the sheet pass calls, and declares it once", () => {
    const names = [...src.matchAll(/fn\s+(\w+)\s*\(/g)].map((m) => m[1]);
    for (const n of ["thinAt", "breakingAt", "shadeOf", "sheetLook"]) {
      expect(names).toContain(n);
    }
    expect(new Set(names).size).toBe(names.length);
  });

  test("and it is WGSL, not the host's own language", () => {
    expect(src).toContain("-> f32");
    expect(src).not.toContain("Math.");
    expect(src).not.toContain("float ");
  });

  /**
   * THE ONE THAT CAUGHT SOMETHING. WGSL's `round` breaks a tie to the nearest
   * EVEN integer; `Math.round` breaks it upwards. Measured on the device, they
   * disagree on 0.5, 2.5, 4.5 and -1.5 — and `floor(x + 0.5)` agreed with
   * `Math.round` on all eight values tried. The sheet pass files a piece into
   * a band by rounding, and a tie is reachable whenever a lip's throw is zero
   * on an axis, which `throwOf` gives for any flow running the other way.
   */
  test("nothing in the generated source rounds with WGSL's round", () => {
    expect(src).not.toMatch(/\bround\s*\(/);
  });
});
