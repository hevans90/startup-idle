/**
 * TERM SHEETS — what an investor wants of this company, chosen at founding:
 * one goal for the run, paying a share on top of the Equity the sale pays if
 * it is met when the company is sold. Each investor pushes a different way to
 * play — a quick sale or a patient one, a big town or a small one, an army of
 * hires or a skeleton crew, the machine or none of it — and four of them are
 * offered, a different four for different land, rerolled for an Exit.
 * The goals are measured here; who the investors are, in term-investors; the
 * clauses, in term-deal. @see termBonusNow, TermSheetSelect
 */
import { runningAgents } from "../state/agents.store";
import { useAiSingularityStore } from "../state/ai-singularity.store";
import { useGeneratorStore } from "../state/generators.store";
import { useInnovationStore } from "../state/innovation.store";
import { useMoneyStore } from "../state/money.store";
import { useSessionStore } from "../state/session.store";
import { useTeamLeadersEmployeesStore } from "../state/team-leaders.store";
import { useUpgradeStore } from "../state/upgrades.store";
import { useValuationStore } from "../state/valuation.store";
import { formatCurrency } from "../utils/money-utils";
import { termEffects } from "./term-deal";
import { INVESTORS, type GoalSpec, type Investor, type Metric } from "./term-investors";

/** What the map says, for the goals that are about it. @see setTermReader */
export type TermReading = { houses: number; wonders: number; projects?: number };

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

/** Everything a goal is read from, at the sale. */
export type TermNow = Required<TermReading> & Record<Exclude<Metric, keyof TermReading>, number> & { secondsIn: number };

/** The first investor's deadline for the quick sale, seconds. */
export const QUICK_SALE = 2.5 * 3600;

const clock = (s: number) => {
  const m = Math.max(0, Math.round(s / 60));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};
const amount = (n: number, money?: boolean) => (money ? formatCurrency(n, { exponentBreakpoint: 1e9 }) : n.toLocaleString("en-GB"));

/** A count asked for at a scale: harder asks more (never under one, a meter never over 99, leaders never over the three there can be). */
const more = (base: number, k: number, metric: Metric) => {
  const n = Math.max(1, Math.round(base * k));
  if (metric === "leaders") return Math.min(3, n);
  return metric === "singularity" || metric === "morale" ? Math.min(99, n) : n;
};
/** A ceiling at a scale: harder allows less — for a negative one, further below nought. */
const fewer = (base: number, k: number) => (base >= 0 ? Math.floor(base / k) : Math.round(base * k));

/** A GOAL, from its spec: what it says at a scale, and where the company stands against it. */
function goalOf(g: GoalSpec): Pick<TermSheet, "goalAt" | "progress"> {
  switch (g.kind) {
    case "more": return {
      goalAt: (k) => `${amount(more(g.base, k, g.metric), g.money)} ${g.unit} when you sell`,
      progress: (n, k = 1) => {
        const need = more(g.base, k, g.metric), have = n[g.metric];
        return { have, need, met: have >= need, text: `${amount(Math.min(have, need), g.money)}/${amount(need, g.money)} ${g.unit}` };
      },
    };
    case "fewer": return {
      goalAt: (k) => `No more than ${fewer(g.base, k).toLocaleString("en-GB")} ${g.unit} when you sell`,
      progress: (n, k = 1) => {
        const need = fewer(g.base, k), have = Math.round(n[g.metric]);
        return { have, need, met: have <= need, text: `${have} now, ${need} at most` };
      },
    };
    case "none": return {
      goalAt: () => `No ${g.unit} when you sell`,
      progress: (n) => {
        const have = Math.round(n[g.metric]);
        return { have, need: 0, met: have === 0, text: have === 0 ? `None so far` : `${have} now: none allowed` };
      },
    };
    case "within": return {
      goalAt: (k) => `Sell within ${clock(g.seconds / k)} of founding`,
      progress: (n, k = 1) => {
        const by = g.seconds / k;
        return { have: n.secondsIn, need: by, met: n.secondsIn <= by, text: n.secondsIn <= by ? `${clock(by - n.secondsIn)} left` : "Too late" };
      },
    };
    case "after": return {
      goalAt: (k) => `Hold the company ${clock(g.seconds * k)} before selling`,
      progress: (n, k = 1) => {
        const from = g.seconds * k;
        return { have: n.secondsIn, need: from, met: n.secondsIn >= from, text: n.secondsIn >= from ? "Free to sell" : `${clock(from - n.secondsIn)} to wait` };
      },
    };
    case "window": return {
      goalAt: (k) => `Sell between ${clock(g.from)} and ${clock(g.from + (g.to - g.from) / k)} after founding`,
      progress: (n, k = 1) => {
        const to = g.from + (g.to - g.from) / k, t = n.secondsIn;
        return {
          have: t, need: to, met: t >= g.from && t <= to,
          text: t < g.from ? `Opens in ${clock(g.from - t)}` : t <= to ? `Open: ${clock(to - t)} left` : "The window has closed",
        };
      },
    };
  }
}

const sheetOf = (i: Investor): TermSheet => {
  const g = goalOf(i.goal);
  return { id: i.id, investor: i.investor, goal: g.goalAt(1), goalAt: g.goalAt, bonus: i.bonus, progress: g.progress };
};

export const TERM_SHEETS: readonly TermSheet[] = INVESTORS.map(sheetOf);

export const termSheet = (id: string | null | undefined): TermSheet | null => TERM_SHEETS.find((t) => t.id === id) ?? null;

/**
 * The `n` offered for a seed and a reroll: the same land and the same reroll,
 * the same ones; another reroll, another draw. @see TermSheetSelect
 */
export function termSheetsFor(seed: number, n = 4, reroll = 0): TermSheet[] {
  const all = [...TERM_SHEETS];
  // mulberry32: a neighbouring seed, or the next reroll, is a different draw.
  let s = (seed + Math.imul(reroll, 0x9e3779b1)) >>> 0;
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
  const gen = useGeneratorStore.getState();
  const count = (id: string) => gen.generators.find((g) => g.id === id)?.amount ?? 0;
  const inn = useInnovationStore.getState();
  const val = useValuationStore.getState();
  const map = reader?.() ?? { houses: 0, wonders: 0 };
  // Morale: the average over the kinds employed (none employed, nought).
  const kinds = gen.generators.filter((g) => g.amount > 0);
  const morale = kinds.length ? kinds.reduce((sum, g) => sum + (gen.satisfactionScores[g.id as keyof typeof gen.satisfactionScores] ?? 0), 0) / kinds.length : 0;
  return {
    houses: map.houses, wonders: map.wonders, projects: map.projects ?? 0,
    secondsIn: (Date.now() - s.incorporatedAt) / 1000,
    agents: runningAgents(),
    interns: count("intern"), vibe: count("vibe_coder"), tenx: count("10x_dev"),
    employees: gen.generators.reduce((n, g) => n + g.amount, 0),
    minKind: Math.min(count("intern"), count("vibe_coder")),
    mps: gen.getMoneyPerSecond(), ips: gen.getInnovationPerSecond(),
    money: useMoneyStore.getState().money.toNumber(),
    valuation: val.accruedThisRun.toNumber(),
    mandates: Object.values(val.mandateLevels).reduce((n, l) => n + l, 0),
    innovation: inn.innovation.toNumber(),
    managerTiers: Object.values(inn.managers).reduce((n, m) => n + m.tier.floor().toNumber(), 0),
    upgrades: useUpgradeStore.getState().unlockedUpgradeIds.length,
    // LEADERS PLACED: hired and put in a building, one a kind. @see game/leaders
    leaders: useTeamLeadersEmployeesStore.getState().employees.filter((l) => l.placedAt !== null).length,
    morale,
    singularity: useAiSingularityStore.getState().value,
    routes: s.routes,
    portIncome: s.portIncomePerSecond,
  };
}

/**
 * This run's term sheet and where it stands, or null with none: its goal and
 * its bonus at the milestone the deal set. A run signed with an investor who
 * is no longer offered has none. @see term-deal
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
