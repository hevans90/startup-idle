/**
 * WHETHER AI MODE IS DRIVING: on, and on a run that has it — the Model's, or
 * any founder's once there has been an Ascension. While it is, the player's
 * hands are off: every control that changes the company is gone or still, and
 * the pilot acts through the same actions. Asked of one DESK, it is also
 * whether that desk is on: a desk switched off gives its controls back.
 * @see Manual, pilot, plans/ai-mode-rebuild.md "Steering"
 */
import { useFounderStore } from "../state/founder.store";
import { useGenerationStore } from "../state/generation.store";
import { useSessionStore } from "../state/session.store";
import type { PilotDesk } from "../state/pilot-view.store";

/** Whether this run may switch AI mode on at all. */
export const aiModeOpen = (): boolean =>
  useFounderStore.getState().selectedFounderId === "model" || useGenerationStore.getState().generation > 1;

/** Asked outside React: by the scene's tick, and by a handler. */
export const aiDriving = (desk?: PilotDesk): boolean => {
  const s = useSessionStore.getState();
  return s.aiMode && aiModeOpen() && !(desk && (s.aiDesksOff ?? []).includes(desk));
};

export function useAiModeOpen(): boolean {
  const model = useFounderStore((s) => s.selectedFounderId) === "model";
  const later = useGenerationStore((s) => s.generation) > 1;
  return model || later;
}

/** Driving at all; or, of a desk, driving with that desk on. Of several, with any of them on. */
export function useAiDriving(...desks: PilotDesk[]): boolean {
  const on = useSessionStore((s) => s.aiMode);
  const off = useSessionStore((s) => s.aiDesksOff) ?? [];
  const open = useAiModeOpen();
  return on && open && (desks.length === 0 || desks.some((d) => !off.includes(d)));
}
