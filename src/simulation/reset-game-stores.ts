import { useAiSingularityStore } from "../state/ai-singularity.store";
import { useFounderStore } from "../state/founder.store";
import { useGeneratorStore } from "../state/generators.store";
import { useInnovationStore } from "../state/innovation.store";
import { useMoneyStore } from "../state/money.store";
import { usePrestigeStore } from "../state/prestige.store";
import { useSessionStore } from "../state/session.store";
import { useUpgradeStore } from "../state/upgrades.store";
import { useValuationStore } from "../state/valuation.store";
import { useVapeAchievementsStore } from "../state/vape-achievements.store";

/**
 * Resets a single RUN — everything that should start fresh when you get
 * acquired (money, employees, upgrades, innovation, valuation, AI singularity,
 * founder, offline clock) — while PRESERVING prestige (Equity + skill tree),
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

  const now = Date.now();
  useInnovationStore.setState({ globalLastTick: now });
  useGeneratorStore.setState({ globalLastTick: now });

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
  // Wipe prestige FIRST so the run reset below sees neutral modifiers (no free
  // Acqui-hire levels granted on a total wipe).
  usePrestigeStore.getState().reset();
  resetRunStores();
  // Board mandates persist across runs, so the run reset keeps them — clear them
  // explicitly here for a true full wipe.
  useValuationStore.getState().clearMandates();
  useVapeAchievementsStore.getState().clearAll();
}
