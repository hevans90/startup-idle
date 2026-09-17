/**
 * SHARED (Phase 0). Bodies moved verbatim from `src/office/**`; the original
 * modules re-export them so v1 call sites are untouched. Do NOT change behaviour
 * here — v2 adds siblings alongside instead.
 */

import type { SpriteId } from "./types";

/**
 * Building-kit COMPOSITION — pure, data-free, shared by v1 and v2.
 *
 * A kit composes a tower from parts: a `ground` entrance floor, one or more
 * `mids` (cycled for floor-to-floor variety), a `roof` cap, optional
 * `rooftopProps`, a per-kit `lift` (px each floor rises — modules differ in wall
 * height), a `maxFloors` cap, and `baseNudge` (extra lift the taller-based
 * ground tiles add to whatever stacks on them; see {@link BASE_TILE_IDS}).
 *
 * Kit DATA — loading `building-kits.json`, the `KITS` / `LANDMARK_KITS` tables
 * and the dev-labeller HMR hook — stays in `src/office/city/building-kits.ts`,
 * which re-exports everything here.
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
  /** Extra lift a base-tile ground adds to the floors above it. */
  baseNudge: number;
};

/**
 * Building tiles whose isometric diamond sits on a taller base (extra ground /
 * pavement skirt). When one is a ground floor, everything stacked above must be
 * lifted by the kit's `baseNudge` so floors meet flush. Mirrors the same set in
 * the labeller (`dev/buildinglab.html`).
 */

export const BASE_TILE_IDS: ReadonlySet<string> = (() => {
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
export function tileId(spriteId: SpriteId): string {
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
};

/**
 * Compose a tower from a kit: ground floor, `floors-1` mid modules (seed-varied),
 * a roof cap, then any rooftop props seated ON the roof. `lift` accumulates per
 * floor and a base tile adds its `baseNudge` to everything above it — exactly
 * mirroring the labeller's live preview so authored kits render identically
 * in-game. Rooftop props share the roof's lift (they rest on the roofline,
 * not stacked a full floor above it) and draw over the roof.
 */
export function composeBuilding(
  kit: BuildingKit,
  floors: number,
  seed: number,
): BuildingPart[] {
  const structural: SpriteId[] = [];
  const ground = kit.ground ?? kit.mids[0] ?? kit.roof;
  if (ground) structural.push(ground);
  for (let f = 1; f < floors; f++) {
    const mid = kit.mids.length
      ? kit.mids[(seed + f) % kit.mids.length]
      : (kit.ground ?? kit.roof);
    if (mid) structural.push(mid);
  }
  if (kit.roof) structural.push(kit.roof); // roof is an additive cap, not a floor

  const parts: BuildingPart[] = [];
  let lift = 0;
  let roofLift = 0; // lift of the topmost structural tile (the roof)
  structural.forEach((spriteId, level) => {
    parts.push({ spriteId, lift, depth: 1 + level });
    roofLift = lift;
    lift += kit.lift + (isBaseTile(spriteId) ? kit.baseNudge : 0);
  });

  // Rooftop props sit on the roof surface (the roof's own lift) and draw above it.
  kit.rooftopProps.forEach((spriteId, i) => {
    parts.push({ spriteId, lift: roofLift, depth: structural.length + 1 + i });
  });

  return parts;
}
