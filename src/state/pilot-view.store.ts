/**
 * WHAT THE PILOT IS DOING, AS THE INTERFACE READS IT: its status, its queue
 * and its log as plain words and numbers, written twice a second by the game's
 * pilot while AI mode drives. The sidebar reads this and never the pilot, so
 * the map's engine stays out of its bundle. @see stepGamePilot, PilotTab
 */
import { create } from "zustand";

export type PilotDesk = "people" | "town" | "landmarks" | "water" | "harbour" | "culture" | "machine" | "events";
export type PilotState = "ready" | "saving" | "waiting" | "blocked" | "cancelled";

export type JobView = {
  id: string;
  desk: PilotDesk;
  says: string;
  why: string;
  at?: { x: number; y: number };
  /** The building it puts there, for its hologram. */
  puts?: string;
  cost: number;
  costs: "money" | "innovation";
  state: PilotState;
  /** Its state in words: "Next", "Saving · $71 short · 0:20", "After: a bed for an intern". */
  shown: string;
};

export type PilotLine = { at: number; kind: "did" | "refused" | "fault"; text: string };

export type PilotView = {
  kind: "did" | "next" | "saving" | "waiting" | "blocked" | "idle" | "paused" | "stuck";
  says: string;
  /** The job it is on, if any. */
  job: string | null;
  /** Every job proposed at its last look, the best first. */
  queue: JobView[];
  /** What it did and what was refused, the newest first. */
  log: PilotLine[];
  /** Seconds on its own clock, for the log's times. */
  now: number;
};

const EMPTY: PilotView = { kind: "idle", says: "Starting", job: null, queue: [], log: [], now: 0 };

export const usePilotView = create<PilotView & { publish: (v: PilotView) => void; clear: () => void }>()((set) => ({
  ...EMPTY,
  publish: (v) => set(v),
  clear: () => set(EMPTY),
}));

/** A job in the queue by its id, or the first whose id starts so. */
export const jobIn = (queue: readonly JobView[], id: string, prefix = false): JobView | undefined =>
  queue.find((j) => (prefix ? j.id.startsWith(id) : j.id === id));
