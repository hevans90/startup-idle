import { useAiSingularityStore } from "../state/ai-singularity.store";
import { useGeneratorStore } from "../state/generators.store";
import { useInnovationStore } from "../state/innovation.store";
import { useMoneyStore } from "../state/money.store";
import { useUpgradeStore } from "../state/upgrades.store";
import { useValuationStore } from "../state/valuation.store";

/**
 * Wipes persisted keys and in-memory state so simulations start from a known baseline.
 * Call after `localStorage.clear()` (handled in `src/test/setup.ts`).
 */
export function resetAllGameStores(): void {
  useMoneyStore.getState().reset();
  useUpgradeStore.getState().reset();
  useValuationStore.getState().reset();
  useInnovationStore.getState().reset();
  useGeneratorStore.getState().reset();
  useAiSingularityStore.getState().reset();

  const now = Date.now();
  useInnovationStore.setState({ globalLastTick: now });
  useGeneratorStore.setState({ globalLastTick: now });
}
