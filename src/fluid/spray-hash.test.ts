/**
 * The spray's scatter has to be the SAME NUMBER on a CPU and a GPU.
 *
 * It did not used to be, and could not have been. `shedSpray` picked where on
 * the sheet a drop left from with the hash everybody writes in a shader —
 * `fract(sin(frontSpeed * 12.9898 + k * 78.233) * 43758.5453)` — and that
 * cannot survive the crossing: JavaScript does it in f64 and WGSL in f32, and
 * the argument runs to millions. At edge 100000 it is 7823462.3725 one side
 * and 7823462.5 exactly the other, before `sin` is even reached.
 *
 * So the hash is integer now, and the tests below are about the two properties
 * that buys: every step is exact in both languages, and the result does not
 * depend on the width of the float doing the arithmetic.
 *
 * WHAT THESE CANNOT DO is run the WGSL. `bun test` has no device, so the twin
 * in `state.ts` is checked against this one by the browser harness — see
 * `__sprayCompare`. What is provable here is that the JS side is exact and
 * width-independent, which is the half that used not to be.
 */
import { describe, expect, test } from "bun:test";

import { scatterOf } from "./falls";
import { STATE_WGSL } from "./gpu/state";

/**
 * The shader's own arithmetic, stepped through in f32 at every stage.
 *
 * Not a reimplementation for its own sake: it is the question the old hash
 * failed. If `scatterOf` agrees with a version where every intermediate has
 * been rounded to f32, then the f32 device and the f64 host reach the same
 * number, which is the whole claim.
 */
function inF32(k: number, speed: number, salt: number): number {
  const one = new Float32Array(1);
  one[0] = speed;
  const bits = new Uint32Array(one.buffer)[0];
  // u32 multiply wraps, and `Math.imul` is that operation exactly.
  let h = (bits ^ Math.imul(k, 0x9e3779b9) ^ Math.imul(salt, 0x632be5ab)) >>> 0;
  h = (Math.imul(h ^ (h >>> 16), 0x85ebca6b)) >>> 0;
  h = (Math.imul(h ^ (h >>> 13), 0xc2b2ae35)) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  // f32(h >> 8) / 16777216 — and BOTH are exact in an f32: 24 bits fits the
  // mantissa and the divisor is a power of two.
  one[0] = h >>> 8;
  one[0] = one[0] / 16777216;
  return one[0];
}

describe("the spray's scatter", () => {
  test("is the same number whether the arithmetic is f32 or f64", () => {
    // Across the range an edge index really reaches — a 512 square map is half
    // a million columns, so a million edges.
    for (const k of [0, 1, 2, 17, 1023, 65535, 100000, 524287, 1048575]) {
      for (const speed of [0, 0.5, 12.5, -3.25, 91.125, 1e-7]) {
        for (const salt of [0, 1]) {
          expect(scatterOf(k, speed, salt)).toBe(inF32(k, speed, salt));
        }
      }
    }
  });

  test("and the old sin hash was NOT — which is why this one exists", () => {
    // The instrument, pointed at what it replaced. If this ever passes, f32
    // and f64 agree about the old hash after all and the change was pointless.
    const k = 100000, speed = 12.5;
    const f64 = (() => {
      const w = Math.sin(speed * 12.9898 + k * 78.233) * 43758.5453;
      return w - Math.floor(w);
    })();
    const f32 = (() => {
      const one = new Float32Array(1);
      one[0] = speed * 12.9898 + k * 78.233;
      one[0] = Math.sin(one[0]) * 43758.5453;
      return one[0] - Math.floor(one[0]);
    })();
    expect(Math.abs(f64 - f32)).toBeGreaterThan(0.1);
  });

  test("lands in [0, 1) and spreads across it", () => {
    const seen = new Array(10).fill(0);
    for (let k = 0; k < 4000; k++) {
      const u = scatterOf(k, 7.5 + k * 0.01);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      seen[Math.floor(u * 10)]++;
    }
    // Not a test of randomness — a test that it is not a constant, and not
    // stuck in a corner. Even bins would be 400 each.
    for (const n of seen) expect(n).toBeGreaterThan(200);
  });

  test("the salt gives two different draws from one state", () => {
    // `shedSpray` needs both: one picks how far down the sheet the drop left
    // from, the other which way it fans. Handed the same number they would be
    // locked together, and every drop would fan the way its height said.
    let same = 0;
    for (let k = 0; k < 500; k++) {
      if (Math.abs(scatterOf(k, 3.25) - scatterOf(k, 3.25, 1)) < 1e-6) same++;
    }
    expect(same).toBe(0);
  });

  test("the shader carries the same constants, written once each", () => {
    // The twin cannot be run here, but it can be READ. A constant changed on
    // one side and not the other is the failure this port keeps having, and
    // it is silent — the drops simply land somewhere else.
    for (const c of ["0x9e3779b9u", "0x632be5abu", "0x85ebca6bu", "0xc2b2ae35u"]) {
      expect(STATE_WGSL).toContain(c);
    }
    expect(STATE_WGSL).toContain("f32(h >> 8u) / 16777216.0");
  });
});
