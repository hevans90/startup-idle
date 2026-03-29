import { useGeneratorStore } from "../state/generators.store";
import { useInnovationStore } from "../state/innovation.store";

/** Matches the app tick cadence: 1s generator boundary + manager tick consuming elapsed time. */
export function advanceGameplayOneSecond(
  advanceTimersByTime: (ms: number) => void
): void {
  advanceTimersByTime(1000);
  useInnovationStore.getState().tickManagers();
  useGeneratorStore.getState().tickGenerators();
}
