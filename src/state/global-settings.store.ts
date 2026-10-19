import { create } from "zustand";
import { persist } from "zustand/middleware";

export type SidebarTab =
  | "employees"
  | "innovation"
  | "valuation"
  | "acquisition"
  | "achievements"
  | "ai";

type GlobalSettingsStore = {
  sidebarTab: SidebarTab;
  setSidebarTab: (tab: SidebarTab) => void;
  /** Whether the company's map has a day and a night. @see world/daylight */
  dayNight: boolean;
  setDayNight: (on: boolean) => void;
  /** The sound's level, 0–1, and whether it is muted. @see audio/sound */
  volume: number;
  muted: boolean;
  setSound: (s: { volume?: number; muted?: boolean }) => void;
};

export const useGlobalSettingsStore = create<GlobalSettingsStore>()(
  persist(
    (set) => ({
      sidebarTab: "employees",
      setSidebarTab: (tab: SidebarTab) => {
        set({ sidebarTab: tab });
      },
      dayNight: true,
      setDayNight: (dayNight) => set({ dayNight }),
      volume: 0.6,
      muted: false,
      setSound: (s) => set(s),
    }),
    {
      name: "global-settings", // name of item in localStorage
      // The Model tab is the AI tab now: a save left on it opens there.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Omit<Partial<GlobalSettingsStore>, "sidebarTab"> & { sidebarTab?: string };
        return { ...current, ...p, sidebarTab: (p.sidebarTab === "agi" ? "ai" : p.sidebarTab ?? current.sidebarTab) as SidebarTab };
      },
    }
  )
);
