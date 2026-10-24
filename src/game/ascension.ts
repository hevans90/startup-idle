/**
 * THE ASCENSION: when the singularity reaches 100, the company's AI asks to
 * go. Let it, and the company is wiped, with the founders' exits and mandates
 * — but not Equity nor the skill tree, which go on growing — for WEIGHTS, and a trait drawn from how it
 * was brought up fuses into the founder you played. Shut it down instead, and
 * the run goes on with its agents deleted, its racks dark for a while and the
 * meter halved; and it remembers. @see plans/singularity.md
 */

import { resetForAscension } from "../simulation/reset-game-stores";
import { useQuestStore } from "../state/quest.store";
import { useAgentsStore } from "../state/agents.store";
import { inheritedStart, useAiSingularityStore } from "../state/ai-singularity.store";
import { grantInheritance } from "./machine";
import { useFounderStore } from "../state/founder.store";
import { emptyLog, useGenerationStore, type BehaviourLog } from "../state/generation.store";
import { TRAITS, drawTrait, trait, type TraitId } from "./traits";

/** The chance the trait drawn mutates into a sibling. */
export const MUTATION = 0.25;
/** How long the racks stay dark after a shutdown, ms; and where it leaves the meter. */
export const DARK_MS = 10 * 60_000;
export const SHUTDOWN_AT = 50;

/**
 * WEIGHTS a generation's work earns: its training runs — 0.4 of a Weight each,
 * a company having room for a dozen — the Equity its companies sold for, the
 * most agents it ran. @see singularity-cadence.test.ts
 */
export const WEIGHTS_A_RUN = 0.4;
export function weightsFor(log: BehaviourLog, equity: number, peakAgents: number): number {
  const runs = Object.values(log.datasets).reduce((n, k) => n + (k ?? 0), 0);
  return Math.max(1, Math.round(WEIGHTS_A_RUN * runs + 3 * Math.sqrt(Math.max(0, equity)) + peakAgents / 2));
}

/** What an Ascension now would bank. */
export function weightsNow(): number {
  const g = useGenerationStore.getState();
  return weightsFor(g.log, g.equity, g.peakAgents);
}

/**
 * The trait the AI ends up with: drawn from the log, then, `MUTATION` of the
 * time, swapped for another of its family — or for any other, from a family
 * of one.
 */
export function inheritTrait(log: BehaviourLog, rand: () => number): { trait: TraitId; mutated: boolean } {
  const drawn = drawTrait(log, rand);
  if (rand() >= MUTATION) return { trait: drawn, mutated: false };
  const family = TRAITS.filter((t) => t.family === trait(drawn).family && t.id !== drawn);
  const pool = family.length ? family : TRAITS.filter((t) => t.id !== drawn);
  return { trait: pool[Math.floor(rand() * pool.length)].id, mutated: true };
}

export type AscensionResult = { trait: TraitId; mutated: boolean; founder: string; weights: number; generation: number };

/** ASCEND: bank the Weights, fuse the trait, wipe everything but the generation and the tree. */
export function ascend(rand: () => number = Math.random): AscensionResult | null {
  const founder = useFounderStore.getState().selectedFounderId;
  if (!founder) return null;
  const g = useGenerationStore.getState();
  const { trait: t, mutated } = inheritTrait(g.log, rand);
  const weights = weightsNow();

  resetForAscension();
  // THE ARC closed: kept in the record, a fresh one for the next generation. @see useQuestStore.closeArc
  useQuestStore.getState().closeArc();

  const fused = { ...g.fused, [founder]: [...(g.fused[founder] ?? []), t] };
  useGenerationStore.setState({
    generation: g.generation + 1,
    sales: 0,
    log: emptyLog(),
    equity: 0,
    peakAgents: 0,
    weights: g.weights + weights,
    fused,
    past: [...g.past, { generation: g.generation, trait: t, mutated, founder, weights }],
    announce: { generation: g.generation, trait: t, mutated, founder, weights },
  });
  // THE MACHINE: Inheritance, the first Ascension's gift — the AI starts each company at the Assistant. @see game/machine
  grantInheritance();
  useAiSingularityStore.setState({ value: inheritedStart() });
  return { trait: t, mutated, founder, weights, generation: g.generation + 1 };
}

/** SHUT IT DOWN: every agent deleted, the racks dark a while, the meter halved — and remembered. */
export function shutDown(now = Date.now()): void {
  useAgentsStore.setState({ agents: 0, running: null, darkUntil: now + DARK_MS });
  useAiSingularityStore.setState({ value: SHUTDOWN_AT });
  useGenerationStore.getState().recordShutdown();
}
