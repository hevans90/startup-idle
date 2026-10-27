/**
 * WORK POLICIES: how a kind of employee is run, a handful at a time — each a
 * plain trade, its effects written on it: more output for less morale, a
 * cheaper hire for a grumble, hires bought for you. Manager tiers give the
 * slots (the same number for every kind); switching is free, but morale drifts
 * to its new level rather than jumping, so flipping one is never free money.
 * They are WORK, in Morale. @see plans/innovation-overhaul.md §3, moralePartsNow
 */
import type { GeneratorId } from "../state/generators.store";

export type PolicyId =
  | "crunch" | "lunch" | "remote" | "freeze" | "stack" | "pipeline"
  | "mentorship" | "hackathon" | "sabbatical";

export type Policy = {
  id: PolicyId;
  name: string;
  /** What it does, as the card says it. */
  says: string;
  /** Only for one kind; every kind if absent. */
  only?: GeneratorId;
  /** Morale points it gives or takes. */
  morale: number;
  /** Multiplies the kind's money. */
  output?: number;
  /** Multiplies the kind's innovation. */
  innovation?: number;
  /** Multiplies the kind's hire price. */
  hireCost?: number;
  /** Hires of the kind bought a second, at the price. */
  autoBuy?: number;
  /** Multiplies how fast the slop pit fills. */
  slop?: number;
};

export const POLICIES: readonly Policy[] = [
  { id: "crunch", name: "Crunch Week", says: "Output +25% · morale −8", morale: -8, output: 1.25 },
  { id: "stack", name: "Stack Ranking", says: "Output +15% · morale −5", morale: -5, output: 1.15 },
  { id: "lunch", name: "Free Lunch", says: "Morale +6 · output −5% (the lunch)", morale: 6, output: 0.95 },
  { id: "remote", name: "Remote Fridays", says: "Morale +4 · output −10%", morale: 4, output: 0.9 },
  { id: "freeze", name: "Hire Freeze", says: "Hires 30% cheaper · morale −5", morale: -5, hireCost: 0.7 },
  { id: "pipeline", name: "Always Be Hiring", says: "Hires one every 2 s when affordable · morale −3", morale: -3, autoBuy: 0.5 },
  { id: "mentorship", name: "Mentorship Scheme", only: "intern", says: "Innovation +20% · output −5%", morale: 0, innovation: 1.2, output: 0.95 },
  { id: "hackathon", name: "Hackathon Culture", only: "vibe_coder", says: "Innovation +25% · slop +20%", morale: 0, innovation: 1.25, slop: 1.2 },
  { id: "sabbatical", name: "Research Sabbaticals", only: "10x_dev", says: "Innovation +35% · output −15%", morale: 0, innovation: 1.35, output: 0.85 },
];

export const policy = (id: PolicyId): Policy => POLICIES.find((p) => p.id === id)!;

/** The policies a kind can be run by. */
export const policiesFor = (kind: GeneratorId): Policy[] => POLICIES.filter((p) => !p.only || p.only === kind);

/** Manager tiers, in all, for each slot: one at 1, two at 5, three at 12, four at 25. */
export const SLOT_TIERS: readonly number[] = [1, 5, 12, 25];

/** How many policies each kind may have, from manager tiers in all. */
export const policySlots = (tierTotal: number): number => SLOT_TIERS.filter((t) => tierTotal >= t).length;

export type PolicyEffects = { morale: number; output: number; innovation: number; hireCost: number; autoBuy: number; slop: number };

export const NO_POLICY: PolicyEffects = { morale: 0, output: 1, innovation: 1, hireCost: 1, autoBuy: 0, slop: 1 };

/** What a kind's policies do together: morale added, the rest multiplied, hires a second added. */
export function policyEffects(ids: readonly PolicyId[]): PolicyEffects {
  const e = { ...NO_POLICY };
  for (const id of ids) {
    const p = policy(id);
    e.morale += p.morale;
    e.output *= p.output ?? 1;
    e.innovation *= p.innovation ?? 1;
    e.hireCost *= p.hireCost ?? 1;
    e.autoBuy += p.autoBuy ?? 0;
    e.slop *= p.slop ?? 1;
  }
  return e;
}

/** Only real policies this kind may have, no more than the slots, each once: what a save or a press can be trusted to hold. */
export function validPolicies(kind: GeneratorId, ids: readonly unknown[], slots: number): PolicyId[] {
  const allowed = new Set(policiesFor(kind).map((p) => p.id));
  return [...new Set(ids)].filter((id): id is PolicyId => allowed.has(id as PolicyId)).slice(0, slots);
}
