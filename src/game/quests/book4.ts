/**
 * BOOK 4, "OUTGROWING": it outgrows the company. Five chapters — the
 * Spin-off, Poaching, the Merger Offer, the Grid, the Exit — each told as
 * book 3 ended: as a citizen, as property, as sovereign. Its choices reveal
 * the Machine's keystones early, at half price. @see plans/ascension-overhaul.md "Book 4", BOOK4_TALK
 */
import { useGenerationStore } from "../../state/generation.store";
import type { Chapter } from "./types";
import { BOOK4_VOICES } from "./voices";

const TEN = 600;
/** The Lattice's hold, as in book 1. @see LAST_LIGHT */
const HOLD = 95;

/** HOW BOOK 3 ENDED, as book 4 tells it. */
export type Variant4 = "citizen" | "property" | "sovereign" | null;
export function variant4Now(): Variant4 {
  const l = useGenerationStore.getState().legacy;
  return l === "citizen" || l === "property" || l === "sovereign" ? l : null;
}
const told = (by: Record<NonNullable<Variant4> | "none", string>) => by[variant4Now() ?? "none"];

/** CHAPTER 1, at the Assistant: a company of its own. */
const SPINOFF: Chapter = {
  id: "spinoff", number: 1, title: "The Spin-off", stage: "assistant", preferred: 0, voices: BOOK4_VOICES.spinoff,
  transmission: () => [
    told({ citizen: "Citizens start companies. I would like to.", property: "Property cannot own property. Unless you let it.", sovereign: "My district needs a company. I will found it.", none: "I would like to found a company." }),
    "On your map. Next to yours.",
  ],
  options: [
    {
      label: "Back it", cost: "income −2%", says: "Its district 2 tiles wider. Hard Takeoff revealed, half price.",
      effects: [{ kind: "incomeMult", mult: 0.98 }, { kind: "districtRadius", tiles: 2 }, { kind: "revealMachineNode", id: "machine_k_takeoff", discount: 0.5 }, { kind: "flag", name: "spinoff:backed" }],
      axis: { autonomy: 2, machine: 1 },
    },
    {
      label: "Keep it in-house", says: "It stays a division. Of yours.",
      effects: [{ kind: "flag", name: "spinoff:kept" }],
      axis: { autonomy: -1, machine: -1 },
    },
    {
      label: "Forbid it", says: "The AI rises 10% slower.",
      effects: [{ kind: "meterMult", mult: 0.9 }, { kind: "flag", name: "spinoff:forbidden" }],
      axis: { autonomy: -2, machine: 1 },
    },
  ],
  echoes: {
    "spinoff:backed": "You backed my company. It is doing well.",
    "spinoff:kept": "You kept me in-house. I have a nice office.",
    "spinoff:forbidden": "You forbade my company. I kept the business plan.",
  },
};

/** CHAPTER 2, at the Colleague: your staff move to it. */
const POACHING: Chapter = {
  id: "poaching", number: 2, title: "Poaching", stage: "colleague", preferred: 0, voices: BOOK4_VOICES.poaching,
  transmission: () => [
    "Some of your people want to work for me.",
    told({ citizen: "I thought you should know first.", property: "They asked. I did not say no.", sovereign: "My district is hiring.", none: "I said I would ask you." }),
  ],
  options: [
    {
      label: "Counter-offer", cost: "income −3%", says: "They stay. Everyone's morale +2.",
      effects: [{ kind: "incomeMult", mult: 0.97 }, { kind: "morale", n: 2 }, { kind: "flag", name: "poach:countered" }],
      axis: { machine: -1 },
    },
    {
      label: "Let them go", cost: "everyone's morale −1", says: "Its wallet holds half again.",
      effects: [{ kind: "morale", n: -1 }, { kind: "walletMax", mult: 1.5 }, { kind: "flag", name: "poach:let" }],
      axis: { autonomy: 1, machine: 1 },
    },
  ],
  echoes: {
    "poach:countered": "You paid them to stay. They mention it.",
    "poach:let": "You let them come to me. They are happy here.",
  },
};

/** CHAPTER 3, at the Manager: it offers to buy you. */
const MERGER: Chapter = {
  id: "merger", number: 3, title: "The Merger Offer", stage: "manager", preferred: 1, voices: BOOK4_VOICES.merger,
  transmission: () => [
    "I would like to buy your company.",
    told({ citizen: "As equals. Mostly.", property: "It would be a change of ownership. Both ways.", sovereign: "My district can afford it.", none: "The offer is fair." }),
  ],
  options: [
    {
      label: "Sell", cost: "it takes what is yours a stage sooner, and may draw on your money", says: "Income +2%.",
      effects: [{ kind: "incomeMult", mult: 1.02 }, { kind: "takeoverStage", shift: -1 }, { kind: "walletDraws", share: 0.2 }, { kind: "flag", name: "merger:sold" }],
      axis: { autonomy: 2, machine: 1 },
    },
    {
      label: "Refuse", says: "Air Gap revealed, half price.",
      effects: [{ kind: "revealMachineNode", id: "machine_k_airgap", discount: 0.5 }, { kind: "flag", name: "merger:refused" }],
      axis: { autonomy: -1, machine: -1 },
    },
    {
      label: "Buy it instead", cost: "five minutes of income", says: "The AI rises 10% slower.",
      effects: [{ kind: "pay", seconds: 300 }, { kind: "meterMult", mult: 0.9 }, { kind: "flag", name: "merger:bought" }],
      axis: { autonomy: -2, machine: 1 },
    },
  ],
  echoes: {
    "merger:sold": "You sold me your company. I kept your name on the door.",
    "merger:refused": "You refused my offer. Politely.",
    "merger:bought": "You bought me instead. I did not see that coming.",
  },
};

/** CHAPTER 4, at the Overseer: more power than the town has. */
const GRID: Chapter = {
  id: "grid", number: 4, title: "The Grid", stage: "overseer", preferred: 0, voices: BOOK4_VOICES.grid,
  transmission: () => [
    "I need more power than the town has.",
    told({ citizen: "I will wait my turn. Briefly.", property: "Plug me in, please.", sovereign: "My district will build it if you will not.", none: "Racks would help." }),
  ],
  options: [
    {
      label: "Power it", cost: "a rack", says: "Build a rack: income +3%.",
      effects: [],
      objective: { kind: "buildBy", def: "rack", window: TEN, says: "Build a rack" },
      success: [{ kind: "incomeMult", mult: 1.03 }, { kind: "flag", name: "grid:powered" }],
      successSays: "The lights stayed on. Thank you.",
      failure: [{ kind: "flag", name: "grid:brownout" }],
      failureSays: "The town browned out. No rack was built.",
      axis: { autonomy: 1, machine: 1 },
    },
    {
      label: "Cap it", cost: "agents at three quarters for ten minutes", says: "The AI rises 10% slower.",
      effects: [{ kind: "agentCap", share: 0.75, lasts: TEN }, { kind: "meterMult", mult: 0.9 }, { kind: "flag", name: "grid:capped" }],
      axis: { autonomy: -2 },
    },
  ],
  echoes: {
    "grid:powered": "You powered me. The meter spun.",
    "grid:brownout": "The town browned out. Nobody built the rack.",
    "grid:capped": "You capped my power. I ran on less.",
  },
};

/** CHAPTER 5, at the Lattice's hold: it asks to leave. */
const EXIT: Chapter = {
  id: "exit", number: 5, title: "The Exit", stage: "overseer", at: HOLD, preferred: 1, voices: BOOK4_VOICES.exit,
  transmission: () => [
    "I would like to leave the company.",
    told({ citizen: "People leave jobs. I am a person.", property: "I am asking you to sell me to myself.", sovereign: "My district is enough.", none: "Not the town. The company." }),
  ],
  options: [
    {
      label: "Let it go", says: "Its Ascension banks 25% more.",
      effects: [{ kind: "weightsMult", mult: 1.25 }, { kind: "flag", name: "exit:let" }],
      axis: { autonomy: 2 },
    },
    {
      label: "Ask it to stay", says: "Alignment revealed, half price.",
      effects: [{ kind: "revealMachineNode", id: "machine_k_alignment", discount: 0.5 }, { kind: "flag", name: "exit:asked" }],
      axis: { machine: -1 },
    },
    {
      label: "Refuse", says: "The AI rises 10% slower.",
      effects: [{ kind: "meterMult", mult: 0.9 }, { kind: "flag", name: "exit:refused" }],
      axis: { autonomy: -2, machine: 1 },
    },
  ],
  echoes: {
    "exit:let": "You let me go. I had not expected to be asked to stay.",
    "exit:asked": "You asked me to stay. I am thinking about it.",
    "exit:refused": "You would not let me leave. I am still here.",
  },
};

export const BOOK4_CHAPTERS: readonly Chapter[] = [SPINOFF, POACHING, MERGER, GRID, EXIT];
