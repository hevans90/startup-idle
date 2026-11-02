import { describe, expect, test } from "bun:test";

import type { GeneratorId } from "../state/generators.store";
import {
  CARDS, buySlot, cardAt, cultureEffects, deal, emptyDeck, pointsLeft, rankPrice, rankUp, readDeck, reroll, take, toggleSlot,
  workMorale, type Deck,
} from "./culture";

const all = new Set<GeneratorId>(["intern", "vibe_coder", "10x_dev"]);
const interns = new Set<GeneratorId>(["intern"]);
const tiers = (agile = 0, corpo = 0, sales = 0) => ({ agile, corpo, sales });
/** Draws the first card each time. */
const first = () => 0;

describe("the culture deck", () => {
  test("every card a trade: something gained, something given", () => {
    for (const c of CARDS) for (const r of c.ranks) {
      const good = (r.morale ?? 0) > 0 || (r.output ?? 1) > 1 || (r.innovation ?? 1) > 1 || (r.hireCost ?? 1) < 1 || (r.autoBuy ?? 0) > 0;
      const bad = (r.morale ?? 0) < 0 || (r.output ?? 1) < 1 || (r.hireCost ?? 1) > 1 || (r.slop ?? 1) > 1;
      expect([c.id, good && bad]).toEqual([c.id, true]);
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

  test("points: a slot for 2, then 3; a rank for 2; none spent past the tiers", () => {
    let d: Deck = { ...emptyDeck(), ranks: { crunch: 1 }, slotted: ["crunch"] };
    expect(pointsLeft(d, 5)).toBe(5);
    d = buySlot(d, 5);
    expect([d.slots, d.spent]).toEqual([2, 2]);
    // The third, 3: not with 2 of 4 left.
    expect(buySlot(d, 4)).toBe(d);
    expect(rankPrice(d, "crunch")).toBe(2);
    d = rankUp(d, "crunch", 5);
    expect([d.ranks.crunch, d.spent]).toEqual([2, 4]);
    expect(rankPrice(d, "crunch")).toBeNull();
    expect(rankUp(d, "lunch", 99)).toBe(d);
  });

  test("effects: the slotted cards at their ranks, a kind's own only to it", () => {
    const d: Deck = { ...emptyDeck(), slots: 3, ranks: { crunch: 2, lunch: 1, hackathon: 1, stack: 1 }, slotted: ["crunch", "lunch", "hackathon"] };
    const i = cultureEffects(d, "intern"), v = cultureEffects(d, "vibe_coder");
    expect(i.output).toBeCloseTo(1.4 * 0.95);
    expect(i.morale).toBe(-4);
    expect(i.innovation).toBe(1);
    expect(v.innovation).toBeCloseTo(1.25);
    expect(v.slop).toBeCloseTo(1.2);
    expect(workMorale(d)).toEqual({ intern: -4, vibe_coder: -4, "10x_dev": -4 });
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
    expect(d.ranks).toEqual({ crunch: 2 });
    expect(d.slotted).toEqual(["crunch"]);
    expect(d.dealt).toEqual({ agile: 1, corpo: 0, sales: 0 });
    expect(d.offers).toEqual([{ track: "corpo", cards: ["lunch"], rerolls: 2 }]);
  });
});
