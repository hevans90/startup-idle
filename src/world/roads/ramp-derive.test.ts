/**
 * Ramp derivation. Pure, so it can be exercised over exact geometry rather than
 * through the store — which matters because the interesting cases are the ones
 * it must REFUSE, and those are easy to get silently wrong.
 */
import { describe, expect, test } from "bun:test";

import { NEIGHBOUR } from "../../iso/dir";
import { RAMP, rampDir, rampRise } from "../iso";
import { derivedRamp, rampNeed, type SurfaceReader } from "./ramp-derive";

/** A tiny world described by two maps, so each test states only what matters. */
const world = (paved: string[], height: Record<string, number> = {}): SurfaceReader => {
  const p = new Set(paved);
  return {
    inBounds: (x, y) => x >= 0 && y >= 0 && x < 20 && y < 20,
    paved: (x, y) => p.has(`${x},${y}`),
    height: (x, y) => height[`${x},${y}`] ?? 0,
  };
};

describe("rampNeed", () => {
  test("nothing on unpaved ground", () => {
    expect(rampNeed(world([]), 4, 4).kind).toBe("none");
  });

  test("nothing when the neighbours are level", () => {
    expect(rampNeed(world(["4,4", "4,5"]), 4, 4).kind).toBe("none");
  });

  test("nothing on the UPPER cell — the ramp belongs to the lower one", () => {
    const w = world(["4,4", "4,5"], { "4,5": 2 });
    expect(rampNeed(w, 4, 5).kind).toBe("none");
    expect(rampNeed(w, 4, 4).kind).toBe("ramp");
  });

  test("a full step gives a ramp toward the higher neighbour", () => {
    // W is (0,+1), so (4,5) is (4,4)'s W neighbour
    const need = rampNeed(world(["4,4", "4,5"], { "4,5": 2 }), 4, 4);
    expect(need).toEqual({ kind: "ramp", dir: RAMP.W, rise: 2 });
  });

  test("each direction resolves to the matching edge", () => {
    for (const d of ["N", "E", "S", "W"] as const) {
      const [dx, dy] = NEIGHBOUR[d];
      const w = world(["4,4", `${4 + dx},${4 + dy}`], { [`${4 + dx},${4 + dy}`]: 2 });
      expect(rampNeed(w, 4, 4)).toEqual({ kind: "ramp", dir: RAMP[d], rise: 2 });
    }
  });

  test("a HALF step is unbridgeable, and says why", () => {
    const need = rampNeed(world(["4,4", "4,5"], { "4,5": 1 }), 4, 4);
    expect(need.kind).toBe("unbridgeable");
    if (need.kind === "unbridgeable") expect(need.reason).toBe("no paved half-ramp art");
  });

  test("a step of two or more is unbridgeable, and says how tall", () => {
    const need = rampNeed(world(["4,4", "4,5"], { "4,5": 4 }), 4, 4);
    expect(need.kind).toBe("unbridgeable");
    if (need.kind === "unbridgeable") expect(need.reason).toContain("too tall");
  });

  test("TWO higher neighbours is unbridgeable — a ramp has one direction", () => {
    const w = world(["4,4", "4,5", "5,4"], { "4,5": 2, "5,4": 2 });
    const need = rampNeed(w, 4, 4);
    expect(need.kind).toBe("unbridgeable");
    if (need.kind === "unbridgeable") expect(need.reason).toBe("two steps at once");
  });

  test("an UNPAVED higher neighbour is ignored — roads ramp to roads", () => {
    expect(rampNeed(world(["4,4"], { "4,5": 2 }), 4, 4).kind).toBe("none");
  });

  test("a lower neighbour never causes a ramp", () => {
    expect(rampNeed(world(["4,4", "4,5"], { "4,4": 2 }), 4, 4).kind).toBe("none");
  });

  test("off-map neighbours are ignored", () => {
    expect(rampNeed(world(["0,0"], {}), 0, 0).kind).toBe("none");
  });
});

describe("derivedRamp", () => {
  test("packs the direction and rise the need reports", () => {
    const packed = derivedRamp(world(["4,4", "4,5"], { "4,5": 2 }), 4, 4);
    expect(rampDir(packed)).toBe(RAMP.W);
    expect(rampRise(packed)).toBe(2);
  });

  test("zero for every case that is not a ramp", () => {
    expect(derivedRamp(world([]), 4, 4)).toBe(RAMP.NONE);
    expect(derivedRamp(world(["4,4", "4,5"], { "4,5": 1 }), 4, 4)).toBe(RAMP.NONE);
    expect(derivedRamp(world(["4,4", "4,5"], { "4,5": 9 }), 4, 4)).toBe(RAMP.NONE);
  });

  test("a staircase ramps at every level", () => {
    const paved: string[] = [];
    const height: Record<string, number> = {};
    for (let y = 0; y < 6; y++) { paved.push(`4,${y}`); height[`4,${y}`] = y * 2; }
    const w = world(paved, height);
    for (let y = 0; y < 5; y++) expect(rampDir(derivedRamp(w, 4, y))).toBe(RAMP.W);
    expect(derivedRamp(w, 4, 5)).toBe(RAMP.NONE);   // the top has nowhere to climb
  });
});
