/**
 * Phase 0 characterization test.
 *
 * Pins the OBSERVABLE BEHAVIOUR of every helper being relocated into `src/iso/`,
 * and deliberately imports each one through its ORIGINAL `src/office/**` path.
 * Written and passing BEFORE the move; if it still passes afterwards, then both
 * the relocation and the re-export shims are behaviour-preserving.
 *
 * These are golden-value assertions, not specifications — if one fails after a
 * deliberate behaviour change, re-derive the expected values on purpose.
 */
import { describe, expect, test } from "bun:test";

import {
  FLOOR_LIFT,
  ISO_CELL_STRIDE,
  ISO_TILE_HEIGHT,
  ISO_TILE_WIDTH,
  ISO_Z_LIFT_PER_LAYER,
  Z_LAYER_WEIGHT,
  cityDepthKey,
  mapToWorld,
  stackedWorldY,
  worldPlaneToMapCell,
} from "../office/math-utils";
import {
  composeBuilding,
  isBaseTile,
  type BuildingKit,
} from "../office/city/building-kits";
import { parseStarlingAtlasXml } from "./atlas/parse-starling-atlas";
import { DIR } from "../office/city/road-autotile";

const CELLS: [number, number][] = [
  [0, 0], [1, 0], [0, 1], [5, 5], [12, 7], [55, 39], [-3, 4],
];

describe("phase 0 · iso projection", () => {
  test("constants", () => {
    expect(ISO_TILE_WIDTH).toBe(132);
    expect(ISO_TILE_HEIGHT).toBe(99);
    expect(ISO_CELL_STRIDE).toBe(132);
    expect(ISO_Z_LIFT_PER_LAYER).toBe(49.5);
    expect(Z_LAYER_WEIGHT).toBe(1000);
    expect(FLOOR_LIFT).toBe(33);
  });

  test("mapToWorld golden values (scale 1, z 0)", () => {
    const got = CELLS.map(([x, y]) => {
      const w = mapToWorld(x, y, 0, 1);
      return [w.x, w.y];
    });
    expect(got).toEqual([
      [0, 0], [66, 33], [-66, 33], [0, 330], [330, 627], [1056, 3102], [-462, 33],
    ]);
  });

  test("mapToWorld: z lifts screen-up by ISO_Z_LIFT_PER_LAYER * scale", () => {
    for (const s of [0.5, 1, 2]) {
      for (const z of [0, 1, 3]) {
        const flat = mapToWorld(4, 7, 0, s);
        const lifted = mapToWorld(4, 7, z, s);
        expect(lifted.x).toBeCloseTo(flat.x, 10);
        expect(lifted.y).toBeCloseTo(flat.y - z * ISO_Z_LIFT_PER_LAYER * s, 10);
      }
    }
  });

  test("worldPlaneToMapCell inverts mapToWorld at cell anchors", () => {
    for (const s of [0.5, 1, 2]) {
      for (const [x, y] of CELLS) {
        const w = mapToWorld(x, y, 0, s);
        expect(worldPlaneToMapCell(w.x, w.y, s)).toEqual({ mapX: x, mapY: y });
      }
    }
  });

  test("cityDepthKey is column-dominant", () => {
    expect(cityDepthKey(0, 0, 0)).toBe(0);
    expect(cityDepthKey(5, 5, 3)).toBe(10003);
    expect(cityDepthKey(1, 0, 0.25)).toBe(1000.25);
    // a nearer column always outranks a taller one further back
    expect(cityDepthKey(6, 6, 0)).toBeGreaterThan(cityDepthKey(5, 5, 99));
  });

  test("stackedWorldY", () => {
    expect(stackedWorldY(100, 0)).toBe(100);
    expect(stackedWorldY(100, 3)).toBe(100 - 3 * FLOOR_LIFT);
  });
});

describe("phase 0 · building kits", () => {
  const KIT: BuildingKit = {
    ground: "buildingTiles_001.png",   // in BASE_TILE_IDS -> triggers baseNudge
    mids: ["buildingTiles_050.png", "buildingTiles_051.png"],
    roof: "buildingTiles_060.png",
    rooftopProps: ["buildingTiles_070.png"],
    lift: 33,
    maxFloors: 6,
    baseNudge: 7,
  };

  test("isBaseTile", () => {
    expect(isBaseTile("buildingTiles_001.png")).toBe(true);   // range [1,4]
    expect(isBaseTile("buildingTiles_046.png")).toBe(true);   // range [46,46]
    expect(isBaseTile("buildingTiles_050.png")).toBe(false);
    expect(isBaseTile("landscapeTiles_067.png")).toBe(false);
  });

  test("composeBuilding golden stack (3 floors, seed 0)", () => {
    expect(composeBuilding(KIT, 3, 0)).toEqual([
      { spriteId: "buildingTiles_001.png", lift: 0, depth: 1 },
      { spriteId: "buildingTiles_051.png", lift: 40, depth: 2 },
      { spriteId: "buildingTiles_050.png", lift: 73, depth: 3 },
      { spriteId: "buildingTiles_060.png", lift: 106, depth: 4 },
      { spriteId: "buildingTiles_070.png", lift: 106, depth: 5 },
    ]);
  });

  test("composeBuilding: seed selects mids, rooftop props share the roof lift", () => {
    const a = composeBuilding(KIT, 3, 0);
    const b = composeBuilding(KIT, 3, 1);
    expect(b[1].spriteId).not.toBe(a[1].spriteId);
    const roof = a[a.length - 2];
    const prop = a[a.length - 1];
    expect(prop.lift).toBe(roof.lift);
    expect(prop.depth).toBeGreaterThan(roof.depth);
  });

  test("composeBuilding: single floor is ground + roof cap", () => {
    expect(composeBuilding(KIT, 1, 0).map((p) => p.spriteId)).toEqual([
      "buildingTiles_001.png",
      "buildingTiles_060.png",
      "buildingTiles_070.png",
    ]);
  });
});

describe("phase 0 · starling atlas parsing", () => {
  test("parses SubTexture rects", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<TextureAtlas imagePath="s.png">
  <SubTexture name="a.png" x="1" y="2" width="132" height="99"/>
  <SubTexture name="b.png" x="3" y="4" width="132" height="83"/>
</TextureAtlas>`;
    expect(parseStarlingAtlasXml(xml)).toEqual({
      imageFile: "s.png",
      textures: [
        { name: "a.png", x: 1, y: 2, width: 132, height: 99 },
        { name: "b.png", x: 3, y: 4, width: 132, height: 83 },
      ],
    });
  });

  test("a single SubTexture still yields an array", () => {
    const xml = `<TextureAtlas imagePath="s.png">
  <SubTexture name="only.png" x="0" y="0" width="10" height="10"/>
</TextureAtlas>`;
    expect(parseStarlingAtlasXml(xml).textures).toHaveLength(1);
  });
});

describe("phase 0 · direction bits", () => {
  test("DIR values match the labeller convention", () => {
    expect(DIR).toEqual({ N: 1, E: 2, S: 4, W: 8 });
  });
});
