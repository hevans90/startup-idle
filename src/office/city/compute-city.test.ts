import { describe, expect, test } from "bun:test";
import { BUILDING_STYLES } from "./buildings";
import {
  computeCity,
  districtBuildingFloors,
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

  test("never exceeds maxFloors per building", () => {
    const floors = districtBuildingFloors("10x_dev", 1_000_000);
    expect(Math.max(...floors)).toBeLessThanOrEqual(
      BUILDING_STYLES["10x_dev"].maxFloors,
    );
  });

  test("taller district produces taller towers for the same count", () => {
    const internMax = Math.max(...districtBuildingFloors("intern", 5000));
    const devMax = Math.max(...districtBuildingFloors("10x_dev", 5000));
    expect(devMax).toBeGreaterThan(internMax);
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
  });

  test("empty company → empty scene", () => {
    expect(computeCity({}).buildings).toEqual([]);
  });
});
