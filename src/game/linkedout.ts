/**
 * LINKEDOUT: where leaders are found. A job posted for a kind brings
 * applicants in over minutes, each a profile — a headline nobody should be
 * proud of, endorsements, a personality, a rank to start at — and a red flag
 * that may or may not be there, found by a background check or after they
 * start. The company's REPUTATION, from its people's morale and how many it
 * has let go, decides how many apply, how good they are and how many hide
 * something. @see plans/innovation-overhaul.md §5, linkedout.store
 */
import type { GeneratorId } from "../state/generators.store";
import { PERSONALITIES, XP_AT, type Leader, type PersonalityId } from "./leaders";
import { getNamePool } from "./team-leaders.catalog";
import { pickAvatarIds } from "./team-leader-avatars";

// ─── Red flags ────────────────────────────────────────────────────────────────

export type RedFlagId = "quitter" | "ego" | "ghost" | "litigious" | "brilliant";

export type RedFlag = { id: RedFlagId; name: string; says: string; bad: boolean };

export const RED_FLAGS: Record<RedFlagId, RedFlag> = {
  quitter: { id: "quitter", name: "Quiet-quits at rank 3", says: "Stops ranking up at rank 3", bad: true },
  ego: { id: "ego", name: "Takes the credit", says: "Their team's morale −3", bad: true },
  ghost: { id: "ghost", name: "Ghosts on Fridays", says: "Their effect on the team a fifth less", bad: true },
  litigious: { id: "litigious", name: "Sues if let go", says: "Letting them go costs a quarter of your innovation", bad: true },
  brilliant: { id: "brilliant", name: "Secretly brilliant", says: "Ranks up half as fast again", bad: false },
};

const BAD: readonly RedFlagId[] = ["quitter", "ego", "ghost", "litigious"];

// ─── Reputation ──────────────────────────────────────────────────────────────

/** How long the company's morale is remembered, seconds: ten minutes. */
export const REPUTATION_MEMORY = 600;

/** The company's stars, 1–5: three for even morale, one more for every +10, half a star off for each person let go this run. */
export function reputation(moraleRemembered: number, letGo: number): number {
  return Math.max(1, Math.min(5, Math.round(3 + moraleRemembered / 10 - 0.5 * letGo)));
}

/** Applicants a post brings, by the stars. */
export const APPLICANTS_AT: readonly number[] = [0, 3, 3, 4, 5, 6];

/** The chance an applicant hides something bad, by the stars. */
export const badChance = (stars: number) => 0.45 - 0.07 * stars;

// ─── Prices and pace ─────────────────────────────────────────────────────────

/** Innovation for a post: 20, doubling with each one this run. */
export const postCost = (postsThisRun: number) => 20 * 2 ** postsThisRun;
/** Innovation to hire: more for a candidate who starts higher. */
export const hireCost = (rank: number) => 30 * (1 + rank);
/** Innovation for a background check. */
export const CHECK_COST = 15;
/** Innovation to bring back a connection from another company, at rank 1. */
export const REHIRE_COST = 25;
/** A post is open this long, seconds. */
export const POST_OPEN = 600;
/** An applicant comes every so many seconds, at random between these. */
export const ARRIVES_EVERY: readonly [number, number] = [60, 180];
/** And waits this long for an answer, seconds, before taking another offer. */
export const WAITS = 480;

// ─── Profiles ────────────────────────────────────────────────────────────────

const TITLES: Record<GeneratorId, readonly string[]> = {
  intern: ["Chief Coffee Officer", "Aspiring Founder", "Intern (Strategic)", "Junior Disruptor", "Gen Z Whisperer"],
  vibe_coder: ["Prompt Engineer", "10x Prompt Whisperer", "Vibe Architect", "AI-Native Builder", "Full-Stack Vibes"],
  "10x_dev": ["Principal Everything", "Staff Rockstar Ninja", "Distinguished Engineer", "Rust Evangelist", "Ex-FAANG"],
};
const BUZZ: readonly string[] = [
  "Visionary", "Ex-Unicorn", "Thought Leader", "Web3 Survivor", "Ex-Googler (intern, 2 weeks)", "Growth Hacker",
  "Disruptor", "Agile Evangelist", "Serial Ideator", "Keynote Speaker (twice)", "Open to Work", "Building in Public",
  "Hustle Culture Ambassador", "Forbes 30 Under 30 (nominated)", "Synergy Enthusiast", "Dad of 3 · Founder of 4",
];
const ABOUT: Record<PersonalityId, readonly string[]> = {
  overachiever: ["I don't do work-life balance. I do work-work balance.", "My calendar is my love language."],
  chaos_agent: ["I move fast and break things, mostly other people's things.", "Process is a cage. I am the zoo."],
  quiet_quitter: ["I bring my whole self to work. Briefly.", "Looking for a role with meaningful lunch breaks."],
  brown_noser: ["Grateful. Humbled. Thrilled. Honoured. Available.", "Huge thanks to everyone who has ever looked at me."],
  thought_leader: ["Here is what my dog taught me about B2B sales. 🧵", "Agree? I'm not asking."],
  burnout_risk: ["Slept 3 hours. Shipped 4 features. Cried once. Grind never stops.", "Vacation is a mindset, and I've never had one."],
};

export type Applicant = Leader & {
  headline: string;
  about: string;
  endorsements: number;
  /** Whether the background is known: checked, or theirs to show once hired. */
  flagKnown: boolean;
  /** When they applied and when they will give up waiting, ms. */
  arrivedAt: number;
  leavesAt: number;
};

let seq = 0;
const pick = <T,>(arr: readonly T[], r: () => number): T => arr[Math.floor(r() * arr.length)];

/** A STARTING RANK, by the stars: better companies attract people further along. */
export function startRank(stars: number, r: () => number): number {
  const x = r();
  if (stars >= 5) return x < 0.3 ? 2 : x < 0.7 ? 1 : 0;
  if (stars >= 4) return x < 0.4 ? 1 : 0;
  if (stars >= 3) return x < 0.2 ? 1 : 0;
  return 0;
}

/** A FLAG for an applicant, by the stars: something bad hidden one time in three at the worst, rarely at the best; now and then something good. */
export function rollFlag(stars: number, r: () => number): RedFlagId | null {
  const x = r();
  if (x < badChance(stars)) return pick(BAD, r);
  if (x < badChance(stars) + 0.1) return "brilliant";
  return null;
}

/** AN APPLICANT for a kind, at the stars the company has now. */
export function makeApplicant(role: GeneratorId, stars: number, now: number, r: () => number = Math.random): Applicant {
  const personality = pick(Object.keys(PERSONALITIES) as PersonalityId[], r);
  const rank = startRank(stars, r);
  const buzz = [...BUZZ].sort(() => r() - 0.5).slice(0, 2);
  return {
    id: `lo_${now}_${seq++}`, role, name: pick(getNamePool(role), r), avatarId: pickAvatarIds(role, 1)[0],
    personality, rank, xp: XP_AT[rank], perks: [], placedAt: null, flag: rollFlag(stars, r),
    headline: [pick(TITLES[role], r), ...buzz].join(" | "),
    about: pick(ABOUT[personality], r),
    endorsements: 3 + Math.floor(r() * 97),
    flagKnown: false,
    arrivedAt: now, leavesAt: now + WAITS * 1000,
  };
}

// ─── Reviews ─────────────────────────────────────────────────────────────────

/** What a kind's people say, from what their morale is made of. @see moralePartsNow */
export function reviewsOf(parts: { kind: GeneratorId; home: number; work: number; leaders: number; score: number }[]): { kind: GeneratorId; stars: number; text: string }[] {
  const out: { kind: GeneratorId; stars: number; text: string }[] = [];
  for (const p of parts) {
    const stars = Math.max(1, Math.min(5, Math.round(3 + p.score / 13)));
    const said: string[] = [];
    if (p.home <= -10) said.push("The commute is a hate crime.");
    else if (p.home >= 10) said.push("Honestly, I love where I live.");
    if (p.work <= -5) said.push("Crunch Week is every week.");
    else if (p.work >= 4) said.push("Free lunch. I'm not leaving.");
    if (p.leaders >= 3) said.push("My manager actually listens.");
    else if (p.leaders <= -3) said.push("My manager posts about me on here.");
    if (!said.length) said.push(p.score >= 0 ? "It's fine. The snacks are fine." : "I have started a podcast about leaving.");
    out.push({ kind: p.kind, stars, text: said.join(" ") });
  }
  return out;
}
