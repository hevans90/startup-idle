/**
 * TERM SHEETS — what the investors want of this company, chosen at founding:
 * one goal for the run, paying a share on top of the Equity the sale pays if
 * it is met when the company is sold. Each pushes a different way to play — a
 * quick sale, a big town, a clean one, the wonders, the agents — and three of
 * them are offered, a different three for different land. @see termBonusNow
 */
import { runningAgents } from "../state/agents.store";
import { termEffects } from "./term-deal";
import { useSessionStore } from "../state/session.store";

/** What the map says, for the goals that are about it. @see setTermReader */
export type TermReading = { houses: number; wonders: number };

/** Where a goal stands: how far along, of how much, and whether it is met. */
export type TermProgress = { have: number; need: number; met: boolean; text: string };

export type TermSheet = {
  id: string;
  /** Who is offering it. */
  investor: string;
  /** The goal, as the investors put it, at their plan. */
  goal: string;
  /** The goal at a milestone's scale: harder, or easier. @see TermEffects.goalScale */
  goalAt: (scale: number) => string;
  /** What meeting it adds to the sale's Equity, as a share, at their plan. */
  bonus: number;
  progress: (now: TermNow, scale?: number) => TermProgress;
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

/** A count at a scale: never below one. */
const scaled = (base: number, scale: number) => Math.max(1, Math.round(base * scale));
/** The quick sale's deadline at a scale: a harder milestone is a shorter one. */
const deadline = (scale: number) => QUICK_SALE / scale;

export const TERM_SHEETS: readonly TermSheet[] = [
  {
    id: "quick", investor: "Blitz Capital", goal: "Sell within 2 h 30 min of founding", bonus: 0.3,
    goalAt: (k) => `Sell within ${clock(deadline(k))} of founding`,
    progress: (n, k = 1) => ({
      have: n.secondsIn, need: deadline(k), met: n.secondsIn <= deadline(k),
      text: n.secondsIn <= deadline(k) ? `${clock(deadline(k) - n.secondsIn)} left` : "Too late",
    }),
  },
  {
    id: "town", investor: "Main Street Partners", goal: "40 lived-in houses when you sell", bonus: 0.25,
    goalAt: (k) => `${scaled(40, k)} lived-in houses when you sell`,
    progress: (n, k = 1) => atLeast(n.houses, scaled(40, k), "houses"),
  },
  {
    // A promise kept or broken: no harder or easier, whatever the milestone says of the kicker.
    id: "clean", investor: "Green Ledger Fund", goal: "Never let the slop pit overflow", bonus: 0.2,
    goalAt: () => "Never let the slop pit overflow",
    progress: (n) => ({ have: n.overflowed ? 0 : 1, need: 1, met: !n.overflowed, text: n.overflowed ? "It overflowed" : "Clean so far" }),
  },
  {
    id: "wonders", investor: "Monument Ventures", goal: "Two wonders standing when you sell", bonus: 0.3,
    goalAt: (k) => { const w = scaled(2, k); return `${w === 1 ? "One wonder" : `${w} wonders`} standing when you sell`; },
    progress: (n, k = 1) => atLeast(n.wonders, scaled(2, k), "wonders"),
  },
  {
    id: "agents", investor: "Singularity Seed", goal: "12 AI agents running when you sell", bonus: 0.25,
    goalAt: (k) => `${scaled(12, k)} AI agents running when you sell`,
    progress: (n, k = 1) => atLeast(n.agents, scaled(12, k), "agents"),
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
    agents: runningAgents(),
    overflowed: !!s.overflowed,
  };
}

/**
 * This run's term sheet and where it stands, or null with none: its goal and
 * its bonus at the milestone the deal set. @see term-deal
 */
export function termStatus(): { sheet: TermSheet; progress: TermProgress; goal: string; bonus: number } | null {
  const sheet = termSheet(useSessionStore.getState().termSheet);
  if (!sheet) return null;
  const e = termEffects();
  return { sheet, progress: sheet.progress(termNow(), e.goalScale), goal: sheet.goalAt(e.goalScale), bonus: sheet.bonus * e.bonusMult };
}

/** What the term sheet adds to a sale now: its bonus if met, else nothing. */
export function termBonusNow(): number {
  const t = termStatus();
  return t?.progress.met ? t.bonus : 0;
}
