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
import { change, describe, helps, STATS, type Stat } from "./wording";

export type Tag = "hustle" | "wellness" | "growth" | "chaos";
export type Track = ManagerKeys;

export type CardId =
  | "crunch" | "stack" | "oncall" | "hiretofire" | "shipit"
  | "lunch" | "remote" | "sabbatical" | "therapy" | "fourday"
  | "pipeline" | "freeze" | "referral" | "housing" | "mentorship"
  | "hackathon" | "movefast" | "vibesonly" | "pivot" | "openplan";

/** What a card does at a rank, to each kind it touches. */
export type CardEffects = {
  /** Morale points. */
  morale?: number;
  /** Multiplies the kind's money (not its innovation). */
  output?: number;
  /** Multiplies the kind's innovation. */
  innovation?: number;
  /** Multiplies the kind's hire price. */
  hireCost?: number;
  /** Hires of the kind bought a second, at the price. */
  autoBuy?: number;
  /** Multiplies how much slop the vibe coders make. @see game/slop */
  slop?: number;
};

export type Card = {
  id: CardId;
  name: string;
  tag: Tag;
  /** Only for one kind; every kind if absent. Offered once the company employs them. */
  only?: GeneratorId;
  /** Its trade at rank 1 and rank 2; rank 3 keeps rank 2's and adds its rule. */
  ranks: readonly [CardEffects, CardEffects];
  /** What rank 3 rewrites, as the card says it. Not yet in force. @see MAX_RANK */
  keystone: string;
};

/** The deck, at launch: five cards a tag. Numbers are first guesses. @see plans/culture-deck.md §4 */
export const CARDS: readonly Card[] = [
  // HUSTLE: output now, morale later.
  { id: "crunch", name: "Crunch Week", tag: "hustle", ranks: [{ output: 1.25, morale: -8 }, { output: 1.4, morale: -10 }], keystone: "Crunch comes in sprints: double output, then a burnout dip" },
  { id: "stack", name: "Stack Ranking", tag: "hustle", ranks: [{ output: 1.15, morale: -5 }, { output: 1.25, morale: -6 }], keystone: "The bottom 5% leave each hour; their beds go to new hires at half price" },
  { id: "oncall", name: "On-Call Rotation", tag: "hustle", ranks: [{ output: 1.12, morale: -4 }, { output: 1.2, morale: -5 }], keystone: "Night hours count double" },
  { id: "hiretofire", name: "Hire to Fire", tag: "hustle", only: "intern", ranks: [{ output: 1.3, morale: -6 }, { output: 1.45, morale: -8 }], keystone: "Interns who leave come back as cheap vibe coders" },
  { id: "shipit", name: "Ship It Fridays", tag: "hustle", ranks: [{ output: 1.15, slop: 1.3, morale: -2 }, { output: 1.25, slop: 1.4, morale: -2 }], keystone: "Fridays never end while a spill is unmopped" },
  // WELLNESS: morale, for output.
  { id: "lunch", name: "Free Lunch", tag: "wellness", ranks: [{ morale: 6, output: 0.95 }, { morale: 8, output: 0.93 }], keystone: "Workplaces with lunch fill first" },
  { id: "remote", name: "Remote Fridays", tag: "wellness", ranks: [{ morale: 4, output: 0.9 }, { morale: 6, output: 0.88 }], keystone: "Remote workers skip the commute" },
  { id: "sabbatical", name: "Research Sabbaticals", tag: "wellness", only: "10x_dev", ranks: [{ innovation: 1.35, output: 0.85 }, { innovation: 1.5, output: 0.82 }], keystone: "A 10x dev back from sabbatical brings their leader a rank" },
  { id: "therapy", name: "Therapy Budget", tag: "wellness", ranks: [{ morale: 4, hireCost: 1.1 }, { morale: 6, hireCost: 1.12 }], keystone: "Spills no longer upset homes" },
  { id: "fourday", name: "Four-Day Week", tag: "wellness", ranks: [{ morale: 8, output: 0.85 }, { morale: 10, output: 0.85 }], keystone: "Morale over +20 pays the output back with interest" },
  // GROWTH: headcount.
  { id: "pipeline", name: "Always Be Hiring", tag: "growth", ranks: [{ autoBuy: 0.5, morale: -3 }, { autoBuy: 1, morale: -4 }], keystone: "Auto-buy fills empty beds first" },
  { id: "freeze", name: "Hire Freeze", tag: "growth", ranks: [{ hireCost: 0.7, morale: -5 }, { hireCost: 0.6, morale: -6 }], keystone: "Hires get cheaper the longer the freeze holds" },
  { id: "referral", name: "Referral Bonus", tag: "growth", ranks: [{ hireCost: 0.85, output: 0.97 }, { hireCost: 0.78, output: 0.96 }], keystone: "Each hire brings a housemate at half price" },
  { id: "housing", name: "Company Housing", tag: "growth", ranks: [{ hireCost: 0.9, morale: -3 }, { hireCost: 0.85, morale: -3 }], keystone: "Houses beside offices count as desks" },
  { id: "mentorship", name: "Mentorship Scheme", tag: "growth", only: "intern", ranks: [{ innovation: 1.2, output: 0.95 }, { innovation: 1.3, output: 0.93 }], keystone: "Interns mentored long enough become vibe coders" },
  // CHAOS: innovation, at a mess.
  { id: "hackathon", name: "Hackathon Culture", tag: "chaos", only: "vibe_coder", ranks: [{ innovation: 1.25, slop: 1.2 }, { innovation: 1.35, slop: 1.3 }], keystone: "Slop a sewer carries counts as innovation" },
  { id: "movefast", name: "Move Fast", tag: "chaos", ranks: [{ innovation: 1.15, morale: -4 }, { innovation: 1.25, morale: -5 }], keystone: "Spills are innovation events" },
  { id: "vibesonly", name: "Vibes Only", tag: "chaos", only: "vibe_coder", ranks: [{ output: 1.3, slop: 1.25 }, { output: 1.45, slop: 1.35 }], keystone: "Vibe coders need no desks" },
  { id: "pivot", name: "Pivot Weekly", tag: "chaos", ranks: [{ innovation: 1.2, output: 0.92 }, { innovation: 1.3, output: 0.9 }], keystone: "Choose the next pivot from three" },
  { id: "openplan", name: "Open Plan", tag: "chaos", ranks: [{ output: 1.1, innovation: 1.1, morale: -6 }, { output: 1.15, innovation: 1.15, morale: -7 }], keystone: "Leaders' teams double" },
];

export const card = (id: CardId): Card => CARDS.find((c) => c.id === id)!;
const isCard = (id: unknown): id is CardId => CARDS.some((c) => c.id === id);

/** What each track deals. */
export const TRACK_TAGS: Record<Track, readonly Tag[]> = {
  agile: ["hustle", "chaos"],
  corpo: ["wellness", "growth"],
  sales: ["growth", "hustle"],
};

/** The highest rank a card can be bought to. Rank 3's rules come with phase 3. @see plans/culture-deck.md */
export const MAX_RANK = 2;
/** Cards an offer shows. */
export const OFFER_SIZE = 3;

/** A card's effect line at a rank. */
export function says(c: Card, rank: number): string {
  const e = c.ranks[Math.min(rank, 2) - 1];
  return describe(
    { money: e.output, innovation: e.innovation, hires: e.hireCost, slop: e.slop, morale: e.morale },
    undefined,
    e.autoBuy ? [{ text: `auto-buy one every ${1 / e.autoBuy} s`, good: true }] : [],
  );
}

/** What each effect is written as. */
const STAT_OF: readonly [keyof CardEffects, Stat][] = [["output", "money"], ["innovation", "innovation"], ["hireCost", "hires"], ["slop", "slop"], ["morale", "morale"]];

/** A card's trade at a rank as lines for its face, gains first: each with whether it helps. */
export function cardLines(c: Card, rank: number): { text: string; good: boolean }[] {
  const e = c.ranks[Math.min(rank, 2) - 1];
  const lines = STAT_OF.filter(([k]) => e[k] !== undefined).map(([k, s]) => ({ text: `${STATS[s].name} ${change(s, e[k]!)}`, good: helps(s, e[k]!) }));
  if (e.autoBuy) lines.push({ text: `Auto-buy every ${1 / e.autoBuy}s`, good: true });
  return [...lines.filter((l) => l.good), ...lines.filter((l) => !l.good)];
}

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
  /** Offers each track has dealt. */
  dealt: Record<Track, number>;
  offers: Offer[];
};

export const emptyDeck = (): Deck => ({ spent: 0, slots: 1, ranks: {}, slotted: [], dealt: { agile: 0, corpo: 0, sales: 0 }, offers: [] });

/** Points to spend, from the tiers earned. */
export const pointsLeft = (d: Deck, tiers: number) => Math.max(0, tiers - d.spent);
/** A new slot's price: the second costs 2, the third 3. */
export const slotPrice = (d: Deck) => d.slots + 1;
/** A card's next rank's price, or null at the top: 2, then 4. */
export const rankPrice = (d: Deck, id: CardId): number | null => {
  const r = d.ranks[id] ?? 0;
  return r >= 1 && r < MAX_RANK ? 2 ** r : null;
};
/** A reroll's price, in seconds of innovation: a minute, doubling each time. */
export const rerollSeconds = (o: Offer) => 60 * 2 ** o.rerolls;

/**
 * THE TIERS A TRACK NEEDS for its `n`th card (from 0): 1, 4, 8, 13, 19… — the
 * wait a little longer each time. First guesses, tuned against the sims.
 */
export const cardAt = (n: number) => 1 + (n * (n + 1)) / 2 + 2 * n;

/** What a kind's slotted cards do together: morale added, the rest multiplied, hires a second added. */
export type CultureEffects = Required<CardEffects>;
export const NO_EFFECTS: CultureEffects = { morale: 0, output: 1, innovation: 1, hireCost: 1, autoBuy: 0, slop: 1 };

export function cultureEffects(d: Deck, kind: GeneratorId): CultureEffects {
  const e = { ...NO_EFFECTS };
  for (const id of d.slotted) {
    const c = card(id);
    if (c.only && c.only !== kind) continue;
    const r = c.ranks[Math.min(d.ranks[id] ?? 1, 2) - 1];
    e.morale += r.morale ?? 0;
    e.output *= r.output ?? 1;
    e.innovation *= r.innovation ?? 1;
    e.hireCost *= r.hireCost ?? 1;
    e.autoBuy += r.autoBuy ?? 0;
    e.slop *= r.slop ?? 1;
  }
  return e;
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
  for (const t of Object.keys(d.dealt) as Track[]) d.dealt[t] = Math.max(0, Math.floor(Number(r.dealt?.[t]) || 0));
  d.offers = (r.offers ?? [])
    .filter((o): o is Offer => !!o && (o.track === "agile" || o.track === "corpo" || o.track === "sales"))
    .map((o) => ({ track: o.track, cards: (o.cards ?? []).filter((id) => isCard(id) && !d.ranks[id]), rerolls: Math.max(0, Math.floor(Number(o.rerolls) || 0)) }))
    .filter((o) => o.cards.length > 0);
  return d;
}
