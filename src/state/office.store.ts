import { Viewport } from "pixi-viewport";
import { create } from "zustand";
import type { GeneratorId } from "./generators.store";

/** The building currently under the cursor, plus its on-screen anchor (CSS px
 * relative to the canvas) so the DOM popover can track it through pan/zoom. */
export type HoveredBuilding = {
  key: string;
  district: GeneratorId;
  /** Flavour name from its kit tier (e.g. "Vibe Penthouses"). */
  name: string;
  floors: number;
  /** Exact employees housed in this building. */
  occupants: number;
  isLandmark: boolean;
  /** Screen position (CSS px) of the building's roof anchor. */
  x: number;
  y: number;
};

type OfficeState = {
  viewport: Viewport | null;
  setViewport: (viewport: Viewport) => void;
  hovered: HoveredBuilding | null;
  setHovered: (hovered: HoveredBuilding | null) => void;
};

export const useOfficeStore = create<OfficeState>()((set) => ({
  viewport: null,
  setViewport: (viewport) => set({ viewport }),
  hovered: null,
  setHovered: (hovered) => set({ hovered }),
}));
