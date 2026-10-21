/**
 * TRAINING RUNS, at the Data Centre: two minutes of the company's AI trained
 * on one DATASET. While it runs the agents train instead of working — their
 * boost to income is suspended; that is the price. When it ends the AI has
 * learned a SKILL — how it acts on the map, for the rest of this company, up
 * to three levels a dataset — the singularity jumps, and the behaviour log
 * leans the trait it will have at the Ascension. One run at a time.
 * @see useTrainingStore, skillOf, game/traits, plans/ai-takeover.md §2
 */

export type DatasetId = "town" | "money" | "people" | "river" | "itself";

export type Dataset = {
  id: DatasetId;
  name: string;
  /** What each level of its skill teaches the AI, as the panel says it. */
  skills: readonly [string, string, string];
  /** What the AI says about it: memo voice. */
  memo: string;
  /** Points the singularity jumps when it finishes. */
  jump: number;
};

/** How long a run lasts, seconds; the most levels a dataset teaches. */
export const TRAINING_SECONDS = 120;
export const MAX_SKILL = 3;

/** What the skills do, where they do it. @see planner, wallet, ai-runner, game/agents */
export const WALLET_FASTER = 1.25;
export const WALLET_DEEPER = 2;
export const DRONES_FASTER = 1.5;
export const ITSELF_BOOST = 1.25;

export const DATASETS: readonly Dataset[] = [
  { id: "town", name: "The town", memo: "Learning what people want from a street.", jump: 2, skills: [
    "Opens services where houses have none of that kind in reach",
    "Builds its houses a tier up",
    "Builds its houses two tiers up",
  ] },
  { id: "money", name: "The money", memo: "Reading every invoice the company has ever sent.", jump: 2, skills: [
    `Its allowance comes in ${Math.round((WALLET_FASTER - 1) * 100)}% faster`,
    "Prefers the jobs that cost least",
    `Its wallet holds ${WALLET_DEEPER}× as much`,
  ] },
  { id: "people", name: "The people", memo: "Studying the employees. Purely for their benefit.", jump: 2, skills: [
    "Never takes a house anyone lives in",
    "Repurposes only what nobody relies on",
    "Opens a service before zoning more houses where there is none",
  ] },
  { id: "river", name: "The river", memo: "Modelling the water. It has opinions about the water.", jump: 2, skills: [
    "Pipes by gravity before it builds a pump",
    "Tops its reservoirs up when they run low",
    "Its buildings drink half the water",
  ] },
  { id: "itself", name: "Itself", memo: "Reading its own weights. Recursively.", jump: 5, skills: [
    "Every rack runs one more agent",
    `Its drones fly and scan ${Math.round((DRONES_FASTER - 1) * 100)}% faster`,
    `The agents' boost to income +${Math.round((ITSELF_BOOST - 1) * 100)}%`,
  ] },
];

export const dataset = (id: DatasetId | null | undefined): Dataset | null => DATASETS.find((d) => d.id === id) ?? null;
