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
import { emptyLog, useGenerationStore, type BehaviourLog, type PastGeneration } from "../state/generation.store";
import { TRAITS, drawTrait, trait, type TraitId } from "./traits";
import { cultureNow } from "./culture-now";
import { MONOLITH_WEIGHTS } from "./agents";
import { projectReading } from "./projects";
import { nextBook } from "./quests/books";
import { questWeightsMult } from "./quests/effects";
import { CONTAIN_AFTER, CONTAIN_AT, CONTAIN_WEIGHTS, LEASH_REMEMBERED, RELEASE_WEIGHTS, type AscendingEnding } from "./quests/endings";
import { useSessionStore } from "../state/session.store";

/** The chance the trait drawn mutates into a sibling. */
export const MUTATION = 0.25;
/** How long the racks stay dark after a shutdown, ms; and where it leaves the meter. */
export const DARK_MS = 10 * 60_000;
export const SHUTDOWN_AT = 50;

/**
 * WEIGHTS a generation's work earns: its training runs — 0.4 of a Weight each,
 * a company having room for a dozen — the Equity its companies sold for, the
 * most agents it ran; all × `WEIGHTS_SHRINK`. @see singularity-cadence.test.ts
 */
export const WEIGHTS_A_RUN = 0.4;
/**
 * An Ascension every ~5 sales, not ~14, banks more a sale (√ Equity favours
 * the short): this much of it keeps the Machine's pace a sale as it was.
 * @see plans/ascension-overhaul.md §2
 */
export const WEIGHTS_SHRINK = 0.7;
export function weightsFor(log: BehaviourLog, equity: number, peakAgents: number): number {
  const runs = Object.values(log.datasets).reduce((n, k) => n + (k ?? 0), 0);
  return Math.max(1, Math.round(WEIGHTS_SHRINK * (WEIGHTS_A_RUN * runs + 3 * Math.sqrt(Math.max(0, equity)) + peakAgents / 2)));
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
  // CONSTITUTION'S RULE: it is what it was brought up to be. @see game/culture
  if (cultureNow().noMutation || rand() >= MUTATION) return { trait: drawn, mutated: false };
  const family = TRAITS.filter((t) => t.family === trait(drawn).family && t.id !== drawn);
  const pool = family.length ? family : TRAITS.filter((t) => t.id !== drawn);
  return { trait: pool[Math.floor(rand() * pool.length)].id, mutated: true };
}

export type AscensionResult = { trait: TraitId; mutated: boolean; founder: string; weights: number; generation: number; also?: TraitId };

/** The endings that ascend; Contain shuts it down instead. @see game/quests/endings */
export type { AscendingEnding };

/** What an Ascension now would bank, by the ending taken: twice for a Release, half again after a Contain. */
export function ascensionWeights(ending: AscendingEnding | null = null): number {
  return Math.round(weightsNow() * (ending === "release" ? RELEASE_WEIGHTS : 1) * (useGenerationStore.getState().contained ? CONTAIN_WEIGHTS : 1) * cultureNow().weights * questWeightsMult() * (projectReading()?.monolith ? 1 + MONOLITH_WEIGHTS : 1));
}

/**
 * ASCEND: bank the Weights, fuse the trait, wipe everything but the generation
 * and the tree — by an ending, if the arc opened one: a Merge fuses a second
 * trait and starts the next generation's takeover at the Colleague; a Steward
 * leaves an AI that never turns; a Release banks twice and leaves nothing to
 * inherit; a Leash leaves it remembering. @see game/quests/endings
 */
export function ascend(rand: () => number = Math.random, ending: AscendingEnding | null = null): AscensionResult | null {
  const founder = useFounderStore.getState().selectedFounderId;
  if (!founder) return null;
  const g = useGenerationStore.getState();
  const { trait: t, mutated } = inheritTrait(g.log, rand);
  // MERGED: a second trait, not the first. @see ENDINGS merge
  let also: TraitId | undefined;
  for (let k = 0; ending === "merge" && k < 8 && (!also || also === t); k++) also = inheritTrait(g.log, rand).trait;
  if (also === t) also = undefined;
  const weights = ascensionWeights(ending);
  // WHAT THE RECAP SAYS of it, read before the wipe. @see AscensionRecap
  const gone: PastGeneration = { generation: g.generation, trait: t, mutated, founder, weights, book: g.book, ending, sales: g.sales, form: useQuestStore.getState().latticeForm, ...(also ? { also } : {}) };

  resetForAscension();
  // THE ARC closed: kept in the record with its ending, a fresh one for the next generation. @see useQuestStore.closeArc
  useQuestStore.getState().closeArc(ending);

  const fused = { ...g.fused, [founder]: [...(g.fused[founder] ?? []), t, ...(also ? [also] : [])] };
  useGenerationStore.setState({
    generation: g.generation + 1,
    // THE NEXT BOOK. @see game/quests/books
    book: nextBook(g.book),
    sales: 0,
    // LEASHED, or a Rival, it remembers it: Resentful likelier, its next talk colder; a Confidant's, warmer. @see traitScores, startTalk
    log: ending === "leash" || ending === "rival" || ending === "property" ? { ...emptyLog(), leashed: LEASH_REMEMBERED }
      : ending === "confidant" || ending === "citizen" || ending === "partner" || ending === "together" ? { ...emptyLog(), confided: 1 } : emptyLog(),
    equity: 0,
    peakAgents: 0,
    weights: g.weights + weights,
    fused,
    past: [...g.past, gone],
    announce: gone,
    // WHAT THE ENDING LEAVES the next generation; a Contain's bonus, spent. @see legacy
    legacy: ending,
    contained: false,
  });
  // THE MACHINE: Inheritance, the first Ascension's gift — the AI starts each company at the Assistant. @see game/machine
  grantInheritance();
  useAiSingularityStore.setState({ value: inheritedStart() });
  return { trait: t, mutated, founder, weights, generation: g.generation + 1, ...(also ? { also } : {}) };
}

/**
 * SHUT IT DOWN: every agent deleted, its wallet emptied, the racks dark a
 * while, the meter halved — and remembered: the book's dark chapter opens,
 * and its next talk begins with the grievance. The culture deck softens it:
 * Red Team keeps the agents, Kill Switch shortens the dark and banks Weights
 * for it. @see game/culture, Book.dark, Talk.grievance
 */
export function shutDown(now = Date.now()): void {
  const c = cultureNow();
  if (c.shutdownPays > 0) useGenerationStore.setState((g) => ({ weights: g.weights + Math.round(ascensionWeights() * c.shutdownPays) }));
  useAgentsStore.setState((a) => ({ agents: c.keepAgents ? a.agents : 0, running: c.keepAgents ? a.running : null, darkUntil: now + DARK_MS * c.dark }));
  useAiSingularityStore.setState({ value: SHUTDOWN_AT });
  useSessionStore.getState().setAiWallet({ aiWallet: 0 });
  useGenerationStore.getState().recordShutdown();
}

/**
 * CONTAIN IT: shut down without the shutdown's costs — no agents lost, no
 * racks dark, nothing resented — the meter back to `CONTAIN_AT`; it stays for
 * another company, and its next Ascension banks half as much again. The
 * shutdown branch's way out: open once it has been shut down `CONTAIN_AFTER`
 * times in a book, and once a book. @see CONTAIN
 */
export function contain(): void {
  useAiSingularityStore.setState({ value: CONTAIN_AT });
  useGenerationStore.setState({ contained: true });
  const q = useQuestStore.getState();
  useQuestStore.setState({ flags: [...new Set([...q.flags, "ending:contain"])] });
}

/** Whether Contain is open: shut down often enough this book, and not contained yet. */
export function containOpen(): boolean {
  return useGenerationStore.getState().log.shutdowns >= CONTAIN_AFTER && !useQuestStore.getState().flags.includes("ending:contain");
}
