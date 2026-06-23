import { Viewport } from "pixi-viewport";
import { create } from "zustand";

/** The node under the cursor + its on-screen anchor (CSS px relative to the
 * canvas), published each frame by the renderer so the DOM tooltip can track it
 * through pan/zoom. Transient UI state — not persisted. */
export type HoveredSkillNode = {
  id: string;
  x: number;
  y: number;
};

type SkillTreeUiState = {
  viewport: Viewport | null;
  setViewport: (viewport: Viewport | null) => void;
  hovered: HoveredSkillNode | null;
  setHovered: (hovered: HoveredSkillNode | null) => void;
};

export const useSkillTreeUiStore = create<SkillTreeUiState>()((set) => ({
  viewport: null,
  setViewport: (viewport) => set({ viewport }),
  hovered: null,
  setHovered: (hovered) => set({ hovered }),
}));
