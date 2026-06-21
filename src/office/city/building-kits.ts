import type { GeneratorId } from "../../state/generators.store";
import type { SpriteId } from "../map/types";

/**
 * Baked building kits — the production copy of the data authored live in the
 * dev building-kit labeller (`dev/buildinglab.html` → `building-kits.json`).
 * Committed so the build never depends on the dev tool or its JSON file.
 *
 * Each kit composes a tower from parts: a `ground` entrance floor, one or more
 * `mids` (cycled for floor-to-floor variety), a `roof` cap, optional
 * `rooftopProps`, a per-kit `lift` (px each floor rises — modules differ in wall
 * height), `maxFloors` cap, optional `tint`, and `baseNudge` (extra lift the
 * taller-based ground tiles add to whatever stacks on them; see BASE_TILE_IDS).
 *
 * To re-bake after editing in the labeller: copy the kit values out of
 * `building-kits.json` into the literals below.
 */
export type BuildingKit = {
  ground: SpriteId | null;
  mids: SpriteId[];
  roof: SpriteId | null;
  rooftopProps: SpriteId[];
  /** Screen-up px each stacked floor rises (native px at scale 1). */
  lift: number;
  /** Tallest this kit grows. */
  maxFloors: number;
  /** Optional Pixi tint (0xRRGGBB); null = untinted. */
  tint: number | null;
  /** Extra lift a base-tile ground adds to the floors above it. */
  baseNudge: number;
};

/** Tiers per district (t0 → t2), best last; a district climbs them as it grows. */
export const KITS: Record<GeneratorId, BuildingKit[]> = {
  intern: [
    { ground: "buildingTiles_030.png", mids: ["buildingTiles_054.png", "buildingTiles_052.png"], roof: "buildingTiles_120.png", rooftopProps: [], lift: 33, maxFloors: 4, tint: null, baseNudge: 42 },
    { ground: "buildingTiles_113.png", mids: ["buildingTiles_049.png", "buildingTiles_045.png"], roof: "buildingTiles_111.png", rooftopProps: [], lift: 32, maxFloors: 6, tint: null, baseNudge: 44 },
    { ground: "buildingTiles_018.png", mids: ["buildingTiles_049.png", "buildingTiles_045.png", "buildingTiles_016.png"], roof: "buildingTiles_082.png", rooftopProps: [], lift: 33, maxFloors: 8, tint: null, baseNudge: 44 },
  ],
  vibe_coder: [
    { ground: "buildingTiles_014.png", mids: ["buildingTiles_047.png", "buildingTiles_043.png"], roof: "buildingTiles_120.png", rooftopProps: [], lift: 33, maxFloors: 4, tint: null, baseNudge: 42 },
    { ground: "buildingTiles_014.png", mids: ["buildingTiles_047.png", "buildingTiles_043.png"], roof: "buildingTiles_127.png", rooftopProps: [], lift: 33, maxFloors: 6, tint: null, baseNudge: 42 },
    { ground: "buildingTiles_014.png", mids: ["buildingTiles_038.png", "buildingTiles_032.png"], roof: "buildingTiles_103.png", rooftopProps: [], lift: 33, maxFloors: 8, tint: null, baseNudge: 42 },
  ],
  "10x_dev": [
    { ground: "buildingTiles_125.png", mids: ["buildingTiles_024.png"], roof: "buildingTiles_094.png", rooftopProps: ["buildingTiles_088.png"], lift: 32, maxFloors: 4, tint: null, baseNudge: 42 },
    { ground: "buildingTiles_125.png", mids: ["buildingTiles_008.png", "buildingTiles_031.png"], roof: "buildingTiles_128.png", rooftopProps: [], lift: 32, maxFloors: 6, tint: null, baseNudge: 42 },
    { ground: "buildingTiles_125.png", mids: ["buildingTiles_031.png", "buildingTiles_008.png"], roof: "buildingTiles_127.png", rooftopProps: [], lift: 32, maxFloors: 8, tint: null, baseNudge: 42 },
  ],
};

/** The hero / HQ building per district, on the plot nearest the access road. */
export const LANDMARK_KITS: Record<GeneratorId, BuildingKit> = {
  intern: { ground: "buildingTiles_002.png", mids: ["buildingTiles_023.png", "buildingTiles_016.png"], roof: "buildingTiles_121.png", rooftopProps: [], lift: 29, maxFloors: 10, tint: null, baseNudge: 40 },
  vibe_coder: { ground: "buildingTiles_014.png", mids: ["buildingTiles_015.png", "buildingTiles_038.png", "buildingTiles_008.png", "buildingTiles_032.png"], roof: "buildingTiles_121.png", rooftopProps: [], lift: 29, maxFloors: 10, tint: null, baseNudge: 42 },
  "10x_dev": { ground: "buildingTiles_116.png", mids: ["buildingTiles_031.png", "buildingTiles_024.png"], roof: "buildingTiles_064.png", rooftopProps: [], lift: 32, maxFloors: 10, tint: null, baseNudge: 42 },
};

/**
 * Building tiles whose isometric diamond sits on a taller base (extra ground /
 * pavement skirt). When one is a ground floor, everything stacked above must be
 * lifted by the kit's `baseNudge` so floors meet flush. Mirrors the same set in
 * the labeller (`dev/buildinglab.html`).
 */
const BASE_TILE_IDS: ReadonlySet<string> = (() => {
  const ranges: [number, number][] = [
    [1, 4], [9, 12], [14, 14], [17, 22], [25, 30], [33, 37], [40, 42],
    [46, 46], [85, 85], [92, 93], [99, 101], [106, 109], [113, 117], [122, 125],
  ];
  const s = new Set<string>();
  for (const [a, b] of ranges)
    for (let n = a; n <= b; n++) s.add(String(n).padStart(3, "0"));
  return s;
})();

/** "buildingTiles_044.png" → "044". */
function tileId(spriteId: SpriteId): string {
  return spriteId.replace(/^buildingTiles_/, "").replace(/\.png$/, "");
}

export function isBaseTile(spriteId: SpriteId): boolean {
  return BASE_TILE_IDS.has(tileId(spriteId));
}

/** One rendered piece of a building: a sprite at a screen-up offset + depth. */
export type BuildingPart = {
  spriteId: SpriteId;
  /** Screen-up offset from the building base in native px (× scale at render). */
  lift: number;
  /** Stacking index, fed to `cityDepthKey` so parts sort within the column. */
  depth: number;
  /** Pixi tint, if the kit specifies one. */
  tint?: number;
};

/**
 * Compose a tower from a kit: ground floor, `floors-1` mid modules (seed-varied),
 * then a roof cap. `lift` accumulates per floor and a base tile adds its
 * `baseNudge` to everything above it — exactly mirroring the labeller's live
 * preview so authored kits render identically in-game.
 *
 * NOTE: `rooftopProps` are intentionally NOT placed yet — they need on-roof
 * positioning (sitting on the roof surface, not stacked a full floor above) and
 * a labeller preview. That lands in Phase 3; the authored data is preserved on
 * the kits until then.
 */
export function composeBuilding(
  kit: BuildingKit,
  floors: number,
  seed: number,
): BuildingPart[] {
  const tiles: SpriteId[] = [];
  const ground = kit.ground ?? kit.mids[0] ?? kit.roof;
  if (ground) tiles.push(ground);
  for (let f = 1; f < floors; f++) {
    const mid = kit.mids.length
      ? kit.mids[(seed + f) % kit.mids.length]
      : (kit.ground ?? kit.roof);
    if (mid) tiles.push(mid);
  }
  if (kit.roof) tiles.push(kit.roof); // roof is an additive cap, not a floor

  const tint = kit.tint ?? undefined;
  const parts: BuildingPart[] = [];
  let lift = 0;
  tiles.forEach((spriteId, level) => {
    parts.push({ spriteId, lift, depth: 1 + level, tint });
    lift += kit.lift + (isBaseTile(spriteId) ? kit.baseNudge : 0);
  });
  return parts;
}
