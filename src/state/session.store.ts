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
  /**
   * Projects this company has been SHOWN as available, by id: the projects
   * log pulses for any available one not in here, and opening the log
   * marks what it shows. Reset with the company. @see ProjectsLog
   */
  seenProjects: string[];
  markProjectsSeen: (ids: readonly string[]) => void;
  /**
   * What the seaports were earning a second when the map last ran: what they
   * are credited for the time away. @see computeOfflineProgress, recordCall
   */
  portIncomePerSecond: number;
  setPortIncome: (perSecond: number) => void;
  /**
   * FIRST-RUN HINTS this company is done with — shown and met, dismissed, or
   * met before they were ever needed — and whether they are off altogether.
   * @see HintCard
   */
  hintsDone: string[];
  markHintsDone: (ids: readonly string[]) => void;
  hintsOff: boolean;
  /** Whether floods, overflows and the like stay away. @see stepEvents */
  mapEventsOff: boolean;
  /**
   * The parcels of its map the company owns, or null for all of it — a
   * company that had its map before land was for sale. @see world/land
   */
  land: number[] | null;
  setLand: (land: number[] | null) => void;
  /** Seconds of play until each kind of map event is next due, kept across loads. @see Pacing */
  eventPacing: Record<string, number> | null;
  setEventPacing: (p: Record<string, number>) => void;
  /** Regular routes won by serving convoys: each adds to every port call. @see ROUTE_BONUS */
  routes: number;
  addRoute: (max: number) => void;
  /** The investors' term sheet chosen at founding, by id. @see game/term-sheets */
  termSheet: string | null;
  setTermSheet: (id: string | null) => void;
  /** Whether the slop pit has overflowed this run. */
  overflowed: boolean;
  markOverflowed: () => void;
  /** Whether investors left a tour unimpressed, until the next acquirer's offer. @see SNUB */
  snubbed: boolean;
  setSnubbed: (snubbed: boolean) => void;
  /** When the company's AI last worked, for what it did while nobody watched. @see catchUpAi */
  aiAt: number | null;
  setAiAt: (at: number) => void;
  /** The stages the AI has announced arriving at, this company. @see ARRIVALS */
  aiSaid: string[];
  markAiSaid: (stage: string) => void;
  /**
   * THE MODEL'S AI MODE: whether the town builds itself, the most of the
   * money it may spend at once, and whether its masterplan is shown.
   * @see world/ai/autopilot
   */
  aiMode: boolean;
  aiBudget: number;
  showPlan: boolean;
  setAiMode: (patch: Partial<{ aiMode: boolean; aiBudget: number; showPlan: boolean }>) => void;
  setMapEventsOff: (off: boolean) => void;
  setHintsOff: (off: boolean) => void;
  /** Whether the projects log is open or folded away. */
  projectsOpen: boolean;
  setProjectsOpen: (open: boolean) => void;
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
      seenProjects: [],
      markProjectsSeen: (ids) => set((s) => {
        const fresh = ids.filter((id) => !s.seenProjects.includes(id));
        return fresh.length ? { seenProjects: [...s.seenProjects, ...fresh] } : s;
      }),
      hintsDone: [],
      markHintsDone: (ids) => set((s) => {
        const fresh = ids.filter((id) => !s.hintsDone.includes(id));
        return fresh.length ? { hintsDone: [...s.hintsDone, ...fresh] } : s;
      }),
      hintsOff: false,
      mapEventsOff: false,
      land: null,
      setLand: (land) => set({ land }),
      eventPacing: null,
      setEventPacing: (eventPacing) => set({ eventPacing }),
      routes: 0,
      addRoute: (max) => set((s) => ({ routes: Math.min(max, (s.routes ?? 0) + 1) })),
      termSheet: null,
      setTermSheet: (termSheet) => set({ termSheet }),
      overflowed: false,
      markOverflowed: () => set((s) => (s.overflowed ? s : { overflowed: true })),
      snubbed: false,
      setSnubbed: (snubbed) => set({ snubbed }),
      aiAt: null,
      setAiAt: (aiAt) => set({ aiAt }),
      aiMode: false,
      aiBudget: 0.8,
      showPlan: true,
      setAiMode: (patch) => set(patch),
      aiSaid: [],
      markAiSaid: (stage) => set((s) => ({ aiSaid: [...(s.aiSaid ?? []), stage] })),
      setMapEventsOff: (mapEventsOff) => set({ mapEventsOff }),
      setHintsOff: (hintsOff) => set({ hintsOff }),
      portIncomePerSecond: 0,
      setPortIncome: (portIncomePerSecond) => set({ portIncomePerSecond }),
      projectsOpen: true,
      setProjectsOpen: (projectsOpen) => set({ projectsOpen }),
      touch: () => set({ lastSeenAt: Date.now() }),
      incorporate: () => set({ incorporatedAt: Date.now() }),
      reset: () => set({
        lastSeenAt: Date.now(), incorporatedAt: Date.now(), remoteBeds: null, mapChoice: null, seenProjects: [],
        portIncomePerSecond: 0, hintsDone: [], land: null, eventPacing: null, routes: 0, termSheet: null, overflowed: false, snubbed: false, aiAt: null, aiSaid: [], aiMode: false,
      }),
    }),
    {
      name: "session",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        lastSeenAt: s.lastSeenAt,
        incorporatedAt: s.incorporatedAt,
        remoteBeds: s.remoteBeds,
        mapChoice: s.mapChoice,
        seenProjects: s.seenProjects,
        projectsOpen: s.projectsOpen,
        portIncomePerSecond: s.portIncomePerSecond,
        hintsDone: s.hintsDone,
        hintsOff: s.hintsOff,
        mapEventsOff: s.mapEventsOff,
        land: s.land,
        eventPacing: s.eventPacing,
        routes: s.routes,
        termSheet: s.termSheet,
        overflowed: s.overflowed,
        snubbed: s.snubbed,
        aiAt: s.aiAt,
        aiSaid: s.aiSaid,
        aiMode: s.aiMode,
        aiBudget: s.aiBudget,
        showPlan: s.showPlan,
      }),
    },
  ),
);
