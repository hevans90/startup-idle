/**
 * A lip's throw is the SAME RULE on the host and the device.
 *
 * It was not. `6c995e6` moved the host's `throwOf` from a clamp at nought to a
 * cap on the magnitude, so a west- or north-facing fall could throw at all, and
 * the device's twin in `gpu/state` kept the old clamp. `__cliffCompare` read
 * 1151 lips against 1151 — the lip set agreed — and 769 throws differing, every
 * one negative on the host and nought on the device. So on the path that ships
 * every backward fall hung dead vertical and landed at the foot of its cliff.
 *
 * Nothing caught it because nothing here can run WGSL. What this can do is take
 * the shader's own expressions out of the source, evaluate them with the WGSL
 * built-ins they use, and hold them to the host's functions over inputs that
 * cover both signs and both caps. The browser half of the same check is
 * `__cliffCompare`, whose `ok` already requires `throwDiff === 0`.
 */
import { describe, expect, test } from "bun:test";

import { FALL_THROW, outward, throwOf } from "./falls";
import { sheetSource } from "./gpu/sheet";
import { STATE_WGSL } from "./gpu/state";

/** WGSL's built-ins, as far as these one-line rules use them. */
const BUILTINS = {
  clamp: (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi),
  min: Math.min,
  max: Math.max,
  // `select(f, t, cond)` — the false case FIRST, which is the trap in it.
  select: (f: number, t: number, cond: boolean) => (cond ? t : f),
};

/** The body of a one-line `fn name(...) -> f32 { return EXPR; }`, as JS. */
function wgslFn(source: string, name: string, params: string[]) {
  const m = source.match(
    new RegExp(`fn ${name}\\([^)]*\\)\\s*->\\s*f32\\s*\\{\\s*return ([^;]+);\\s*\\}`),
  );
  if (!m) throw new Error(`no one-line fn ${name} in the shader source`);
  // Float literals read the same in both languages: `3.0`, `-3.0`, `0.0`.
  const body = m[1];
  const f = new Function(...Object.keys(BUILTINS), ...params, `return ${body};`);
  return (...args: unknown[]) => f(...Object.values(BUILTINS), ...args) as number;
}

/** Both signs, both caps, nought, and the cap's neighbourhood. */
const SPEEDS = [
  -10, -FALL_THROW - 0.5, -FALL_THROW, -FALL_THROW + 0.01, -1.44, -0.03, -1e-6,
  0, 1e-6, 0.03, 1.44, FALL_THROW - 0.01, FALL_THROW, FALL_THROW + 0.5, 10,
];

describe("the throw at a lip", () => {
  const device = wgslFn(STATE_WGSL, "throwOf", ["speed"]);

  test("the device's throwOf is the host's, at every speed", () => {
    for (const s of SPEEDS) expect(device(s)).toBe(throwOf(s));
  });

  test("and a backward lip throws backward, on both", () => {
    // The fault itself, stated directly: a negative speed is a negative throw.
    expect(throwOf(-1.44)).toBeLessThan(0);
    expect(device(-1.44)).toBeLessThan(0);
    expect(device(-10)).toBe(-FALL_THROW);
  });
});

describe("a sheet never throws back into the rock", () => {
  const device = wgslFn(sheetSource(), "outward", ["v", "rev"]);

  test("the device's outward is the host's, both ways round", () => {
    for (const s of SPEEDS) {
      for (const back of [false, true]) expect(device(s, back)).toBe(outward(s, back));
    }
  });

  test("and the sheet applies it along the axis and nowhere else", () => {
    // Only the ALONG component is clamped; the across one keeps its sign. A
    // presence test, because the arithmetic is above and this is the wiring.
    const src = sheetSource();
    expect(src).toContain("select(v, outward(v, rev), axis == 0)");
    expect(src).toContain("select(v, outward(v, rev), axis == 1)");
    for (const w of ["axThrow = alongX(", "ayThrow = alongY(", "bxThrow = alongX(", "byThrow = alongY("]) {
      expect(src).toContain(w);
    }
  });
});
