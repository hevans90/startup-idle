import { describe, expect, test } from "bun:test";
import { isBaseTile } from "./building-kits";
import { districtTier, landmarkKit } from "./buildings";
import {
  computeCity,
  districtBuildingFloors,
  planDistrict,
} from "./compute-city";

describe("districtBuildingFloors", () => {
  test("no employees → no buildings", () => {
    expect(districtBuildingFloors("intern", 0)).toEqual([]);
  });

  test("a single employee → one 1-floor building", () => {
    expect(districtBuildingFloors("intern", 1)).toEqual([1]);
  });

  test("opens more buildings as count grows", () => {
    const few = districtBuildingFloors("intern", 6);
    const many = districtBuildingFloors("intern", 60);
    expect(many.length).toBeGreaterThan(few.length);
  });

  test("never exceeds the chosen kit's maxFloors", () => {
    for (const b of planDistrict("10x_dev", 1_000_000)) {
      expect(b.floors).toBeLessThanOrEqual(b.kit.maxFloors);
    }
  });
});

describe("tiers + landmarks", () => {
  test("district tier advances with headcount", () => {
    expect(districtTier("intern", 1)).toBe(0);
    expect(districtTier("intern", 50)).toBe(1);
    expect(districtTier("intern", 200)).toBe(2);
  });

  test("lead plot becomes the landmark past the milestone", () => {
    expect(planDistrict("intern", 10)[0].isLandmark).toBe(false);
    const big = planDistrict("intern", 5000);
    expect(big[0].isLandmark).toBe(true);
    expect(big[0].kit).toBe(landmarkKit("intern"));
    // only the lead plot is a landmark
    expect(big.slice(1).every((b) => !b.isLandmark)).toBe(true);
  });
});

describe("composeBuilding (via computeCity)", () => {
  test("parts stack ground → … → roof with rising lift and depth", () => {
    const b = computeCity({ intern: 40 }).buildings[0];
    expect(b.parts.length).toBeGreaterThanOrEqual(2); // at least ground + roof
    // depth and lift both strictly increase up the stack
    for (let i = 1; i < b.parts.length; i++) {
      expect(b.parts[i].depth).toBeGreaterThan(b.parts[i - 1].depth);
      expect(b.parts[i].lift).toBeGreaterThan(b.parts[i - 1].lift);
    }
    expect(b.parts[0].lift).toBe(0); // ground sits on the base
  });

  test("a base-tile ground lifts the floor above it by more than a plain floor", () => {
    // intern landmark ground (002) is a base tile; its first gap includes baseNudge.
    const lm = computeCity({ intern: 5000 }).buildings.find((x) => x.isLandmark)!;
    expect(isBaseTile(lm.parts[0].spriteId)).toBe(true);
    const firstGap = lm.parts[1].lift - lm.parts[0].lift;
    const laterGap = lm.parts[2].lift - lm.parts[1].lift;
    expect(firstGap).toBeGreaterThan(laterGap);
  });
});

describe("computeCity", () => {
  test("deterministic: same counts → identical output", () => {
    const counts = { intern: 137, vibe_coder: 42, "10x_dev": 9 };
    expect(computeCity(counts)).toEqual(computeCity(counts));
  });

  test("buildings sit on real plots and have stable unique keys", () => {
    const scene = computeCity({ intern: 200, vibe_coder: 90, "10x_dev": 300 });
    const keys = scene.buildings.map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(scene.buildings.every((b) => b.floors >= 1)).toBe(true);
    expect(scene.buildings.every((b) => b.parts.length >= 1)).toBe(true);
  });

  test("empty company → empty scene", () => {
    expect(computeCity({}).buildings).toEqual([]);
  });
});
