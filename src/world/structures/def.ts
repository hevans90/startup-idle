/**
 * World v2 — what a structure IS, separately from how it draws.
 *
 * A definition is data: a footprint, a render strategy, and the rules for where
 * it may stand. Nothing here imports Pixi or touches a container, so placement
 * and validation are testable without a renderer — which matters because the
 * placement rules are where the bugs live, not the sprite stacking.
 *
 * v1 has no such split. The slop pit IS a structure, but its footprint lives as
 * ~7 hardcoded span constants inside `GroundRoadLayer`, so there is no way to
 * ask "what occupies this cell" or to place a second one. The registry below is
 * the thing that was missing.
 */
import type { BuildingKit } from "../../iso/kits";
import kits from "../../../building-kits.json";

/** A building kit from `building-kits.json`: stacked ground/mid/roof frames. */
export type KitRef = {
  /** Key into that file's `kits` map. */
  kit: string;
  /** Floors to stack, clamped to the kit's own `maxFloors`. */
  floors?: number;
};

/**
 * How a structure draws. Stacked tiles, or "a renderer written by hand" for
 * anything procedural.
 *
 * There was an `excavation` strategy here for the slop pit. It is gone: a pool
 * merges with its neighbours on contact and splits when you fill it in, which
 * makes it a REGION and not a placed object, so fluid became a layer with
 * derived components — see `world/pools`.
 */
export type RenderSpec =
  | { kind: "tiles"; kit: KitRef }
  | { kind: "custom"; rendererId: string };

export type Placement = {
  /** May stand on a paved cell. Default false — a road is not a foundation. */
  allowOnPaved?: boolean;
  /**
   * Level the footprint to its median height as part of placing, in the SAME
   * command. Default true: structures need level ground, and making the player
   * flatten by hand first is the annoying half of the rule.
   */
  autoFlatten?: boolean;
};

export type StructureDef = {
  id: string;
  name: string;
  footprint: { w: number; h: number };
  render: RenderSpec;
  /**
   * The footprint draws no ground tile.
   *
   * A RENDER rule, not a data one: the terrain layer keeps its material and the
   * renderer skips those cells while the structure stands. Zeroing the layer
   * would throw away what was underneath, so demolishing could not put it back
   * and every excavation would leave a permanent hole in the map.
   */
  clearsTerrain?: boolean;
  placement?: Placement;
};

const RAW_KITS = (kits as { kits: Record<string, Partial<BuildingKit>> }).kits;
const KIT_IDS = Object.keys(RAW_KITS);

/**
 * One kit from `building-kits.json`, with its defaults filled in.
 *
 * The same normalisation v1 does privately in `office/city/building-kits.ts`,
 * repeated here rather than imported: v2 does not depend on `src/office/`, and
 * the shared half — kit COMPOSITION — already lives in `src/iso/kits.ts`, which
 * is what both sides call.
 */
export function kitByName(id: string): BuildingKit | null {
  const raw = RAW_KITS[id];
  if (!raw) return null;
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

/**
 * One 1×1 definition per building kit.
 *
 * Generated rather than hand-listed so the registry cannot drift from the kit
 * file — which is hand-authored, and the place new buildings actually arrive.
 */
const kitDefs = (): StructureDef[] =>
  KIT_IDS.map((kit) => ({
    id: `kit:${kit}`,
    name: kit,
    footprint: { w: 1, h: 1 },
    render: { kind: "tiles", kit: { kit } },
  }));

const DEFS = new Map<string, StructureDef>(
  kitDefs().map((d) => [d.id, d]),
);

export const structureDef = (id: string): StructureDef | null => DEFS.get(id) ?? null;

/**
 * Add or replace a definition.
 *
 * A placed structure records its def by ID, and the renderer resolves that ID
 * through here — so a definition that exists only as an object nothing can look
 * up is placeable but not drawable. Content that does not come from the kit
 * file registers itself through this.
 */
export function registerStructureDef(def: StructureDef): void {
  DEFS.set(def.id, def);
}

export const allStructureDefs = (): StructureDef[] => [...DEFS.values()];

/** Placement rules with the defaults filled in, so callers never re-state them. */
export function placementOf(def: StructureDef): Required<Placement> {
  return {
    allowOnPaved: def.placement?.allowOnPaved ?? false,
    autoFlatten: def.placement?.autoFlatten ?? true,
  };
}

