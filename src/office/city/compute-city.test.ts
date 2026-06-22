import { describe, expect, test } from "bun:test";
import { isBaseTile } from "./building-kits";
import { buildingName, districtTier, landmarkKit } from "./buildings";
import {
  computeCity,
  districtBuildingFloors,
  districtBuildingOccupants,
  planDistrict,
} from "./compute-city";
import { generateWorld } from "./generate-world";
import { cellKey } from "./types";

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

  test("a building never loses floors as the company grows (no stealing)", () => {
    for (const id of ["intern", "vibe_coder", "10x_dev"] as const) {
      const prev = new Map<string, number>();
      for (let count = 1; count <= 600; count++) {
        for (const b of planDistrict(id, count)) {
          const key = `${b.plot.mapX},${b.plot.mapY}`;
          const last = prev.get(key) ?? 0;
          expect(b.floors).toBeGreaterThanOrEqual(last);
          prev.set(key, b.floors);
        }
      }
    }
  });

  test("10x_dev builds a real downtown within its tiny headcount range", () => {
    // ~20 devs is the realistic ceiling — it should still read as a downtown.
    const at20 = planDistrict("10x_dev", 20);
    expect(at20.length).toBeGreaterThan(4); // several towers, not one stub
    expect(at20[0].isLandmark).toBe(true); // HQ present
    expect(districtTier("10x_dev", 20)).toBe(2); // top-tier architecture
    // each rare hire lifts the whole skyline: the lead tower is taller at 10
    // devs than at 5 (shared lift + its own growth).
    const lead = (n: number) => planDistrict("10x_dev", n)[0].floors;
    expect(lead(10)).toBeGreaterThan(lead(5));
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

describe("districtBuildingOccupants", () => {
  test("per-building counts sum to EXACTLY the headcount", () => {
    for (const id of ["intern", "vibe_coder", "10x_dev"] as const) {
      for (const count of [1, 6, 23, 80, 137, 500]) {
        const occ = districtBuildingOccupants(id, count);
        expect(occ.reduce((a, b) => a + b, 0)).toBe(count);
        expect(occ.every((n) => n >= 0)).toBe(true);
      }
    }
  });

  test("no employees → no shares", () => {
    expect(districtBuildingOccupants("intern", 0)).toEqual([]);
  });

  test("taller lead tower houses at least as many as the shortest", () => {
    const occ = districtBuildingOccupants("intern", 200);
    expect(occ[0]).toBeGreaterThanOrEqual(occ[occ.length - 1]);
  });

  test("computeCity attaches occupancy that sums to the headcount", () => {
    const scene = computeCity({ intern: 137, vibe_coder: 42, "10x_dev": 9 });
    for (const [id, n] of [
      ["intern", 137],
      ["vibe_coder", 42],
      ["10x_dev", 9],
    ] as const) {
      const sum = scene.buildings
        .filter((b) => b.district === id)
        .reduce((a, b) => a + b.occupants, 0);
      expect(sum).toBe(n);
    }
  });
});

describe("building names", () => {
  test("tier picks the flavour name; landmark overrides", () => {
    expect(buildingName("vibe_coder", 2, false)).toBe("Vibe Penthouses");
    expect(buildingName("vibe_coder", 0, false)).toBe("Vibe Garage");
    expect(buildingName("vibe_coder", 2, true)).toBe("Vibe Tower");
  });

  test("every computed building has a name", () => {
    const scene = computeCity({ intern: 200, vibe_coder: 90, "10x_dev": 12 });
    expect(scene.buildings.every((b) => b.name.length > 0)).toBe(true);
    expect(
      scene.buildings.find((b) => b.isLandmark && b.district === "10x_dev")
        ?.name,
    ).toBe("10x Spire");
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

describe("ground props", () => {
  test("never overlap a road or building, nor sit in front of one", () => {
    const scene = computeCity({ intern: 60, vibe_coder: 60, "10x_dev": 800 });
    expect(scene.props.length).toBeGreaterThan(0); // sanity: some did place
    const world = generateWorld();
    const built = new Set(
      scene.buildings.map((b) => cellKey(b.mapX, b.mapY)),
    );
    for (const p of scene.props) {
      const here = cellKey(p.mapX, p.mapY);
      expect(world.roadCells.has(here)).toBe(false);
      expect(built.has(here)).toBe(false);
      // down-screen spill cells must be clear of both roads and buildings
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
        [1, 1],
      ]) {
        const k = cellKey(p.mapX + dx, p.mapY + dy);
        expect(world.roadCells.has(k)).toBe(false);
        expect(built.has(k)).toBe(false);
      }
    }
  });
});
