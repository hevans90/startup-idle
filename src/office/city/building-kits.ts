import type { GeneratorId } from "../../state/generators.store";
import type { SpriteId } from "../map/types";
import { type BuildingKit } from "../../iso/kits";
import buildingKitsData from "../../../building-kits.json";

// Phase 0: moved to `src/iso/`. Re-exported here so v1 call sites are unchanged.
export {
  BASE_TILE_IDS,
  composeBuilding,
  isBaseTile,
  tileId,
} from "../../iso/kits";
export type { BuildingKit, BuildingPart } from "../../iso/kits";

/**
 * Building-kit DATA. The single source of truth is `building-kits.json`,
 * authored in the dev building-kit labeller (`dev/buildinglab.html`). It's
 * imported directly, so Vite bundles it into production builds (no dev-tool
 * dependency at runtime) and there's no duplicated copy to keep in sync. In dev
 * it also hot-updates as the labeller saves (see the bottom of this file).
 *
 * Kit COMPOSITION (`composeBuilding`, `BASE_TILE_IDS`, …) lives in
 * `src/iso/kits.ts` and is re-exported above.
 */
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
