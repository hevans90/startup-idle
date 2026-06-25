import { create } from "zustand";
import { persist } from "zustand/middleware";

export const CURRENT_VERSION = "0.2.0";
const VERSION_STORAGE_KEY = "game_version";

/**
 * localStorage keys that are user PREFERENCES, not game progress — they survive
 * a version wipe (e.g. your dark/light theme shouldn't reset on an update).
 */
const PRESERVED_KEYS = [VERSION_STORAGE_KEY, "theme", "global-settings"];

// Utility: wipe game progress but keep the version + user preferences.
export const clearAllStorageExceptVersion = () => {
  const preserved = PRESERVED_KEYS.map(
    (key) => [key, localStorage.getItem(key)] as const,
  );
  localStorage.clear();
  for (const [key, value] of preserved) {
    if (value != null) localStorage.setItem(key, value);
  }
};

// Compare only major.minor
export const hasMajorOrMinorChanged = (
  oldVersion: string,
  newVersion: string,
): boolean => {
  const [oldMajor, oldMinor] = oldVersion.split(".").map(Number);
  const [newMajor, newMinor] = newVersion.split(".").map(Number);
  return oldMajor !== newMajor || oldMinor !== newMinor;
};

type VersionState = {
  version: string;
  setVersion: (v: string) => void;
};

export const useVersionStore = create<VersionState>()(
  persist(
    (set) => ({
      version: CURRENT_VERSION,
      setVersion: (v) => set({ version: v }),
    }),
    {
      name: VERSION_STORAGE_KEY,
    },
  ),
);
