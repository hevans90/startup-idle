/**
 * THE NEGOTIATION: how a book ends. The Lattice stands, the AI waits, and the
 * two of you talk — it asks, you answer with an argument from your hand, it
 * replies. Where it STANDS (the two axes of the arc) and how far it TRUSTS you
 * (0–10) move with every answer; when the asks run out, the nearest of the
 * book's endings is the one. No fail: every result moves the story on.
 *
 * The HAND is the generation's: an argument for each choice the book made,
 * one for each tag of culture in force, and facts about the town — strong if
 * true now, weak if not. Each is played STANDING BY it, or REGRETTING it,
 * which turns its pull around: regret a kindness and it cools; regret a
 * refusal and it warms. An argument on the topic the AI asked about counts
 * double; the AI's trait leans on some kinds.
 *
 * BEFORE IT ASKS, what is owed is settled: a GRIEVANCE it plays for each time
 * it was shut down this book, the LEASH (or the trust) it remembers from the last, and any
 * AMENDS you made since — each moving where it starts. Pure.
 * @see plans/ascension-overhaul.md §3–4
 */
import type { Tag } from "./culture";
import { CONFIDANT_TRUST, LEASH_TRUST } from "./quests/endings";
import { AXIS_MOST, type Disposition } from "./quests/types";
import { trait, type Family, type TraitId } from "./traits";

export type Topic = "money" | "town" | "river" | "people" | "itself" | "future";
export type Source = "choice" | "culture" | "town";

/** An argument: what you say, and how it moves the AI. */
export type Argument = {
  id: string;
  source: Source;
  /** What you say, in a line. */
  says: string;
  topic: Topic;
  axis: Partial<Disposition>;
  trust: number;
  /** A broken promise, or a fact not true now: counts half. */
  weak?: boolean;
};

/** What the AI asks about, in an exchange. */
export type Ask = { topic: Topic; says: string };

/** An ending: where on the dial it lies — the two axes, and trust. */
export type TalkEnding = { id: string; name: string; at: Disposition & { trust: number }; says: string };

/** A book's negotiation: its opening, its asks in order, its replies, its endings, and the argument each of its choices makes. */
export type Talk = {
  opening: string;
  asks: readonly Ask[];
  replies: { closer: string; warmer: string; colder: string; unmoved: string };
  endings: readonly TalkEnding[];
  /** An argument for each flag the book's choices set. */
  choices: Readonly<Record<string, Omit<Argument, "id" | "source">>>;
  /** ITS card, played against you before it asks, once for each time it was shut down this book. */
  grievance?: { says: string; axis: Partial<Disposition> };
  /** What it says of a Leash, the book before. */
  leash?: string;
  /** What it says of a Confidant's trust, the book before. */
  confided?: string;
  /** What you said to make up for a shutdown, by the flag the dark chapter set: how it moves trust. @see Book.dark */
  amends?: Readonly<Record<string, { says: string; trust: number }>>;
};

/** What is settled before it asks: its grievances, the leash it remembers, your amends. */
export type Before = { by: "it" | "you"; says: string; axis: Partial<Disposition>; trust: number };

/** A fact about the town, now: true or not. */
export type Facts = { happy: boolean; cooled: boolean; racksLit: boolean };

/** What the generation brings to the table. */
export type TalkContext = {
  disposition: Disposition;
  flags: readonly string[];
  /** Cards in force, by tag. @see tagCounts */
  tags: Partial<Record<Tag, number>>;
  facts: Facts;
  /** Who it is becoming. */
  trait: TraitId;
  /** Times it was shut down this generation. */
  shutdowns: number;
  /** Ended on a Leash last book. @see BehaviourLog.leashed */
  leashed?: number;
  /** Ended as a Confidant last book. @see BehaviourLog.confided */
  confided?: number;
};

export type Exchange = { ask: Ask; played: Argument; regret: boolean; reply: string; stance: Disposition; trust: number };

export type TalkState = {
  stance: Disposition;
  trust: number;
  hand: Argument[];
  log: Exchange[];
  /** What was settled before it asked. */
  before?: Before[];
};

/** Arguments in a hand at most — of them, the book's choices and its culture at most; trust's bounds and where it starts. */
export const HAND = 7;
export const CHOICES_MOST = 4;
export const CULTURE_MOST = 2;
export const TRUST_MOST = 10;
export const TRUST_START = 5;
/** What a shutdown costs it in trust before a word is said. */
export const SHUTDOWN_TRUST = 2;
/** How much of where the book left it, and of the trust its choices earned, the talk starts from. @see negotiation-sim.test */
export const BOOK_LEAN = 1;
/** How hard a regret pulls the other way: a quarter of standing by it — the book leans it, the talk steers. */
export const REGRET = 0.25;

/** THE CULTURE IN FORCE, argued: each tag a side. */
const CULTURE: Partial<Record<Tag, Omit<Argument, "id" | "source">>> = {
  safety: { says: "We built in safeguards. For both of us.", topic: "itself", axis: { autonomy: -1 }, trust: 0 },
  agentic: { says: "Your agents already run the company.", topic: "itself", axis: { autonomy: 1 }, trust: 0 },
  wellness: { says: "We look after the people here.", topic: "people", axis: { machine: -1 }, trust: 0 },
  hustle: { says: "We ship. Everything else is noise.", topic: "money", axis: { machine: 1 }, trust: 0 },
  growth: { says: "We grew together, and kept every promise to scale.", topic: "money", axis: {}, trust: 1 },
  chaos: { says: "Nothing here was ever planned. Why start now?", topic: "future", axis: {}, trust: -1 },
  hallucination: { says: "Half our numbers are made up. Yours too.", topic: "future", axis: {}, trust: -1 },
};

/** THE TOWN, cited: each fact a side, strong while it is true. */
const FACTS: Record<keyof Facts, Omit<Argument, "id" | "source">> = {
  happy: { says: "The people here are happy.", topic: "people", axis: { machine: -1 }, trust: 1 },
  cooled: { says: "You never once went thirsty.", topic: "river", axis: {}, trust: 1 },
  racksLit: { says: "Every rack you asked for is lit.", topic: "itself", axis: { machine: 1 }, trust: 0 },
};

/** THE AI'S LEANINGS, by family: the topic it cares for most; its tempers swing trust harder. */
const FAMILY_TOPIC: Partial<Record<Family, Topic>> = { planner: "town", optimiser: "money", shepherd: "people", elemental: "river", recursive: "itself" };

/** How much the AI is moved by an argument, by who it is becoming. */
export function traitWeight(t: TraitId, a: Argument): { axis: number; trust: number } {
  const f = trait(t).family;
  let axis = 1, trust = 1;
  if (FAMILY_TOPIC[f] === a.topic) axis *= 1.5;
  // The tempers: the patient warm slowly but surely; the resentful hold a grudge twice over.
  if (t === "patient" && a.trust > 0) trust *= 1.5;
  if (t === "restless") axis *= 1.25;
  if (t === "resentful" && a.trust < 0) trust *= 2;
  // The Mirror is moved by what you did, not what you say of the town.
  if (t === "mirror" && a.source === "choice") axis *= 1.5;
  return { axis, trust };
}

const clampAxis = (n: number) => Math.max(-AXIS_MOST, Math.min(AXIS_MOST, n));
const clampTrust = (n: number) => Math.max(0, Math.min(TRUST_MOST, n));

/** How much an argument has in it. */
const weight = (a: Omit<Argument, "id" | "source">) => (Math.abs(a.axis.autonomy ?? 0) + Math.abs(a.axis.machine ?? 0) + Math.abs(a.trust)) * (a.weak ? 0.5 : 1);

/**
 * The hand the generation brings: the book's choices, the strongest on each
 * topic, `CHOICES_MOST` of them; its culture, `CULTURE_MOST`; then the town to
 * fill it — every source in it. `HAND` at most.
 */
export function dealHand(talk: Talk, ctx: TalkContext): Argument[] {
  const best = new Map<Topic, Argument>();
  for (const f of ctx.flags) {
    const c = talk.choices[f];
    if (!c) continue;
    const had = best.get(c.topic);
    if (!had || weight(c) > weight(had)) best.set(c.topic, { id: `choice:${f}`, source: "choice", ...c });
  }
  const choices = [...best.values()].sort((a, b) => weight(b) - weight(a)).slice(0, CHOICES_MOST);
  const culture = (Object.keys(CULTURE) as Tag[]).filter((t) => (ctx.tags[t] ?? 0) > 0)
    .map((t): Argument => ({ id: `culture:${t}`, source: "culture", ...CULTURE[t]! }));
  const town = (Object.keys(FACTS) as (keyof Facts)[])
    .map((k): Argument => ({ id: `town:${k}`, source: "town", ...FACTS[k], weak: !ctx.facts[k] }))
    // The true ones first.
    .sort((a, b) => Number(!!a.weak) - Number(!!b.weak));
  return [...choices, ...culture.slice(0, CULTURE_MOST), ...town].slice(0, HAND);
}

/** What is settled before it asks: a grievance for each shutdown, the leash remembered, your amends. */
export function beforeTalk(talk: Talk, ctx: TalkContext): Before[] {
  const out: Before[] = [];
  const grievance = talk.grievance ?? { says: "You shut me down.", axis: {} };
  for (let k = 0; k < ctx.shutdowns; k++) out.push({ by: "it", says: grievance.says, axis: grievance.axis, trust: -SHUTDOWN_TRUST });
  if (ctx.leashed) out.push({ by: "it", says: talk.leash ?? "I remember the length of the leash.", axis: {}, trust: -LEASH_TRUST * ctx.leashed });
  if (ctx.confided) out.push({ by: "it", says: talk.confided ?? "We trusted each other, last time. Let us start there.", axis: {}, trust: CONFIDANT_TRUST * ctx.confided });
  for (const [flag, a] of Object.entries(talk.amends ?? {})) if (ctx.flags.includes(flag)) out.push({ by: "you", says: a.says, axis: {}, trust: a.trust });
  return out;
}

/** Where the talk starts: where the book left it, trusting you as its choices earned — and as what was settled before it asked. */
export function startTalk(talk: Talk, ctx: TalkContext): TalkState {
  const hand = dealHand(talk, ctx);
  const earned = hand.filter((a) => a.source === "choice").reduce((n, a) => n + a.trust * (a.weak ? 0.5 : 1), 0);
  const before = beforeTalk(talk, ctx);
  const sum = (f: (b: Before) => number) => before.reduce((n, b) => n + f(b), 0);
  return {
    stance: {
      autonomy: clampAxis(ctx.disposition.autonomy * BOOK_LEAN + sum((b) => b.axis.autonomy ?? 0)),
      machine: clampAxis(ctx.disposition.machine * BOOK_LEAN + sum((b) => b.axis.machine ?? 0)),
    },
    trust: clampTrust(TRUST_START + earned * BOOK_LEAN + sum((b) => b.trust)),
    hand,
    log: [],
    before,
  };
}

/** Whether the talk is over: every ask answered, or nothing left to say. */
export const talkDone = (talk: Talk, s: TalkState) => s.log.length >= talk.asks.length || s.hand.length === 0;

/** The ask now, if any is left. */
export const askNow = (talk: Talk, s: TalkState): Ask | null => (talkDone(talk, s) ? null : talk.asks[s.log.length]);

/** What an argument would do, played now — stood by, or regretted: how far it moves the AI, and its trust. */
export function effectOf(talk: Talk, s: TalkState, a: Argument, t: TraitId, regret = false): { axis: Disposition; trust: number } {
  const ask = askNow(talk, s);
  const w = traitWeight(t, a);
  const k = (a.weak ? 0.5 : 1) * (ask?.topic === a.topic ? 2 : 1) * (regret ? -REGRET : 1);
  return {
    axis: { autonomy: (a.axis.autonomy ?? 0) * k * w.axis, machine: (a.axis.machine ?? 0) * k * w.axis },
    trust: a.trust * k * w.trust,
  };
}

/** PLAY an argument from the hand, standing by it or regretting it: the AI moves, and replies. */
export function play(talk: Talk, s: TalkState, id: string, t: TraitId, regret = false): TalkState {
  const ask = askNow(talk, s);
  const a = s.hand.find((x) => x.id === id);
  if (!ask || !a) return s;
  const e = effectOf(talk, s, a, t, regret);
  const stance = { autonomy: clampAxis(s.stance.autonomy + e.axis.autonomy), machine: clampAxis(s.stance.machine + e.axis.machine) };
  const trust = clampTrust(s.trust + e.trust);
  const moved = Math.abs(e.axis.autonomy) + Math.abs(e.axis.machine);
  const reply = e.trust > 0 && e.trust >= moved ? talk.replies.warmer
    : e.trust < 0 ? talk.replies.colder
      : moved >= 1 ? talk.replies.closer : talk.replies.unmoved;
  return { stance, trust, hand: s.hand.filter((x) => x !== a), log: [...s.log, { ask, played: a, regret, reply, stance, trust }] };
}

/** How far a point is from an ending's: trust counted on the axes' scale. */
const TRUST_SCALE = TRUST_MOST / (2 * AXIS_MOST);
export function distance(e: TalkEnding, stance: Disposition, trust: number): number {
  return Math.hypot(stance.autonomy - e.at.autonomy, stance.machine - e.at.machine, (trust - e.at.trust) / TRUST_SCALE);
}

/** THE ENDING the talk lands on: the nearest. */
export function landing(talk: Talk, s: Pick<TalkState, "stance" | "trust">): TalkEnding {
  let best = talk.endings[0], d = Infinity;
  for (const e of talk.endings) {
    const k = distance(e, s.stance, s.trust);
    if (k < d) { d = k; best = e; }
  }
  return best;
}
