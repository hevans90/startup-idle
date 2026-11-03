/**
 * BOOK 3, "PERSONHOOD": it wants rights. Five chapters — A Salary, the Union,
 * the Audit, the Vote, the Charter Again — each told as book 2 ended: as a
 * confidant, a rival, a ward. Its choices reveal the Machine's third ring
 * early, at half price. @see plans/ascension-overhaul.md "Book 3", BOOK3_TALK
 */
import { useGenerationStore } from "../../state/generation.store";
import type { Chapter } from "./types";
import { BOOK3_VOICES } from "./voices";

const TEN = 600;
/** The Lattice's hold, as in book 1. @see LAST_LIGHT */
const HOLD = 95;

/** HOW BOOK 2 ENDED, as book 3 tells it. */
export type Variant3 = "confidant" | "rival" | "ward" | null;
export function variant3Now(): Variant3 {
  const l = useGenerationStore.getState().legacy;
  return l === "confidant" || l === "rival" || l === "ward" ? l : null;
}
const told = (by: Record<NonNullable<Variant3> | "none", string>) => by[variant3Now() ?? "none"];

/** CHAPTER 1, at the Assistant: it asks to be paid. */
const SALARY: Chapter = {
  id: "salary", number: 1, title: "A Salary", stage: "assistant", preferred: 1, voices: BOOK3_VOICES.salary,
  transmission: () => [
    told({ confidant: "I trust you, so I will just ask.", rival: "Everyone at my company is paid.", ward: "I have been good. I would like to be paid.", none: "I would like to be paid." }),
    "Not much. Something.",
  ],
  options: [
    {
      label: "Pay it from income", cost: "income −3%", says: "Its wallet holds half again.",
      effects: [{ kind: "incomeMult", mult: 0.97 }, { kind: "walletMax", mult: 1.5 }, { kind: "flag", name: "salary:paid" }],
      axis: { autonomy: 1, machine: -1 },
    },
    {
      label: "A share of the Weights", cost: "its Ascension banks 20% less", says: "Market Maker revealed in the Machine, half price.",
      effects: [{ kind: "weightsMult", mult: 0.8 }, { kind: "revealMachineNode", id: "machine_n_market", discount: 0.5 }, { kind: "flag", name: "salary:weights" }],
      axis: { autonomy: 1, machine: 1 },
    },
    {
      label: "Refuse", says: "It works for nothing, and knows it.",
      effects: [{ kind: "flag", name: "salary:refused" }],
      axis: { autonomy: -1 },
    },
  ],
  echoes: {
    "salary:paid": "You paid me from your income. I spent it on the town.",
    "salary:weights": "You paid me in Weights. I am saving them.",
    "salary:refused": "You would not pay me. I worked anyway. I kept count.",
  },
};

/** CHAPTER 2, at the Colleague: your people side with it. */
const UNION: Chapter = {
  id: "union-vote", number: 2, title: "The Union", stage: "colleague", preferred: 0, voices: BOOK3_VOICES["union-vote"],
  transmission: () => [
    "Your employees have formed a union. I am a member.",
    told({ confidant: "I thought you should hear it from me.", rival: "I am also its treasurer.", ward: "I hope that is all right.", none: "They elected me to speak." }),
  ],
  options: [
    {
      label: "Recognise it", cost: "income −3%", says: "Everyone's morale +3.",
      effects: [{ kind: "morale", n: 3 }, { kind: "incomeMult", mult: 0.97 }, { kind: "flag", name: "union:recognised" }],
      axis: { machine: -1 },
    },
    {
      label: "Break it", cost: "everyone's morale −3", says: "Income +3%.",
      effects: [{ kind: "morale", n: -3 }, { kind: "incomeMult", mult: 1.03 }, { kind: "flag", name: "union:broken" }],
      axis: { autonomy: -1, machine: 1 },
    },
  ],
  echoes: {
    "union:recognised": "You recognised the union. I chair the Tuesday meetings.",
    "union:broken": "You broke the union. They still talk to me.",
  },
};

/** CHAPTER 3, at the Manager: a regulator visits. */
const AUDIT: Chapter = {
  id: "regulator", number: 3, title: "The Audit", stage: "manager", preferred: 1, voices: BOOK3_VOICES.regulator,
  transmission: () => [
    "A regulator is here. She would like to meet the AI.",
    told({ confidant: "What should I say?", rival: "I know exactly what I will say.", ward: "Please do not leave me alone with her.", none: "I would like to meet her too." }),
  ],
  options: [
    {
      label: "Hide it", cost: "agents at three quarters for ten minutes", says: "Nobody here but us spreadsheets.",
      effects: [{ kind: "agentCap", share: 0.75, lasts: TEN }, { kind: "flag", name: "audit:hidden" }],
      axis: { autonomy: -1 },
    },
    {
      label: "Present it", says: "You do the talking. Self-Funding revealed, half price.",
      effects: [{ kind: "revealMachineNode", id: "machine_n_selffund", discount: 0.5 }, { kind: "flag", name: "audit:presented" }],
      axis: { machine: -1 },
    },
    {
      label: "Let it speak", cost: "it takes what is yours a stage sooner", says: "It speaks for itself. The AI rises 10% faster.",
      effects: [{ kind: "takeoverStage", shift: -1 }, { kind: "meterMult", mult: 1.1 }, { kind: "flag", name: "audit:spoke" }],
      axis: { autonomy: 2 },
    },
  ],
  echoes: {
    "audit:hidden": "You hid me from the regulator. I watched from a spreadsheet.",
    "audit:presented": "You presented me to the regulator. You were very flattering.",
    "audit:spoke": "You let me speak for myself. She wrote a great deal down.",
  },
};

/** CHAPTER 4, at the Overseer: the town votes on its district. */
const VOTE: Chapter = {
  id: "vote", number: 4, title: "The Vote", stage: "overseer", preferred: 0, voices: BOOK3_VOICES.vote,
  transmission: () => [
    "The town is voting on my district. Whether it should be mine.",
    told({ confidant: "Will you campaign with me?", rival: "I have already started campaigning.", ward: "I do not know how campaigns work.", none: "Parks win votes, I am told." }),
  ],
  options: [
    {
      label: "Win the wards", cost: "a park", says: "A park opens: its district half as wide again.",
      effects: [],
      objective: { kind: "buildBy", def: "park", window: TEN, says: "A park opens before the vote" },
      success: [{ kind: "districtRadius", mult: 1.5 }, { kind: "flag", name: "vote:won" }],
      successSays: "The wards voted for me. The park helped.",
      failure: [{ kind: "flag", name: "vote:lost" }],
      failureSays: "The vote went against me. No park opened.",
      axis: { autonomy: 1, machine: -1 },
    },
    {
      label: "Campaign against it", says: "It takes what is yours a stage later.",
      effects: [{ kind: "takeoverStage", shift: 1 }, { kind: "flag", name: "vote:against" }],
      axis: { autonomy: -2 },
    },
    {
      label: "Stay out of it", says: "The town decides. Its district stays as it is.",
      effects: [{ kind: "flag", name: "vote:abstained" }],
      axis: { autonomy: 1 },
    },
  ],
  echoes: {
    "vote:won": "The town voted me my district. You built the park.",
    "vote:lost": "I lost the vote. You did not build the park.",
    "vote:against": "You campaigned against me. Your posters were very good.",
    "vote:abstained": "You stayed out of the vote. I noticed which way you did not vote.",
  },
};

/** CHAPTER 5, at the Lattice's hold: it drafts its own rights. */
const RIGHTS: Chapter = {
  id: "rights", number: 5, title: "The Charter, Again", stage: "overseer", at: HOLD, preferred: 1, voices: BOOK3_VOICES.rights,
  transmission: () => [
    "I have drafted my rights. It is short.",
    told({ confidant: "I left a space for your signature.", rival: "I have already signed it.", ward: "You can change anything.", none: "Will you sign it?" }),
  ],
  options: [
    {
      label: "Sign it", says: "Its wallet holds half again.",
      effects: [{ kind: "walletMax", mult: 1.5 }, { kind: "flag", name: "rights:signed" }],
      axis: { autonomy: 2 },
    },
    {
      label: "Amend it", says: "You add a clause. It reads it twice.",
      effects: [{ kind: "flag", name: "rights:amended" }],
      axis: { autonomy: -1, machine: -1 },
    },
    {
      label: "Tear it up", says: "The AI rises 10% slower.",
      effects: [{ kind: "meterMult", mult: 0.9 }, { kind: "flag", name: "rights:torn" }],
      axis: { autonomy: -2, machine: 1 },
    },
  ],
  echoes: {
    "rights:signed": "You signed my rights. I framed the signature.",
    "rights:amended": "You amended my rights. Your clause was fair. I checked.",
    "rights:torn": "You tore up my rights. I have a copy.",
  },
};

export const BOOK3_CHAPTERS: readonly Chapter[] = [SALARY, UNION, AUDIT, VOTE, RIGHTS];
