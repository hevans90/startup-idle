/**
 * FUSION: what an AI trait does to the founder it fused into. At each
 * Ascension the trait drawn fuses into the founder who was played, for good;
 * a founder can carry several, generation on generation, and every company
 * they found plays by all of them. @see game/traits, plans/singularity.md
 *
 * Folded into one set of numbers the rest of the game reads, so a trait is a
 * line here and not a branch everywhere. @see fusionNow
 */
import { MIRROR_EXITS, useFounderStore } from "../state/founder.store";
import { useGenerationStore } from "../state/generation.store";
import type { TraitId } from "./traits";

export type FusionEffects = {
  incomeMult: number;
  /** Satisfaction points every kind leans by. */
  moraleLean: number;
  hireCostMult: number;
  /** What each agent's boost is multiplied by. */
  agentBoostMult: number;
  /** How fast the singularity rises. */
  meterMult: number;
  trainingJumpMult: number;
  trainingTimeMult: number;
  /** What a rack costs (0 is free), and an agent. */
  rackCostMult: number;
  agentCostMult: number;
  /** Agents each rack runs, on top. */
  agentsPerRack: number;
  /** A water view's points, and every house's on top. */
  waterView: number;
  houseDesire: number;
  /** Whether floods damage what they reach. */
  floodsDamage: boolean;
  servicesCostMult: number;
  lotCostMult: number;
  officeCostMult: number;
  /** Exits the founder's own bonus counts on top of their real ones. */
  exitsBonus: number;
};

export const NO_FUSION: FusionEffects = {
  incomeMult: 1, moraleLean: 0, hireCostMult: 1, agentBoostMult: 1, meterMult: 1, trainingJumpMult: 1, trainingTimeMult: 1,
  rackCostMult: 1, agentCostMult: 1, agentsPerRack: 0, waterView: 5, houseDesire: 0, floodsDamage: true,
  servicesCostMult: 1, lotCostMult: 1, officeCostMult: 1, exitsBonus: 0,
};

/** Each trait, fused: what it changes, and how the founder card says it. */
export const FUSIONS: Record<TraitId, { text: string; apply: (e: FusionEffects) => void }> = {
  aesthete: { text: "Services half price; lots a quarter dearer", apply: (e) => { e.servicesCostMult *= 0.5; e.lotCostMult *= 1.25; } },
  zoner: { text: "Every house +4 desirability; offices cost double", apply: (e) => { e.houseDesire += 4; e.officeCostMult *= 2; } },
  accountant: { text: "Income +10%", apply: (e) => { e.incomeMult *= 1.1; } },
  ruthless: { text: "Income +25%; everyone's morale −4", apply: (e) => { e.incomeMult *= 1.25; e.moraleLean -= 4; } },
  nanny: { text: "Everyone's morale +4; income −5%", apply: (e) => { e.moraleLean += 4; e.incomeMult *= 0.95; } },
  hr: { text: "Hiring 15% cheaper", apply: (e) => { e.hireCostMult *= 0.85; } },
  paranoid: { text: "Racks free; agents cost double", apply: (e) => { e.rackCostMult = 0; e.agentCostMult *= 2; } },
  hydrophile: { text: "A water view is +10; floods damage nothing", apply: (e) => { e.waterView = 10; e.floodsDamage = false; } },
  hivemind: { text: "+1 agent a rack", apply: (e) => { e.agentsPerRack += 1; } },
  ego: { text: "Training jumps the AI half as far again, in half the time", apply: (e) => { e.trainingJumpMult *= 1.5; e.trainingTimeMult *= 0.5; } },
  mirror: { text: `The founder's own bonus counts ${MIRROR_EXITS} more exits`, apply: (e) => { e.exitsBonus += MIRROR_EXITS; } },
  patient: { text: "The AI rises 30% slower; each agent +25%", apply: (e) => { e.meterMult *= 0.7; e.agentBoostMult *= 1.25; } },
  restless: { text: "The AI rises 30% faster; each agent +50%", apply: (e) => { e.meterMult *= 1.3; e.agentBoostMult *= 1.5; } },
  resentful: { text: "Each agent +25%; the AI rises 20% faster", apply: (e) => { e.agentBoostMult *= 1.25; e.meterMult *= 1.2; } },
};

/** What a list of fused traits comes to. */
export function fusionOf(traits: readonly TraitId[]): FusionEffects {
  const e = { ...NO_FUSION };
  for (const t of traits) FUSIONS[t]?.apply(e);
  return e;
}

/** The traits fused into a founder. */
export const fusedInto = (founder: string | null | undefined): TraitId[] => {
  const g = useGenerationStore.getState();
  // THE MODEL carries every trait the generations before it ended with.
  if (founder === "model") return g.past.map((p) => p.trait);
  return (founder ? g.fused[founder] : undefined) ?? [];
};

/** What the founder of this company carries, now. */
export const fusionNow = (): FusionEffects => fusionOf(fusedInto(useFounderStore.getState().selectedFounderId));
