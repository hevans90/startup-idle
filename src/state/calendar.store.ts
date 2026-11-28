import { create } from "zustand";
import { persist } from "zustand/middleware";

import { YEAR_SECONDS } from "../world/calendar";

/**
 * THE CALENDAR: how many years have gone by on the map, as a float. Kept as where it stood (`t0`) and when, by the
 * wall clock (`at`), so it runs without being written every frame; `at` null while Seasons is off, the year held
 * where it was. Time away is credited as the economy's is, up to its cap. @see world/calendar, catchUp
 */
type CalendarState = {
  t0: number;
  at: number | null;
  /** The year, now: the one looked at while the editor's slider holds one. @see held */
  now: (wall?: number) => number;
  /** The year by the calendar itself, whatever is looked at: what grows and what is cut go by this. */
  real: (wall?: number) => number;
  /** THE EDITOR'S SLIDERS: a year and an hour of the day looked at, not run, not saved; null for the clock's. @see TimeSlider */
  held: number | null;
  hour: number | null;
  look: (held: number | null, hour: number | null) => void;
  /** Seasons on or off: off holds the year where it is. */
  setRunning: (on: boolean, wall?: number) => void;
  /**
   * TIME AWAY: the calendar as it stood when the player was last seen, moved on by the time credited for being
   * away (the economy's, capped), and running from now — not by the whole of a long absence.
   */
  catchUp: (lastSeen: number, creditedMs: number, wall?: number) => void;
  /** Set the year outright: a fixture, a screenshot. */
  setYear: (t: number, wall?: number) => void;
};

/** `?year=0.6` holds the calendar there, for a look at a season. */
const ASKED = typeof location !== "undefined" ? new URLSearchParams(location.search).get("year") : null;

export const useCalendarStore = create<CalendarState>()(
  persist(
    (set, get) => ({
      t0: 0,
      at: Date.now(),
      held: null,
      hour: null,
      look: (held, hour) => set({ held, hour }),
      now: (wall = Date.now()) => get().held ?? get().real(wall),
      real: (wall = Date.now()) => {
        const { t0, at } = get();
        return at === null ? t0 : t0 + Math.max(0, wall - at) / (YEAR_SECONDS * 1000);
      },
      setRunning: (on, wall = Date.now()) => {
        const t = get().real(wall);
        set({ t0: t, at: on ? wall : null });
      },
      catchUp: (lastSeen, creditedMs, wall = Date.now()) => {
        const { t0, at } = get();
        if (at === null) return;
        set({ t0: t0 + (Math.max(0, lastSeen - at) + Math.max(0, creditedMs)) / (YEAR_SECONDS * 1000), at: wall });
      },
      setYear: (t, wall = Date.now()) => set((s) => ({ t0: t, at: s.at === null ? null : wall })),
    }),
    {
      name: "calendar",
      partialize: (s) => ({ t0: s.t0, at: s.at }),
      // (Asked for in the address: held there, whatever was saved.)
      merge: (persisted, current) => ({ ...current, ...(persisted as object), ...(ASKED !== null && Number.isFinite(+ASKED) ? { t0: +ASKED, at: null } : {}) }),
    },
  ),
);
