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
  /**
   * Must stand on a RIVER'S BANK: on dry ground, with the river beside it.
   * A fact about the building — a seaport away from the water is not one — so
   * the editor obeys it too, unlike frontage. @see riversBeside
   */
  riverside?: boolean;
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
  /**
   * A SEAPORT: boats on the river beside it call here. How many can lie
   * alongside at once, and for how long each one does. @see world/boats/traffic
   */
  port?: { berths: number; dockSeconds: number };
  /**
   * What clicking it with the build tool turns it into, in place, if anything:
   * the next tier, grown out of its own footprint. @see upgradeCommand
   */
  upgradesTo?: string;
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
 *
 * EVERY KIT IS HOUSING, because the kits ARE the three employee districts:
 * `intern`, `vibe_coder`, `10x_dev`, each in tiers. That is what binds the map
 * to the economy — a placed building is beds, and beds are the ceiling on
 * hiring. @see housedBy
 *
 * The road requirement is NOT set here. It is a rule of the GAME, not a fact
 * about the building, and the editor has to stay able to author a map with a
 * building wherever it likes. @see PlaceRules
 */
const kitDefs = (): StructureDef[] =>
  KIT_IDS.map((kit) => ({
    id: `kit:${kit}`,
    name: kit,
    footprint: { w: 1, h: 1 },
    render: { kind: "tiles", kit: { kit } },
  }));

/**
 * THE SEAPORTS, by tier: quays, warehouses and cranes on a river's bank. While
 * one stands beside a river, boats come down that river to call at it.
 *
 * A bigger port is a longer quay with more BERTHS — boats alongside at once —
 * and quicker turnarounds, so a river's ports can take more boats a minute and
 * the river sends them in faster. The tier-one id stays `seaport`, which maps
 * saved before tiers already name. @see stepTraffic
 */
export const SEAPORTS: readonly StructureDef[] = [
  { id: "seaport", name: "seaport", footprint: { w: 2, h: 2 }, port: { berths: 1, dockSeconds: 20 }, upgradesTo: "seaport-2" },
  { id: "seaport-2", name: "seaport II", footprint: { w: 3, h: 2 }, port: { berths: 2, dockSeconds: 15 }, upgradesTo: "seaport-3" },
  { id: "seaport-3", name: "seaport III", footprint: { w: 4, h: 2 }, port: { berths: 3, dockSeconds: 10 } },
].map((d) => ({
  ...d,
  render: { kind: "custom", rendererId: "seaport" } as const,
  placement: { riverside: true },
}));

/** The first tier. */
export const SEAPORT = SEAPORTS[0];

/**
 * BUILDINGS RAISED AS PROJECTS, not bought off a list: a site is chosen and
 * employees build them over time, and what they open is unlocked when they
 * do. Never for sale in the build bar. @see game/projects
 */
export const PROJECT_BUILDINGS: readonly StructureDef[] = [
  {
    id: "garage",
    name: "Founder's Garage",
    footprint: { w: 2, h: 1 },
    render: { kind: "custom", rendererId: "project" },
  },
  {
    id: "studio",
    name: "Vibe Coder Studio",
    footprint: { w: 3, h: 2 },
    render: { kind: "custom", rendererId: "project" },
  },
  {
    id: "hq",
    name: "Company HQ",
    footprint: { w: 3, h: 3 },
    render: { kind: "custom", rendererId: "project" },
  },
  {
    id: "boardroom",
    name: "Boardroom Tower",
    footprint: { w: 3, h: 3 },
    render: { kind: "custom", rendererId: "project" },
  },
  {
    id: "campus",
    name: "Campus",
    footprint: { w: 4, h: 4 },
    render: { kind: "custom", rendererId: "project" },
  },
  {
    id: "townhall",
    name: "Town Hall",
    footprint: { w: 3, h: 2 },
    render: { kind: "custom", rendererId: "project" },
  },
  {
    id: "harbour",
    name: "Harbour Office",
    footprint: { w: 2, h: 2 },
    render: { kind: "custom", rendererId: "project" },
  },
];

/**
 * OFFICES: more places for a kind of employee to work, bought and put down
 * anywhere on the road like housing, so a town can bring work closer to where
 * its people live. Drawn like the building that first opened that kind of
 * work, smaller or larger. @see world/agents/commute
 */
export const OFFICES: readonly StructureDef[] = [
  { id: "office-intern", name: "Intern office", footprint: { w: 2, h: 2 }, render: { kind: "custom", rendererId: "project" } },
  { id: "office-vibe", name: "Vibe studio", footprint: { w: 2, h: 2 }, render: { kind: "custom", rendererId: "project" } },
  { id: "office-10x", name: "10x office", footprint: { w: 3, h: 3 }, render: { kind: "custom", rendererId: "project" } },
];

/**
 * SERVICES: a café, a park and a gym, which serve the homes near them along
 * the roads, and are what houses grow by. @see world/agents/services
 */
export const SERVICES: readonly StructureDef[] = [
  { id: "cafe", name: "Café", footprint: { w: 2, h: 1 }, render: { kind: "custom", rendererId: "project" } },
  { id: "park", name: "Park", footprint: { w: 2, h: 2 }, render: { kind: "custom", rendererId: "project" } },
  { id: "gym", name: "Gym", footprint: { w: 2, h: 2 }, render: { kind: "custom", rendererId: "project" } },
];

/**
 * THE SLOP PIT: where fifty vibe coders' output goes. Not built or bought: it
 * opens up beside the studio on its own once there are that many, and fills.
 * @see state/slop-pit.store, slop-renderer
 */
export const SLOP_PIT: StructureDef = {
  id: "slop-pit", name: "Slop pit", footprint: { w: 3, h: 3 }, render: { kind: "custom", rendererId: "slop" },
  // A hole: the ground there is not drawn, or it would cover what is in it.
  clearsTerrain: true,
};

const DEFS = new Map<string, StructureDef>(
  [...kitDefs(), ...SEAPORTS, ...PROJECT_BUILDINGS, ...OFFICES, ...SERVICES, SLOP_PIT].map((d) => [d.id, d]),
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
    riverside: def.placement?.riverside ?? false,
  };
}

