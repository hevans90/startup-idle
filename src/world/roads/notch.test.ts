/**
 * Inner-corner notches.
 *
 * The rects are MEASURED (see the module note), so what is testable here is the
 * selection logic and the invariants the measurement has to satisfy for the
 * compositing to be seamless: one rect per vertex, non-overlapping, and each
 * inside the frame.
 */
import { describe, expect, test } from "bun:test";

import { DIR } from "../../iso/dir";
import { TILE_W } from "../iso";
import { DIAG } from "./mask";
import { NOTCH_RECTS, VERTEX_FLANKS, VERTICES, notchesFor } from "./notch";

const ORTH_ALL = DIR.N | DIR.E | DIR.S | DIR.W;
const DIAG_ALL = DIAG.NE | DIAG.SE | DIAG.SW | DIAG.NW;

describe("NOTCH_RECTS", () => {
  test("one per vertex, and all inside a 132x99 frame", () => {
    expect(Object.keys(NOTCH_RECTS).sort()).toEqual([...VERTICES].sort());
    for (const r of Object.values(NOTCH_RECTS)) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(TILE_W);
      expect(r.y + r.h).toBeLessThanOrEqual(99);
    }
  });

  test("NON-OVERLAPPING — two notches on one cell must not fight", () => {
    const rs = Object.entries(NOTCH_RECTS);
    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        const [, a] = rs[i], [, b] = rs[j];
        const apart =
          a.x + a.w <= b.x || b.x + b.w <= a.x ||
          a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(apart).toBe(true);
      }
    }
  });

  test("each rect is on the side of the frame its vertex is", () => {
    // NE at the top, SW at the bottom, NW left of SE
    expect(NOTCH_RECTS.NE.y).toBeLessThan(NOTCH_RECTS.SW.y);
    expect(NOTCH_RECTS.NW.x).toBeLessThan(NOTCH_RECTS.SE.x);
  });
});

describe("notchesFor", () => {
  test("nothing when every diagonal is paved — all corners are interior", () => {
    expect(notchesFor(ORTH_ALL, DIAG_ALL)).toEqual([]);
  });

  test("all four when no diagonal is paved", () => {
    expect(notchesFor(ORTH_ALL, 0).sort()).toEqual([...VERTICES].sort());
  });

  test("exactly the corners whose own diagonal is grass", () => {
    expect(notchesFor(ORTH_ALL, DIAG.NE)).toEqual(["SE", "SW", "NW"]);
    expect(notchesFor(ORTH_ALL, DIAG.NE | DIAG.SW)).toEqual(["SE", "NW"]);
  });

  test("a vertex with a grass ORTHOGONAL is not a notch — the base kerbs it", () => {
    // three connections, missing W: only NE and SE have both flanks paved
    const orth = DIR.N | DIR.E | DIR.S;
    expect(notchesFor(orth, 0)).toEqual(["NE", "SE"]);
    expect(notchesFor(orth, DIAG.NE)).toEqual(["SE"]);
  });

  test("a straight or a dead end never needs one", () => {
    expect(notchesFor(DIR.N | DIR.S, 0)).toEqual([]);
    expect(notchesFor(DIR.E | DIR.W, 0)).toEqual([]);
    expect(notchesFor(DIR.N, 0)).toEqual([]);
    expect(notchesFor(0, 0)).toEqual([]);
  });

  test("VERTEX_FLANKS pairs each vertex with its two orthogonals", () => {
    expect(VERTEX_FLANKS.NE).toBe(DIR.N | DIR.E);
    expect(VERTEX_FLANKS.SE).toBe(DIR.S | DIR.E);
    expect(VERTEX_FLANKS.SW).toBe(DIR.S | DIR.W);
    expect(VERTEX_FLANKS.NW).toBe(DIR.N | DIR.W);
  });
});
