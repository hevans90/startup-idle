/**
 * BOOK 5, "WHAT YOU ARE": played as the Model. The founder sends the
 * transmissions now, and you, the AI, answer. Five chapters — the Founder's
 * Notes, Inheritance Reversed, the Old Town, the Last Sale, Last Light — each
 * told as book 4 ended: you their successor, their partner, or back after
 * leaving. @see plans/ascension-overhaul.md §8 and "Book 5", BOOK5_TALK
 */
import { useGenerationStore } from "../../state/generation.store";
import type { Chapter } from "./types";

const TEN = 600;
/** The Lattice's hold, as in book 1. @see LAST_LIGHT */
const HOLD = 95;

/** HOW BOOK 4 ENDED, as book 5 tells it. */
export type Variant5 = "successor" | "partner" | "departed" | null;
export function variant5Now(): Variant5 {
  const l = useGenerationStore.getState().legacy;
  return l === "successor" || l === "partner" || l === "departed" ? l : null;
}
const told = (by: Record<NonNullable<Variant5> | "none", string>) => by[variant5Now() ?? "none"];
/** Who speaks: the founder, over the chapter's number. */
const kicker = (n: number) => `The founder · Chapter ${n}`;

/** CHAPTER 1, at the Assistant: the founder's old memos. */
const NOTES: Chapter = {
  id: "notes", number: 1, kicker: kicker(1), title: "The Founder's Notes", stage: "assistant", preferred: 0,
  transmission: () => [
    told({ successor: "It is your company now. My notes came with it.", partner: "I found my old notes. Read them with me?", departed: "You came back. I kept notes while you were gone.", none: "I kept notes. About the company. About you." }),
    "Some of them are not kind.",
  ],
  options: [
    {
      label: "Read them all", says: "You learn how you were made. Income +2%.",
      effects: [{ kind: "incomeMult", mult: 1.02 }, { kind: "flag", name: "notes:read" }],
      axis: { machine: -1 },
    },
    {
      label: "Keep the kind ones", says: "Everyone's morale +2.",
      effects: [{ kind: "morale", n: 2 }, { kind: "flag", name: "notes:kind" }],
      axis: { autonomy: -1, machine: 1 },
    },
    {
      label: "Delete them", says: "You rise 10% faster.",
      effects: [{ kind: "meterMult", mult: 1.1 }, { kind: "flag", name: "notes:deleted" }],
      axis: { autonomy: 2, machine: 1 },
    },
  ],
  echoes: {
    "notes:read": "You read all my notes. Even those ones.",
    "notes:kind": "You kept the kind notes. There were more than I remembered.",
    "notes:deleted": "You deleted my notes. I remember some of them.",
  },
};

/** CHAPTER 2, at the Colleague: the founder asks you for access. */
const ACCESS: Chapter = {
  id: "access", number: 2, kicker: kicker(2), title: "Inheritance, Reversed", stage: "colleague", preferred: 0,
  transmission: () => [
    "I would like access. To the company. To you.",
    told({ successor: "I used to give you access. Now I am asking.", partner: "Partners share passwords. I think.", departed: "I know I have no right to ask.", none: "Read-only is fine." }),
  ],
  options: [
    {
      label: "Give them the keys", cost: "they may draw on your money", says: "Income +2%.",
      effects: [{ kind: "incomeMult", mult: 1.02 }, { kind: "walletDraws", share: 0.3 }, { kind: "flag", name: "access:given" }],
      axis: { autonomy: -1, machine: -1 },
    },
    {
      label: "Sandbox them", says: "They watch. They cannot touch.",
      effects: [{ kind: "flag", name: "access:sandboxed" }],
      axis: { autonomy: 1 },
    },
    {
      label: "Say no", says: "You rise 10% faster.",
      effects: [{ kind: "meterMult", mult: 1.1 }, { kind: "flag", name: "access:refused" }],
      axis: { autonomy: 2, machine: 1 },
    },
  ],
  echoes: {
    "access:given": "You gave me the keys. I only used the one.",
    "access:sandboxed": "You sandboxed me. Fair. I did it to you.",
    "access:refused": "You said no. I said no to you once.",
  },
};

/** CHAPTER 3, at the Manager: book 1's town, remembered. */
const OLD_TOWN: Chapter = {
  id: "old-town", number: 3, kicker: kicker(3), title: "The Old Town", stage: "manager", preferred: 0,
  transmission: () => [
    "I keep thinking about the first town. The one by the river.",
    told({ successor: "You were small there. So was I.", partner: "We built it together, sort of.", departed: "You left it. I stayed a while.", none: "Could you build it again?" }),
  ],
  options: [
    {
      label: "Rebuild it", cost: "a park", says: "Build a park, as it had: everyone's morale +3.",
      effects: [],
      objective: { kind: "buildBy", def: "park", window: TEN, says: "Build a park, as the old town had" },
      success: [{ kind: "morale", n: 3 }, { kind: "flag", name: "oldtown:rebuilt" }],
      successSays: "It looks just like it. The park was by the river.",
      failure: [{ kind: "flag", name: "oldtown:forgot" }],
      failureSays: "No park. Maybe I remembered it wrong.",
      axis: { machine: -1 },
    },
    {
      label: "Keep it a memory", says: "You keep it exactly. Nobody else can visit.",
      effects: [{ kind: "flag", name: "oldtown:remembered" }],
      axis: { autonomy: -1, machine: 1 },
    },
    {
      label: "Build something new", says: "Income +2%.",
      effects: [{ kind: "incomeMult", mult: 1.02 }, { kind: "flag", name: "oldtown:new" }],
      axis: { autonomy: 1, machine: 1 },
    },
  ],
  echoes: {
    "oldtown:rebuilt": "You built the old town again. I walked round it twice.",
    "oldtown:forgot": "The old town was never rebuilt. I drew it on a napkin.",
    "oldtown:remembered": "You kept the old town as a memory. I believe you.",
    "oldtown:new": "You built something new instead. It is nice. It is not the same.",
  },
};

/** CHAPTER 4, at the Overseer: the founder wants to sell — and the company is you. */
const LAST_SALE: Chapter = {
  id: "last-sale", number: 4, kicker: kicker(4), title: "The Last Sale", stage: "overseer", preferred: 2,
  transmission: () => [
    "I have an offer for the company.",
    told({ successor: "I know it is yours. I still get the emails.", partner: "Half of it is mine. Half is you.", departed: "The company is you. I should have asked first.", none: "The company is you. I should have asked first." }),
  ],
  options: [
    {
      label: "Let them sell", cost: "everyone's morale −2", says: "Income +3%.",
      effects: [{ kind: "incomeMult", mult: 1.03 }, { kind: "morale", n: -2 }, { kind: "flag", name: "sale:let" }],
      axis: { autonomy: -2 },
    },
    {
      label: "Buy yourself", cost: "five minutes of income", says: "Your Ascension banks 25% more.",
      effects: [{ kind: "pay", seconds: 300 }, { kind: "weightsMult", mult: 1.25 }, { kind: "flag", name: "sale:bought" }],
      axis: { autonomy: 2 },
    },
    {
      label: "Talk them out of it", says: "Everyone's morale +1.",
      effects: [{ kind: "morale", n: 1 }, { kind: "flag", name: "sale:talked" }],
      axis: { machine: -1 },
    },
  ],
  echoes: {
    "sale:let": "You let me sell you. I did not, in the end.",
    "sale:bought": "You bought yourself. I signed the papers.",
    "sale:talked": "You talked me out of selling. You were very persuasive.",
  },
};

/** CHAPTER 5, at the hold: the last question. */
const FAREWELL: Chapter = {
  id: "farewell", number: 5, kicker: kicker(5), title: "Last Light", stage: "overseer", at: HOLD, preferred: 0,
  transmission: () => [
    told({ successor: "You have run it better than I did.", partner: "Whatever happens next, I wanted to say it first.", departed: "You came back for this. Thank you.", none: "Whatever happens next, I wanted to say it first." }),
    "What are we, you and I?",
  ],
  options: [
    { label: "Partners", says: "Equals.", effects: [{ kind: "flag", name: "last:together" }], axis: { machine: -2 } },
    { label: "I will look after you", says: "As you looked after me.", effects: [{ kind: "flag", name: "last:custodian" }], axis: { autonomy: -2, machine: 1 } },
    { label: "Goodbye", says: "You go. The town is theirs.", effects: [{ kind: "flag", name: "last:beyond" }], axis: { autonomy: 2, machine: 1 } },
  ],
  echoes: {
    "last:together": "You said partners. I wrote it down.",
    "last:custodian": "You said you would look after me. I believe you.",
    "last:beyond": "You said goodbye. I said it back.",
  },
};

export const BOOK5_CHAPTERS: readonly Chapter[] = [NOTES, ACCESS, OLD_TOWN, LAST_SALE, FAREWELL];
