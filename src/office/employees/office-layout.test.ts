import { describe, expect, test } from "bun:test";
import {
  EMPLOYEE_BUILDINGS,
  computeOfficePlacements,
  structuresForCount,
} from "./office-layout";

describe("structuresForCount", () => {
  const intern = EMPLOYEE_BUILDINGS.intern; // perStructure 5, max 40

  test("zero / negative counts give no structures", () => {
    expect(structuresForCount(intern, 0)).toBe(0);
    expect(structuresForCount(intern, -3)).toBe(0);
  });

  test("aggregates by perStructure (rounding up)", () => {
    expect(structuresForCount(intern, 1)).toBe(1);
    expect(structuresForCount(intern, 5)).toBe(1);
    expect(structuresForCount(intern, 6)).toBe(2);
    expect(structuresForCount(intern, 10)).toBe(2);
  });

  test("caps at maxStructures", () => {
    expect(structuresForCount(intern, 1_000_000)).toBe(intern.maxStructures);
  });
});

describe("computeOfficePlacements", () => {
  test("no employees → no placements", () => {
    expect(computeOfficePlacements({})).toEqual([]);
    expect(
      computeOfficePlacements({ intern: 0, vibe_coder: 0, "10x_dev": 0 }),
    ).toEqual([]);
  });

  test("tier upgrades at thresholds (sprite swaps, not multiplies)", () => {
    const spriteAt = (count: number) =>
      computeOfficePlacements({ intern: count })[0]?.spriteId;
    expect(spriteAt(1)).toBe("buildingTiles_000.png");
    expect(spriteAt(24)).toBe("buildingTiles_000.png");
    expect(spriteAt(25)).toBe("buildingTiles_008.png");
    expect(spriteAt(99)).toBe("buildingTiles_008.png");
    expect(spriteAt(100)).toBe("buildingTiles_038.png");
  });

  test("all structures of a type share the current tier sprite", () => {
    const placed = computeOfficePlacements({ intern: 120 });
    expect(placed.length).toBeGreaterThan(1);
    expect(placed.every((p) => p.spriteId === "buildingTiles_038.png")).toBe(
      true,
    );
  });

  test("placements stay inside the type's zone", () => {
    const placed = computeOfficePlacements({ intern: 1_000_000 });
    const { zone } = EMPLOYEE_BUILDINGS.intern;
    for (const p of placed) {
      expect(p.mapX).toBeGreaterThanOrEqual(zone.x0);
      expect(p.mapX).toBeLessThanOrEqual(zone.x1);
      expect(p.mapY).toBeGreaterThanOrEqual(zone.y0);
      expect(p.mapY).toBeLessThanOrEqual(zone.y1);
    }
  });

  test("different types occupy non-overlapping cells", () => {
    const placed = computeOfficePlacements({
      intern: 1_000_000,
      vibe_coder: 1_000_000,
      "10x_dev": 1_000_000,
    });
    const cells = placed.map((p) => `${p.mapX},${p.mapY}`);
    expect(new Set(cells).size).toBe(cells.length);
  });

  test("deterministic: same counts → identical output", () => {
    const counts = { intern: 37, vibe_coder: 12, "10x_dev": 8 };
    expect(computeOfficePlacements(counts)).toEqual(
      computeOfficePlacements(counts),
    );
  });

  test("stable keys are unique", () => {
    const placed = computeOfficePlacements({
      intern: 200,
      vibe_coder: 90,
      "10x_dev": 90,
    });
    const keys = placed.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
