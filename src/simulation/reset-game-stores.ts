import { emptyLog, useGenerationStore } from "../state/generation.store";
import { SEED_ROUND, moduleLevel } from "../game/modules";
import { useTrainingStore } from "../state/training.store";
import { clearMorale } from "../game/morale";
import { resetAutopilot } from "../world/ai/autopilot";
import { resetCooling } from "../world/projects/cooling";
import { useAgentsStore } from "../state/agents.store";
import { useAiSingularityStore } from "../state/ai-singularity.store";
import { useSlopPitStore } from "../state/slop-pit.store";
import { useExitsStore } from "../state/exits.store";
import { useFounderStore } from "../state/founder.store";
import { useGeneratorStore } from "../state/generators.store";
import { useInnovationStore } from "../state/innovation.store";
import { useMoneyStore } from "../state/money.store";
import { usePrestigeStore } from "../state/prestige.store";
import { useSessionStore } from "../state/session.store";
import { useUpgradeStore } from "../state/upgrades.store";
import { useValuationStore } from "../state/valuation.store";
import { useVapeAchievementsStore } from "../state/vape-achievements.store";
import { retireRunSave } from "../world/io/world-save";

/**
 * Resets a single RUN — everything that should start fresh when you get
 * acquired (money, employees, upgrades, innovation, valuation, AI singularity,
 * founder, offline clock, the company's map) — while PRESERVING prestige (Equity + skill tree),
 * board mandates, and vape achievements/upgrades. The founder is cleared so a
 * new one is chosen.
 */
export function resetRunStores(): void {
  useMoneyStore.getState().reset();
  useUpgradeStore.getState().reset();
  useValuationStore.getState().reset();
  useInnovationStore.getState().reset();
  useGeneratorStore.getState().reset();
  useAiSingularityStore.getState().reset();
  useFounderStore.getState().reset();
  useSessionStore.getState().reset();
  useSlopPitStore.getState().reset();
  useAgentsStore.getState().reset();
  useTrainingStore.getState().reset();
  clearMorale();
  resetAutopilot();
  resetCooling();
  // And the company's map: a new company founds on new ground. @see retireRunSave
  retireRunSave();

  const now = Date.now();
  useInnovationStore.setState({ globalLastTick: now });
  useGeneratorStore.setState({ globalLastTick: now });

  // THE SEED ROUND module: money to start with. @see SEED_ROUND
  const seed = SEED_ROUND[moduleLevel("seed-round")];
  if (seed > 0) useMoneyStore.getState().increaseMoney(seed);

  // Skill-tree "Permanent Acqui-hire": start the new company with free intern
  // levels (reads prestige, which is preserved across a run reset).
  const freeLevels = usePrestigeStore.getState().modifiers.freeStartingLevels;
  if (freeLevels > 0) {
    useGeneratorStore.getState().increaseGenerator("intern", freeLevels);
  }
}

/**
 * Full wipe — a run reset PLUS prestige. Used by the reset button and the
 * version-change wipe (and simulations). Call after `localStorage.clear()`
 * (handled in `src/test/setup.ts`).
 */
export function resetAllGameStores(): void {
  resetForAscension();
  useVapeAchievementsStore.getState().clearAll();
  // And the generations: a true new game begins at the first. @see useGenerationStore
  useGenerationStore.setState({
    generation: 1, sales: 0, log: emptyLog(), equity: 0, peakAgents: 0, weights: 0, modules: {}, slotted: [], fused: {}, past: [], announce: null,
  });
}

/**
 * AN ASCENSION'S WIPE: a run reset plus prestige — Equity, the skill tree,
 * founders' exits and board mandates — keeping the generation's
 * own store and the achievements. @see game/ascension
 */
export function resetForAscension(): void {
  // Wipe prestige FIRST so the run reset below sees neutral modifiers (no free
  // Acqui-hire levels granted on a total wipe).
  usePrestigeStore.getState().reset();
  resetRunStores();
  // Board mandates persist across runs, so the run reset keeps them — clear them
  // explicitly here for a true full wipe.
  useValuationStore.getState().clearMandates();
  useExitsStore.getState().clearAll();
}
