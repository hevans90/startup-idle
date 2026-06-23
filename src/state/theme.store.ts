// stores/useThemeStore.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

type Theme = "light" | "dark";

/** OS colour-scheme preference, falling back to light where unavailable. Used as
 * the default ONLY when no theme has been persisted yet (first run). */
const getSystemTheme = (): Theme =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";

interface ThemeStore {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => ({
      // Persisted value (if any) overrides this on rehydration.
      theme: getSystemTheme(),
      toggleTheme: () => {
        const newTheme = get().theme === "light" ? "dark" : "light";
        set({ theme: newTheme });
      },
      setTheme: (theme: Theme) => set({ theme }),
    }),
    {
      name: "theme", // name of item in localStorage
    }
  )
);
