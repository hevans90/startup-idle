import { create } from "zustand";
import { persist } from "zustand/middleware";

type SidebarTab = "generators" | "innovation";

type GlobalSettingsStore = {
  sidebarTab: SidebarTab;
  setSidebarTab: (tab: SidebarTab) => void;
};

export const useGlobalSettingsStore = create<GlobalSettingsStore>()(
  persist(
    (set) => ({
      sidebarTab: "generators",
      setSidebarTab: (tab: SidebarTab) => {
        set({ sidebarTab: tab });
      },
    }),
    {
      name: "global-settings", // name of item in localStorage
    }
  )
);
