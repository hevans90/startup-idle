/**
 * WHICH WATER IS ONE SHEET.
 *
 * Every case here is one the mesh got wrong before, or one it got right and
 * must go on getting right. The two that name a bridge are the reported bug;
 * the two that name a cliff are what the old bed rule was built for and what
 * any replacement has to keep.
 */
import { describe, expect, test } from "bun:test";

import { addWater, createColumnField, surfaceAt, type ColumnField } from "../../fluid/columns";
import { FALL_MIN } from "../../fluid/falls";
import { OPEN_SKY } from "../../fluid/slots";
import { NO_BODY, createBodies, findBodies, sameSheet } from "./bodies";

const WHOLE = { x0: 0, y0: 0, x1: 1e9, y1: 1e9 };

/** A field with `layers` storeys, flat ground, nothing overhead. */
const field = (n: number, layers = 1) => {
  const f = createColumnField(n, n, undefined, 1, layers);
  return f;
};

const label = (f: ColumnField) => {
  const b = createBodies(f);
  findBodies(f, WHOLE, b);
  return b;
};

/** The body at a column's slot. */
const at = (f: ColumnField, b: { at: Int32Array }, x: number, y: number, a = 0) =>
  b.at[a * f.cells + y * f.nx + x];

describe("one sheet", () => {
  test("a flat pool is one body", () => {
    const f = field(6);
    for (let y = 1; y <= 4; y++) for (let x = 1; x <= 4; x++) addWater(f, x, y, 3, 1);
    const b = label(f);
    expect(b.n).toBe(1);
    expect(at(f, b, 1, 1)).toBe(0);
    expect(at(f, b, 4, 4)).toBe(0);
    // And the dry ring belongs to nothing.
    expect(at(f, b, 0, 0)).toBe(NO_BODY);
  });

  test("a dry gap makes two", () => {
    const f = field(8);
    for (let y = 1; y <= 6; y++) {
      addWater(f, 1, y, 3, 1);
      addWater(f, 6, y, 3, 1);
    }
    const b = label(f);
    expect(b.n).toBe(2);
    expect(at(f, b, 1, 3)).not.toBe(at(f, b, 6, 3));
  });

  test("a river over a stepped bed is still one body", () => {
    // The bed rule split these and merged them back; this must not need a
    // merge. Steps of two half steps, which is a ledge and not a fall.
    const f = field(8);
    for (let y = 1; y <= 6; y++) {
      for (let x = 1; x <= 6; x++) {
        f.ground[y * f.nx + x] = -2 * x;
        addWater(f, x, y, 12 + 2 * x, 1);      // a level surface over a stair
      }
    }
    const b = label(f);
    expect(b.n).toBe(1);
  });
});

describe("a box that moves", () => {
  test("leaves no id behind it when it shrinks", () => {
    // A rebuild walks the water's own active box, so a box that shrinks
    // leaves last frame's labels standing outside the new one — and a stale
    // id is a number that can equal a live sheet's, which joins two puddles
    // that have never met. It did not matter while the only reader wrote
    // exactly where it read; it matters the moment the array goes to a
    // device whole.
    const f = field(10);
    for (let y = 1; y <= 8; y++) for (let x = 1; x <= 8; x++) addWater(f, x, y, 3, 1);
    const b = createBodies(f);
    findBodies(f, WHOLE, b);
    expect(at(f, b, 7, 7)).toBe(0);
    // The water goes, and the box with it.
    for (let y = 1; y <= 8; y++) for (let x = 1; x <= 8; x++) f.depth[y * f.nx + x] = 0;
    for (let y = 1; y <= 2; y++) for (let x = 1; x <= 2; x++) addWater(f, x, y, 3, 1);
    findBodies(f, { x0: 0, y0: 0, x1: 3, y1: 3 }, b);
    expect(at(f, b, 1, 1)).toBe(0);
    // And nothing out where the water used to be still claims to be a sheet.
    for (let i = 0; i < b.at.length; i++) {
      const x = i % f.nx, y = (i / f.nx) | 0;
      if (x <= 3 && y <= 3) continue;
      expect(b.at[i]).toBe(NO_BODY);
    }
  });
});

describe("a cliff, which is what the bed rule was for", () => {
  /** A plateau at 12 with a film on it, a lake at -20 below the drop. */
  const cliff = () => {
    const f = field(8);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) f.ground[y * f.nx + x] = x <= 3 ? 12 : -20;
    }
    for (let y = 1; y <= 6; y++) {
      for (let x = 1; x <= 3; x++) addWater(f, x, y, 0.6, 1);   // the sheet
      for (let x = 4; x <= 6; x++) addWater(f, x, y, 15, 1);    // the lake
    }
    return f;
  };

  test("splits the sheet on top from the lake below", () => {
    const f = cliff();
    const b = label(f);
    expect(b.n).toBe(2);
    expect(at(f, b, 2, 3)).not.toBe(at(f, b, 5, 3));
  });

  test("and it is the FALL that splits them, not the bed", () => {
    // The same two beds, but the lake filled until its surface reaches the
    // plateau: now it is one body of water and must be drawn as one.
    const f = cliff();
    for (let y = 1; y <= 6; y++) for (let x = 4; x <= 6; x++) addWater(f, x, y, 17, 1);
    const b = label(f);
    expect(b.n).toBe(1);
  });
});

describe("a bridge", () => {
  /**
   * A channel at -20 along y = 3..4, banks at 40, a deck at 0 over x = 3..4.
   * Slot 0 is the channel — roofed where the deck is — and slot 1 is the deck.
   */
  const culvert = () => {
    const f = field(10, 2);
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const i = y * f.nx + x;
        const inChannel = y >= 3 && y <= 4;
        f.ground[i] = inChannel ? -20 : 40;
        const decked = inChannel && x >= 3 && x <= 4;
        f.roof[i] = decked ? -2 : OPEN_SKY;    // the soffit, two below the deck
        f.ground[f.cells + i] = decked ? 0 : f.ground[i];
        f.roof[f.cells + i] = decked ? OPEN_SKY : f.ground[i];   // absent
      }
    }
    return f;
  };

  test("the river runs under the span as ONE body", () => {
    // THE REPORTED BUG. Split here, the river took its whole appearance from
    // whatever happened to be standing on the deck above it.
    const f = culvert();
    for (let y = 3; y <= 4; y++) for (let x = 1; x <= 8; x++) addWater(f, x, y, 15, 1);
    const b = label(f);
    expect(b.n).toBe(1);
    expect(at(f, b, 1, 3)).toBe(at(f, b, 3, 3));   // open channel and under it
    expect(at(f, b, 3, 3)).toBe(at(f, b, 8, 3));   // and out the far side
  });

  test("and a puddle on the deck is a DIFFERENT body", () => {
    const f = culvert();
    for (let y = 3; y <= 4; y++) for (let x = 1; x <= 8; x++) addWater(f, x, y, 15, 1);
    for (let y = 3; y <= 4; y++) for (let x = 3; x <= 4; x++) addWater(f, x, y, 1, 1, 1);
    const b = label(f);
    expect(b.n).toBe(2);
    expect(at(f, b, 3, 3, 1)).not.toBe(at(f, b, 3, 3, 0));
    // The deck's puddle is one sheet across the whole span.
    expect(at(f, b, 3, 3, 1)).toBe(at(f, b, 4, 4, 1));
  });

  test("the deck's water and the road it meets are ONE body", () => {
    // The seam. The road is slot zero and the deck is slot one, so nothing
    // about the slot INDEX can join them — only the geometry can.
    const f = field(10, 2);
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const i = y * f.nx + x;
        const gorge = x >= 4 && x <= 5;
        f.ground[i] = gorge ? -20 : 0;         // the road at 0, a gorge in it
        f.roof[i] = gorge ? -2 : OPEN_SKY;
        f.ground[f.cells + i] = gorge ? 0 : f.ground[i];
        f.roof[f.cells + i] = gorge ? OPEN_SKY : f.ground[i];
      }
    }
    for (let y = 3; y <= 5; y++) {
      for (let x = 1; x <= 8; x++) {
        if (x >= 4 && x <= 5) addWater(f, x, y, 2, 1, 1);      // on the deck
        else addWater(f, x, y, 2, 1, 0);                        // on the road
      }
    }
    const b = label(f);
    expect(b.n).toBe(1);
    expect(at(f, b, 3, 4, 0)).toBe(at(f, b, 4, 4, 1));
    expect(at(f, b, 4, 4, 1)).toBe(at(f, b, 6, 4, 0));
  });

  test("a kerb column joins the deck it stands on", () => {
    // The parapet is two half steps over its own deck, so the bed rule made
    // it a body of its own — and one column, being the highest bed at the
    // corner, demoted the whole span's water into the low bucket.
    const f = field(8, 2);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const i = y * f.nx + x;
        f.ground[i] = -20;
        f.roof[i] = -2;
        const kerb = x === 2 || x === 5 || y === 2 || y === 5;
        f.ground[f.cells + i] = kerb ? 2 : 0;   // the parapet stands proud
        f.roof[f.cells + i] = OPEN_SKY;
      }
    }
    for (let y = 2; y <= 5; y++) for (let x = 2; x <= 5; x++) addWater(f, x, y, 3, 1, 1);
    const b = label(f);
    expect(b.n).toBe(1);
    expect(at(f, b, 2, 2, 1)).toBe(at(f, b, 3, 3, 1));
  });
});

describe("the rule itself", () => {
  test("refuses two slots with a solid between them", () => {
    // AND THEIR SURFACES ARE CLOSE, which is the only way this pins the
    // solid test rather than the fall test: a culvert running nearly full
    // under a low deck with a puddle on it. Seven of water in a channel
    // roofed at eight, and one on a deck whose floor is nine — three half
    // steps apart, well inside a fall, and a slab of bridge between them.
    const f = field(4, 2);
    f.ground[0] = 0; f.roof[0] = 8;             // a channel, roofed
    f.ground[f.cells + 1] = 9; f.roof[f.cells + 1] = OPEN_SKY;   // a deck beside
    f.depth[0] = 7; f.depth[f.cells + 1] = 1;
    expect(Math.abs(surfaceAt(f, 0) - surfaceAt(f, f.cells + 1))).toBeLessThan(FALL_MIN);
    expect(sameSheet(f, 0, f.cells + 1)).toBe(false);
  });

  test("even when the channel is full to the soffit", () => {
    // The same thing across a whole span, through `findBodies` rather than
    // the predicate: a flooded culvert under a wet deck is TWO sheets, and
    // nothing about their heights says so.
    const f = field(8, 2);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const i = y * f.nx + x;
        f.ground[i] = 0;
        f.roof[i] = 8;                          // roofed everywhere: a tunnel
        f.ground[f.cells + i] = 9;
        f.roof[f.cells + i] = OPEN_SKY;
      }
    }
    for (let y = 1; y <= 6; y++) {
      for (let x = 1; x <= 6; x++) {
        addWater(f, x, y, 7, 1, 0);             // the culvert, nearly full
        addWater(f, x, y, 1, 1, 1);             // a puddle on the deck
      }
    }
    const b = label(f);
    expect(b.n).toBe(2);
    expect(at(f, b, 3, 3, 0)).not.toBe(at(f, b, 3, 3, 1));
  });

  test("and two whose surfaces are a fall apart", () => {
    const f = field(4);
    f.ground[0] = 0; f.depth[0] = 1;            // surface 1
    f.ground[1] = -20; f.depth[1] = 2;          // surface -18
    expect(sameSheet(f, 0, 1)).toBe(false);
    f.depth[1] = 19;                            // surface -1, within a fall
    expect(sameSheet(f, 0, 1)).toBe(true);
  });
});
