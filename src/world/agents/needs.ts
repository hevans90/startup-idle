/**
 * World v2 — WHAT EACH KIND NEEDS NEAR HOME, and the services that meet it.
 * The town opens them itself, where the need is: a small one in the ground
 * floor of a house, a big one on a lot of its own. A house grows a tier only
 * with enough of its kind's needs met. @see stepTown, NEEDS_FOR
 */
import type { GeneratorId } from "../../state/generators.store";
import type { Structure } from "../grid";

export type NeedId = "food" | "nightlife" | "coffee" | "scene" | "health" | "fitness" | "quiet";

/** Each kind's needs, in the order they matter. */
export const NEEDS: Record<GeneratorId, readonly NeedId[]> = {
  intern: ["food", "nightlife"],
  vibe_coder: ["coffee", "scene"],
  "10x_dev": ["health", "fitness", "quiet"],
};

/** Whose need each is. */
export const NEED_KIND: Record<NeedId, GeneratorId> = {
  food: "intern", nightlife: "intern", coffee: "vibe_coder", scene: "vibe_coder", health: "10x_dev", fitness: "10x_dev", quiet: "10x_dev",
};

export type ServiceId =
  | "takeaway" | "bakery" | "bar" | "club" | "arcade"
  | "cafe" | "kombucha" | "coworking" | "vape" | "cinema"
  | "pharmacy" | "doctor" | "dentist" | "gym" | "climbing" | "park";

/** A service: the need it meets, and whether it is a shop in a house's ground floor or a building of its own. */
export type ServiceDef = { id: ServiceId; name: string; need: NeedId; shop: boolean };

export const SERVICE_DEFS: readonly ServiceDef[] = [
  { id: "takeaway", name: "Takeaway", need: "food", shop: true },
  { id: "bakery", name: "Bakery", need: "food", shop: true },
  { id: "bar", name: "Bar", need: "nightlife", shop: true },
  { id: "club", name: "Night club", need: "nightlife", shop: false },
  { id: "arcade", name: "Arcade", need: "nightlife", shop: true },
  { id: "cafe", name: "Café", need: "coffee", shop: true },
  { id: "kombucha", name: "Kombucha bar", need: "coffee", shop: true },
  { id: "coworking", name: "Co-working", need: "scene", shop: false },
  { id: "vape", name: "Vape shop", need: "scene", shop: true },
  { id: "cinema", name: "Cinema", need: "scene", shop: false },
  { id: "pharmacy", name: "Pharmacy", need: "health", shop: true },
  { id: "doctor", name: "Doctor", need: "health", shop: false },
  { id: "dentist", name: "Dentist", need: "health", shop: true },
  { id: "gym", name: "Gym", need: "fitness", shop: false },
  { id: "climbing", name: "Climbing wall", need: "fitness", shop: false },
  { id: "park", name: "Park", need: "quiet", shop: false },
];

export const SERVICE_IDS: readonly ServiceId[] = SERVICE_DEFS.map((d) => d.id);
const BY_ID = new Map(SERVICE_DEFS.map((d) => [d.id, d]));
export const serviceDef = (id: string): ServiceDef | undefined => BY_ID.get(id as ServiceId);

/** Which service a structure is drawn as, if it is a service building of its own — a café from before shops among them. */
export const serviceOf = (defId: string): ServiceId | null => {
  const d = serviceDef(defId);
  return d && (!d.shop || d.id === "cafe") ? d.id : null;
};

/** The service a structure keeps: a building of its own, or a shop in its ground floor. */
export const serviceIn = (s: Structure): ServiceId | null => serviceOf(s.def) ?? (s.shop ? (s.shop as ServiceId) : null);

/** Each need's services, in the order they open. */
export const SERVICES_FOR: Record<NeedId, readonly ServiceId[]> = Object.fromEntries(
  (Object.keys(NEED_KIND) as NeedId[]).map((n) => [n, SERVICE_DEFS.filter((d) => d.need === n).map((d) => d.id)]),
) as unknown as Record<NeedId, readonly ServiceId[]>;

/** Needs met a house must have to grow into each tier: all of them for a tower. */
export const NEEDS_FOR = { t0: 0, t1: 1, t2: 2, landmark: Infinity } as const;
/** How many needs a kind must have met for a tier, its own needs being fewer than the rule. */
export const needsAt = (who: GeneratorId, t: keyof typeof NEEDS_FOR) => Math.min(NEEDS[who].length, NEEDS_FOR[t]);
