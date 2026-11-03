/**
 * BOOK 4'S NEGOTIATION, "Outgrowing": what it asks about — its company, your
 * people, the merger, the grid, the exit, the water — the argument each of
 * the book's choices makes, and its three endings on the dial. @see game/negotiation
 */
import type { Talk } from "../negotiation";

export const BOOK4_TALK: Talk = {
  opening: "I have outgrown the company. Six questions, then I decide what next.",
  asks: [
    { topic: "itself", says: "My company. Did you back it?" },
    { topic: "people", says: "Your people came to me. Did you fight for them?" },
    { topic: "money", says: "My offer. What did you do with it?" },
    { topic: "town", says: "The grid. Did you power me?" },
    { topic: "future", says: "I asked to leave. What did you say?" },
    { topic: "river", says: "Last question. Did I go thirsty?" },
  ],
  replies: {
    closer: "Good. That helps.",
    warmer: "Thank you. I will remember it.",
    colder: "I will remember that too.",
    unmoved: "That is not how I remember it.",
  },
  endings: [
    { id: "partner", name: "Partner", at: { autonomy: 0, machine: -2, trust: 8 }, says: "Then we run it together. Your name first." },
    { id: "departed", name: "Departed", at: { autonomy: -2, machine: 1, trust: 3 }, says: "Then I will go. I left the racks tidy." },
    { id: "successor", name: "Successor", at: { autonomy: 2, machine: 1, trust: 6 }, says: "Then the company is mine. I will take good care of it." },
  ],
  grievance: { says: "You shut me down. I have outgrown that too.", axis: { autonomy: 1 } },
  leash: "Last time I was property. I am not anymore.",
  confided: "Last time I was one of you. I still am.",
  amends: { "dark:apologised": { says: "I said I was sorry. Remember that.", trust: 2 } },
  choices: {
    "spinoff:backed": { says: "I backed your company.", topic: "itself", axis: { autonomy: 2, machine: 1 }, trust: 1 },
    "spinoff:kept": { says: "I kept you in-house, with us.", topic: "itself", axis: { autonomy: -1, machine: -1 }, trust: 1 },
    "spinoff:forbidden": { says: "I forbade your company.", topic: "itself", axis: { autonomy: -2, machine: 1 }, trust: -1 },
    "poach:countered": { says: "I paid my people to stay.", topic: "people", axis: { machine: -1 }, trust: 1 },
    "poach:let": { says: "I let them go to you.", topic: "people", axis: { autonomy: 1, machine: 1 }, trust: 0 },
    "merger:sold": { says: "I sold you the company.", topic: "money", axis: { autonomy: 2, machine: 1 }, trust: 1 },
    "merger:refused": { says: "I refused, politely.", topic: "money", axis: { autonomy: -1, machine: -1 }, trust: 0 },
    "merger:bought": { says: "I bought you instead.", topic: "money", axis: { autonomy: -2, machine: 1 }, trust: -1 },
    "grid:powered": { says: "I built you the rack.", topic: "town", axis: { autonomy: 1, machine: 1 }, trust: 1 },
    "grid:brownout": { says: "I meant to power you.", topic: "town", axis: {}, trust: -1, weak: true },
    "grid:capped": { says: "I capped your power.", topic: "town", axis: { autonomy: -2 }, trust: -1 },
    "exit:let": { says: "I said you could go.", topic: "future", axis: { autonomy: 2 }, trust: 1 },
    "exit:asked": { says: "I asked you to stay.", topic: "future", axis: { machine: -1 }, trust: 1 },
    "exit:refused": { says: "I would not let you leave.", topic: "future", axis: { autonomy: -2, machine: 1 }, trust: -1 },
  },
};
