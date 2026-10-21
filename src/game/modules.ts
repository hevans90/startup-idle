/**
 * MODULES: the Machine's minors — each a spoke of three nodes in the skill
 * tree's AI cluster, bought with Weights; a module's level is how many of
 * its nodes are bought. They were once bought here and slotted, one slot an
 * Ascension; a save that did has the Weights back. @see game/machine
 */
import { hasMachine, useGenerationStore } from "../state/generation.store";

export type ModuleId =
  | "quiet-model" | "rack-density" | "blueprint-cache"
  | "pre-trained" | "seed-round" | "drone-swarm" | "memo-filter";

export type Module = {
  id: ModuleId;
  name: string;
  /** What each level does, as the Model's shop says it. */
  levels: readonly [string, string, string];
  /** Weights each level costs. */
  costs: readonly [number, number, number];
};

export const MODULES: readonly Module[] = [
  { id: "quiet-model", name: "Quiet Model", levels: ["The AI rises 15% slower", "30% slower", "45% slower"], costs: [3, 8, 18] },
  { id: "rack-density", name: "Rack Density", levels: ["+1 agent a rack", "+2 agents a rack", "+3 agents a rack"], costs: [5, 12, 26] },
  { id: "blueprint-cache", name: "Blueprint Cache", levels: ["The Data Centre needs 20% less headcount", "40% less", "60% less"], costs: [4, 10, 22] },
  { id: "pre-trained", name: "Pre-trained", levels: ["Training runs take 25% less time", "50% less", "75% less"], costs: [3, 8, 18] },
  { id: "seed-round", name: "Seed Round", levels: ["Every company starts with $500", "$5,000", "$50,000"], costs: [2, 6, 14] },
  { id: "drone-swarm", name: "Drone Swarm", levels: ["The AI's drones fly 25% faster", "50% faster", "Twice as fast"], costs: [3, 8, 18] },
  { id: "memo-filter", name: "Memo Filter", levels: ["The AI's helpful memos come 50% more often", "Twice as often", "Three times as often"], costs: [3, 8, 18] },
];

export const moduleDef = (id: ModuleId) => MODULES.find((m) => m.id === id)!;

/** The level a module works at now: how many of its nodes in the Machine are bought. @see machineLevel */
export function moduleLevel(id: ModuleId): number {
  let n = 0;
  for (let ring = 1; ring <= 3; ring++) if (hasMachine(`machine_${id}_${ring}`)) n++;
  return n;
}

/** What each module's level is worth, where a number does it. */
export const QUIET_MODEL = [1, 0.85, 0.7, 0.55] as const;
export const BLUEPRINT_CACHE = [1, 0.8, 0.6, 0.4] as const;
export const PRE_TRAINED = [1, 0.75, 0.5, 0.25] as const;
export const SEED_ROUND = [0, 500, 5_000, 50_000] as const;
export const DRONE_SWARM = [1, 1.25, 1.5, 2] as const;
export const MEMO_FILTER = [1, 1.5, 2, 3] as const;

/**
 * MODULES BOUGHT THE OLD WAY, refunded: a save that bought levels has their
 * Weights back to spend in the Machine, and its slots are emptied. Warm Start,
 * gone from the list — an Ascension keeps all the Equity now — with them.
 */
const OLD_COSTS: Record<string, readonly number[]> = {
  "warm-start": [4, 10, 24], ...Object.fromEntries(MODULES.map((m) => [m.id, m.costs])),
};
export function refundRetired(): void {
  const g = useGenerationStore.getState();
  let back = 0;
  for (const [id, level] of Object.entries(g.modules as Record<string, number | undefined>)) {
    back += (OLD_COSTS[id] ?? []).slice(0, level ?? 0).reduce((a, b) => a + b, 0);
  }
  if (!back && !g.slotted.length) return;
  useGenerationStore.setState({ weights: g.weights + back, modules: {}, slotted: [] });
}
refundRetired();
