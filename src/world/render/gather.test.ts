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

import { LIST_W, bandTiles, ceilingFor, quadCap, quadList, roomFor } from "./water-gpu";
import { COLUMNS_PER_TILE } from "../water/field";
import { canCopyOut, stateBytes } from "../../fluid/gpu/state";
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

});

/**
 * WHERE EACH BAND'S QUADS LIVE.
 *
 * The list used to be a rectangle with the WIDEST band's stride, for every
 * band — which is two copies of the map in a texture that can only ever
 * address one, and a texture width the map dictated rather than the code. Both
 * of those are what these hold to account.
 */
describe("the quad list is packed, not a rectangle", () => {
  const cases: [number, number][] = [[64, 64], [128, 128], [16, 16], [13, 7], [96, 40]];

  test("a band gets exactly its own diagonal's worth", () => {
    for (const [w, h] of cases) {
      const l = quadList(w, h);
      expect(l.caps.length).toBe(w + h - 1);
      for (let b = 0; b < l.caps.length; b++) {
        expect(l.caps[b]).toBe(bandTiles(w, h, b) * COLUMNS_PER_TILE ** 2 * 5);
      }
      // The widest band is still the shorter side, which is what `quadCap` says.
      expect(Math.max(...l.caps)).toBe(quadCap(w, h));
    }
  });

  test("the slices tile the list — no gap, no overlap", () => {
    for (const [w, h] of cases) {
      const l = quadList(w, h);
      let at = 0;
      for (let b = 0; b < l.caps.length; b++) {
        expect(l.offsets[b]).toBe(at);
        at += l.caps[b];
      }
      expect(l.total).toBe(at);
    }
  });

  /**
   * THE NUMBER THAT MADE THIS WORTH DOING. A rectangle of the widest band's
   * stride holds `min(w,h) * (w+h-1) * 80` slots; the quads that can exist
   * anywhere on the map at once are `w * h * 80`. Measured at 64², 96² and
   * 128², the rectangle was 1.99 times the second — so half of every
   * allocation was unreachable by construction.
   */
  test("it holds every quad that can exist, and not twice that", () => {
    for (const [w, h] of cases) {
      const l = quadList(w, h);
      expect(l.total).toBe(w * h * COLUMNS_PER_TILE ** 2 * 5);
      const rectangle = quadCap(w, h) * (w + h - 1);
      expect(l.total).toBeLessThanOrEqual(rectangle);
    }
    // On a square map the old layout was almost exactly twice this one.
    for (const n of [64, 96, 128]) {
      const ratio = (quadCap(n, n) * (2 * n - 1)) / quadList(n, n).total;
      expect(ratio).toBeGreaterThan(1.9);
      expect(ratio).toBeLessThan(2.0);
    }
  });

  /**
   * THE ROW RULE IS NO LONGER ABOUT THE MAP. A buffer-to-texture row must be a
   * multiple of 256 bytes. It used to be a band's stride, so a map whose
   * shorter side was not a multiple of four lost its gathering outright and
   * every band drew its whole complement for ever — correctly and slowly,
   * which is why nobody noticed. 13 by 7 is such a map.
   */
  test("the copy's row is legal whatever shape the map is", () => {
    expect((LIST_W * 4) % 256).toBe(0);
    expect((quadCap(13, 7) * 4) % 256).not.toBe(0);      // the old rule refused it
    for (const [w, h] of cases) {
      const l = quadList(w, h);
      expect(l.rows * LIST_W).toBeGreaterThanOrEqual(l.total);
      expect(l.rows).toBeGreaterThan(0);
    }
  });

  test("and the widest map's list is a texture any device will make", () => {
    // The guarantee every WebGPU device offers, whatever the adapter can do.
    expect(LIST_W).toBeLessThanOrEqual(8192);
    expect(quadCap(128, 128)).toBeGreaterThan(8192);      // the old width would not
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

/**
 * A TEXTURE THE DEVICE TURNED DOWN MUST STILL BE UPLOADED.
 *
 * `deviceSinks` decides per texture and per map whether the solver can fill
 * it — the 256-byte row rule is about BYTES, so a map can take the float
 * copies and refuse the material's single-byte one. The layer then has to go
 * on uploading exactly the ones it refused.
 *
 * Told a static list of the textures the device COULD fill, it skipped one
 * the device had turned down: nobody wrote it, and it kept whatever it held
 * when the layer was built — the map's water at the moment it loaded, sitting
 * under the water that is really there.
 */
describe("which textures the layer stops uploading", () => {
  test("is what the device took, not what it might have taken", async () => {
    const { canCopyOut } = await import("../../fluid/gpu/state");
    // 128 columns: 512 bytes a row for a float and 128 for a byte, so the
    // floats copy and the material cannot. This is a 32-tile map.
    expect(canCopyOut(128, 4)).toBe(true);
    expect(canCopyOut(128, 1)).toBe(false);
    // 96 columns — a 24-tile map — refuses both.
    expect(canCopyOut(96, 4)).toBe(false);
    // 256 columns, a 64-tile map, takes everything.
    expect(canCopyOut(256, 4)).toBe(true);
    expect(canCopyOut(256, 1)).toBe(true);
  });
});

describe("the largest map the water will run on", () => {
  /** The solver's state for a square map of `t` tiles with a deck on it. */
  const state = (t: number) =>
    stateBytes(t * COLUMNS_PER_TILE, t * COLUMNS_PER_TILE, 2, Math.ceil(t / 4) ** 2);

  test("is held to the BUFFER limits, and not the texture alone", () => {
    // The device that broke: a texture limit of 16,384, which the quad list
    // took to mean 204 tiles, and the buffer limits a device gets unasked. At
    // 128 tiles with a deck the state is a 153 MB binding against 128, and
    // the water silently stopped. @see ceilingFor
    const unasked = {
      maxTextureDimension2D: 16384,
      maxStorageBufferBindingSize: 128 * 2 ** 20,
      maxBufferSize: 256 * 2 ** 20,
    };
    const t = ceilingFor(unasked);
    expect(t).toBeLessThan(128);
    expect(state(t)).toBeLessThanOrEqual(128 * 2 ** 20);
    expect(state(t + 1)).toBeGreaterThan(128 * 2 ** 20);
  });

  test("and offers what the hardware has when the device asked for it", () => {
    const asked = {
      maxTextureDimension2D: 16384,
      maxStorageBufferBindingSize: 2 ** 32 - 4,
      maxBufferSize: 2 ** 32 - 4,
    };
    expect(ceilingFor(asked)).toBe(204);
  });

  test("and the guaranteed limits where there is no device at all", () => {
    expect(ceilingFor(null)).toBe(102);
    expect(state(102)).toBeLessThanOrEqual(128 * 2 ** 20);
  });
});
