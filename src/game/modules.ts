/**
 * MODULES: what Weights buy. Each Ascension opens a SLOT; a module bought
 * works only while it sits in one, and modules swap in and out between
 * companies. Each has three levels. @see slotCount, useGenerationStore
 */
import { useGenerationStore } from "../state/generation.store";

export type ModuleId =
  | "warm-start" | "quiet-model" | "rack-density" | "blueprint-cache"
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
  { id: "warm-start", name: "Warm Start", levels: ["Keep 10% of Equity through an Ascension", "Keep 20%", "Keep 30%"], costs: [4, 10, 24] },
  { id: "quiet-model", name: "Quiet Model", levels: ["The AI rises 15% slower", "30% slower", "45% slower"], costs: [3, 8, 18] },
  { id: "rack-density", name: "Rack Density", levels: ["+1 agent a rack", "+2 agents a rack", "+3 agents a rack"], costs: [5, 12, 26] },
  { id: "blueprint-cache", name: "Blueprint Cache", levels: ["The Data Centre needs 20% less headcount", "40% less", "60% less"], costs: [4, 10, 22] },
  { id: "pre-trained", name: "Pre-trained", levels: ["Training runs take 25% less time", "50% less", "75% less"], costs: [3, 8, 18] },
  { id: "seed-round", name: "Seed Round", levels: ["Every company starts with $500", "$5,000", "$50,000"], costs: [2, 6, 14] },
  { id: "drone-swarm", name: "Drone Swarm", levels: ["The AI's drones fly 25% faster", "50% faster", "Twice as fast"], costs: [3, 8, 18] },
  { id: "memo-filter", name: "Memo Filter", levels: ["The AI's helpful memos come 50% more often", "Twice as often", "Three times as often"], costs: [3, 8, 18] },
];

export const moduleDef = (id: ModuleId) => MODULES.find((m) => m.id === id)!;

/** The level a module works at now: what was bought of it, if it is in a slot; else nought. */
export function moduleLevel(id: ModuleId): number {
  const g = useGenerationStore.getState();
  return g.slotted.includes(id) ? g.modules[id] ?? 0 : 0;
}

/** What each module's level is worth, where a number does it. */
export const WARM_START = [0, 0.1, 0.2, 0.3] as const;
export const QUIET_MODEL = [1, 0.85, 0.7, 0.55] as const;
export const BLUEPRINT_CACHE = [1, 0.8, 0.6, 0.4] as const;
export const PRE_TRAINED = [1, 0.75, 0.5, 0.25] as const;
export const SEED_ROUND = [0, 500, 5_000, 50_000] as const;
export const DRONE_SWARM = [1, 1.25, 1.5, 2] as const;
export const MEMO_FILTER = [1, 1.5, 2, 3] as const;

/** Buy the next level of a module, if the Weights are there. Whether it was bought. */
export function buyModule(id: ModuleId): boolean {
  const g = useGenerationStore.getState();
  const level = g.modules[id] ?? 0;
  if (level >= 3) return false;
  const cost = moduleDef(id).costs[level];
  if (g.weights < cost) return false;
  useGenerationStore.setState({ weights: g.weights - cost, modules: { ...g.modules, [id]: level + 1 } });
  return true;
}

/** Put a bought module in a free slot, or take it out. Whether anything changed. */
export function toggleSlot(id: ModuleId, slots: number): boolean {
  const g = useGenerationStore.getState();
  if (g.slotted.includes(id)) {
    useGenerationStore.setState({ slotted: g.slotted.filter((m) => m !== id) });
    return true;
  }
  if (!(g.modules[id] ?? 0) || g.slotted.length >= slots) return false;
  useGenerationStore.setState({ slotted: [...g.slotted, id] });
  return true;
}
