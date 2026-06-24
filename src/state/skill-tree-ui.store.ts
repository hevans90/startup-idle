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
  /** Cheapest route (unallocated node ids, allocate order) to reach the hovered
   * node from the current allocation. Published by the renderer for the tooltip. */
  previewPath: string[];
  setPreviewPath: (path: string[]) => void;
  /** When on, clicking an allocated node refunds it instead of allocating. */
  respecMode: boolean;
  setRespecMode: (on: boolean) => void;
};

export const useSkillTreeUiStore = create<SkillTreeUiState>()((set) => ({
  viewport: null,
  setViewport: (viewport) => set({ viewport }),
  hovered: null,
  setHovered: (hovered) => set({ hovered }),
  previewPath: [],
  setPreviewPath: (previewPath) => set({ previewPath }),
  respecMode: false,
  setRespecMode: (respecMode) => set({ respecMode }),
}));
