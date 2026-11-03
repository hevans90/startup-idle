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
  /** Road tiles further every service reaches. @see liveCoverage */
  serviceReach: number;
  lotCostMult: number;
  officeCostMult: number;
  /** Exits the founder's own bonus counts on top of their real ones. */
  exitsBonus: number;
};

export const NO_FUSION: FusionEffects = {
  incomeMult: 1, moraleLean: 0, hireCostMult: 1, agentBoostMult: 1, meterMult: 1, trainingJumpMult: 1, trainingTimeMult: 1,
  rackCostMult: 1, agentCostMult: 1, agentsPerRack: 0, waterView: 5, houseDesire: 0, floodsDamage: true,
  serviceReach: 0, lotCostMult: 1, officeCostMult: 1, exitsBonus: 0,
};

/** Each trait, fused: what it changes, and how the founder card says it. Half what it was: the story is the reward now. @see plans/ascension-overhaul.md §5 */
export const FUSIONS: Record<TraitId, { text: string; apply: (e: FusionEffects) => void }> = {
  aesthete: { text: "Services reach +2 tiles; lots +10%", apply: (e) => { e.serviceReach += 2; e.lotCostMult *= 1.1; } },
  zoner: { text: "Every house +2 desirability; offices +50%", apply: (e) => { e.houseDesire += 2; e.officeCostMult *= 1.5; } },
  accountant: { text: "Income +5%", apply: (e) => { e.incomeMult *= 1.05; } },
  ruthless: { text: "Income +12%; everyone's morale −2", apply: (e) => { e.incomeMult *= 1.12; e.moraleLean -= 2; } },
  nanny: { text: "Everyone's morale +2; income −3%", apply: (e) => { e.moraleLean += 2; e.incomeMult *= 0.97; } },
  hr: { text: "Hiring 8% cheaper", apply: (e) => { e.hireCostMult *= 0.92; } },
  paranoid: { text: "Racks half price; agents +50%", apply: (e) => { e.rackCostMult *= 0.5; e.agentCostMult *= 1.5; } },
  hydrophile: { text: "A water view is +8; floods damage nothing", apply: (e) => { e.waterView = 8; e.floodsDamage = false; } },
  hivemind: { text: "+1 agent a rack", apply: (e) => { e.agentsPerRack += 1; } },
  ego: { text: "Training jumps the AI a quarter further, in three quarters the time", apply: (e) => { e.trainingJumpMult *= 1.25; e.trainingTimeMult *= 0.75; } },
  mirror: { text: `The founder's own bonus counts ${MIRROR_EXITS} more exit${MIRROR_EXITS === 1 ? "" : "s"}`, apply: (e) => { e.exitsBonus += MIRROR_EXITS; } },
  patient: { text: "The AI rises 15% slower; each agent +12%", apply: (e) => { e.meterMult *= 0.85; e.agentBoostMult *= 1.12; } },
  restless: { text: "The AI rises 15% faster; each agent +25%", apply: (e) => { e.meterMult *= 1.15; e.agentBoostMult *= 1.25; } },
  resentful: { text: "Each agent +12%; the AI rises 10% faster", apply: (e) => { e.agentBoostMult *= 1.12; e.meterMult *= 1.1; } },
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
