// stores/useThemeStore.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

type Theme = "light" | "dark";

interface ThemeStore {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => ({
      theme:
        typeof window !== "undefined"
          ? (localStorage.getItem("theme") as Theme) || "light"
          : "light",
      toggleTheme: () => {
        const newTheme = get().theme === "light" ? "dark" : "light";
        set({ theme: newTheme });
      },
      setTheme: (theme: Theme) => set({ theme }),
    }),
    {
      name: "theme-storage", // name of item in localStorage
    }
  )
);
