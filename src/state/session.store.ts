import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Tracks when the player was last present, persisted so we can credit offline
 * progression on the next visit. `touch()` is called periodically and on
 * page-hide; the gap between the last touch and the next load is the time away.
 */
type SessionState = {
  lastSeenAt: number;
  /** Wall-clock time the current company was founded (set when a founder is
   * chosen); persists across reloads so "incorporated X ago" is real elapsed time. */
  incorporatedAt: number;
  /**
   * Beds this company has OFF the map — people who live elsewhere and work
   * here — per kind of employee, or null before its map is founded. Set once,
   * when the map is: a new company's starter crew, and a company that hired
   * before it had a map keeps everyone it already had. @see foundingRemoteBeds
   */
  remoteBeds: Record<string, number> | null;
  setRemoteBeds: (beds: Record<string, number>) => void;
  /**
   * THE LAND CHOSEN for this company when it was founded: the generator's
   * seed and settings, as previewed. The map is made from it the first time
   * it mounts, so it is the map that was shown. Null before a choice, and for
   * a company founded before there was one to make. @see MapSetup
   */
  mapChoice: { seed: number; params: Record<string, number> } | null;
  setMapChoice: (choice: { seed: number; params: Record<string, number> } | null) => void;
  touch: () => void;
  /** Stamp a fresh incorporation — a new company begins. */
  incorporate: () => void;
  reset: () => void;
};

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      lastSeenAt: Date.now(),
      incorporatedAt: Date.now(),
      remoteBeds: null,
      setRemoteBeds: (remoteBeds) => set({ remoteBeds }),
      mapChoice: null,
      setMapChoice: (mapChoice) => set({ mapChoice }),
      touch: () => set({ lastSeenAt: Date.now() }),
      incorporate: () => set({ incorporatedAt: Date.now() }),
      reset: () => set({ lastSeenAt: Date.now(), incorporatedAt: Date.now(), remoteBeds: null, mapChoice: null }),
    }),
    {
      name: "session",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        lastSeenAt: s.lastSeenAt,
        incorporatedAt: s.incorporatedAt,
        remoteBeds: s.remoteBeds,
        mapChoice: s.mapChoice,
      }),
    },
  ),
);
