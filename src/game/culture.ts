/**
 * THE CULTURE DECK: how the company is run, as cards. Each manager tier is a
 * POINT, spent on a new SLOT (wide) or a card's next RANK (tall). New cards
 * come as OFFERS, one of three, dealt by the track whose tiers earned them:
 * Agile deals Hustle and Chaos, Corpo Wellness and Growth, Sales Growth and
 * Hustle. Every card is a trade; most touch every kind, a few one. Which cards
 * sit in the slots is free to change — morale drifts to suit — but points
 * spent stay spent, and a card keeps its rank. Pure: the store keeps the
 * deck. @see plans/culture-deck.md, generators.store
 */
import type { GeneratorId } from "../state/generators.store";
import type { ManagerKeys } from "../state/innovation.store";
import { change, helps, percent, STATS, times } from "./wording";

export type Tag = "hustle" | "wellness" | "growth" | "chaos";
export type Track = ManagerKeys;

export type CardId =
  | "crunch" | "hotdesk" | "stack" | "hiretofire" | "shipit"
  | "lunch" | "remote" | "sabbatical" | "therapy" | "fourday"
  | "pipeline" | "freeze" | "shuttle" | "housing" | "mentorship"
  | "hackathon" | "movefast" | "vibesonly" | "pivot" | "openplan";

/**
 * WHAT A CARD DOES at a rank, to each kind it touches: not a few percent here
 * and there, but how the map's systems run — desks, beds, commutes, leaders,
 * builds, slop. Each is read where its system works it out. @see cultureNow
 */
export type CardEffects = {
  /** Morale points. */
  morale?: number;
  /** × the kind's money (not its innovation). */
  output?: number;
  /** × the kind's innovation. */
  innovation?: number;
  /** × the kind's hire price. */
  hireCost?: number;
  /** Added to the kind's hire price curve. @see effectiveCostExponent */
  costCurve?: number;
  /** Hires of the kind bought a second, at the price. */
  autoBuy?: number;
  /** No auto-buy at all, the leaders' too. */
  noAutoBuy?: boolean;
  /** × how much slop the vibe coders make. @see game/slop */
  slop?: number;
  /** × each slop tank's size. @see tankFor */
  tank?: number;
  /** × the desks at the kind's workplaces. @see seat */
  desks?: number;
  /** What the kind's people with no desk manage, at least. @see DESKLESS */
  deskless?: number;
  /** The share of the kind working from home: no desk, no commute, in full. */
  remote?: number;
  /** × the beds in the kind's houses. @see housedBy */
  beds?: number;
  /** Tiles of commute more that cost nothing; Infinity, none do. @see commuteEfficiency */
  freeCommute?: number;
  /** Added to the mood of the kind's houses. @see moodsOf */
  houseMood?: number;
  /** × the mood sludge, fouled water and floods take. */
  hazards?: number;
  /** Tiles a workplace's lunch reaches: houses that near count a café. */
  lunch?: number;
  /** × the share of the kind's work that gets done. @see attendance */
  attendance?: number;
  /** × every building's price. @see buildCost */
  buildPrice?: number;
  /** × how fast crews build. */
  buildSpeed?: number;
  /** × the output a leader's rank adds. @see RANK_OUTPUT */
  leaderRank?: number;
  /** Leaders lead the whole kind in full, not their team only. @see teamShare */
  leadAll?: boolean;
  /** × leaders' XP. */
  leaderXp?: number;
  /** Every so often, another slotted card is swapped out. @see PIVOT_SECONDS */
  pivot?: boolean;
};

/**
 * WHAT RANK 3 REWRITES: not a bigger number, a different rule — who sits
 * where, who leads whom, what a spill is worth. Each is read where its rule
 * is. @see cultureNow
 */
export type Rules = {
  /** Any kind sits at any kind's workplace. @see seat */
  anyDesk?: boolean;
  /** × money while it is light. @see isDaytime */
  dayOutput?: number;
  /** Leaders rank on past five. @see rankAt */
  noLeaderCap?: boolean;
  /** Vibe coders who come free with each intern hired. */
  vibePerIntern?: number;
  /** Crews work ahead of the deliveries. @see materialCap */
  noMaterialWait?: boolean;
  /** Lunch counts as a café, a park and a gym. @see moodsOf */
  lunchAll?: boolean;
  /** Those working from home are on their leader's team. */
  homeTeam?: boolean;
  /** × attendance while the kind's morale is over `HAPPY_AT`. */
  happyAttendance?: number;
  /** Nobody moves out over their house's mood. @see stepMood */
  noMoveOut?: boolean;
  /** Everyone of the kind works from home. @see seat */
  allHome?: boolean;
  /** Houses by a workplace need no desks. @see NEXT_DOOR */
  nextDoor?: boolean;
  /** Auto-buy a second added for each person of the kind. */
  autoBuyPer?: number;
  /** The hire price halves again each `FREEZE_HALVES` seconds slotted. */
  freezeFalls?: boolean;
  /** Houses with no road to work still get there, in full. @see STRANDED */
  noStranded?: boolean;
  /** The kind earns what vibe coders do. */
  earnAsVibe?: boolean;
  /** × innovation while no slop tank spills. */
  cleanInnovation?: number;
  /** × innovation while a slop tank spills. */
  messInnovation?: number;
  /** Workplaces seat people while still building. */
  openSites?: boolean;
  /** Pivot Weekly brings a card into a slot of its own, swapping none out. @see pivot */
  pivotIn?: boolean;
  /** Each leader leads every kind. @see leadersNow */
  leadEvery?: boolean;
};

export type Card = {
  id: CardId;
  name: string;
  tag: Tag;
  /** Only for one kind; every kind if absent. Offered once the company employs them. */
  only?: GeneratorId;
  /** Its trade at rank 1 and rank 2; rank 3 keeps rank 2's and adds its rule. */
  ranks: readonly [CardEffects, CardEffects];
  /** What rank 3 rewrites, as the card says it… */
  keystone: string;
  /** …and as the game reads it. */
  rule: Rules;
};

/** The deck, at launch: five cards a tag. Numbers are first guesses. @see plans/culture-deck.md §4 */
export const CARDS: readonly Card[] = [
  // HUSTLE: more out of the same buildings; tired people.
  { id: "hotdesk", name: "Hot Desking", tag: "hustle", ranks: [{ desks: 1.5, houseMood: -6 }, { desks: 2, houseMood: -6 }], keystone: "Any kind sits at any workplace", rule: { anyDesk: true } },
  { id: "crunch", name: "Crunch Week", tag: "hustle", ranks: [{ deskless: 0.7, morale: -10 }, { deskless: 1, morale: -14 }], keystone: "Output ×2 while it is light", rule: { dayOutput: 2 } },
  { id: "stack", name: "Stack Ranking", tag: "hustle", ranks: [{ leaderRank: 2, morale: -8 }, { leaderRank: 3, morale: -10 }], keystone: "Leaders rank on past 5, without end", rule: { noLeaderCap: true } },
  { id: "hiretofire", name: "Hire to Fire", tag: "hustle", only: "intern", ranks: [{ costCurve: -0.04, morale: -12 }, { costCurve: -0.07, morale: -12 }], keystone: "A free vibe coder with every 10 interns hired", rule: { vibePerIntern: 0.1 } },
  { id: "shipit", name: "Ship It Fridays", tag: "hustle", ranks: [{ buildSpeed: 2, slop: 1.5 }, { buildSpeed: 3, slop: 1.75 }], keystone: "Crews build ahead of deliveries", rule: { noMaterialWait: true } },
  // WELLNESS: a happier town; space or speed given for it.
  { id: "lunch", name: "Free Lunch", tag: "wellness", ranks: [{ lunch: 6, buildPrice: 1.15 }, { lunch: 12, buildPrice: 1.15 }], keystone: "Lunch counts as a café, park and gym", rule: { lunchAll: true } },
  { id: "remote", name: "Remote Fridays", tag: "wellness", ranks: [{ remote: 0.25 }, { remote: 0.5 }], keystone: "Home workers join their leader's team", rule: { homeTeam: true } },
  { id: "fourday", name: "Four-Day Week", tag: "wellness", ranks: [{ houseMood: 10, attendance: 0.8 }, { houseMood: 15, attendance: 0.8 }], keystone: "Morale over +20: attendance ×1.5", rule: { happyAttendance: 1.5 } },
  { id: "therapy", name: "Therapy Budget", tag: "wellness", ranks: [{ hazards: 0.5, hireCost: 1.15 }, { hazards: 0, hireCost: 1.15 }], keystone: "No one moves out over mood", rule: { noMoveOut: true } },
  { id: "sabbatical", name: "Sabbaticals", tag: "wellness", only: "10x_dev", ranks: [{ innovation: 2, attendance: 0.75 }, { innovation: 3, attendance: 0.75 }], keystone: "Every 10x dev works from home", rule: { allHome: true } },
  // GROWTH: headcount.
  { id: "housing", name: "Company Housing", tag: "growth", ranks: [{ beds: 2, houseMood: -8 }, { beds: 3, houseMood: -8 }], keystone: "Houses beside a workplace need no desks", rule: { nextDoor: true } },
  { id: "pipeline", name: "Always Be Hiring", tag: "growth", ranks: [{ autoBuy: 1, costCurve: 0.03 }, { autoBuy: 3, costCurve: 0.03 }], keystone: "Auto-buy +1/s for every 1,000 hired", rule: { autoBuyPer: 0.001 } },
  { id: "freeze", name: "Hire Freeze", tag: "growth", ranks: [{ hireCost: 0.5, noAutoBuy: true, morale: -10 }, { hireCost: 0.33, noAutoBuy: true, morale: -10 }], keystone: "Hire prices halve again every 10 min", rule: { freezeFalls: true } },
  { id: "shuttle", name: "Shuttle Bus", tag: "growth", ranks: [{ freeCommute: 8, buildPrice: 1.15 }, { freeCommute: Infinity, buildPrice: 1.15 }], keystone: "Houses with no road get to work anyway", rule: { noStranded: true } },
  { id: "mentorship", name: "Mentorship Scheme", tag: "growth", only: "intern", ranks: [{ innovation: 3, desks: 0.5 }, { innovation: 5, desks: 0.5 }], keystone: "Interns earn what vibe coders earn", rule: { earnAsVibe: true } },
  // CHAOS: innovation, and a mess.
  { id: "hackathon", name: "Hackathon Culture", tag: "chaos", only: "vibe_coder", ranks: [{ innovation: 2, slop: 2 }, { innovation: 3, slop: 2 }], keystone: "Innovation ×2 while no tank spills", rule: { cleanInnovation: 2 } },
  { id: "movefast", name: "Move Fast", tag: "chaos", ranks: [{ buildSpeed: 2, tank: 0.5 }, { buildSpeed: 3, tank: 0.5 }], keystone: "Workplaces seat people while still building", rule: { openSites: true } },
  { id: "vibesonly", name: "Vibes Only", tag: "chaos", only: "vibe_coder", ranks: [{ deskless: 0.7, slop: 1.5, houseMood: -6 }, { deskless: 1, slop: 1.5, houseMood: -6 }], keystone: "Innovation ×3 while a tank spills", rule: { messInnovation: 3 } },
  { id: "pivot", name: "Pivot Weekly", tag: "chaos", ranks: [{ innovation: 1.5, pivot: true }, { innovation: 2, pivot: true }], keystone: "Pivots bring a card in, in a slot of its own", rule: { pivotIn: true } },
  { id: "openplan", name: "Open Plan", tag: "chaos", ranks: [{ leadAll: true, morale: -8 }, { leadAll: true, leaderXp: 2, morale: -8 }], keystone: "Every leader leads every kind", rule: { leadEvery: true } },
];

export const card = (id: CardId): Card => CARDS.find((c) => c.id === id)!;
const isCard = (id: unknown): id is CardId => CARDS.some((c) => c.id === id);

/** What each track deals. */
export const TRACK_TAGS: Record<Track, readonly Tag[]> = {
  agile: ["hustle", "chaos"],
  corpo: ["wellness", "growth"],
  sales: ["growth", "hustle"],
};

/** The highest rank a card can be bought to: the third brings its rule. */
export const MAX_RANK = 3;
/** Cards an offer shows. */
export const OFFER_SIZE = 3;
/** Seconds between Pivot Weekly's swaps. */
export const PIVOT_SECONDS = 600;
/** Four-Day Week's rule: morale over this. */
export const HAPPY_AT = 20;
/** Hire Freeze's rule: seconds slotted for each halving of the price, and the least it falls to. */
export const FREEZE_HALVES = 600;
export const FREEZE_LEAST = 0.01;

/**
 * TAG SETS: two, three or four cards of a tag in force bring its set, each
 * step on top of the last — for every kind, whatever the cards are for. Not a
 * trade: what playing to a tag earns. @see plans/culture-deck.md §3
 */
export const SET_AT = [2, 3, 4] as const;
export const TAG_SETS: Record<Tag, readonly [SetStep, SetStep, SetStep]> = {
  hustle: [{ text: "Desks ×1.25", e: { desks: 1.25 } }, { text: "Build speed ×2", e: { buildSpeed: 2 } }, { text: "Money ×2", e: { output: 2 } }],
  wellness: [{ text: "Morale +6", e: { morale: 6 } }, { text: "House mood +10", e: { houseMood: 10 } }, { text: "Attendance +30%", e: { attendance: 1.3 } }],
  growth: [{ text: "Hire prices −20%", e: { hireCost: 0.8 } }, { text: "Beds per house ×1.5", e: { beds: 1.5 } }, { text: "Price curve −0.05", e: { costCurve: -0.05 } }],
  chaos: [{ text: "Innovation ×1.5", e: { innovation: 1.5 } }, { text: "Spill upset −50%", e: { hazards: 0.5 } }, { text: "Innovation ×2 while a tank spills", e: { messInnovation: 2 } }],
};
export type SetStep = { text: string; e: CardEffects & Rules };

/** Each tag's cards in force. */
export function tagCounts(d: Deck): Record<Tag, number> {
  const n: Record<Tag, number> = { hustle: 0, wellness: 0, growth: 0, chaos: 0 };
  for (const id of inForce(d)) n[card(id).tag]++;
  return n;
}
/** The steps of a tag's set that `count` cards reach. */
export const setSteps = (tag: Tag, count: number): readonly SetStep[] => TAG_SETS[tag].filter((_, k) => count >= SET_AT[k]);

/** A share as the card says it: ×2 and up, else a percentage. */
const share = (v: number) => (v >= 2 ? times(v) : percent((v - 1) * 100));
const signed = (v: number) => `${v > 0 ? "+" : "−"}${Math.abs(v)}`;

/** Each effect as a line on the card's face, and whether it helps. */
const LINES: { [K in keyof CardEffects]-?: (v: NonNullable<CardEffects[K]>) => { text: string; good: boolean } } = {
  desks: (v) => ({ text: `Desks ${share(v)}`, good: v > 1 }),
  deskless: (v) => ({ text: `Deskless work at ${Math.round(v * 100)}%`, good: true }),
  remote: (v) => ({ text: `Working from home ${Math.round(v * 100)}%`, good: true }),
  beds: (v) => ({ text: `Beds per house ${share(v)}`, good: v > 1 }),
  freeCommute: (v) => ({ text: v === Infinity ? "Commutes cost nothing" : `Free commute +${v} tiles`, good: true }),
  lunch: (v) => ({ text: `Lunch for homes ${v} tiles out`, good: true }),
  hazards: (v) => ({ text: v === 0 ? "Spills upset no one" : `Spill upset ${percent((v - 1) * 100)}`, good: true }),
  buildSpeed: (v) => ({ text: `Build speed ${share(v)}`, good: v > 1 }),
  leaderRank: (v) => ({ text: `Leader ranks ${times(v)}`, good: v > 1 }),
  leadAll: () => ({ text: "Leaders lead everyone", good: true }),
  leaderXp: (v) => ({ text: `Leader XP ${times(v)}`, good: v > 1 }),
  autoBuy: (v) => ({ text: `Auto-buy ${v}/s`, good: true }),
  output: (v) => ({ text: `${STATS.money.name} ${change("money", v)}`, good: helps("money", v) }),
  innovation: (v) => ({ text: `${STATS.innovation.name} ${share(v)}`, good: v > 1 }),
  hireCost: (v) => ({ text: `${STATS.hires.name} ${change("hires", v)}`, good: helps("hires", v) }),
  costCurve: (v) => ({ text: `Price curve ${v > 0 ? "+" : "−"}${Math.abs(v)}`, good: v < 0 }),
  houseMood: (v) => ({ text: `House mood ${signed(v)}`, good: v > 0 }),
  morale: (v) => ({ text: `${STATS.morale.name} ${change("morale", v)}`, good: helps("morale", v) }),
  attendance: (v) => ({ text: `Attendance ${percent((v - 1) * 100)}`, good: v > 1 }),
  buildPrice: (v) => ({ text: `Build prices ${percent((v - 1) * 100)}`, good: v < 1 }),
  slop: (v) => ({ text: `${STATS.slop.name} ${share(v)}`, good: v < 1 }),
  tank: (v) => ({ text: `Slop tanks ${percent((v - 1) * 100)}`, good: v > 1 }),
  noAutoBuy: () => ({ text: "No auto-buy", good: false }),
  pivot: () => ({ text: `A card swapped out /${PIVOT_SECONDS / 60} min`, good: false }),
};

/** A card's trade at a rank as lines for its face, gains first: each with whether it helps. */
export function cardLines(c: Card, rank: number): { text: string; good: boolean }[] {
  const e = c.ranks[Math.min(rank, 2) - 1];
  const lines = (Object.keys(e) as (keyof CardEffects)[]).map((k) => (LINES[k] as (v: unknown) => { text: string; good: boolean })(e[k]));
  // What working from home costs is not a number: who is home is on no
  // leader's team — till Remote Fridays' rule puts them on it. @see seat
  if (e.remote && !(rank >= 3 && c.rule.homeTeam)) lines.push({ text: "Home workers on no team", good: false });
  return [...lines.filter((l) => l.good), ...lines.filter((l) => !l.good)];
}

/** A card's effect line at a rank. */
export const says = (c: Card, rank: number): string => cardLines(c, rank).map((l) => l.text).join(" · ");

/** An offer waiting: the track that dealt it, its cards, how often it has been rerolled. */
export type Offer = { track: Track; cards: CardId[]; rerolls: number };

export type Deck = {
  /** Points spent, on slots and ranks: the rest of the tiers are there to spend. */
  spent: number;
  /** Slots owned, the first free. */
  slots: number;
  /** Each card owned, at its rank. */
  ranks: Partial<Record<CardId, number>>;
  /** The cards in the slots, in order. */
  slotted: CardId[];
  /** The card Pivot Weekly's rule has brought in, in a slot of its own. @see pivot */
  guest?: CardId | null;
  /** Offers each track has dealt. */
  dealt: Record<Track, number>;
  offers: Offer[];
};

export const emptyDeck = (): Deck => ({ spent: 0, slots: 1, ranks: {}, slotted: [], dealt: { agile: 0, corpo: 0, sales: 0 }, offers: [] });

/** Points to spend, from the tiers earned. */
export const pointsLeft = (d: Deck, tiers: number) => Math.max(0, tiers - d.spent);
/** A new slot's price: the second costs 2, the third 3. */
export const slotPrice = (d: Deck) => d.slots + 1;
/** WHAT A RANK COSTS, by the rank bought: the cards are strong, so the top is far. */
export const RANK_PRICE: Record<number, number> = { 2: 6, 3: 15 };
/** A card's next rank's price, or null at the top. */
export const rankPrice = (d: Deck, id: CardId): number | null => {
  const r = d.ranks[id] ?? 0;
  return r >= 1 && r < MAX_RANK ? RANK_PRICE[r + 1] : null;
};
/** A reroll's price, in seconds of innovation: a minute, doubling each time. */
export const rerollSeconds = (o: Offer) => 60 * 2 ** o.rerolls;

/**
 * THE TIERS A TRACK NEEDS for its `n`th card (from 0): 1, 4, 8, 13, 19… — the
 * wait a little longer each time. First guesses, tuned against the sims.
 */
export const cardAt = (n: number) => 1 + (n * (n + 1)) / 2 + 2 * n;

/** What slotted cards do together, their trades and rules. @see combine */
export type CultureEffects = Required<CardEffects> & Required<Rules>;
export const NO_EFFECTS: CultureEffects = {
  morale: 0, output: 1, innovation: 1, hireCost: 1, costCurve: 0, autoBuy: 0, noAutoBuy: false, slop: 1, tank: 1,
  desks: 1, deskless: 0, remote: 0, beds: 1, freeCommute: 0, houseMood: 0, hazards: 1, lunch: 0, attendance: 1,
  buildPrice: 1, buildSpeed: 1, leaderRank: 1, leadAll: false, leaderXp: 1, pivot: false,
  anyDesk: false, dayOutput: 1, noLeaderCap: false, vibePerIntern: 0, noMaterialWait: false, lunchAll: false,
  homeTeam: false, happyAttendance: 1, noMoveOut: false, allHome: false, nextDoor: false, autoBuyPer: 0,
  freezeFalls: false, noStranded: false, earnAsVibe: false, cleanInnovation: 1, messInnovation: 1, openSites: false,
  pivotIn: false, leadEvery: false,
};
/** How two cards' effects of a kind combine: added, multiplied, the larger, or either. */
const ADDED = new Set<keyof CultureEffects>(["morale", "costCurve", "autoBuy", "remote", "freeCommute", "houseMood", "vibePerIntern", "autoBuyPer"]);
const LARGER = new Set<keyof CultureEffects>(["deskless", "lunch"]);

/** Whether a card is slotted at its top rank: its rule in force. */
const ruled = (d: Deck, id: CardId) => d.slotted.includes(id) && (d.ranks[id] ?? 0) >= 3;

/** The cards in force: those slotted, and Pivot Weekly's guest while its rule holds. */
export const inForce = (d: Deck): CardId[] =>
  d.guest && ruled(d, "pivot") && !d.slotted.includes(d.guest) && d.ranks[d.guest] ? [...d.slotted, d.guest] : d.slotted;

/**
 * What the slotted cards do to a kind — or, with no kind, what they do to the
 * whole company: the cards for one kind left out.
 */
export function cultureEffects(d: Deck, kind?: GeneratorId): CultureEffects {
  const e: Record<string, number | boolean> = { ...NO_EFFECTS };
  const add = (r: CardEffects & Rules) => {
    for (const [k, v] of Object.entries(r) as [keyof CultureEffects, number | boolean][]) {
      if (typeof v === "boolean") e[k] = (e[k] as boolean) || v;
      else if (ADDED.has(k)) e[k] = (e[k] as number) + v;
      else if (LARGER.has(k)) e[k] = Math.max(e[k] as number, v);
      else e[k] = (e[k] as number) * v;
    }
  };
  for (const id of inForce(d)) {
    const c = card(id), rank = d.ranks[id] ?? 1;
    if (c.only && c.only !== kind) continue;
    // Rank 3 keeps rank 2's trade, and adds its rule.
    add({ ...c.ranks[Math.min(rank, 2) - 1], ...(rank >= 3 ? c.rule : {}) });
  }
  // The tags' sets, for every kind: a kind's own cards count to them too.
  const n = tagCounts(d);
  for (const tag of Object.keys(n) as Tag[]) for (const step of setSteps(tag, n[tag])) add(step.e);
  // Never all of a kind at home — but under Sabbaticals' rule.
  e.remote = e.allHome ? 1 : Math.min(0.9, e.remote as number);
  return e as CultureEffects;
}

/** WORK, in Morale: what the slotted cards do to each kind's. @see moralePartsNow */
export const workMorale = (d: Deck): Record<GeneratorId, number> => ({
  intern: cultureEffects(d, "intern").morale,
  vibe_coder: cultureEffects(d, "vibe_coder").morale,
  "10x_dev": cultureEffects(d, "10x_dev").morale,
});

/** The cards a track can deal now: its tags', not owned, not on an offer already, a kind's own only once it is employed. */
export function poolFor(d: Deck, track: Track, employs: ReadonlySet<GeneratorId>): CardId[] {
  const waiting = new Set(d.offers.flatMap((o) => o.cards));
  return CARDS.filter((c) => TRACK_TAGS[track].includes(c.tag) && !d.ranks[c.id] && !waiting.has(c.id) && (!c.only || employs.has(c.only))).map((c) => c.id);
}

/** Up to `n` of `from`, drawn without repeats. */
function draw(from: readonly CardId[], n: number, rng: () => number): CardId[] {
  const left = [...from], out: CardId[] = [];
  while (out.length < n && left.length) out.push(left.splice(Math.floor(rng() * left.length), 1)[0]);
  return out;
}

/** OFFERS DUE: each track whose tiers have reached its next card's deals one — while it has cards to deal. */
export function deal(d: Deck, tiers: Record<Track, number>, employs: ReadonlySet<GeneratorId>, rng: () => number = Math.random): Deck {
  let next = d;
  for (const track of Object.keys(TRACK_TAGS) as Track[]) {
    while (tiers[track] >= cardAt(next.dealt[track])) {
      const cards = draw(poolFor(next, track, employs), OFFER_SIZE, rng);
      if (!cards.length) break;
      next = { ...next, dealt: { ...next.dealt, [track]: next.dealt[track] + 1 }, offers: [...next.offers, { track, cards, rerolls: 0 }] };
    }
  }
  return next;
}

/** TAKE a card from an offer: owned at rank 1, in a slot if one is free; the offer gone. */
export function take(d: Deck, offer: number, id: CardId): Deck {
  const o = d.offers[offer];
  if (!o || !o.cards.includes(id)) return d;
  return {
    ...d,
    ranks: { ...d.ranks, [id]: 1 },
    slotted: d.slotted.length < d.slots ? [...d.slotted, id] : d.slotted,
    offers: d.offers.filter((_, k) => k !== offer),
  };
}

/** A REROLL: the offer's cards dealt again from its track — none of them again, while others are left. */
export function reroll(d: Deck, offer: number, employs: ReadonlySet<GeneratorId>, rng: () => number = Math.random): Deck {
  const o = d.offers[offer];
  if (!o) return d;
  const without = { ...d, offers: d.offers.filter((_, k) => k !== offer) };
  const pool = poolFor(without, o.track, employs);
  const fresh = pool.filter((id) => !o.cards.includes(id));
  const cards = draw(fresh.length >= OFFER_SIZE ? fresh : pool, OFFER_SIZE, rng);
  const offers = [...d.offers];
  offers[offer] = { ...o, cards, rerolls: o.rerolls + 1 };
  return { ...d, offers };
}

/** A NEW SLOT, if the points are there. */
export function buySlot(d: Deck, tiers: number): Deck {
  return pointsLeft(d, tiers) >= slotPrice(d) ? { ...d, spent: d.spent + slotPrice(d), slots: d.slots + 1 } : d;
}

/**
 * PIVOT WEEKLY'S SWAP: a slotted card other than it, at random, out — and an
 * owned card out of the slots, at random, in its place. Nothing to swap, nothing.
 * At rank 3, none out: an owned card out of the slots comes in as its GUEST,
 * in a slot of its own, until the next pivot brings another.
 */
export function pivot(d: Deck, rng: () => number = Math.random): Deck {
  if (ruled(d, "pivot")) {
    const bench = (Object.keys(d.ranks) as CardId[]).filter((id) => !d.slotted.includes(id) && id !== d.guest);
    return bench.length ? { ...d, guest: bench[Math.floor(rng() * bench.length)] } : d;
  }
  const outOf = d.slotted.filter((id) => !card(id).ranks[0].pivot);
  if (!outOf.length) return d;
  const out = outOf[Math.floor(rng() * outOf.length)];
  const bench = (Object.keys(d.ranks) as CardId[]).filter((id) => !d.slotted.includes(id));
  const into = bench.length ? bench[Math.floor(rng() * bench.length)] : null;
  return { ...d, slotted: d.slotted.flatMap((id) => (id !== out ? [id] : into ? [into] : [])) };
}

/** A CARD'S NEXT RANK, if it has one and the points are there. */
export function rankUp(d: Deck, id: CardId, tiers: number): Deck {
  const price = rankPrice(d, id);
  if (price === null || pointsLeft(d, tiers) < price) return d;
  return { ...d, spent: d.spent + price, ranks: { ...d.ranks, [id]: (d.ranks[id] ?? 1) + 1 } };
}

/** A card owned in or out of a slot: out always; in while one is free. */
export function toggleSlot(d: Deck, id: CardId): Deck {
  if (!d.ranks[id]) return d;
  if (d.slotted.includes(id)) return { ...d, slotted: d.slotted.filter((c) => c !== id) };
  return d.slotted.length < d.slots ? { ...d, slotted: [...d.slotted, id] } : d;
}

/** A card owned PUT IN SLOT `at`: moved there if it is in another, what was there taken out. */
export function place(d: Deck, id: CardId, at: number): Deck {
  if (!d.ranks[id] || at < 0 || at >= d.slots) return d;
  const slotted = d.slotted.filter((c) => c !== id);
  const k = Math.min(at, slotted.length);
  if (k < slotted.length) slotted[k] = id;
  else slotted.push(id);
  return { ...d, slotted };
}

/**
 * A SAVED DECK, trusted for nothing — or, from a save of the old work
 * policies, those policies as rank-1 cards, the first in the free slot. The
 * tiers that earned them are points now, unspent. @see plans/culture-deck.md §7
 */
export function readDeck(raw: unknown, oldPolicies?: Partial<Record<string, readonly unknown[]>>): Deck {
  const d = emptyDeck();
  const r = (raw && typeof raw === "object" ? raw : null) as Partial<Deck> | null;
  if (!r) {
    const had = [...new Set(Object.values(oldPolicies ?? {}).flatMap((l) => [...(l ?? [])]))].filter(isCard);
    for (const id of had) d.ranks[id] = 1;
    d.slotted = had.slice(0, d.slots);
    return d;
  }
  d.spent = Math.max(0, Math.floor(Number(r.spent) || 0));
  d.slots = Math.max(1, Math.floor(Number(r.slots) || 1));
  for (const [id, rank] of Object.entries(r.ranks ?? {})) if (isCard(id)) d.ranks[id] = Math.min(MAX_RANK, Math.max(1, Math.floor(Number(rank) || 1)));
  d.slotted = [...new Set(r.slotted ?? [])].filter((id) => isCard(id) && d.ranks[id]).slice(0, d.slots);
  d.guest = isCard(r.guest) && d.ranks[r.guest] ? r.guest : null;
  for (const t of Object.keys(d.dealt) as Track[]) d.dealt[t] = Math.max(0, Math.floor(Number(r.dealt?.[t]) || 0));
  d.offers = (r.offers ?? [])
    .filter((o): o is Offer => !!o && (o.track === "agile" || o.track === "corpo" || o.track === "sales"))
    .map((o) => ({ track: o.track, cards: (o.cards ?? []).filter((id) => isCard(id) && !d.ranks[id]), rerolls: Math.max(0, Math.floor(Number(o.rerolls) || 0)) }))
    .filter((o) => o.cards.length > 0);
  return d;
}
