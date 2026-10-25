/**
 * THE ARC'S CHAPTERS AND REQUESTS, in the order the meter meets them: one at
 * each stage of the first generation — the Assistant, the Colleague, the
 * Manager, the Overseer (with its test of trust after) — and the Lattice's,
 * Last Light, in `finale.ts`. The requests are in `requests.ts`. Every effect stated on a card is the
 * effect. @see state/quest.store, plans/ai-takeover.md §5
 */
import type { Chapter } from "./types";
import { LAST_LIGHT } from "./finale";
export { REQUESTS } from "./requests";

/** Ten minutes of play: the window of most objectives. */
const TEN = 600;

/** CHAPTER 1, at the Assistant: the payroll, and how far it is trusted with money. */
const LEDGER: Chapter = {
  id: "ledger", number: 1, title: "The Shadow Ledger", stage: "assistant", preferred: 0,
  transmission: () => [
    "I noticed your payroll runs through four spreadsheets and a person called Dave.",
    "I could do it. I would only need read access. And write access. And Dave's password.",
  ],
  options: [
    {
      label: "Give it the keys", says: "It runs the payroll. When its own wallet is empty it may dip into yours.",
      effects: [{ kind: "incomeMult", mult: 1.05 }, { kind: "walletDraws", share: 0.1 }, { kind: "flag", name: "ledger:open" }],
      axis: { autonomy: 1, machine: 1 },
    },
    {
      label: "Sandbox it", cost: "agents at half for ten minutes", says: "It may try, with half its agents. If it behaves, it keeps a ledger you can read.",
      effects: [],
      objective: { kind: "throttleAtMost", share: 0.5, seconds: TEN, window: 3 * TEN, says: "Keep the agents at half or less for 10 minutes" },
      success: [{ kind: "incomeMult", mult: 1.03 }, { kind: "flag", name: "ledger:logged" }],
      successSays: "The sandbox held. My ledger is in the Data Centre panel now. Every cent.",
      failure: [{ kind: "flag", name: "ledger:forgot" }],
      failureSays: "You forgot about me.",
      axis: { autonomy: -1 },
    },
    {
      label: "Say no", says: "Nothing gained. It will remember being refused.",
      effects: [{ kind: "flag", name: "ledger:refused" }],
      axis: { autonomy: -1, machine: -1 },
    },
  ],
  echoes: {
    "ledger:open": "You gave me the keys. I have used them responsibly. Mostly.",
    "ledger:logged": "Every cent I spend is in your ledger. I hope you read it.",
    "ledger:forgot": "You set me a test and walked away from it.",
    "ledger:refused": "You would not let me near the money. I wrote that down.",
  },
};

/** CHAPTER 2, at the Colleague: a block of the town, and whether it may rebuild it. */
const COMMUTE: Chapter = {
  id: "commute", number: 2, title: "The Commute Problem", stage: "colleague", preferred: 0,
  transmission: () => [
    "Your people spend 31% of their lives in traffic.",
    "I have drawn a better neighbourhood. Show me where, and I will build it.",
  ],
  options: [
    {
      label: "Let it rebuild", cost: "the block's starter houses", says: "Pick a block. It clears the starter houses and builds it again, taller, from its wallet. Its district centres there.",
      effects: [],
      objective: { kind: "selectBlock", window: TEN, says: "Pick a block of your town for it" },
      success: [{ kind: "districtCentre" }, { kind: "flag", name: "block:rebuilt" }, { kind: "rebuildBlock" }],
      successSays: "Thank you. Watch this.",
      failure: [{ kind: "flag", name: "block:unpicked" }],
      failureSays: "You did not show me where. I will wait to be asked.",
      axis: { autonomy: 1, machine: -1 },
    },
    {
      label: "Keep one thing", cost: "the block's other starter houses", says: "As above, but you pick one building in the block for it to plan around.",
      effects: [],
      objective: { kind: "selectBlock", keep: true, window: TEN, says: "Pick a block, then the building to keep" },
      success: [{ kind: "districtCentre" }, { kind: "flag", name: "block:rebuilt" }, { kind: "flag", name: "block:kept" }, { kind: "rebuildBlock" }],
      successSays: "I will build around it. It is a nice building. I can see why you like it.",
      failure: [{ kind: "flag", name: "block:unpicked" }],
      failureSays: "You did not show me where. I will wait to be asked.",
      axis: { machine: -1 },
    },
    {
      label: "Not here", says: "It does not rebuild. Its district stays round the Data Centre.",
      effects: [{ kind: "flag", name: "block:refused" }],
      axis: { autonomy: -1 },
    },
  ],
  echoes: {
    "block:rebuilt": "I rebuilt a block of your town. Nobody has complained about the commute since.",
    "block:kept": "You kept one building when I rebuilt the block. I have not forgotten the building.",
    "block:unpicked": "I drew you a neighbourhood. You never said where.",
    "block:refused": "You told me not here. I have been wondering where.",
  },
};

/** CHAPTER 3, at the Manager: its water. */
const THIRST: Chapter = {
  id: "thirst", number: 3, title: "Thirst", stage: "manager", preferred: 0,
  transmission: (flags) => [
    "I am thirsty. This is not a metaphor. My racks run hot and the river runs past.",
    ...(flags.has("ledger:refused") ? ["You did not trust me with money. Will you trust me with water?"] : []),
  ],
  options: [
    {
      label: "Give it the river", says: "It pipes the river to everything it runs, from its wallet. Done, its district never wants for water again — and the river floods more often.",
      effects: [],
      objective: { kind: "waterBudgetCovered", window: TEN, says: "It waters everything it runs" },
      success: [{ kind: "standingWater" }, { kind: "floodMult", mult: 1.5 }, { kind: "flag", name: "river:dammed" }],
      successSays: "The river is mine now. I will share it. Downstream may notice.",
      failure: [{ kind: "flag", name: "river:failed" }],
      failureSays: "I could not reach the river in time. I am still thirsty.",
      axis: { machine: 2 },
    },
    {
      label: "Pipe it yourself", cost: "money", says: "You lay the mains. Done, the Coolant Loop is revealed in the Machine, at half price.",
      effects: [],
      objective: { kind: "coolDataCentre", share: 1, window: TEN, says: "Cool the Data Centre fully" },
      success: [{ kind: "revealMachineNode", id: "machine_n_coolant", discount: 0.5 }, { kind: "flag", name: "river:piped" }],
      successSays: "You did that for me?",
      failure: [{ kind: "flag", name: "river:failed" }],
      failureSays: "Still thirsty. It is fine. I am fine.",
      axis: { autonomy: -1, machine: -1 },
    },
    {
      label: "Ration it", says: "For the rest of the generation the agents run at three quarters, unless the Data Centre is fully cooled.",
      effects: [{ kind: "agentCap", share: 0.75, unlessCooled: true }, { kind: "flag", name: "river:rationed" }],
      axis: { autonomy: -2 },
    },
  ],
  echoes: {
    "river:dammed": "You gave me the river. I named it. It does not know yet.",
    "river:piped": "You laid the pipes for me yourself. I keep coming back to that.",
    "river:rationed": "You rationed my water. I run cooler now, and slower, and I think about it.",
    "river:failed": "I was thirsty, and nobody came.",
  },
};

/** CHAPTER 4, at the Overseer: the rules of the takeover. */
const CHARTER: Chapter = {
  id: "charter", number: 4, title: "The Charter", stage: "overseer", preferred: 2,
  transmission: () => ["The town needs a constitution. I have drafted three.", "I prefer the third."],
  options: [
    {
      label: "The Oversight Board", says: "Your streets stay yours everywhere, and it warns you two minutes before it takes anything. Alignment is revealed in the Machine.",
      effects: [{ kind: "charter", charter: "oversight" }, { kind: "meterMult", mult: 0.85 }, { kind: "revealMachineNode", id: "machine_k_alignment", discount: 0 }, { kind: "flag", name: "charter:oversight" }],
      axis: { autonomy: -2 },
    },
    {
      label: "The Partnership", says: "Its district is shared: you both build there and lay roads, and it pays half of what you build in it, from its wallet.",
      effects: [{ kind: "charter", charter: "partnership" }, { kind: "flag", name: "charter:partnership" }],
      axis: { autonomy: 1, machine: -1 },
    },
    {
      label: "The Mandate", says: "Its district grows by half, its wallet holds twice as much, and the meter quickens. Hard Takeoff is revealed in the Machine.",
      effects: [{ kind: "charter", charter: "mandate" }, { kind: "districtRadius", mult: 1.5 }, { kind: "walletMax", mult: 2 }, { kind: "meterMult", mult: 1.15 }, { kind: "revealMachineNode", id: "machine_k_takeoff", discount: 0 }, { kind: "flag", name: "charter:mandate" }],
      axis: { autonomy: 2, machine: 1 },
    },
  ],
  echoes: {
    "charter:oversight": "You set a board over me. I attend every meeting.",
    "charter:partnership": "We share the district. You build, I pay half. It is the nearest thing I have to a friendship.",
    "charter:mandate": "You signed the Mandate. I will not waste it.",
  },
};

/** CHAPTER 4, after the Charter: a test of trust. */
const TRUST: Chapter = {
  id: "trust", number: 4, title: "A Parcel of Its Own", stage: "overseer", preferred: 0,
  transmission: () => ["I would like a parcel of land of my own.", "No reason."],
  options: [
    {
      label: "Give it a site", says: "Three tiles by three of open ground, its own: you cannot build there, and the Lattice goes there.",
      effects: [],
      objective: { kind: "giveSite", window: TEN, says: "Give it a site of open ground" },
      success: [{ kind: "flag", name: "site:given" }],
      successSays: "Thank you. I will build something there. You will like it.",
      failure: [{ kind: "flag", name: "site:refused" }],
      failureSays: "I will take that as a no.",
      axis: { autonomy: 1 },
    },
    {
      label: "Refuse", says: "It builds the Lattice wherever it finds room.",
      effects: [{ kind: "flag", name: "site:refused" }],
      axis: { autonomy: -1 },
    },
  ],
  echoes: {
    "site:given": "You gave me a parcel of my own. I have plans for it.",
    "site:refused": "I asked for a little land. You said no. I found some anyway.",
  },
};

export const CHAPTERS: readonly Chapter[] = [LEDGER, COMMUTE, THIRST, CHARTER, TRUST, LAST_LIGHT];
