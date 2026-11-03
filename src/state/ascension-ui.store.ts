/**
 * THE AI, WAITING: at 100% it asks once, and can be told "not yet" — then it
 * waits, through sales, till you begin from the AI tab or the HUD. Not saved:
 * a reload asks again. @see AscensionCard, plans/ascension-overhaul.md §1
 */
import { create } from "zustand";

import { useTalkStore } from "./talk.store";

type AscensionUiState = {
  /** Told "not yet": the card stays shut till begun. */
  waiting: boolean;
  later: () => void;
  begin: () => void;
};

export const useAscensionUiStore = create<AscensionUiState>()((set) => ({
  waiting: false,
  later: () => set({ waiting: true }),
  // A talk already under way: straight back into it. @see useTalkStore
  begin: () => {
    set({ waiting: false });
    if (useTalkStore.getState().state) useTalkStore.getState().begin();
  },
}));
