import { Viewport } from "pixi-viewport";
import { create } from "zustand";

type OfficeState = {
  viewport: Viewport | null;
  setViewport: (viewport: Viewport) => void;
};

export const useOfficeStore = create<OfficeState>()((set) => ({
  viewport: null,
  setViewport: (viewport) => set({ viewport }),
}));
