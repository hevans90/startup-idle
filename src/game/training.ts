/**
 * TRAINING RUNS, at the Data Centre: three minutes of the company's AI
 * trained on one DATASET — a boost to what it was trained on while it runs,
 * then a jump in the singularity, and a line in the behaviour log that leans
 * the traits it will have at the Ascension. One run at a time.
 * @see useTrainingStore, game/traits
 */

export type DatasetId = "town" | "money" | "people" | "river" | "itself";

export type Dataset = {
  id: DatasetId;
  name: string;
  /** What it does while it runs, as the panel says it. */
  boost: string;
  /** What the AI says about it: memo voice. */
  memo: string;
  /** Points the singularity jumps when it finishes. */
  jump: number;
};

/** How long a run lasts, seconds. */
export const TRAINING_SECONDS = 180;
/** Seconds of the company's innovation rate a run costs, the least it costs, and how much dearer each this generation makes the next. */
export const TRAINING_COST_SECONDS = 60;
export const TRAINING_FLOOR = 50;
export const TRAINING_STEP = 1.3;

/** While it runs: houses' desirability, income, satisfaction, port calls, agents' boost. */
export const TOWN_DESIRE = 8;
export const MONEY_MULT = 1.15;
export const PEOPLE_MORALE = 15;
export const RIVER_PORTS = 1.5;
export const ITSELF_AGENTS = 1.5;

export const DATASETS: readonly Dataset[] = [
  { id: "town", name: "The town", boost: `every house +${TOWN_DESIRE} desirability`, memo: "Learning what people want from a street.", jump: 3 },
  { id: "money", name: "The money", boost: `income ×${MONEY_MULT}`, memo: "Reading every invoice the company has ever sent.", jump: 4 },
  { id: "people", name: "The people", boost: `+${PEOPLE_MORALE} satisfaction, everyone`, memo: "Studying the employees. Purely for their benefit.", jump: 3 },
  { id: "river", name: "The river", boost: `port calls ×${RIVER_PORTS}, floods repaired three times as fast`, memo: "Modelling the water. It has opinions about the water.", jump: 3 },
  { id: "itself", name: "Itself", boost: `each agent's boost ×${ITSELF_AGENTS}`, memo: "Reading its own weights. Recursively.", jump: 8 },
];

export const dataset = (id: DatasetId | null | undefined): Dataset | null => DATASETS.find((d) => d.id === id) ?? null;

/** What the next run costs in innovation, at an innovation rate a second, after `runs` this generation. */
export function trainingCost(innovationPerSecond: number, runs: number): number {
  const live = Number.isFinite(innovationPerSecond) ? Math.max(0, innovationPerSecond) * TRAINING_COST_SECONDS : 0;
  return Math.max(TRAINING_FLOOR, live) * TRAINING_STEP ** runs;
}
