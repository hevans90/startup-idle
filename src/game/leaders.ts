/**
 * LEADERS, ONE A KIND: a person placed in a building that employs their kind.
 * Their TEAM is that building's people — the full effect — and the rest of
 * their kind feel half of it. They rank up from their team's work, and at
 * each rank a pick of three perks from their personality's pool. Placed
 * nowhere, they do nothing. @see plans/innovation-overhaul.md §4, team-leaders.store
 */
import type { GeneratorId } from "../state/generators.store";
import { cultureNow } from "./culture-now";
import type { RedFlagId } from "./linkedout";
import { describe, type Plain } from "./wording";

export type PersonalityId = "overachiever" | "chaos_agent" | "quiet_quitter" | "brown_noser" | "thought_leader" | "burnout_risk";
export type LeaderPerkId = "inspire" | "ship" | "crunch" | "recruit" | "reach" | "sprint" | "mentor" | "culture" | "thick" | "autopilot";

/** What a personality or a perk does. Team effects are felt in full by the team, at half (or `reach`) by the rest of the kind. */
type Lean = {
  /** Team: output, as a share more (0.1 is +10%). */
  output?: number;
  /** Team: innovation, as a share more. */
  innovation?: number;
  /** Team: morale points. */
  morale?: number;
  /** The kind's hires: a share off. */
  hireDiscount?: number;
  /** The kind's hires bought a second. */
  autoBuy?: number;
  /** How fast they rank up, ×. */
  xp?: number;
  /** Every kind's morale points, company-wide. */
  everyone?: number;
  /** How much of it the rest of the kind feel, instead of half. */
  rest?: number;
};

export type Personality = Lean & { id: PersonalityId; name: string; says: string; pool: readonly LeaderPerkId[] };
export type LeaderPerk = Lean & { id: LeaderPerkId; name: string; says: string };

/** The rest of the kind, without Open Door: half. */
export const REST_SHARE = 0.5;

/**
 * ITS EFFECT LINE, from its numbers: the team's first, under "Team", then the
 * kind's and the company's. "Output" here is the team's money. @see game/wording
 */
function says(l: Lean): string {
  const plain: Plain[] = [];
  if (l.hireDiscount) plain.push({ text: describe({ hires: 1 - l.hireDiscount }), good: true });
  if (l.autoBuy) plain.push({ text: `auto-buy one every ${1 / l.autoBuy} s`, good: true });
  if (l.everyone) plain.push({ text: describe({ morale: l.everyone }, "Every kind's"), good: l.everyone > 0 });
  if (l.rest) plain.push({ text: `rest of their kind feel ${Math.round(l.rest * 100)}%, not ${Math.round(REST_SHARE * 100)}%`, good: true });
  const team = l.output !== undefined || l.innovation !== undefined || l.morale !== undefined;
  return describe({ money: l.output && 1 + l.output, innovation: l.innovation && 1 + l.innovation, morale: l.morale, xp: l.xp }, team ? "Team" : undefined, plain);
}

const withSays = <T extends Lean>(l: T): T & { says: string } => ({ ...l, says: says(l) });

export const PERSONALITIES: Record<PersonalityId, Personality> = {
  overachiever: withSays({ id: "overachiever", name: "Overachiever", output: 0.15, morale: -4, pool: ["ship", "crunch", "mentor", "autopilot", "reach"] }),
  chaos_agent: withSays({ id: "chaos_agent", name: "Chaos Agent", innovation: 0.2, morale: -3, pool: ["sprint", "crunch", "culture", "reach", "ship"] }),
  quiet_quitter: withSays({ id: "quiet_quitter", name: "Quiet Quitter", morale: 5, output: -0.05, xp: 0.8, pool: ["inspire", "thick", "culture", "mentor", "recruit"] }),
  brown_noser: withSays({ id: "brown_noser", name: "Brown-Noser", morale: 3, hireDiscount: 0.1, pool: ["recruit", "inspire", "autopilot", "reach", "culture"] }),
  thought_leader: withSays({ id: "thought_leader", name: "Thought Leader", innovation: 0.1, morale: 2, pool: ["sprint", "culture", "inspire", "reach", "mentor"] }),
  burnout_risk: withSays({ id: "burnout_risk", name: "Burnout Risk", output: 0.25, morale: -8, xp: 1.3, pool: ["crunch", "ship", "thick", "autopilot", "sprint"] }),
};

export const LEADER_PERKS: Record<LeaderPerkId, LeaderPerk> = {
  inspire: withSays({ id: "inspire", name: "Inspire", morale: 3 }),
  ship: withSays({ id: "ship", name: "Ship It", output: 0.1 }),
  crunch: withSays({ id: "crunch", name: "Crunch Captain", output: 0.2, morale: -4 }),
  recruit: withSays({ id: "recruit", name: "Recruiter", hireDiscount: 0.1 }),
  reach: withSays({ id: "reach", name: "Open Door", rest: 0.75 }),
  sprint: withSays({ id: "sprint", name: "Innovation Sprint", innovation: 0.15 }),
  mentor: withSays({ id: "mentor", name: "Mentor Program", xp: 1.4 }),
  culture: withSays({ id: "culture", name: "Culture Carrier", everyone: 1 }),
  thick: withSays({ id: "thick", name: "Thick Skin", morale: 2, output: 0.05 }),
  autopilot: withSays({ id: "autopilot", name: "Always Recruiting", autoBuy: 0.25 }),
};

/** Output a rank adds to the team: +4% each. */
export const RANK_OUTPUT = 0.04;
/** XP for each rank, from nought; five ranks. */
export const XP_AT: readonly number[] = [0, 300, 1200, 3000, 6500, 12000];
export const MAX_LEADER_RANK = XP_AT.length - 1;

export type Leader = {
  id: string;
  role: GeneratorId;
  name: string;
  avatarId?: string;
  personality: PersonalityId;
  rank: number;
  xp: number;
  /** The perks picked, one a rank. */
  perks: LeaderPerkId[];
  /** The building they lead, by structure id; null while not placed. */
  placedAt: number | null;
  /** What their profile did not say, if anything: shown once they start. @see RED_FLAGS */
  flag?: RedFlagId | null;
};

/** The rank an amount of XP reaches. */
export const rankAt = (xp: number): number => {
  let r = 0;
  for (let k = 1; k < XP_AT.length; k++) if (xp >= XP_AT[k]) r = k;
  return r;
};

/** A stable number for a string, to draw the same three each time. */
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

/** THE PICK WAITING, if a rank has been reached without one: three perks of their pool not yet taken, the same three until one is picked. */
export function perkOffer(l: Leader): LeaderPerkId[] {
  if (l.perks.length >= l.rank) return [];
  const left = PERSONALITIES[l.personality].pool.filter((p) => !l.perks.includes(p));
  const seed = hash(`${l.id}:${l.perks.length}`);
  return [...left].sort((a, b) => hash(`${seed}${a}`) - hash(`${seed}${b}`)).slice(0, 3);
}

/** Everything a leader leans: their personality and their perks. */
function leans(l: Leader): Lean[] {
  return [PERSONALITIES[l.personality], ...l.perks.map((p) => LEADER_PERKS[p])];
}

/** How much of a leader the kind feels, together: the team in full, the rest at half (or Open Door's). 0 placed nowhere, or nobody of the kind. */
export function teamShare(l: Leader, team: number, owned: number): number {
  if (l.placedAt === null || owned <= 0) return 0;
  // Open Plan: everyone is on the team. @see CARDS
  const rest = cultureNow(l.role).leadAll ? 1 : Math.max(...leans(l).map((x) => x.rest ?? REST_SHARE));
  const t = Math.min(team, owned);
  // Ghosts on Fridays: a fifth less of them. @see RED_FLAGS
  return ((t + rest * (owned - t)) / owned) * (l.flag === "ghost" ? 0.8 : 1);
}

export type LeaderEffects = { output: number; innovation: number; morale: number; hireCost: number; autoBuy: number; everyone: number; xpPerSecond: number };

/**
 * WHAT A LEADER DOES to their kind, given the people at their building's
 * desks (`team`) and of their kind (`owned`): output and innovation as ×,
 * morale as points, all as felt across the kind; and how fast they rank up,
 * at a morale-scaled `outputMult`.
 */
export function leaderEffects(l: Leader, team: number, owned: number, outputMult = 1): LeaderEffects {
  const share = teamShare(l, team, owned), all = leans(l), deck = cultureNow(l.role);
  const sum = (k: keyof Lean) => all.reduce((n, x) => n + ((x[k] as number | undefined) ?? 0), 0);
  const placed = l.placedAt !== null;
  // Secretly brilliant ranks faster; a quiet quitter stops at rank 3. @see RED_FLAGS
  const xpMult = all.reduce((n, x) => n * (x.xp ?? 1), 1) * (l.flag === "brilliant" ? 1.5 : 1) * (l.flag === "quitter" && l.rank >= 3 ? 0 : 1);
  const t = Math.min(team, owned);
  return {
    // Stack Ranking: a rank counts double, or triple. @see CARDS
    output: 1 + share * (sum("output") + RANK_OUTPUT * l.rank * deck.leaderRank),
    innovation: 1 + share * sum("innovation"),
    // + 0: never a negative nought, for nobody to see as "−0".
    morale: share * (sum("morale") + (l.flag === "ego" ? -3 : 0)) + 0,
    hireCost: placed ? all.reduce((n, x) => n * (1 - (x.hireDiscount ?? 0)), 1) : 1,
    autoBuy: placed ? sum("autoBuy") : 0,
    everyone: placed ? sum("everyone") : 0,
    xpPerSecond: placed && owned > 0 ? 0.25 * Math.sqrt(t + REST_SHARE * (owned - t)) * outputMult * xpMult * deck.leaderXp : 0,
  };
}
