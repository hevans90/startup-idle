/**
 * THE ARC'S OBJECTIVES, MEASURED: what the world looks like once a second,
 * and how far an objective is from met in it, 0 to 1. @see types ObjectiveSpec
 */
import type { Stage } from "../../state/ai-singularity.store";
import type { Running } from "../../state/quest.store";

/** What an objective can see of the world. @see questWorld */
export type QuestWorld = {
  /** The meter, and where each stage begins now. */
  meter: number;
  stageFrom: Record<Stage, number>;
  agents: number;
  running: number;
  /** How well the Data Centre is cooled, 0–1; 0 with none. */
  dcCooled: number;
  /** The share of the buildings that drink with their water, 0–1; 1 with none. */
  covered: number;
  /** Buildings standing, by kind. */
  counts: Record<string, number>;
  /** Whether a block has been picked, a building in it kept, and a site given. */
  block: boolean;
  keep: boolean;
  /** How far the Lattice is charged, 0–1. */
  lattice: number;
  site: boolean;
};

/** How far it is, and the seconds held so far. */
export function measure(o: Running, w: QuestWorld, dt: number): { progress: number; held: number } {
  const s = o.spec;
  const at = (p: number) => ({ progress: Math.max(0, Math.min(1, p)), held: o.held });
  switch (s.kind) {
    case "throttleAtMost": {
      const held = o.held + (w.agents > 0 && w.running <= s.share * w.agents ? dt : 0);
      return { progress: Math.min(1, held / s.seconds), held };
    }
    case "selectBlock": return at(w.block && (!s.keep || w.keep) ? 1 : w.block ? 0.5 : 0);
    case "giveSite": return at(w.site ? 1 : 0);
    case "coolDataCentre": return at(w.dcCooled / s.share);
    case "aiBuilds": return at(o.aiBuilt ? 1 : 0);
    case "buildBy": return at((w.counts[s.def] ?? 0) > (o.baseline ?? Infinity) ? 1 : 0);
    case "agentsRunning": return at(w.running / s.n);
    case "latticeCharged": return at(w.lattice);
    case "waterBudgetCovered": return at(w.covered >= 1 ? 1 : w.covered * 0.99);
  }
}
