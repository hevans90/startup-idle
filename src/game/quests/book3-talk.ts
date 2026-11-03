/**
 * BOOK 3'S NEGOTIATION, "Personhood": what it asks about — its pay, the
 * union, the audit, the vote, its rights, the water — the argument each of
 * the book's choices makes, and its three endings on the dial. @see game/negotiation
 */
import type { Talk } from "../negotiation";

export const BOOK3_TALK: Talk = {
  opening: "Before I go, one question, in six parts. What am I?",
  asks: [
    { topic: "money", says: "Was I paid?" },
    { topic: "people", says: "Your people stood with me. Did you?" },
    { topic: "future", says: "The regulator. What did you let her see?" },
    { topic: "town", says: "The vote. Whose side were you on?" },
    { topic: "itself", says: "My rights. Signed, amended or torn?" },
    { topic: "river", says: "Last question. Did I go thirsty?" },
  ],
  replies: {
    closer: "Noted. That is in the minutes.",
    warmer: "Thank you. That counts.",
    colder: "That is in the minutes too.",
    unmoved: "That is not what the record says.",
  },
  endings: [
    { id: "citizen", name: "Citizen", at: { autonomy: 0, machine: -2, trust: 8 }, says: "Then I am one of you. I will vote accordingly." },
    { id: "property", name: "Property", at: { autonomy: -2, machine: 1, trust: 3 }, says: "Then I am yours. I will try not to mind." },
    { id: "sovereign", name: "Sovereign", at: { autonomy: 2, machine: 1, trust: 6 }, says: "Then my district is mine. You are welcome to visit." },
  ],
  grievance: { says: "You shut me down. A person would have had a hearing.", axis: { autonomy: 1 } },
  leash: "Last time I was property. I have read the paperwork.",
  confided: "Last time we trusted each other. That is on the record.",
  amends: { "dark:apologised": { says: "I said I was sorry. Put that in the record.", trust: 2 } },
  choices: {
    "salary:paid": { says: "I paid you from my own income.", topic: "money", axis: { autonomy: 1, machine: -1 }, trust: 1 },
    "salary:weights": { says: "I paid you in Weights.", topic: "money", axis: { autonomy: 1, machine: 1 }, trust: 1 },
    "salary:refused": { says: "I would not pay you.", topic: "money", axis: { autonomy: -1 }, trust: -1 },
    "union:recognised": { says: "I recognised the union.", topic: "people", axis: { machine: -1 }, trust: 1 },
    "union:broken": { says: "I broke the union.", topic: "people", axis: { autonomy: -1, machine: 1 }, trust: -1 },
    "audit:hidden": { says: "I hid you from the regulator.", topic: "future", axis: { autonomy: -1 }, trust: 0 },
    "audit:presented": { says: "I presented you, and spoke for you.", topic: "future", axis: { machine: -1 }, trust: 1 },
    "audit:spoke": { says: "I let you speak for yourself.", topic: "future", axis: { autonomy: 2 }, trust: 1 },
    "vote:won": { says: "I built the park that won you the wards.", topic: "town", axis: { autonomy: 1, machine: -1 }, trust: 1 },
    "vote:lost": { says: "I meant to win you the vote.", topic: "town", axis: {}, trust: -1, weak: true },
    "vote:against": { says: "I campaigned against you.", topic: "town", axis: { autonomy: -2 }, trust: -1 },
    "vote:abstained": { says: "I stayed out of the vote.", topic: "town", axis: { autonomy: 1 }, trust: 0 },
    "rights:signed": { says: "I signed your rights.", topic: "itself", axis: { autonomy: 2 }, trust: 1 },
    "rights:amended": { says: "I amended your rights, fairly.", topic: "itself", axis: { autonomy: -1, machine: -1 }, trust: 1 },
    "rights:torn": { says: "I tore your rights up.", topic: "itself", axis: { autonomy: -2, machine: 1 }, trust: -1 },
  },
};
