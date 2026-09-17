import { create } from "zustand";

type State = {
  openCount: number;
  open: () => void;
  close: () => void;
};

export const useAnyPopoverStore = create<State>()((set) => ({
  openCount: 0,
  open: () => set((s) => ({ openCount: s.openCount + 1 })),
  close: () => set((s) => ({ openCount: Math.max(0, s.openCount - 1) })),
}));
