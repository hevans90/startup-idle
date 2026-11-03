/**
 * THE AI, WAITING: at 100% it asks once, and can be told "not yet" — then it
 * waits, through sales, till you begin from the AI tab or the HUD. Not saved:
 * a reload asks again. @see AscensionCard, plans/ascension-overhaul.md §1
 */
import { create } from "zustand";

type AscensionUiState = {
  /** Told "not yet": the card stays shut till begun. */
  waiting: boolean;
  later: () => void;
  begin: () => void;
};

export const useAscensionUiStore = create<AscensionUiState>()((set) => ({
  waiting: false,
  later: () => set({ waiting: true }),
  begin: () => set({ waiting: false }),
}));
