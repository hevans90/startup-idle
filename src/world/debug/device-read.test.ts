/**
 * The two things in `device-read` that can be wrong without a device: the row
 * padding, and the counting.
 *
 * The padding because the 256-byte row rule has already cost this repository
 * two bugs — a gathering that silently gave up on maps whose side was not a
 * multiple of four, and a material texture that could not be copied at 128
 * columns — and an instrument that unpacks its rows wrongly reports numbers
 * that look plausible and are about the wrong columns.
 *
 * The counting because it is the whole point of the instrument, and the
 * distinction it draws — wet on the DEVICE with no id, against wet on the HOST
 * with no id — is exactly the one every previous probe collapsed.
 */
import { describe, expect, test } from "bun:test";

import { createColumnField } from "../../fluid/columns";
import { accountDecks, padded, strideFor, unpad } from "./device-read";

describe("the row padding", () => {
  test("a stride is a whole number of 256-byte rows, and never short", () => {
    for (const nx of [1, 16, 63, 64, 96, 128, 129, 256]) {
      expect(strideFor(nx) % 256).toBe(0);
      expect(strideFor(nx)).toBeGreaterThanOrEqual(nx * 4);
      expect(strideFor(nx) - nx * 4).toBeLessThan(256);
    }
  });

  test("64 columns of float need no padding and 96 do", () => {
    // The two cases `canCopyOut` separates, from the other side: the copy IN
    // cannot serve 96 columns and this read back can.
    expect(strideFor(64)).toBe(256);
    expect(strideFor(96)).toBe(512);
  });

  test("a padded round trip is the identity, on a width that needs padding", () => {
    const nx = 96, rows = 5;
    const data = new Float32Array(nx * rows);
    for (let i = 0; i < data.length; i++) data[i] = i * 0.25 - 3;
    const raw = padded(data, nx, rows, strideFor(nx));
    expect(raw.length).toBe(strideFor(nx) * rows);
    expect(Array.from(unpad(raw, nx, rows, strideFor(nx)))).toEqual(Array.from(data));
  });

  test("unpad reads past the pad, not through it", () => {
    // A row's tail is whatever the driver left there. Counted as data it would
    // show up as water in columns that do not exist.
    const nx = 3, rows = 2, stride = 256;
    const raw = new Uint8Array(stride * rows).fill(0xff);
    const view = new Float32Array(raw.buffer);
    view[0] = 1; view[1] = 2; view[2] = 3;
    view[stride / 4] = 4; view[stride / 4 + 1] = 5; view[stride / 4 + 2] = 6;
    expect(Array.from(unpad(raw, nx, rows, stride))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("a view is taken at the offset it was handed, not at zero", () => {
    // `getMappedRange` gives a buffer that need not start at the copy.
    const nx = 2, rows = 2, stride = 256;
    const backing = new Uint8Array(stride * rows + 512);
    const raw = backing.subarray(512);
    const view = new Float32Array(backing.buffer, 512);
    view[0] = 7; view[1] = 8;
    view[stride / 4] = 9; view[stride / 4 + 1] = 10;
    expect(Array.from(unpad(raw, nx, rows, stride))).toEqual([7, 8, 9, 10]);
  });
});

/**
 * A two-storey field, every column carrying a deck.
 *
 * The deck's water stands on slot 1 under the open sky — a fresh field's roof
 * is `OPEN_SKY` already — and the channel it spans is slot 0 with the soffit
 * over it. What makes the column storeyed is that slot 1 EXISTS.
 */
function decked(nx = 4, ny = 4) {
  const f = createColumnField(nx, ny, undefined, 1, 2);
  for (let i = 0; i < f.cells; i++) {
    f.roof[i] = 3;              // the soffit over the channel
    f.ground[f.cells + i] = 4;  // the road on top of the span
  }
  return f;
}

describe("the deck account", () => {
  test("counts the columns the two copies do not agree are wet", () => {
    const f = decked();
    const cells = f.cells, dry = f.params.dryDepth;
    const dev = new Float32Array(cells * f.layers);
    // Column 0: wet on the device, dry in the host's copy — a front moving
    // ONTO the deck that the readback has not caught up with.
    dev[cells + 0] = dry * 10;
    // Column 1: the host's copy still has water the device has let go — a
    // front moving OFF.
    f.depth[cells + 1] = dry * 10;
    // Column 2: agreed. Nothing to report.
    dev[cells + 2] = dry * 10;
    f.depth[cells + 2] = dry * 10;

    const a = accountDecks(f, dev);
    expect(a.deckColumns).toBe(cells);
    expect(a.deviceWetHostDry).toBe(1);
    expect(a.hostWetDeviceDry).toBe(1);
    expect(a.ok).toBe(false);
    expect(a.examples[0]).toMatchObject({ cx: 0, cy: 0, a: 1 });
  });

  test("a map the two copies agree about is clean", () => {
    const f = decked();
    const dev = new Float32Array(f.cells * f.layers);
    for (let i = 0; i < f.cells; i++) {
      dev[f.cells + i] = 1;
      f.depth[f.cells + i] = 1;
    }
    const a = accountDecks(f, dev);
    expect(a.ok).toBe(true);
    expect(a.why).toBe(null);
    expect(a.deviceWet).toBe(f.cells);
    expect(a.deviceHeld).toBeCloseTo(f.cells, 3);
  });

  test("only columns that really are storeyed are counted", () => {
    // Slot zero is never a deck however wet it is, and an upper slot the map
    // has no room for is collapsed onto its own floor by `rebuildSlots`.
    const f = decked();
    for (let i = 0; i < f.cells; i++) f.roof[f.cells + i] = f.ground[f.cells + i];
    const dev = new Float32Array(f.cells * f.layers).fill(1);
    expect(accountDecks(f, dev).deckColumns).toBe(0);
  });

  test("the widest gap between the two copies is kept, with its column", () => {
    // A HEIGHT AND NOT A VERDICT: the depths will never match to the digit on
    // a moving map, and a readback a few frames behind is the design. This is
    // how far behind it got, which is what the falls are drawn from.
    const f = decked();
    const dev = new Float32Array(f.cells * f.layers);
    dev[f.cells + 5] = 2.5;
    f.depth[f.cells + 5] = 0.25;
    const a = accountDecks(f, dev);
    expect(a.worstGap).toBeCloseTo(2.25, 4);
    expect(a.worstAt).toMatchObject({ cx: 1, cy: 1, a: 1 });
  });
});
