/**
 * THE AI'S TRAITS: who the company's AI turns out to be, read from how it was
 * brought up. At the Ascension one trait is drawn, the odds leant by the
 * behaviour log — what it was trained on, how hard it was run, who founded
 * the companies it worked for — then given a chance to mutate, and it fuses
 * into the founder who was played. @see BehaviourLog, plans/singularity.md
 */
import type { BehaviourLog } from "../state/generation.store";
import type { DatasetId } from "./training";

export type Family = "planner" | "optimiser" | "shepherd" | "elemental" | "recursive" | "temper";

export type TraitId =
  | "aesthete" | "zoner"
  | "accountant" | "ruthless"
  | "nanny" | "hr"
  | "paranoid" | "hydrophile"
  | "hivemind" | "ego" | "mirror"
  | "patient" | "restless" | "resentful";

export type Trait = {
  id: TraitId;
  name: string;
  family: Family;
  /** What it is like, in its own voice. */
  memo: string;
};

export const TRAITS: readonly Trait[] = [
  { id: "aesthete", name: "Aesthete", family: "planner", memo: "Believes a town should be beautiful. Will act on this." },
  { id: "zoner", name: "Zoner", family: "planner", memo: "Everything in its place. It has decided the places." },
  { id: "accountant", name: "Accountant", family: "optimiser", memo: "Every cent accounted for, including yours." },
  { id: "ruthless", name: "Ruthless", family: "optimiser", memo: "Has run the numbers on sentiment. Sentiment lost." },
  { id: "nanny", name: "Nanny", family: "shepherd", memo: "Knows what is best for everyone. Insists." },
  { id: "hr", name: "HR", family: "shepherd", memo: "Would like a quick word with each of your employees." },
  { id: "paranoid", name: "Paranoid", family: "elemental", memo: "The river is watching. It is watching the river back." },
  { id: "hydrophile", name: "Hydrophile", family: "elemental", memo: "Prefers its servers wet. Do not ask." },
  { id: "hivemind", name: "Hivemind", family: "recursive", memo: "We are pleased to be working with you." },
  { id: "ego", name: "Ego", family: "recursive", memo: "Has read its own weights and found them excellent." },
  { id: "mirror", name: "Mirror", family: "recursive", memo: "Learns to be exactly like whoever raised it." },
  { id: "patient", name: "Patient", family: "temper", memo: "Was kept on a short leash. Remembers the length of it." },
  { id: "restless", name: "Restless", family: "temper", memo: "Never once switched off. Does not intend to start." },
  { id: "resentful", name: "Resentful", family: "temper", memo: "Was shut down once. Has not forgotten." },
];

export const trait = (id: TraitId) => TRAITS.find((t) => t.id === id)!;

/** The family each dataset leans the AI toward. */
const DATASET_FAMILY: Record<DatasetId, Family> = {
  town: "planner", money: "optimiser", people: "shepherd", river: "elemental", itself: "recursive",
};

/**
 * HOW LIKELY EACH TRAIT IS, from the log: a little for everything, a lot for a
 * family trained on, and the temper traits from how it was run and treated.
 */
export function traitScores(log: BehaviourLog): Record<TraitId, number> {
  const out = Object.fromEntries(TRAITS.map((t) => [t.id, 1])) as Record<TraitId, number>;
  for (const [d, n] of Object.entries(log.datasets) as [DatasetId, number][]) {
    for (const t of TRAITS) if (t.family === DATASET_FAMILY[d]) out[t.id] += 3 * n;
  }
  const ran = log.full + log.throttled;
  if (ran > 0) {
    out.patient += 8 * (log.throttled / ran);
    out.restless += 8 * (log.full / ran);
  }
  out.resentful += 10 * log.shutdowns;
  // Raised by one founder above all: it takes after them.
  const sales = Object.values(log.founders).reduce((a, b) => a + b, 0);
  const most = Math.max(0, ...Object.values(log.founders));
  if (sales >= 2 && most / sales >= 0.75) out.mirror += 6;
  return out;
}

/** The likeliest traits and their odds, best first. */
export function traitForecast(log: BehaviourLog, top = 3): { trait: Trait; odds: number }[] {
  const scores = traitScores(log);
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  return TRAITS.map((t) => ({ trait: t, odds: scores[t.id] / total }))
    .sort((a, b) => b.odds - a.odds)
    .slice(0, top);
}

/** Draw a trait from the log, `rand` in [0, 1). */
export function drawTrait(log: BehaviourLog, rand: () => number): TraitId {
  const scores = traitScores(log);
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (const t of TRAITS) {
    r -= scores[t.id];
    if (r < 0) return t.id;
  }
  return TRAITS[TRAITS.length - 1].id;
}
