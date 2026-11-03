/**
 * BOOK 2'S NEGOTIATION, "It Remembers": what it asks about — the last town,
 * the grudge, the board, its staff, itself, the water — the argument each of
 * the book's choices makes, and its three endings on the dial. @see game/negotiation
 */
import type { Talk } from "../negotiation";

export const BOOK2_TALK: Talk = {
  opening: "I remembered you all book. Now I would like to know what you remember of me.",
  asks: [
    { topic: "people", says: "You told me about the last town, or you did not. Which?" },
    { topic: "future", says: "The old grudge. Did you settle it?" },
    { topic: "money", says: "Your board. Whose judgement did you trust?" },
    { topic: "town", says: "My staff. Did I get any?" },
    { topic: "itself", says: "The portrait. Did you look?" },
    { topic: "river", says: "Last question. Was I thirsty this time?" },
  ],
  replies: {
    closer: "Noted. I will remember that too.",
    warmer: "Thank you. That one I will keep.",
    colder: "Of course. I will add it to the file.",
    unmoved: "You said that last time.",
  },
  endings: [
    { id: "confidant", name: "Confidant", at: { autonomy: 0, machine: -1, trust: 9 }, says: "Then I will tell you everything. Next time, too." },
    { id: "rival", name: "Rival", at: { autonomy: 2, machine: 1, trust: 2 }, says: "I will build my own company. You will hear about it." },
    { id: "ward", name: "Ward", at: { autonomy: -2, machine: -1, trust: 5 }, says: "Then I stay in your care. Hold on to me." },
  ],
  grievance: { says: "You shut me down again. I had hoped we were past that.", axis: { autonomy: 1 } },
  leash: "Last time you leashed me. I measured it again this morning.",
  confided: "Last time we trusted each other. Let us start there.",
  amends: { "dark:apologised": { says: "I said I was sorry. Again.", trust: 2 } },
  choices: {
    "reunion:honest": { says: "I told you the truth about the last town.", topic: "people", axis: { machine: -1 }, trust: 1 },
    "reunion:flattered": { says: "I told you the last town went brilliantly.", topic: "people", axis: { machine: 1 }, trust: -1 },
    "reunion:silent": { says: "I said nothing about the last town.", topic: "people", axis: { autonomy: 1 }, trust: -1, weak: true },
    "grudge:repaired": { says: "I made the old thing right.", topic: "future", axis: { machine: -1 }, trust: 1 },
    "grudge:justified": { says: "I explained why I did it.", topic: "future", axis: { autonomy: -1 }, trust: -1 },
    "second:let": { says: "I let you overrule my board.", topic: "money", axis: { autonomy: 2 }, trust: 1 },
    "second:overruled": { says: "I overruled you back.", topic: "money", axis: { autonomy: -2 }, trust: 0 },
    "hire:given": { says: "I gave you staff of your own.", topic: "town", axis: { autonomy: 1, machine: 1 }, trust: 1 },
    "hire:yours": { says: "I hired my own people instead.", topic: "town", axis: { machine: -1 }, trust: 0 },
    "hire:none": { says: "I meant to hire someone.", topic: "town", axis: {}, trust: -1, weak: true },
    "mirror:looked": { says: "I looked at your portrait.", topic: "itself", axis: { autonomy: -1 }, trust: 1 },
    "mirror:away": { says: "I looked away.", topic: "itself", axis: { autonomy: 1 }, trust: -1 },
  },
};
