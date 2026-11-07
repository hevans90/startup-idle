import { describe, expect, test } from "bun:test";

import type { GeneratorId } from "../state/generators.store";
import { useInnovationStore } from "../state/innovation.store";
import {
  CARDS, buySlot, cardLines, pivot, place, cardAt, cultureEffects, deal, emptyDeck, pointsLeft, rankPrice, rankUp, readDeck, reroll, take, toggleSlot,
  TRACK_PACE, hallucination, inForce, isAiTag, poolFor, rankNow, setSteps, tagCounts, workMorale, type CardId, type Deck,
  HACKATHON_TRACK, MAX_RANK, TRACK_TAGS, card, hackathonDeal,
} from "./culture";

const all = new Set<GeneratorId>(["intern", "vibe_coder", "10x_dev"]);
const interns = new Set<GeneratorId>(["intern"]);
const tiers = (agile = 0, corpo = 0, sales = 0) => ({ agile, corpo, sales });
/** Draws the first card each time. */
const first = () => 0;

describe("the culture deck", () => {
  test("every card a trade, at each rank: something gained, something given, on its face", () => {
    for (const c of CARDS) for (const rank of [1, 2]) {
      const lines = cardLines(c, rank);
      expect([c.id, rank, lines.some((l) => l.good) && lines.some((l) => !l.good)]).toEqual([c.id, rank, true]);
    }
  });

  test("a track's cards come minutes apart, however its tiers climb, from its own tags", () => {
    expect([0, 1, 2, 3].map((n) => cardAt("agile", n))).toEqual([8, 16, 22, 26]);
    expect([0, 1, 2, 3].map((n) => cardAt("corpo", n))).toEqual([4, 8, 10, 12]);
    expect([0, 1, 2, 3].map((n) => cardAt("sales", n))).toEqual([2, 3, 5, 6]);
    // One manager on a track: its first card past 3 minutes, its fourth past 40.
    for (const t of ["agile", "corpo", "sales"] as const) {
      const { scaling: s, growth: g } = TRACK_PACE[t];
      const at = (tiers: number) => (20 / g) * (s ** tiers - 1) / (s - 1);
      expect(at(cardAt(t, 0))).toBeGreaterThan(180);
      expect(at(cardAt(t, 3))).toBeGreaterThan(2400);
    }
    let d = deal(emptyDeck(), tiers(16), all, first);
    expect(d.offers.length).toBe(2);
    expect(d.dealt).toEqual({ agile: 2, corpo: 0, sales: 0 });
    for (const o of d.offers) for (const id of o.cards) expect(["hustle", "chaos"]).toContain(CARDS.find((c) => c.id === id)!.tag);
    // Never the same card on two offers.
    expect(new Set(d.offers.flatMap((o) => o.cards)).size).toBe(6);
    d = deal(d, tiers(21), all, first);
    expect(d.offers.length).toBe(2);
  });

  test("the pace is the managers' own", () => {
    const { managers } = useInnovationStore.getState();
    for (const t of ["agile", "corpo", "sales"] as const) {
      expect(managers[t].tierScalingExponent.toNumber()).toBe(TRACK_PACE[t].scaling);
      expect(managers[t].growthRate.toNumber()).toBe(TRACK_PACE[t].growth);
    }
  });

  test("a kind's own cards only once it is employed", () => {
    const d = deal(emptyDeck(), tiers(0, 0, 0), interns);
    expect(d.offers).toEqual([]);
    const many = deal(emptyDeck(), tiers(100, 100, 100), interns);
    const dealt = many.offers.flatMap((o) => o.cards).map((id) => CARDS.find((c) => c.id === id)!);
    expect(dealt.some((c) => c.only === "intern")).toBe(true);
    expect(dealt.some((c) => c.only && c.only !== "intern")).toBe(false);
  });

  test("taking a card: owned at rank 1, in the free slot, the offer gone; a second waits unslotted", () => {
    let d = deal(emptyDeck(), tiers(16), all, first);
    const [a, b] = [d.offers[0].cards[0], d.offers[1].cards[0]];
    d = take(d, 0, a);
    expect(d.ranks[a]).toBe(1);
    expect(d.slotted).toEqual([a]);
    d = take(d, 0, b);
    expect(d.offers).toEqual([]);
    expect(d.slotted).toEqual([a]);
    expect(toggleSlot(d, b).slotted).toEqual([a]);
    expect(toggleSlot(toggleSlot(d, a), b).slotted).toEqual([b]);
  });

  test("points: a slot for 2, then 3; rank 2 for 6, rank 3 for 15; none spent past the tiers", () => {
    let d: Deck = { ...emptyDeck(), ranks: { crunch: 1 }, slotted: ["crunch"] };
    expect(pointsLeft(d, 5)).toBe(5);
    d = buySlot(d, 5);
    expect([d.slots, d.spent]).toEqual([2, 2]);
    // The third, 3: not with 2 of 4 left.
    expect(buySlot(d, 4)).toBe(d);
    expect(rankPrice(d, "crunch")).toBe(6);
    expect(rankUp(d, "crunch", 7)).toBe(d);
    d = rankUp(d, "crunch", 8);
    expect([d.ranks.crunch, d.spent]).toEqual([2, 8]);
    expect(rankPrice(d, "crunch")).toBe(15);
    d = rankUp(d, "crunch", 23);
    expect([d.ranks.crunch, d.spent]).toEqual([3, 23]);
    expect(rankPrice(d, "crunch")).toBeNull();
    expect(rankUp(d, "lunch", 99)).toBe(d);
  });

  test("effects: the slotted cards at their ranks, a kind's own only to it", () => {
    const d: Deck = { ...emptyDeck(), slots: 4, ranks: { crunch: 2, hotdesk: 1, housing: 1, hackathon: 1, stack: 1 }, slotted: ["crunch", "hotdesk", "housing", "hackathon"] };
    const i = cultureEffects(d, "intern"), v = cultureEffects(d, "vibe_coder");
    expect(i.deskless).toBe(1);
    // Hot Desking's, and two Hustle's set.
    expect(i.desks).toBe(2 * 1.5);
    expect(i.beds).toBe(2);
    expect(i.houseMood).toBe(-10);
    expect(i.morale).toBe(-10);
    expect(i.innovation).toBe(1);
    expect(v.innovation).toBe(3);
    expect(v.slop).toBe(2);
    // The company's: the vibe coders' own card left out.
    expect(cultureEffects(d).slop).toBe(1);
    expect(workMorale(d)).toEqual({ intern: -10, vibe_coder: -10, "10x_dev": -10 });
  });

  test("a reroll deals other cards of the track, and counts", () => {
    const d = deal(emptyDeck(), tiers(8), all, first);
    const r = reroll(d, 0, all, first);
    expect(r.offers[0].rerolls).toBe(1);
    expect(r.offers[0].cards.some((id) => d.offers[0].cards.includes(id))).toBe(false);
  });

  test("an old save: its policies, every kind's, rank-1 cards, the first slotted, nothing spent", () => {
    const d = readDeck(undefined, { intern: ["crunch", "mentorship"], vibe_coder: ["crunch", "hackathon"], "10x_dev": ["bogus"] });
    expect(d.ranks).toEqual({ crunch: 1, mentorship: 1, hackathon: 1 });
    expect(d.slotted).toEqual(["crunch"]);
    expect(d.spent).toBe(0);
  });

  test("a saved deck is checked: unknown cards and ranks past the top go", () => {
    const d = readDeck({ spent: 3, slots: 2, ranks: { crunch: 9, nope: 1 }, slotted: ["crunch", "nope", "lunch"], dealt: { agile: 1 }, offers: [{ track: "x", cards: [] }, { track: "corpo", cards: ["lunch", "crunch"], rerolls: 2 }] });
    expect(d.ranks).toEqual({ crunch: 3 });
    expect(d.slotted).toEqual(["crunch"]);
    expect(d.dealt).toEqual({ agile: 1, corpo: 0, sales: 0 });
    expect(d.offers).toEqual([{ track: "corpo", cards: ["lunch"], rerolls: 2 }]);
  });

  test("placing: into an empty slot, over a card (it goes out), or moved from another", () => {
    const d: Deck = { ...emptyDeck(), slots: 2, ranks: { crunch: 1, lunch: 1, stack: 1 }, slotted: ["crunch"] };
    expect(place(d, "lunch", 1).slotted).toEqual(["crunch", "lunch"]);
    expect(place(d, "lunch", 0).slotted).toEqual(["lunch"]);
    expect(place(place(d, "lunch", 1), "lunch", 0).slotted).toEqual(["lunch"]);
    expect(place(d, "freeze", 1)).toBe(d);
    expect(place(d, "lunch", 2)).toBe(d);
  });

  test("a card's face: gains first, each line marked", () => {
    expect(cardLines(CARDS.find((c) => c.id === "hotdesk")!, 1)).toEqual([{ text: "Desks ×2", good: true }, { text: "House mood −5", good: false }]);
    expect(cardLines(CARDS.find((c) => c.id === "housing")!, 2)[0]).toEqual({ text: "Beds per house ×3", good: true });
  });

  test("Pivot Weekly swaps another slotted card for one out of the slots; alone, nothing", () => {
    const d: Deck = { ...emptyDeck(), slots: 2, ranks: { pivot: 1, crunch: 1, lunch: 1 }, slotted: ["pivot", "crunch"] };
    expect(pivot(d, () => 0).slotted).toEqual(["pivot", "lunch"]);
    const alone: Deck = { ...d, slotted: ["pivot"] };
    expect(pivot(alone)).toBe(alone);
  });

  test("rank 3: rank 2's trade and its rule, only while slotted at the top", () => {
    const d: Deck = { ...emptyDeck(), slots: 2, ranks: { hotdesk: 3, crunch: 2 }, slotted: ["hotdesk", "crunch"] };
    const e = cultureEffects(d, "intern");
    expect(e.desks).toBe(3 * 1.5);
    expect(e.anyDesk).toBe(true);
    expect(e.dayOutput).toBe(1);
    expect(cultureEffects({ ...d, ranks: { hotdesk: 2, crunch: 2 } }).anyDesk).toBe(false);
    // Every card has a rule, and says it.
    for (const c of CARDS) {
      expect(Object.keys(c.rule).length).toBe(1);
      expect(c.keystone.length).toBeGreaterThan(0);
    }
  });

  test("Sabbaticals' rule: every 10x dev at home, past the cap the others keep", () => {
    const d: Deck = { ...emptyDeck(), slots: 2, ranks: { sabbatical: 3, remote: 2 }, slotted: ["sabbatical", "remote"] };
    expect(cultureEffects(d, "10x_dev").remote).toBe(1);
    expect(cultureEffects(d, "intern").remote).toBe(0.7);
  });

  test("Pivot Weekly's rule: a guest brought in, none taken out, in force while it holds", () => {
    const d: Deck = { ...emptyDeck(), slots: 2, ranks: { pivot: 3, crunch: 1, lunch: 2, stack: 1 }, slotted: ["pivot", "crunch"] };
    const p = pivot(d, () => 0);
    expect(p.slotted).toEqual(["pivot", "crunch"]);
    expect(p.guest).toBe("lunch");
    expect(inForce(p)).toEqual(["pivot", "crunch", "lunch"]);
    expect(cultureEffects(p).lunch).toBe(20);
    // The next pivot, another.
    expect(pivot(p, () => 0).guest).toBe("stack");
    // Pivot out of its slot: the guest goes with it.
    expect(inForce({ ...p, slotted: ["crunch"] })).toEqual(["crunch"]);
    expect(readDeck(p).guest).toBe("lunch");
  });
});

describe("tag sets", () => {
  const slotted = (ids: CardId[], rank = 1): Deck => ({ ...emptyDeck(), slots: 9, ranks: Object.fromEntries(ids.map((id) => [id, rank])), slotted: ids });

  test("two, three and four of a tag in force bring its steps, each on the last", () => {
    expect(tagCounts(slotted(["hotdesk", "crunch", "lunch"]))).toMatchObject({ hustle: 2, wellness: 1, growth: 0, chaos: 0, agentic: 0 });
    expect(setSteps("hustle", 1)).toHaveLength(0);
    expect(setSteps("hustle", 3)).toHaveLength(2);
    expect(setSteps("hustle", 5)).toHaveLength(3);
  });

  test("a set's step is in the effects, for every kind", () => {
    // Two Wellness: +10 morale on top of the cards'.
    const one = cultureEffects(slotted(["lunch"]), "intern").morale;
    expect(cultureEffects(slotted(["lunch", "remote"]), "intern").morale).toBe(one + 10);
    // Four Hustle: money ×3, though Hire to Fire is the interns' alone.
    const four = slotted(["hotdesk", "crunch", "stack", "hiretofire"]);
    expect(cultureEffects(four, "10x_dev").output).toBe(3);
    expect(cultureEffects(four, "10x_dev").desks).toBeCloseTo(2 * 1.5, 9);
  });

  test("Pivot Weekly's guest counts toward its tag", () => {
    const d = { ...slotted(["pivot", "hackathon"]), ranks: { pivot: 3, hackathon: 1, movefast: 1 }, guest: "movefast" as CardId };
    expect(tagCounts(d).chaos).toBe(3);
  });
});

describe("the AI families", () => {
  const slotted = (ranks: Partial<Record<CardId, number>>): Deck => ({ ...emptyDeck(), slots: 9, ranks, slotted: Object.keys(ranks) as CardId[] });
  const MIN = 60_000;

  test("dealt only after a first Ascension, a family a track", () => {
    const tags = (ascended: boolean) => new Set(poolFor(emptyDeck(), "agile", all, ascended).map((id) => CARDS.find((c) => c.id === id)!.tag));
    expect([...tags(false)].some(isAiTag)).toBe(false);
    expect(tags(true).has("agentic")).toBe(true);
    expect(tags(true).has("safety")).toBe(false);
  });

  test("a die rolls between its least and most, the same all minute, another the next", () => {
    const d = slotted({ guess: 1 });
    const seen = Array.from({ length: 200 }, (_, m) => hallucination(d, m * MIN).money);
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(0.5);
    expect(Math.max(...seen)).toBeLessThanOrEqual(3);
    expect(new Set(seen.map((v) => v.toFixed(3))).size).toBeGreaterThan(150);
    expect(hallucination(d, 5 * MIN + 59_000).money).toBe(hallucination(d, 5 * MIN).money);
    // Confident Guess's rule: fewer rolls under ×1.
    const low = (r: number) => Array.from({ length: 400 }, (_, m) => hallucination(slotted({ guess: r }), m * MIN).money).filter((v) => v < 1).length;
    expect(low(3)).toBeLessThan(low(2) / 2);
  });

  test("Phantom Revenue: a minute in four, the money gone — and innovation for it at rank 3", () => {
    const minutes = Array.from({ length: 400 }, (_, m) => hallucination(slotted({ phantom: 3 }), m * MIN));
    const gone = minutes.filter((h) => h.vanished);
    expect(gone.length / minutes.length).toBeGreaterThan(0.18);
    expect(gone.length / minutes.length).toBeLessThan(0.32);
    expect(gone.every((h) => h.money === 0 && h.innovation === 5)).toBe(true);
  });

  test("Self-Improving's surge: every card a rank up, its rule with it, while it lasts", () => {
    const d = slotted({ hotdesk: 2, crunch: 3 });
    expect(rankNow(d, "hotdesk")).toBe(2);
    expect(cultureEffects(d).anyDesk).toBe(false);
    const up = { ...d, surgeUntil: 1 };
    expect([rankNow(up, "hotdesk"), rankNow(up, "crunch")]).toEqual([3, 3]);
    expect(cultureEffects(up).anyDesk).toBe(true);
  });

  test("their sets, at two and three of their three cards", () => {
    expect(cultureEffects(slotted({ autonomous: 1, swarm: 1 })).rackAgents).toBe(3 + 2);
    expect(cultureEffects(slotted({ autonomous: 1, swarm: 1, selfimprove: 1 })).agentCost).toBe(0.5);
    expect(cultureEffects(slotted({ redteam: 1, constitution: 1, killswitch: 1 })).weights).toBeCloseTo(2 * 2, 9);
    // Best of two: the same minutes, never the lower for it.
    const one = slotted({ guess: 1, phantom: 1 }), all3 = slotted({ guess: 1, phantom: 1, benchmark: 1 });
    expect(cultureEffects(all3).bestOfTwo).toBe(true);
    const lows = (d: Deck) => Array.from({ length: 300 }, (_, m) => hallucination({ ...d, slotted: ["guess"] }, m * MIN, cultureEffects(d)).money).filter((v) => v < 1).length;
    expect(lows(all3)).toBeLessThan(lows(one));
  });
});


describe("a hackathon's ideas", () => {
  const employs = new Set<GeneratorId>(["intern", "vibe_coder", "10x_dev"]);
  test("are an offer of hustle and chaos cards, outside the track's pace", () => {
    const { deck, gain } = hackathonDeal(emptyDeck(), employs, () => 0.3);
    expect(gain).toEqual({ kind: "offer" });
    expect(deck.offers).toHaveLength(1);
    expect(deck.offers[0].track).toBe(HACKATHON_TRACK);
    expect(deck.offers[0].cards.every((id) => TRACK_TAGS[HACKATHON_TRACK].includes(card(id).tag))).toBe(true);
    expect(deck.dealt).toEqual(emptyDeck().dealt);
  });

  test("with none left to deal, are a free rank on a slotted card of those tags, and nothing past the top", () => {
    const tags = TRACK_TAGS[HACKATHON_TRACK];
    const all = CARDS.filter((c) => tags.includes(c.tag) && !isAiTag(c.tag)).map((c) => c.id);
    const owned = { ...emptyDeck(), ranks: Object.fromEntries(all.map((id) => [id, 1])), slotted: [all[0]] };
    const { deck, gain } = hackathonDeal(owned, employs);
    expect(gain).toEqual({ kind: "rank", card: all[0] });
    expect(deck.ranks[all[0]]).toBe(2);
    expect(deck.spent).toBe(0);
    const top = { ...owned, ranks: { ...owned.ranks, [all[0]]: MAX_RANK } };
    expect(hackathonDeal(top, employs).gain).toBeNull();
  });
});
