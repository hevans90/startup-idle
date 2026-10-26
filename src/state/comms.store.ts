/**
 * COMMS: everything the game tells you, in one place, replacing six —
 * toasts, the world's notices, the AI's memos and its report, hints, event
 * cards and the arc's transmissions each had their own look, place and
 * lifetime, and none kept a history. @see plans/ui-overhaul.md §4
 *
 * KINDS, each with its look, sound and lifetime:
 *  - `alert` — needs you now (an event's choice, a takeover announced): on the
 *    map till resolved. Events are their own source; they are logged here.
 *  - `transmission` — the AI asks (the arc). Its own source too; logged here.
 *  - `report` — something happened (a project opened, the AI's memo, a sale):
 *    a card for a while, then gone. `REPORT_MS`, or till dismissed with `sticky`.
 *  - `notice` — your action was refused, and why: by the pointer, `NOTICE_MS`.
 *  - `hint` — how to play: the hint card's own, not logged.
 *
 * THE LOG keeps every alert, transmission and report of the session, newest
 * last, `LOG_MOST` at most. Not saved: it is this session's.
 */
import { create } from "zustand";

export type CommsKind = "alert" | "transmission" | "report" | "notice" | "hint";
/** Who it is from: the AI's words are its violet. */
export type CommsFrom = "game" | "ai";

export type CommsEntry = {
  id: number;
  kind: CommsKind;
  from: CommsFrom;
  /** A short title over it: "Memo from the AI", "While you were out". */
  title?: string;
  text: string;
  /** Lines under it: the AI's report of what it did while you were out. */
  lines?: string[];
  at: number;
  /** When it goes from the map, ms since the epoch; null, when dismissed. */
  until: number | null;
};

/** How long a report, and a notice, stays up, ms; and the most the log keeps. */
export const REPORT_MS = 12_000;
export const NOTICE_MS = 3_000;
export const LOG_MOST = 300;

type CommsState = {
  /** What is up now: reports and notices. */
  live: CommsEntry[];
  /** Everything this session: alerts, transmissions, reports. */
  log: CommsEntry[];
  push: (e: { kind: CommsKind; text: string; from?: CommsFrom; title?: string; lines?: string[]; sticky?: boolean }, now?: number) => number;
  /** Log what another source shows — an event, a transmission — without putting it up. */
  note: (e: { kind: CommsKind; text: string; from?: CommsFrom; title?: string }, now?: number) => void;
  dismiss: (id: number) => void;
  /** Take down what has run its time. */
  expire: (now?: number) => void;
  reset: () => void;
};

let next = 1;

export const useCommsStore = create<CommsState>()((set, get) => ({
  live: [],
  log: [],
  push: ({ kind, text, from = "game", title, lines, sticky }, now = Date.now()) => {
    const id = next++;
    const life = kind === "notice" ? NOTICE_MS : kind === "report" ? REPORT_MS : null;
    const e: CommsEntry = { id, kind, from, title, text, lines, at: now, until: sticky || life === null ? null : now + life };
    set((s) => ({
      live: kind === "report" || kind === "notice" ? [...s.live, e] : s.live,
      log: kind === "notice" || kind === "hint" ? s.log : [...s.log, e].slice(-LOG_MOST),
    }));
    return id;
  },
  note: ({ kind, text, from = "game", title }, now = Date.now()) => {
    set((s) => ({ log: [...s.log, { id: next++, kind, from, title, text, at: now, until: null }].slice(-LOG_MOST) }));
  },
  dismiss: (id) => set((s) => ({ live: s.live.filter((e) => e.id !== id) })),
  expire: (now = Date.now()) => {
    const live = get().live;
    if (live.some((e) => e.until !== null && e.until <= now)) set({ live: live.filter((e) => e.until === null || e.until > now) });
  },
  reset: () => set({ live: [], log: [] }),
}));

/** Something happened: a report. */
export const report = (text: string, opts: { from?: CommsFrom; title?: string; lines?: string[]; sticky?: boolean } = {}) =>
  useCommsStore.getState().push({ kind: "report", text, ...opts });
/** Your action was refused, and why. */
export const notice = (text: string) => useCommsStore.getState().push({ kind: "notice", text });
