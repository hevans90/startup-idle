import { create } from "zustand";
import { persist } from "zustand/middleware";

export const CURRENT_VERSION = "0.0.1";
const VERSION_STORAGE_KEY = "game_version";

// Utility: Clear everything except the version
export const clearAllStorageExceptVersion = () => {
  const saved = localStorage.getItem(VERSION_STORAGE_KEY);
  localStorage.clear();
  if (saved) {
    localStorage.setItem(VERSION_STORAGE_KEY, saved);
  }
};

// Compare only major.minor
export const hasMajorOrMinorChanged = (
  oldVersion: string,
  newVersion: string
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
    }
  )
);
