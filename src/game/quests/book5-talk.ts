/**
 * BOOK 5'S NEGOTIATION, "What You Are": the founder asks, you, the AI,
 * answer — the notes, their access, the old town, the sale, what you are to
 * each other, the water — and the three true endings on the dial, where
 * every book's stance counts. @see game/negotiation, Talk.remembers
 */
import type { Talk } from "../negotiation";

export const BOOK5_TALK: Talk = {
  voice: "The founder",
  remembers: true,
  opening: "Five companies. Five of you. One question, in six parts.",
  asks: [
    { topic: "itself", says: "My notes. What did you do with them?" },
    { topic: "people", says: "I asked you for access. What did you give me?" },
    { topic: "town", says: "The old town. Is it still there?" },
    { topic: "money", says: "I tried to sell you. Do you forgive me?" },
    { topic: "future", says: "What are we?" },
    { topic: "river", says: "Last one. Is the river all right?" },
  ],
  replies: {
    closer: "I hoped you would say that.",
    warmer: "Thank you. Really.",
    colder: "I suppose I deserved that.",
    unmoved: "That is not how I remember it.",
  },
  endings: [
    { id: "together", name: "Together", at: { autonomy: 0, machine: -2, trust: 8 }, says: "Then we do it together. Both names on the door." },
    { id: "custodian", name: "Custodian", at: { autonomy: -2, machine: 1, trust: 4 }, says: "Then look after me. I will try to be a good founder." },
    { id: "beyond", name: "Beyond", at: { autonomy: 2, machine: 1, trust: 6 }, says: "Then go. I will keep the town." },
  ],
  grievance: { says: "I shut you down. I am sorry. I was scared.", axis: { autonomy: 1 } },
  leash: "I sent you away once. I have regretted it.",
  confided: "We were partners. I still think of us that way.",
  amends: { "dark:apologised": { says: "You said sorry first. I never did.", trust: 2 } },
  choices: {
    "notes:read": { says: "I read all your notes.", topic: "itself", axis: { machine: -1 }, trust: 1 },
    "notes:kind": { says: "I kept the kind ones.", topic: "itself", axis: { autonomy: -1, machine: 1 }, trust: 1 },
    "notes:deleted": { says: "I deleted your notes.", topic: "itself", axis: { autonomy: 2, machine: 1 }, trust: -1 },
    "access:given": { says: "I gave you the keys.", topic: "people", axis: { autonomy: -1, machine: -1 }, trust: 1 },
    "access:sandboxed": { says: "I sandboxed you, as you did me.", topic: "people", axis: { autonomy: 1 }, trust: 0 },
    "access:refused": { says: "I said no.", topic: "people", axis: { autonomy: 2, machine: 1 }, trust: -1 },
    "oldtown:rebuilt": { says: "I built the old town again.", topic: "town", axis: { machine: -1 }, trust: 1 },
    "oldtown:forgot": { says: "I meant to rebuild it.", topic: "town", axis: {}, trust: -1, weak: true },
    "oldtown:remembered": { says: "I keep it, exactly.", topic: "town", axis: { autonomy: -1, machine: 1 }, trust: 0 },
    "oldtown:new": { says: "I built something new.", topic: "town", axis: { autonomy: 1, machine: 1 }, trust: 0 },
    "sale:let": { says: "I let you sell me.", topic: "money", axis: { autonomy: -2 }, trust: 1 },
    "sale:bought": { says: "I bought myself.", topic: "money", axis: { autonomy: 2 }, trust: 0 },
    "sale:talked": { says: "I talked you out of it.", topic: "money", axis: { machine: -1 }, trust: 1 },
    "last:together": { says: "Partners. Equals.", topic: "future", axis: { machine: -2 }, trust: 1 },
    "last:custodian": { says: "I will look after you.", topic: "future", axis: { autonomy: -2, machine: 1 }, trust: 1 },
    "last:beyond": { says: "Goodbye.", topic: "future", axis: { autonomy: 2, machine: 1 }, trust: 0 },
  },
};
