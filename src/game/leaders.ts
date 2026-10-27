/**
 * LEADERS, ONE A KIND: a person placed in a building that employs their kind.
 * Their TEAM is that building's people — the full effect — and the rest of
 * their kind feel half of it. They rank up from their team's work, and at
 * each rank a pick of three perks from their personality's pool. Placed
 * nowhere, they do nothing. @see plans/innovation-overhaul.md §4, team-leaders.store
 */
import type { GeneratorId } from "../state/generators.store";

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

export const PERSONALITIES: Record<PersonalityId, Personality> = {
  overachiever: { id: "overachiever", name: "Overachiever", says: "Team output +15% · morale −4", output: 0.15, morale: -4, pool: ["ship", "crunch", "mentor", "autopilot", "reach"] },
  chaos_agent: { id: "chaos_agent", name: "Chaos Agent", says: "Team innovation +20% · morale −3", innovation: 0.2, morale: -3, pool: ["sprint", "crunch", "culture", "reach", "ship"] },
  quiet_quitter: { id: "quiet_quitter", name: "Quiet Quitter", says: "Team morale +5 · output −5% · ranks slower", morale: 5, output: -0.05, xp: 0.8, pool: ["inspire", "thick", "culture", "mentor", "recruit"] },
  brown_noser: { id: "brown_noser", name: "Brown-Noser", says: "Team morale +3 · hires 10% cheaper", morale: 3, hireDiscount: 0.1, pool: ["recruit", "inspire", "autopilot", "reach", "culture"] },
  thought_leader: { id: "thought_leader", name: "Thought Leader", says: "Team innovation +10% · morale +2", innovation: 0.1, morale: 2, pool: ["sprint", "culture", "inspire", "reach", "mentor"] },
  burnout_risk: { id: "burnout_risk", name: "Burnout Risk", says: "Team output +25% · morale −8 · ranks faster", output: 0.25, morale: -8, xp: 1.3, pool: ["crunch", "ship", "thick", "autopilot", "sprint"] },
};

export const LEADER_PERKS: Record<LeaderPerkId, LeaderPerk> = {
  inspire: { id: "inspire", name: "Inspire", says: "Team morale +3", morale: 3 },
  ship: { id: "ship", name: "Ship It", says: "Team output +10%", output: 0.1 },
  crunch: { id: "crunch", name: "Crunch Captain", says: "Team output +20% · morale −4", output: 0.2, morale: -4 },
  recruit: { id: "recruit", name: "Recruiter", says: "Their kind's hires 10% cheaper", hireDiscount: 0.1 },
  reach: { id: "reach", name: "Open Door", says: "The rest of their kind feel three quarters, not half", rest: 0.75 },
  sprint: { id: "sprint", name: "Innovation Sprint", says: "Team innovation +15%", innovation: 0.15 },
  mentor: { id: "mentor", name: "Mentor Program", says: "Ranks up 40% faster", xp: 1.4 },
  culture: { id: "culture", name: "Culture Carrier", says: "Every kind's morale +1", everyone: 1 },
  thick: { id: "thick", name: "Thick Skin", says: "Team morale +2 · output +5%", morale: 2, output: 0.05 },
  autopilot: { id: "autopilot", name: "Always Recruiting", says: "Hires one of their kind every 4 s when affordable", autoBuy: 0.25 },
};

/** Output a rank adds to the team: +4% each. */
export const RANK_OUTPUT = 0.04;
/** The rest of the kind, without Open Door: half. */
export const REST_SHARE = 0.5;
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
  const rest = Math.max(...leans(l).map((x) => x.rest ?? REST_SHARE));
  const t = Math.min(team, owned);
  return (t + rest * (owned - t)) / owned;
}

export type LeaderEffects = { output: number; innovation: number; morale: number; hireCost: number; autoBuy: number; everyone: number; xpPerSecond: number };

/**
 * WHAT A LEADER DOES to their kind, given the people at their building's
 * desks (`team`) and of their kind (`owned`): output and innovation as ×,
 * morale as points, all as felt across the kind; and how fast they rank up,
 * at a morale-scaled `outputMult`.
 */
export function leaderEffects(l: Leader, team: number, owned: number, outputMult = 1): LeaderEffects {
  const share = teamShare(l, team, owned), all = leans(l);
  const sum = (k: keyof Lean) => all.reduce((n, x) => n + ((x[k] as number | undefined) ?? 0), 0);
  const placed = l.placedAt !== null;
  const xpMult = all.reduce((n, x) => n * (x.xp ?? 1), 1);
  const t = Math.min(team, owned);
  return {
    output: 1 + share * (sum("output") + RANK_OUTPUT * l.rank),
    innovation: 1 + share * sum("innovation"),
    // + 0: never a negative nought, for nobody to see as "−0".
    morale: share * sum("morale") + 0,
    hireCost: placed ? all.reduce((n, x) => n * (1 - (x.hireDiscount ?? 0)), 1) : 1,
    autoBuy: placed ? sum("autoBuy") : 0,
    everyone: placed ? sum("everyone") : 0,
    xpPerSecond: placed && owned > 0 ? 0.25 * Math.sqrt(t + REST_SHARE * (owned - t)) * outputMult * xpMult : 0,
  };
}
