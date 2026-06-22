import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Tracks when the player was last present, persisted so we can credit offline
 * progression on the next visit. `touch()` is called periodically and on
 * page-hide; the gap between the last touch and the next load is the time away.
 */
type SessionState = {
  lastSeenAt: number;
  touch: () => void;
  reset: () => void;
};

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      lastSeenAt: Date.now(),
      touch: () => set({ lastSeenAt: Date.now() }),
      reset: () => set({ lastSeenAt: Date.now() }),
    }),
    {
      name: "session",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ lastSeenAt: s.lastSeenAt }),
    },
  ),
);
