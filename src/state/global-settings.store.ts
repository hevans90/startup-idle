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
  /**
   * The sound's level, 0–1, and whether it is muted; and each bus's share of
   * it — the game's effects, the interface's, the town's ambience — and
   * whether the interface ticks under the pointer. @see audio/sound
   */
  volume: number;
  muted: boolean;
  effects: number;
  interface: number;
  ambience: number;
  ticks: boolean;
  setSound: (s: Partial<Pick<GlobalSettingsStore, "volume" | "muted" | "effects" | "interface" | "ambience" | "ticks">>) => void;
  /** How much the console moves: in full, or calm — frames simply there, text whole, nothing behind. @see ui/motion */
  motion: "full" | "calm";
  setMotion: (motion: "full" | "calm") => void;
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
      // The interface at half the effects, and no ticks till asked for. @see plans/ui-overhaul.md open question 3
      effects: 1,
      interface: 0.5,
      ambience: 1,
      ticks: false,
      setSound: (s) => set(s),
      motion: "full",
      setMotion: (motion) => set({ motion }),
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
