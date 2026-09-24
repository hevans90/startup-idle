/**
 * WHICH WATER IS ONE SHEET, asked at a corner.
 *
 * Every case here came from `bodies.test.ts`, which asked the same questions
 * of a map-wide labelling. They are asked of the corner now, because that is
 * where the answer is worked out — but they are the same questions, and the
 * two that name a bridge are still the reported bug while the two that name a
 * cliff are still what the old bed rule was built for.
 *
 * The one that is NOT a port is the last: that every member of a component
 * computes the identical component. That is the tear-free property stated
 * directly, and it is the whole reason this can be decided locally at all.
 */
import { describe, expect, test } from "bun:test";

import { addWater, createColumnField, surfaceAt, type ColumnField } from "../../fluid/columns";
import { FALL_MIN } from "../../fluid/falls";
import { OPEN_SKY } from "../../fluid/slots";
import {
  CORNER_COLUMNS, contribOf, cornerMask, cornerMasksInto, sameSheet,
} from "./sheet-group";

const field = (n: number, layers = 1) => createColumnField(n, n, undefined, 1, layers);

/** The mask of slot `a` of column `(cx, cy)`, asked at corner `(vx, vy)`. */
const maskAt = (
  f: ColumnField, vx: number, vy: number, cx: number, cy: number, a = 0,
) => cornerMask(f, vx, vy, contribOf(vx, vy, cx, cy, a, f.layers));

/** Every contributor of corner `(vx, vy)`, as indices. */
const all = (f: ColumnField) =>
  Array.from({ length: CORNER_COLUMNS * f.layers }, (_, k) => k);

describe("one sheet", () => {
  test("a flat pool holds all four of a corner's columns", () => {
    const f = field(6);
    for (let y = 1; y <= 4; y++) for (let x = 1; x <= 4; x++) addWater(f, x, y, 3, 1);
    // The corner where (2,2), (3,2), (2,3) and (3,3) meet.
    const m = maskAt(f, 3, 3, 2, 2);
    expect(m).toBe(0b1111);
  });

  test("a dry column is in nobody's component", () => {
    const f = field(6);
    for (let y = 1; y <= 4; y++) for (let x = 1; x <= 4; x++) addWater(f, x, y, 3, 1);
    // Corner (1,1): only (1,1) is wet — (0,0), (1,0) and (0,1) are the dry ring.
    const m = maskAt(f, 1, 1, 1, 1);
    expect(m).toBe(0b1000);
    // And the dry one answers with itself alone, which gathers nothing.
    expect(maskAt(f, 1, 1, 0, 0)).toBe(0b0001);
  });

  test("a river over a stepped bed is still one corner's worth", () => {
    // Steps of two half steps, which is a ledge and not a fall.
    const f = field(8);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) f.ground[y * f.nx + x] = -2 * x;
    for (let y = 1; y <= 6; y++) for (let x = 1; x <= 6; x++) addWater(f, x, y, 3, 1);
    expect(maskAt(f, 4, 4, 3, 3)).toBe(0b1111);
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
    // Corner (4,4): columns (3,3) and (3,4) are the plateau, (4,3) and (4,4)
    // the lake. Two components, and neither reaches the other.
    const top = maskAt(f, 4, 4, 3, 3);
    const low = maskAt(f, 4, 4, 4, 3);
    expect(top).not.toBe(low);
    expect(top & low).toBe(0);
    expect(top | low).toBe(0b1111);
  });

  test("and it is the FALL that splits them, not the bed", () => {
    const f = cliff();
    for (let y = 1; y <= 6; y++) for (let x = 4; x <= 6; x++) addWater(f, x, y, 17, 1);
    expect(maskAt(f, 4, 4, 3, 3)).toBe(0b1111);
  });
});

describe("a bridge", () => {
  /** A channel at -20 along y = 3..4, banks at 40, a deck at 0 over x = 3..4. */
  const culvert = () => {
    const f = field(10, 2);
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const i = y * f.nx + x;
        const inChannel = y >= 3 && y <= 4;
        f.ground[i] = inChannel ? -20 : 40;
        const decked = inChannel && x >= 3 && x <= 4;
        f.roof[i] = decked ? -2 : OPEN_SKY;
        f.ground[f.cells + i] = decked ? 0 : f.ground[i];
        f.roof[f.cells + i] = decked ? OPEN_SKY : f.ground[i];
      }
    }
    return f;
  };

  test("the river runs under the span as ONE sheet", () => {
    // THE REPORTED BUG. Split here, the river took its whole appearance from
    // whatever happened to be standing on the deck above it.
    const f = culvert();
    for (let y = 3; y <= 4; y++) for (let x = 1; x <= 8; x++) addWater(f, x, y, 15, 1);
    // The corner at the mouth of the span, where open channel (2,3) meets
    // roofed channel (3,3).
    const open = maskAt(f, 3, 4, 2, 3, 0);
    const under = maskAt(f, 3, 4, 3, 3, 0);
    expect(open).toBe(under);
  });

  test("and a puddle on the deck is a DIFFERENT sheet", () => {
    const f = culvert();
    for (let y = 3; y <= 4; y++) for (let x = 1; x <= 8; x++) addWater(f, x, y, 15, 1);
    for (let y = 3; y <= 4; y++) for (let x = 3; x <= 4; x++) addWater(f, x, y, 1, 1, 1);
    // Corner (4,4) stands inside the span: every one of its four columns has
    // a channel under it and a deck over it.
    const channel = maskAt(f, 4, 4, 3, 3, 0);
    const deck = maskAt(f, 4, 4, 3, 3, 1);
    expect(channel & deck).toBe(0);
    // The deck's puddle is one sheet across the corner.
    expect(deck).toBe(maskAt(f, 4, 4, 4, 4, 1));
  });

  test("the deck's water and the road it meets are ONE sheet", () => {
    // The seam. The road is slot zero and the deck is slot one, so nothing
    // about the slot INDEX can join them — only the geometry can.
    const f = field(10, 2);
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const i = y * f.nx + x;
        const gorge = x >= 4 && x <= 5;
        f.ground[i] = gorge ? -20 : 0;
        f.roof[i] = gorge ? -2 : OPEN_SKY;
        f.ground[f.cells + i] = gorge ? 0 : f.ground[i];
        f.roof[f.cells + i] = gorge ? OPEN_SKY : f.ground[i];
      }
    }
    for (let y = 3; y <= 5; y++) {
      for (let x = 1; x <= 8; x++) {
        if (x >= 4 && x <= 5) addWater(f, x, y, 2, 1, 1);
        else addWater(f, x, y, 2, 1, 0);
      }
    }
    // Corner (4,4): road (3,3) and (3,4) in slot 0, deck (4,3) and (4,4) in
    // slot 1. One sheet across the abutment.
    const road = maskAt(f, 4, 4, 3, 3, 0);
    const deck = maskAt(f, 4, 4, 4, 4, 1);
    expect(road).toBe(deck);
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
        f.ground[f.cells + i] = kerb ? 2 : 0;
        f.roof[f.cells + i] = OPEN_SKY;
      }
    }
    for (let y = 2; y <= 5; y++) for (let x = 2; x <= 5; x++) addWater(f, x, y, 3, 1, 1);
    // Corner (3,3): the kerb at (2,2) and the deck at (3,3).
    expect(maskAt(f, 3, 3, 2, 2, 1)).toBe(maskAt(f, 3, 3, 3, 3, 1));
  });
});

describe("the rule itself", () => {
  test("refuses two slots with a solid between them", () => {
    const f = field(4, 2);
    f.ground[0] = 0; f.roof[0] = 8;
    f.ground[f.cells + 1] = 9; f.roof[f.cells + 1] = OPEN_SKY;
    f.depth[0] = 7; f.depth[f.cells + 1] = 1;
    expect(Math.abs(surfaceAt(f, 0) - surfaceAt(f, f.cells + 1))).toBeLessThan(FALL_MIN);
    expect(sameSheet(f, 0, f.cells + 1)).toBe(false);
  });

  test("and two whose surfaces are a fall apart", () => {
    const f = field(4);
    f.ground[0] = 0; f.depth[0] = 1;
    f.ground[1] = -20; f.depth[1] = 2;
    expect(sameSheet(f, 0, 1)).toBe(false);
    f.depth[1] = 19;
    expect(sameSheet(f, 0, 1)).toBe(true);
  });

  test("two diagonal columns join through a neighbour they both touch", () => {
    // The diagonals are not edges of the corner's graph, so this is the only
    // way the two of them can end up in one component — and they must, or a
    // pool would be drawn at two heights at its own middle.
    const f = field(4);
    addWater(f, 1, 1, 3, 1);
    addWater(f, 2, 1, 3, 1);
    addWater(f, 2, 2, 3, 1);
    // (1,2) is dry: (1,1) and (2,2) are diagonal, joined through (2,1).
    expect(maskAt(f, 2, 2, 1, 1)).toBe(maskAt(f, 2, 2, 2, 2));
    // Bits 0, 1 and 3: (1,1), (2,1) and (2,2). Bit 2 is the dry (1,2).
    expect(maskAt(f, 2, 2, 1, 1)).toBe(0b1011);
  });
});

/**
 * THE PROPERTY THE WHOLE SCHEME RESTS ON.
 *
 * A corner is asked by up to twelve contributors and every one of them must
 * get the SAME partition, or two columns of one sheet draw the corner they
 * share at two heights and the mesh comes apart along the seam between them.
 * Held locally this is not an agreement to maintain, it is arithmetic: the
 * component is a pure function of the corner. This asserts it over every
 * corner of a map with a bridge, a cliff, a parapet and a shoreline on it.
 */
describe("no member of a component disagrees about the component", () => {
  const busy = () => {
    const f = field(12, 2);
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 12; x++) {
        const i = y * f.nx + x;
        const gorge = x >= 5 && x <= 6;
        const cliff = y >= 8;
        f.ground[i] = gorge ? -20 : cliff ? -9 : 0;
        f.roof[i] = gorge && y < 8 ? -2 : OPEN_SKY;
        const decked = gorge && y < 8;
        f.ground[f.cells + i] = decked ? (y === 2 ? 2 : 0) : f.ground[i];
        f.roof[f.cells + i] = decked ? OPEN_SKY : f.ground[i];
      }
    }
    for (let y = 1; y <= 10; y++) {
      for (let x = 1; x <= 10; x++) {
        if (x >= 5 && x <= 6 && y < 8) addWater(f, x, y, 2, 1, 1);
        else if (x < 9) addWater(f, x, y, 3, 1, 0);
      }
    }
    return f;
  };

  test("over every corner of a map with a span, a cliff and a shore on it", () => {
    const f = busy();
    let checked = 0, components = 0;
    for (let vy = 0; vy <= f.ny; vy++) {
      for (let vx = 0; vx <= f.nx; vx++) {
        for (const k of all(f)) {
          const m = cornerMask(f, vx, vy, k);
          if (m !== 1 << k) components++;
          for (const j of all(f)) {
            if (((m >> j) & 1) === 0) continue;
            expect(cornerMask(f, vx, vy, j), `corner ${vx},${vy} k=${k} j=${j}`)
              .toBe(m);
            checked++;
          }
        }
      }
    }
    // And the map really did have components to check, rather than twelve
    // singletons everywhere.
    expect(components).toBeGreaterThan(250);
    expect(checked).toBeGreaterThan(2000);
  });
});

/**
 * THE FAST PATH MUST BE THE RULE.
 *
 * The mesh builder does not flood once per contributor — it comes back to the
 * same corner a dozen times per column, so it partitions the corner once with
 * a union-find and reads the answer. That is a second implementation of the
 * same thing, which is exactly the arrangement this whole file exists to stop
 * being silent about. So it is held to the rule, corner for corner and
 * contributor for contributor, on a map with a span, a cliff and a shore.
 */
describe("the batch partition is the rule", () => {
  const busy = () => {
    const f = field(12, 2);
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 12; x++) {
        const i = y * f.nx + x;
        const gorge = x >= 5 && x <= 6;
        const cliff = y >= 8;
        f.ground[i] = gorge ? -20 : cliff ? -9 : 0;
        f.roof[i] = gorge && y < 8 ? -2 : OPEN_SKY;
        const decked = gorge && y < 8;
        f.ground[f.cells + i] = decked ? (y === 2 ? 2 : 0) : f.ground[i];
        f.roof[f.cells + i] = decked ? OPEN_SKY : f.ground[i];
      }
    }
    for (let y = 1; y <= 10; y++) {
      for (let x = 1; x <= 10; x++) {
        if (x >= 5 && x <= 6 && y < 8) addWater(f, x, y, 2, 1, 1);
        else if (x < 9) addWater(f, x, y, 3, 1, 0);
      }
    }
    return f;
  };

  test("agrees with cornerMask on every contributor of every corner", () => {
    const f = busy();
    const n = CORNER_COLUMNS * f.layers;
    const out = new Int32Array(n);
    let grouped = 0;
    for (let vy = 0; vy <= f.ny; vy++) {
      for (let vx = 0; vx <= f.nx; vx++) {
        cornerMasksInto(f, vx, vy, out, 0);
        for (let k = 0; k < n; k++) {
          const want = cornerMask(f, vx, vy, k);
          expect(out[k], `corner ${vx},${vy} k=${k}`).toBe(want);
          if (want !== 1 << k) grouped++;
        }
      }
    }
    expect(grouped).toBeGreaterThan(250);
  });
});
