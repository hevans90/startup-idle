/**
 * WHETHER AI MODE IS DRIVING: on, and on a run that has it. While it is, the
 * player's hands are off: every control that changes the company is gone or
 * still, and the pilot acts through the same actions. @see Manual, pilot
 */
import { useFounderStore } from "../state/founder.store";
import { useSessionStore } from "../state/session.store";

/** Asked outside React: by the scene's tick, and by a handler. */
export const aiDriving = (): boolean =>
  useSessionStore.getState().aiMode && useFounderStore.getState().selectedFounderId === "model";

export function useAiDriving(): boolean {
  const on = useSessionStore((s) => s.aiMode);
  const model = useFounderStore((s) => s.selectedFounderId) === "model";
  return on && model;
}
