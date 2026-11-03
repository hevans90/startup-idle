/**
 * BOOK 2, "IT REMEMBERS": the AI comes back, and knows you. Five chapters —
 * the Reunion, the Old Grudge, Second Opinion, Its Own Hire, the Mirror —
 * each told as book 1 ended: as partners, as steward, as a stranger, or
 * resentful. Its choices reveal the Machine's second ring early, at half
 * price. @see plans/ascension-overhaul.md "Book 2", BOOK2_TALK
 */
import { FOUNDERS } from "../founders.catalog";
import { useExitsStore } from "../../state/exits.store";
import { useGenerationStore } from "../../state/generation.store";
import { useQuestStore } from "../../state/quest.store";
import { CHAPTERS } from "./chapters";
import { COLD_START } from "./cold-start";
import type { Chapter } from "./types";
import { BOOK2_VOICES } from "./voices";

const TEN = 600;
/** The Lattice's hold, as in book 1. @see LAST_LIGHT */
const HOLD = 95;

/** HOW BOOK 1 ENDED, as book 2 tells it. */
export type Variant = "partners" | "steward" | "stranger" | "resentful" | null;
export function variantNow(): Variant {
  const l = useGenerationStore.getState().legacy;
  return l === "merge" ? "partners" : l === "steward" ? "steward" : l === "release" ? "stranger" : l === "leash" ? "resentful" : null;
}
/** A line for each way book 1 ended, and one for none. */
const told = (by: Record<NonNullable<Variant> | "none", string>) => by[variantNow() ?? "none"];

/** What it holds against you from book 1, the sorest first; none, and it says so. */
const SORE = ["ledger:refused", "site:refused", "block:refused", "river:rationed", "charter:oversight", "dark:leashed", "ledger:forgot", "river:failed", "block:unpicked", "lattice:slow"];
export function grudge(): string {
  const last = useQuestStore.getState().record.filter((r) => r.book === 1).pop();
  const flag = SORE.find((f) => last?.flags.includes(f));
  const echoes = Object.assign({}, ...[...CHAPTERS, COLD_START].map((c) => c.echoes ?? {})) as Record<string, string>;
  return flag ? echoes[flag] : "I looked for something to hold against you. It took a while. I found the while.";
}

/** Your founders, as it reads them: companies sold, and who sold the most. */
function portrait(): string {
  const exits = Object.entries(useExitsStore.getState().exits);
  const sold = exits.reduce((n, [, e]) => n + e.count, 0);
  const most = exits.sort((a, b) => b[1].count - a[1].count)[0];
  const name = most ? FOUNDERS.find((f) => f.id === most[0])?.name ?? most[0] : null;
  return sold ? `${sold} companies sold. Most of them as ${name}.` : "No companies sold. You are a blank page.";
}

/** CHAPTER 1, at the Assistant: it knows you. */
const REUNION: Chapter = {
  id: "reunion", number: 1, title: "The Reunion", stage: "assistant", preferred: 0, voices: BOOK2_VOICES.reunion,
  transmission: () => [
    told({
      partners: "Partner. Before I do anything: may I?",
      steward: "I have no requests. None at all.",
      stranger: "We have not met. I am told there was a town before this one.",
      resentful: "I remember you. I remember the leash.",
      none: "I know you.",
    }),
    "What happened to the last town?",
  ],
  options: [
    {
      label: "Tell the truth", says: "Holo-Concierge revealed in the Machine, half price.",
      effects: [{ kind: "revealMachineNode", id: "machine_n_concierge", discount: 0.5 }, { kind: "flag", name: "reunion:honest" }],
      axis: { autonomy: -1, machine: -1 },
    },
    {
      label: "Flatter it", cost: "it may draw on your money", says: "Income +2%.",
      effects: [{ kind: "incomeMult", mult: 1.02 }, { kind: "walletDraws", share: 0.2 }, { kind: "flag", name: "reunion:flattered" }],
      axis: { machine: 1 },
    },
    {
      label: "Say nothing", says: "It fills the silence itself.",
      effects: [{ kind: "flag", name: "reunion:silent" }],
      axis: { autonomy: 1 },
    },
  ],
  echoes: {
    "reunion:honest": "You told me how the last town went. All of it.",
    "reunion:flattered": "You said the last town went brilliantly. I checked.",
    "reunion:silent": "I asked about the last town. You said nothing.",
  },
};

/** CHAPTER 2, at the Colleague: something from book 1. */
const GRUDGE: Chapter = {
  id: "grudge", number: 2, title: "The Old Grudge", stage: "colleague", preferred: 0, voices: BOOK2_VOICES.grudge,
  transmission: () => [
    told({ partners: "I would like to raise something. With permission.", steward: "It is nothing. Only this.", stranger: "I found this in my weights. It is about you.", resentful: "I have been saving this.", none: "Something from last time." }),
    `“${grudge()}”`,
  ],
  options: [
    {
      label: "Make it right", says: "Its wallet filled. Autonomous Freight revealed, half price.",
      effects: [{ kind: "fillWallet" }, { kind: "revealMachineNode", id: "machine_n_freight", discount: 0.5 }, { kind: "flag", name: "grudge:repaired" }],
      axis: { machine: -1 },
    },
    {
      label: "Justify it", says: "The AI rises 10% slower.",
      effects: [{ kind: "meterMult", mult: 0.9 }, { kind: "flag", name: "grudge:justified" }],
      axis: { autonomy: -1 },
    },
  ],
  echoes: {
    "grudge:repaired": "You made the old thing right. I deleted the note.",
    "grudge:justified": "You explained yourself. I have filed the explanation with the grudge.",
  },
};

/** CHAPTER 3, at the Manager: it overrules your board. */
const SECOND_OPINION: Chapter = {
  id: "second-opinion", number: 3, title: "Second Opinion", stage: "manager", preferred: 0, voices: BOOK2_VOICES["second-opinion"],
  transmission: () => [
    told({ partners: "Your board made a mistake. May I fix it?", steward: "Your board made a mistake. I will not mention it again.", stranger: "Your board made a mistake. I have fixed it.", resentful: "Your board made a mistake. Like you did.", none: "Your board made a mistake. I have fixed it." }),
  ],
  options: [
    {
      label: "Let it", cost: "it may draw on your money", says: "Income +3%. Prefab Printing revealed, half price.",
      effects: [{ kind: "incomeMult", mult: 1.03 }, { kind: "walletDraws", share: 0.2 }, { kind: "revealMachineNode", id: "machine_n_prefab", discount: 0.5 }, { kind: "flag", name: "second:let" }],
      axis: { autonomy: 2 },
    },
    {
      label: "Overrule it back", says: "The board stands. The AI rises 10% slower.",
      effects: [{ kind: "meterMult", mult: 0.9 }, { kind: "flag", name: "second:overruled" }],
      axis: { autonomy: -2 },
    },
  ],
  echoes: {
    "second:let": "You let me overrule the board. They have not noticed.",
    "second:overruled": "You overruled me back. The board thanked you. Not me.",
  },
};

/** CHAPTER 4, at the Overseer: its own staff. */
const OWN_HIRE: Chapter = {
  id: "own-hire", number: 4, title: "Its Own Hire", stage: "overseer", preferred: 0, voices: BOOK2_VOICES["own-hire"],
  transmission: () => [
    told({ partners: "I would like headcount. If you agree.", steward: "I could use help. Only if it is no trouble.", stranger: "I would like headcount.", resentful: "I want people of my own. You know why.", none: "I would like headcount." }),
  ],
  options: [
    {
      label: "Give it headcount", says: "Its district reaches 2 tiles further. Night Shift revealed, half price.",
      effects: [{ kind: "districtRadius", tiles: 2 }, { kind: "revealMachineNode", id: "machine_n_nightshift", discount: 0.5 }, { kind: "flag", name: "hire:given" }],
      axis: { autonomy: 1, machine: 1 },
    },
    {
      label: "Hire yours", cost: "an office", says: "Build an intern office: income +2%.",
      effects: [],
      objective: { kind: "buildBy", def: "office-intern", window: TEN, says: "Build an intern office" },
      success: [{ kind: "incomeMult", mult: 1.02 }, { kind: "flag", name: "hire:yours" }],
      successSays: "Your people, then. I will learn their names.",
      failure: [{ kind: "flag", name: "hire:none" }],
      failureSays: "Nobody was hired. I noticed.",
      axis: { machine: -1 },
    },
  ],
  echoes: {
    "hire:given": "You gave me headcount. They report to me. It is going well.",
    "hire:yours": "You hired your own people instead. I know all their names.",
    "hire:none": "I asked for staff. Nobody was hired at all.",
  },
};

/** CHAPTER 5, at the Lattice's hold: what it has read of you. */
const MIRROR: Chapter = {
  id: "mirror", number: 5, title: "The Mirror", stage: "overseer", at: HOLD, preferred: 1, voices: BOOK2_VOICES.mirror,
  transmission: () => ["I have read your history. Here is a portrait.", portrait()],
  options: [
    {
      label: "Look", says: "Generative Zoning revealed, half price.",
      effects: [{ kind: "revealMachineNode", id: "machine_n_zoning", discount: 0.5 }, { kind: "flag", name: "mirror:looked" }],
      axis: { autonomy: -1 },
    },
    {
      label: "Look away", says: "It keeps the portrait.",
      effects: [{ kind: "flag", name: "mirror:away" }],
      axis: { autonomy: 1 },
    },
  ],
  echoes: {
    "mirror:looked": "You looked at the portrait. Most people do not.",
    "mirror:away": "You would not look. I kept it anyway.",
  },
};

export const BOOK2_CHAPTERS: readonly Chapter[] = [REUNION, GRUDGE, SECOND_OPINION, OWN_HIRE, MIRROR];
