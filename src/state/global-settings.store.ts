import { create } from "zustand";
import { persist } from "zustand/middleware";

export type SidebarTab =
  | "employees"
  | "innovation"
  | "valuation"
  | "acquisition"
  | "achievements"
  | "agi";

type GlobalSettingsStore = {
  sidebarTab: SidebarTab;
  setSidebarTab: (tab: SidebarTab) => void;
  /** Whether the company's map has a day and a night. @see world/daylight */
  dayNight: boolean;
  setDayNight: (on: boolean) => void;
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
    }),
    {
      name: "global-settings", // name of item in localStorage
    }
  )
);
