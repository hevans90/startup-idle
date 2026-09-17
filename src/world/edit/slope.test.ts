/**
 * Slopes in bare terrain.
 *
 * The `ramp` layer had only ever been written by the road derivation, so a
 * hillside could be stepped but never sloped. Water running down one is not
 * tested here any more: it is not a feature of the slope, it is what the
 * column solver does with any ground at all.
 */
import { describe, expect, test } from "bun:test";


import { createGrid, fillTerrain, idx, setHeight } from "../grid";
import { MAX_RISE, RAMP, rampDir, rampRise } from "../iso";
import { terrainRampFrame } from "../ramp-art";
import { SLOPE_LABELS } from "../ramp-art";
import { derivedSlope, slopeNeed } from "./slope";
const fresh = (w = 16, h = 16) => {
  const g = createGrid(w, h);
  fillTerrain(g, 1);
  return { g };
};

describe("the art a bare slope uses", () => {
  test("every direction and rise has a plain open-sided slope", () => {
    for (const dir of [RAMP.N, RAMP.E, RAMP.S, RAMP.W] as const) {
      for (const rise of [1, 2]) {
        const frame = terrainRampFrame(dir, rise);
        expect(frame).not.toBeNull();
        const edges = SLOPE_LABELS[frame!]?.edges;
        // Open on all four, so it is a hillside and not a cutting.
        for (const side of ["N", "E", "S", "W"]) expect(edges?.[side]).toBe("open");
      }
    }
  });

  test("it does NOT pick the banked cutting that sorts first for S", () => {
    // landscapeTiles_009 is a S slope with grass banks either side. It is the
    // right tile for a sunken path and the wrong one for open ground.
    expect(terrainRampFrame(RAMP.S, 2)).not.toBe("landscapeTiles_009.png");
  });
});

describe("slopeNeed", () => {
  test("rises toward its single higher neighbour, and sits on the LOWER cell", () => {
    const { g } = fresh();
    setHeight(g, 3, 4, 2);                       // N of (4,4) is higher
    const need = slopeNeed(g, 4, 4);
    expect(need).toEqual({ kind: "slope", dir: RAMP.N, rise: 2 });
    expect(slopeNeed(g, 3, 4).kind).toBe("none");   // the top has nowhere to climb
  });

  test("a half step slopes too", () => {
    const { g } = fresh();
    setHeight(g, 3, 4, 1);
    expect(slopeNeed(g, 4, 4)).toEqual({ kind: "slope", dir: RAMP.N, rise: 1 });
  });

  test("flat ground has nothing to climb", () => {
    const { g } = fresh();
    expect(slopeNeed(g, 4, 4).reason).toBe("nothing to climb");
  });

  test("two higher neighbours is a corner the artset cannot draw", () => {
    const { g } = fresh();
    setHeight(g, 3, 4, 2);
    setHeight(g, 4, 3, 2);
    expect(slopeNeed(g, 4, 4).reason).toBe("two steps at once");
  });

  test("anything past MAX_RISE is a cliff, not a slope", () => {
    const { g } = fresh();
    setHeight(g, 3, 4, MAX_RISE + 2);
    expect(slopeNeed(g, 4, 4).reason).toContain("too tall");
  });

  test("it will not slope ground something is built on", () => {
    const { g } = fresh();
    setHeight(g, 3, 4, 2);
    g.structureAt[idx(g, 4, 4)] = 7;
    expect(slopeNeed(g, 4, 4).reason).toBe("built on");
  });

  test("a staircase slopes every tread", () => {
    const { g } = fresh();
    for (let x = 0; x < 6; x++) setHeight(g, x, 4, (5 - x) * 2);
    for (let x = 1; x < 6; x++) {
      expect(rampDir(derivedSlope(g, x, 4))).toBe(RAMP.N);
      expect(rampRise(derivedSlope(g, x, 4))).toBe(2);
    }
    expect(derivedSlope(g, 0, 4)).toBe(RAMP.NONE);
  });
});
