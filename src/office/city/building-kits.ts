import type { GeneratorId } from "../../state/generators.store";
import type { SpriteId } from "../map/types";
import buildingKitsData from "../../../building-kits.json";

/**
 * Building kits — the single source of truth is `building-kits.json`, authored
 * in the dev building-kit labeller (`dev/buildinglab.html`). It's imported
 * directly, so Vite bundles it into production builds (no dev-tool dependency at
 * runtime) and there's no duplicated copy to keep in sync. In dev it also
 * hot-updates as the labeller saves (see the bottom of this file).
 *
 * Each kit composes a tower from parts: a `ground` entrance floor, one or more
 * `mids` (cycled for floor-to-floor variety), a `roof` cap, optional
 * `rooftopProps`, a per-kit `lift` (px each floor rises — modules differ in wall
 * height), `maxFloors` cap, and `baseNudge` (extra lift the
 * taller-based ground tiles add to whatever stacks on them; see BASE_TILE_IDS).
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

/** A raw kit entry as stored in building-kits.json. */
type RawKit = Partial<BuildingKit>;

const TIER_SLOT: Record<string, number> = { t0: 0, t1: 1, t2: 2 };

function toKit(raw: RawKit): BuildingKit {
  return {
    ground: raw.ground ?? null,
    mids: raw.mids ?? [],
    roof: raw.roof ?? null,
    rooftopProps: raw.rooftopProps ?? [],
    lift: raw.lift ?? 33,
    maxFloors: raw.maxFloors ?? 6,
    baseNudge: raw.baseNudge ?? 0,
  };
}

/** Tiers per district (t0 → t2), best last; a district climbs them as it grows. */
export const KITS: Record<GeneratorId, BuildingKit[]> = {
  intern: [],
  vibe_coder: [],
  "10x_dev": [],
};

/**
 * Ground decorations (trees / planters) scattered on unbuilt, street-facing
 * plots. These come from the city-detail atlas (not the labeller, whose palette
 * is building tiles), so they're listed here directly. Empty = no scatter.
 */
export const GROUND_PROPS: SpriteId[] = ["cityDetails_010.png"];

/** The hero / HQ building per district, on the plot nearest the access road. */
export const LANDMARK_KITS = {} as Record<GeneratorId, BuildingKit>;

/**
 * Populate KITS / LANDMARK_KITS in place from a labeller-format kit map (keys
 * like `"intern.t0"` / `"10x_dev.landmark"`). Mutates in place so live updates
 * are seen by everything already holding the exported references.
 */
export function loadKits(data: { kits?: Record<string, RawKit> }): void {
  if (!data?.kits) return;
  for (const [key, raw] of Object.entries(data.kits)) {
    const dot = key.lastIndexOf(".");
    if (dot < 0) continue;
    const district = key.slice(0, dot) as GeneratorId;
    const slot = key.slice(dot + 1);
    if (!KITS[district]) continue; // unknown district
    const kit = toKit(raw);
    if (slot === "landmark") LANDMARK_KITS[district] = kit;
    else if (slot in TIER_SLOT) KITS[district][TIER_SLOT[slot]] = kit;
  }
}

loadKits(buildingKitsData as { kits?: Record<string, RawKit> });

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

// ---------------------------------------------------------------------------
// DEV-ONLY live authoring: re-read building-kits.json whenever the labeller
// saves, so edits — max heights, tiles, lift — appear in-game without a
// reload. Production never fetches anything (this block is dead code when
// `import.meta.env.DEV` is false and is tree-shaken away).
// ---------------------------------------------------------------------------

/** Subscribe to live kit changes (dev only). No-op in production. */
type KitsListener = () => void;
const kitsListeners = new Set<KitsListener>();
export function onKitsChanged(cb: KitsListener): () => void {
  kitsListeners.add(cb);
  return () => kitsListeners.delete(cb);
}

// When building-kits.json changes (the labeller saves to it), Vite re-imports
// it and calls this accept handler with the new data — we re-parse and notify,
// so kits update in-place without a full reload. Undefined in production.
const hot = (
  import.meta as {
    hot?: {
      accept(dep: string, cb: (mod?: { default: unknown }) => void): void;
    };
  }
).hot;
hot?.accept("../../../building-kits.json", (mod) => {
  if (!mod) return;
  loadKits(mod.default as { kits?: Record<string, RawKit> });
  kitsListeners.forEach((cb) => cb());
});
