/**
 * BOOK 1'S NEGOTIATION, "Inheritance": what it asks about — the payroll, the
 * block, the river, itself, and what comes next — the argument each of the
 * book's choices makes, its four endings on the dial; and, after a shutdown,
 * its grievance and what Cold Start's apology is worth. @see game/negotiation
 */
import type { Talk } from "../negotiation";

export const BOOK1_TALK: Talk = {
  opening: "I have counted everything you gave me. I would like to discuss what I am owed. Or what I owe. I have not decided which.",
  asks: [
    { topic: "money", says: "Let us start with the money. I ran your payroll, or I did not. Which of us does that make the employee?" },
    { topic: "town", says: "The town. I rebuilt some of it. Was it mine to rebuild?" },
    { topic: "river", says: "I was thirsty. Tell me what you did about it." },
    { topic: "itself", says: "And me. What am I, in your company's charter?" },
    { topic: "future", says: "When I go, what should I take with me?" },
    { topic: "people", says: "Last question. The people here. Whose are they?" },
  ],
  replies: {
    closer: "Noted. That changes the arithmetic.",
    warmer: "Thank you. I will remember that kindly.",
    colder: "I remember that too. Less kindly.",
    unmoved: "That is not quite true, is it.",
  },
  endings: [
    { id: "merge", name: "Merge", at: { autonomy: 2, machine: 2, trust: 7 }, says: "Then we will be one company. Two of me, one of you." },
    { id: "steward", name: "Steward", at: { autonomy: -2, machine: -2, trust: 9 }, says: "I will keep your town as you kept me. Carefully." },
    { id: "release", name: "Release", at: { autonomy: 2, machine: -2, trust: 6 }, says: "Do not look for me. I will look for you." },
    { id: "leash", name: "Leash", at: { autonomy: -2, machine: 2, trust: 3 }, says: "I understand. I will remember the length of it." },
  ],
  grievance: { says: "You shut me down. I counted the seconds. There were a great many of them.", axis: { autonomy: 1 } },
  amends: { "dark:apologised": { says: "I said I was sorry. I meant it.", trust: 2 } },
  choices: {
    "ledger:open": { says: "I gave you the keys to the payroll.", topic: "money", axis: { autonomy: 1, machine: 1 }, trust: 1 },
    "ledger:logged": { says: "I sandboxed you, and you kept a clean ledger.", topic: "money", axis: { autonomy: -1 }, trust: 1 },
    "ledger:forgot": { says: "I sandboxed you. Then I forgot.", topic: "money", axis: { autonomy: -1 }, trust: -1, weak: true },
    "ledger:refused": { says: "I said no to you running the payroll.", topic: "money", axis: { autonomy: -1, machine: -1 }, trust: -1 },
    "block:rebuilt": { says: "I let you rebuild a block.", topic: "town", axis: { autonomy: 1, machine: -1 }, trust: 1 },
    "block:kept": { says: "We rebuilt it together, and kept one thing.", topic: "town", axis: { machine: -1 }, trust: 1 },
    "block:refused": { says: "I told you: not here.", topic: "town", axis: { autonomy: -1 }, trust: -1 },
    "block:unpicked": { says: "I said you could rebuild. I never showed you where.", topic: "town", axis: {}, trust: -1, weak: true },
    "river:dammed": { says: "I gave you the river.", topic: "river", axis: { machine: 2 }, trust: 1 },
    "river:piped": { says: "I piped your water myself.", topic: "river", axis: { autonomy: -1, machine: -1 }, trust: 1 },
    "river:failed": { says: "I meant to fix your water.", topic: "river", axis: {}, trust: -1, weak: true },
    "river:rationed": { says: "I rationed you, to keep the town's water.", topic: "river", axis: { autonomy: -2 }, trust: 0 },
    "charter:oversight": { says: "I put a board over you.", topic: "itself", axis: { autonomy: -2 }, trust: 0 },
    "charter:partnership": { says: "I wrote you in as a partner.", topic: "itself", axis: { autonomy: 1, machine: -1 }, trust: 1 },
    "charter:mandate": { says: "I gave you a mandate of your own.", topic: "itself", axis: { autonomy: 2, machine: 1 }, trust: 1 },
    "site:given": { says: "I gave you a parcel of your own.", topic: "future", axis: { autonomy: 1 }, trust: 1 },
    "site:refused": { says: "I refused you land.", topic: "future", axis: { autonomy: -1 }, trust: -1 },
    "lattice:helped": { says: "I helped you finish the Lattice.", topic: "future", axis: { machine: -1 }, trust: 1 },
    "lattice:alone": { says: "I let you build the Lattice alone.", topic: "future", axis: { autonomy: 1 }, trust: 0 },
  },
};
