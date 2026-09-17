/**
 * The host's half of the device path: the arithmetic nobody needs a GPU for.
 *
 * These are pure functions that decide how much gets drawn and whether the
 * device may copy straight into a texture at all. Every one of them fails
 * SILENTLY when it is wrong — a band draws too few quads and water goes
 * missing at the edge of a puddle, or a map shape falls back to the slow path
 * and nothing says so — which is exactly the sort of thing worth pinning.
 */
import { describe, expect, test } from "bun:test";

import { quadCap, roomFor } from "./water-gpu";
import { COLUMNS_PER_TILE } from "../water/field";
import { canCopyOut } from "../../fluid/gpu/state";
import { readReduce, reduceSeed } from "../../fluid/gpu/apply";
import { CLAMP_SLOT, DELTA_SLOT, DEPTH_SLOT, REDUCE_SLOTS, WET_SLOT } from "../../fluid/gpu/state";

/** What `SPARE` is, read off the function rather than imported. */
const SPARE = roomFor(0, 0, 1e9);

describe("how many quads a band is told to draw", () => {
  test("it is what was gathered, plus the growth, plus the spare", () => {
    expect(roomFor(100, 10, 1e9)).toBe(100 + 10 + SPARE);
  });

  test("a band that has not grown gets the spare and no more", () => {
    expect(roomFor(100, 0, 1e9)).toBe(100 + SPARE);
  });

  /**
   * `grew` IS A SIGNED INT32 and it leaks downwards past zero — see the LEAK
   * note on `QuadGather.grew`. A negative one must not SHRINK the draw, which
   * is the arithmetic slip that would take quads off a band that is shedding
   * water rather than leaving it room.
   */
  test("a negative growth is ignored, not subtracted", () => {
    expect(roomFor(100, -40, 1e9)).toBe(100 + SPARE);
    expect(roomFor(100, -40, 1e9)).toBeGreaterThan(100);
  });

  test("and it never asks for more than the band can hold", () => {
    expect(roomFor(100, 10, 105)).toBe(105);
    expect(roomFor(1e6, 1e6, 64)).toBe(64);
  });

  test("an empty band still gets its spare, so a first drop has somewhere to go", () => {
    expect(roomFor(0, 0, 1e9)).toBe(SPARE);
    expect(SPARE).toBeGreaterThan(0);
  });
});

describe("whether the device may copy straight into a texture", () => {
  /**
   * A copy's row must be a multiple of 256 BYTES. A float texel is four bytes
   * and the material's is one, so the same map can take one and refuse the
   * other — which is why this is asked per texture and not once for a layer.
   */
  test("a float row needs the column count to be a multiple of 64", () => {
    expect(canCopyOut(64, 4)).toBe(true);
    expect(canCopyOut(256, 4)).toBe(true);
    expect(canCopyOut(128, 4)).toBe(true);
    expect(canCopyOut(96, 4)).toBe(false);
    expect(canCopyOut(100, 4)).toBe(false);
  });

  test("a byte row needs 256, so a map can take the floats and refuse the bytes", () => {
    expect(canCopyOut(256, 1)).toBe(true);
    expect(canCopyOut(128, 1)).toBe(false);
    // The case the per-texture question exists for.
    expect(canCopyOut(128, 4) && !canCopyOut(128, 1)).toBe(true);
  });

  test("the live map's shape takes both", () => {
    const nx = 64 * COLUMNS_PER_TILE;             // 64 tiles across
    expect(canCopyOut(nx, 4)).toBe(true);
    expect(canCopyOut(nx, 1)).toBe(true);
  });
});

describe("how many quads a band could ever hold", () => {
  test("it is the SHORTER side, because that bounds a diagonal", () => {
    expect(quadCap(64, 64)).toBe(quadCap(64, 200));
    expect(quadCap(40, 64)).toBeLessThan(quadCap(64, 64));
  });

  test("it grows with the map and is never zero on a real one", () => {
    expect(quadCap(8, 8)).toBeGreaterThan(0);
    expect(quadCap(128, 128)).toBeGreaterThan(quadCap(64, 64));
  });

  /**
   * The gather REFUSES a shape whose row is not a multiple of 256 bytes, and
   * falls back to drawing every quad. Worth knowing which shapes those are.
   */
  test("and a square map of tiles gives a row the copy will take", () => {
    for (const tiles of [16, 32, 64, 128]) {
      expect((quadCap(tiles, tiles) * 4) % 256).toBe(0);
    }
  });
});

describe("the reduction, seeded and read back", () => {
  test("the box starts INSIDE OUT, so the first wet cell sets both ends", () => {
    const seed = reduceSeed(256, 128);
    const r = readReduce(seed);
    expect(r.x0).toBe(256);
    expect(r.y0).toBe(128);
    expect(r.x1).toBe(-1);
    expect(r.y1).toBe(-1);
    expect(r.x0).toBeGreaterThan(r.x1);          // which is what inside out means
  });

  test("and everything else starts at nothing", () => {
    const r = readReduce(reduceSeed(64, 64));
    expect(r.deepest).toBe(0);
    expect(r.breaking).toBe(false);
    expect(r.spawned).toBe(0);
    expect(r.cliffN).toBe(0);
    expect(r.clamped).toBe(0);
    expect(r.deltaSum).toBe(0);
    expect(r.wet).toBe(0);
  });

  test("the seed is exactly as long as the buffer", () => {
    expect(reduceSeed(64, 64).length).toBe(REDUCE_SLOTS);
  });

  /**
   * `deepest` travels as the BIT PATTERN of a float, combined with atomicMax —
   * which works only because every depth is non-negative and IEEE bit order
   * matches value order there. Read back the wrong way it is a vast integer.
   */
  test("the deepest column comes back as the float it is, not its bits", () => {
    const raw = reduceSeed(64, 64);
    const bits = new Int32Array(new Float32Array([3.75]).buffer)[0];
    raw[4] = bits;
    expect(readReduce(raw).deepest).toBeCloseTo(3.75, 6);
    expect(bits).not.toBeCloseTo(3.75, 6);       // it really is a different number
  });

  test("and bit order matches value order, which is what atomicMax relies on", () => {
    const bitsOf = (v: number) => new Int32Array(new Float32Array([v]).buffer)[0];
    let last = -1;
    for (const v of [0, 0.001, 0.5, 1, 3.75, 100, 1e6]) {
      const b = bitsOf(v);
      expect(b).toBeGreaterThan(last);
      last = b;
    }
  });

  test("the fixed-point tallies come back scaled, not raw", () => {
    const raw = reduceSeed(64, 64);
    raw[CLAMP_SLOT] = 1000;
    raw[DELTA_SLOT] = 2000;
    raw[WET_SLOT] = 37;
    raw[DEPTH_SLOT] = 4000;
    const r = readReduce(raw);
    expect(r.clamped).not.toBe(1000);            // divided by its scale
    expect(r.deltaSum).not.toBe(2000);
    expect(r.wet).toBe(37);                      // a count, not fixed point
  });
});
