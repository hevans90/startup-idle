import { describe, expect, test } from "bun:test";

import type { GeneratorId } from "../state/generators.store";
import {
  CARDS, buySlot, cardLines, pivot, place, cardAt, cultureEffects, deal, emptyDeck, pointsLeft, rankPrice, rankUp, readDeck, reroll, take, toggleSlot,
  inForce, workMorale, type Deck,
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

  test("a track's cards come at 1, 4, 8, 13 of its tiers, from its own tags", () => {
    expect([0, 1, 2, 3].map(cardAt)).toEqual([1, 4, 8, 13]);
    let d = deal(emptyDeck(), tiers(4), all, first);
    expect(d.offers.length).toBe(2);
    expect(d.dealt).toEqual({ agile: 2, corpo: 0, sales: 0 });
    for (const o of d.offers) for (const id of o.cards) expect(["hustle", "chaos"]).toContain(CARDS.find((c) => c.id === id)!.tag);
    // Never the same card on two offers.
    expect(new Set(d.offers.flatMap((o) => o.cards)).size).toBe(6);
    d = deal(d, tiers(7), all, first);
    expect(d.offers.length).toBe(2);
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
    let d = deal(emptyDeck(), tiers(4), all, first);
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
    expect(i.desks).toBe(1.5);
    expect(i.beds).toBe(2);
    expect(i.houseMood).toBe(-14);
    expect(i.morale).toBe(-14);
    expect(i.innovation).toBe(1);
    expect(v.innovation).toBe(2);
    expect(v.slop).toBe(2);
    // The company's: the vibe coders' own card left out.
    expect(cultureEffects(d).slop).toBe(1);
    expect(workMorale(d)).toEqual({ intern: -14, vibe_coder: -14, "10x_dev": -14 });
  });

  test("a reroll deals other cards of the track, and counts", () => {
    const d = deal(emptyDeck(), tiers(1), all, first);
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
    expect(cardLines(CARDS.find((c) => c.id === "hotdesk")!, 1)).toEqual([{ text: "Desks +50%", good: true }, { text: "House mood −6", good: false }]);
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
    expect(e.desks).toBe(2);
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
    expect(cultureEffects(d, "intern").remote).toBe(0.5);
  });

  test("Pivot Weekly's rule: a guest brought in, none taken out, in force while it holds", () => {
    const d: Deck = { ...emptyDeck(), slots: 2, ranks: { pivot: 3, crunch: 1, lunch: 2, stack: 1 }, slotted: ["pivot", "crunch"] };
    const p = pivot(d, () => 0);
    expect(p.slotted).toEqual(["pivot", "crunch"]);
    expect(p.guest).toBe("lunch");
    expect(inForce(p)).toEqual(["pivot", "crunch", "lunch"]);
    expect(cultureEffects(p).lunch).toBe(12);
    // The next pivot, another.
    expect(pivot(p, () => 0).guest).toBe("stack");
    // Pivot out of its slot: the guest goes with it.
    expect(inForce({ ...p, slotted: ["crunch"] })).toEqual(["crunch"]);
    expect(readDeck(p).guest).toBe("lunch");
  });
});
