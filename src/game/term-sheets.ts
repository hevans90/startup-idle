/**
 * TERM SHEETS — what the investors want of this company, chosen at founding:
 * one goal for the run, paying a share on top of the Equity the sale pays if
 * it is met when the company is sold. Each pushes a different way to play — a
 * quick sale, a big town, a clean one, the wonders, the agents — and three of
 * them are offered, a different three for different land. @see termBonusNow
 */
import { useAgentsStore } from "../state/agents.store";
import { useSessionStore } from "../state/session.store";

/** What the map says, for the goals that are about it. @see setTermReader */
export type TermReading = { houses: number; wonders: number };

/** Where a goal stands: how far along, of how much, and whether it is met. */
export type TermProgress = { have: number; need: number; met: boolean; text: string };

export type TermSheet = {
  id: string;
  /** Who is offering it. */
  investor: string;
  /** The goal, as the investors put it. */
  goal: string;
  /** What meeting it adds to the sale's Equity, as a share. */
  bonus: number;
  progress: (now: TermNow) => TermProgress;
};

/** Everything a goal is read from. */
export type TermNow = TermReading & { secondsIn: number; agents: number; overflowed: boolean };

/** A run's deadline for the quick sale, seconds. */
export const QUICK_SALE = 2.5 * 3600;

const clock = (s: number) => {
  const m = Math.max(0, Math.round(s / 60));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};

const atLeast = (have: number, need: number, what: string): TermProgress =>
  ({ have, need, met: have >= need, text: `${Math.min(have, need)}/${need} ${what}` });

export const TERM_SHEETS: readonly TermSheet[] = [
  {
    id: "quick", investor: "Blitz Capital", goal: "Sell within 2 h 30 min of founding", bonus: 0.3,
    progress: (n) => ({
      have: n.secondsIn, need: QUICK_SALE, met: n.secondsIn <= QUICK_SALE,
      text: n.secondsIn <= QUICK_SALE ? `${clock(QUICK_SALE - n.secondsIn)} left` : "Too late",
    }),
  },
  {
    id: "town", investor: "Main Street Partners", goal: "40 lived-in houses when you sell", bonus: 0.25,
    progress: (n) => atLeast(n.houses, 40, "houses"),
  },
  {
    id: "clean", investor: "Green Ledger Fund", goal: "Never let the slop pit overflow", bonus: 0.2,
    progress: (n) => ({ have: n.overflowed ? 0 : 1, need: 1, met: !n.overflowed, text: n.overflowed ? "It overflowed" : "Clean so far" }),
  },
  {
    id: "wonders", investor: "Monument Ventures", goal: "Two wonders standing when you sell", bonus: 0.3,
    progress: (n) => atLeast(n.wonders, 2, "wonders"),
  },
  {
    id: "agents", investor: "Singularity Seed", goal: "12 AI agents running when you sell", bonus: 0.25,
    progress: (n) => atLeast(n.agents, 12, "agents"),
  },
];

export const termSheet = (id: string | null | undefined): TermSheet | null => TERM_SHEETS.find((t) => t.id === id) ?? null;

/** The `n` offered for a seed: the same land, the same ones. */
export function termSheetsFor(seed: number, n = 3): TermSheet[] {
  const all = [...TERM_SHEETS];
  // mulberry32: a neighbouring seed is a different three.
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, n);
}

let reader: (() => TermReading) | null = null;

/** Tell the term sheet how to ask the map; returns a function that stops it. */
export function setTermReader(read: () => TermReading): () => void {
  reader = read;
  return () => { if (reader === read) reader = null; };
}

/** What every goal is read from, now. */
export function termNow(): TermNow {
  const s = useSessionStore.getState();
  return {
    ...(reader?.() ?? { houses: 0, wonders: 0 }),
    secondsIn: (Date.now() - s.incorporatedAt) / 1000,
    agents: useAgentsStore.getState().agents,
    overflowed: !!s.overflowed,
  };
}

/** This run's term sheet and where it stands, or null with none. */
export function termStatus(): { sheet: TermSheet; progress: TermProgress } | null {
  const sheet = termSheet(useSessionStore.getState().termSheet);
  return sheet ? { sheet, progress: sheet.progress(termNow()) } : null;
}

/** What the term sheet adds to a sale now: its bonus if met, else nothing. */
export function termBonusNow(): number {
  const t = termStatus();
  return t?.progress.met ? t.sheet.bonus : 0;
}
