import { create } from "zustand";
import { persist } from "zustand/middleware";

export type SidebarTab = "employees" | "innovation";

type GlobalSettingsStore = {
  sidebarTab: SidebarTab;
  setSidebarTab: (tab: SidebarTab) => void;
};

export const useGlobalSettingsStore = create<GlobalSettingsStore>()(
  persist(
    (set) => ({
      sidebarTab: "employees",
      setSidebarTab: (tab: SidebarTab) => {
        set({ sidebarTab: tab });
      },
    }),
    {
      name: "global-settings", // name of item in localStorage
    }
  )
);
