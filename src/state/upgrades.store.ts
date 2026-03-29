import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import {
  GeneratorId,
  MIN_GENERATOR_COST_EXPONENT,
  useGeneratorStore,
} from "./generators.store";
import { useMoneyStore } from "./money.store";

export type UnlockCondition = {
  requiredId: GeneratorId;
  requiredAmount: number;
};

const UPGRADE_PERSIST_KEY = "unlockedUpgrades";

const upgradesLegacyStorage: StateStorage = {
  getItem: (name) => {
    const raw = localStorage.getItem(name);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return JSON.stringify({
          state: { unlockedUpgradeIds: parsed as string[] },
          version: 0,
        });
      }
    } catch {
      return null;
    }
    return raw;
  },
  setItem: (name, value) => localStorage.setItem(name, value),
  removeItem: (name) => localStorage.removeItem(name),
};

export type GeneratorEffect =
  | { type: "multiplier"; value: number }
  | { type: "costMultiplier"; value: number }
  | { type: "costExponent"; delta: number };

export type Upgrade = {
  id: string;
  abbreviation?: string;
  name: string;
  description: string;
  unlockConditions: UnlockCondition[];
  effects: { genId: GeneratorId; changes: GeneratorEffect[] }[];
  cost: number;
};

const INTERN_UPGRADES: Upgrade[] = [
  {
    id: "intern_upgrade_1",
    abbreviation: "IN1",
    name: "Micromanagement",
    description:
      "Micromanage your interns harder. Weekly 1-1s will improve morale and productivity (you think).",
    unlockConditions: [{ requiredId: "intern", requiredAmount: 15 }],
    effects: [
      {
        genId: "intern",
        changes: [{ type: "multiplier", value: 1.5 }],
      },
    ],
    cost: 400,
  },
  {
    id: "intern_upgrade_2",
    abbreviation: "IN2",
    name: "Mandatory Weekend Work",
    description:
      "Threaten your interns with violence if they don't work weekends.",
    unlockConditions: [{ requiredId: "intern", requiredAmount: 25 }],
    effects: [
      {
        genId: "intern",
        changes: [{ type: "multiplier", value: 2 }],
      },
    ],
    cost: 2200,
  },
  {
    id: "intern_cost_1",
    abbreviation: "IN3",
    name: "Free Prospecting",
    description: "Force applicants to do a week of work for free, profit.",
    unlockConditions: [{ requiredId: "intern", requiredAmount: 35 }],
    effects: [
      {
        genId: "intern",
        changes: [
          { type: "costMultiplier", value: 0.1 },
          { type: "multiplier", value: 1.5 },
        ],
      },
    ],
    cost: 5000,
  },
  {
    id: "intern_upgrade_3",
    abbreviation: "IN4",
    name: "Promotion Griefing",
    description:
      "Promise your interns promotions, but in reality just burn them out faster.",
    unlockConditions: [{ requiredId: "intern", requiredAmount: 50 }],
    effects: [
      {
        genId: "intern",
        changes: [{ type: "multiplier", value: 2 }],
      },
    ],
    cost: 10000,
  },
  {
    id: "intern_cost_exponent_1",
    abbreviation: "IN5",
    name: "Homeless Interns",
    description: "Start hiring homeless streetrats. They're cheaper.",
    unlockConditions: [{ requiredId: "intern", requiredAmount: 75 }],
    effects: [
      {
        genId: "intern",
        changes: [
          { type: "costExponent", delta: -0.02 },
          { type: "multiplier", value: 1.3 },
        ],
      },
    ],
    cost: 80000,
  },
  {
    id: "intern_hybrid_upgrade_1",
    abbreviation: "IN6",
    name: "Upward Management",
    description: "The interns think they know everything now, maybe they do?!",
    unlockConditions: [
      { requiredId: "intern", requiredAmount: 100 },
      { requiredId: "vibe_coder", requiredAmount: 35 },
    ],
    effects: [
      {
        genId: "intern",
        changes: [{ type: "costExponent", delta: -0.04 }],
      },
      {
        genId: "vibe_coder",
        changes: [
          { type: "costExponent", delta: -0.02 },
          { type: "multiplier", value: 2 },
        ],
      },
    ],
    cost: 2e5,
  },
  {
    id: "intern_upgrade_4",
    abbreviation: "IN7",
    name: "Unions",
    description: "The interns are unionising. This is a blessing in disguise.",
    unlockConditions: [{ requiredId: "intern", requiredAmount: 150 }],
    effects: [
      {
        genId: "intern",
        changes: [
          { type: "costExponent", delta: 0.1 },
          { type: "multiplier", value: 10 },
        ],
      },
    ],
    cost: 5e6,
  },
  {
    id: "intern_hybrid_upgrade_2",
    abbreviation: "IN8",
    name: "Vape Mentorships",
    description:
      "The vape gods have teamed up with the interns to teach them some tricks.",
    unlockConditions: [
      { requiredId: "intern", requiredAmount: 150 },
      { requiredId: "vibe_coder", requiredAmount: 75 },
    ],
    effects: [
      {
        genId: "intern",
        changes: [
          { type: "costExponent", delta: -0.05 },
          { type: "multiplier", value: 5 },
        ],
      },
      {
        genId: "vibe_coder",
        changes: [
          { type: "costExponent", delta: -0.05 },
          { type: "multiplier", value: 5 },
        ],
      },
    ],
    cost: 1e7,
  },
];

const INTERN_LATE_UPGRADES: Upgrade[] = [
  {
    id: "intern_upgrade_5",
    abbreviation: "IN9",
    name: "Infinite Coffee Subsidy",
    description:
      "You discovered interns run on cold brew. Corner the wholesale bean market.",
    unlockConditions: [{ requiredId: "intern", requiredAmount: 200 }],
    effects: [
      {
        genId: "intern",
        changes: [
          { type: "multiplier", value: 4 },
          { type: "costExponent", delta: -0.03 },
        ],
      },
    ],
    cost: 2.5e8,
  },
  {
    id: "intern_cost_2",
    abbreviation: "IN10",
    name: "LinkedOut Pipeline",
    description:
      "Scrape every bootcamp graduate on earth. Consent is a social construct.",
    unlockConditions: [{ requiredId: "intern", requiredAmount: 275 }],
    effects: [
      {
        genId: "intern",
        changes: [
          { type: "costMultiplier", value: 0.35 },
          { type: "multiplier", value: 2.5 },
        ],
      },
    ],
    cost: 8e8,
  },
  {
    id: "intern_upgrade_6",
    abbreviation: "IN11",
    name: "Intern IPO",
    description:
      "Each intern gets phantom equity. Legally meaningless, emotionally devastating.",
    unlockConditions: [{ requiredId: "intern", requiredAmount: 400 }],
    effects: [
      {
        genId: "intern",
        changes: [{ type: "multiplier", value: 6 }],
      },
    ],
    cost: 3e9,
  },
  {
    id: "intern_cost_exponent_2",
    abbreviation: "IN12",
    name: "Offshore Unpaid Trial",
    description:
      "Time zones make labor law someone else's problem. Your lawyer said 'interesting'.",
    unlockConditions: [{ requiredId: "intern", requiredAmount: 550 }],
    effects: [
      {
        genId: "intern",
        changes: [
          { type: "costExponent", delta: -0.06 },
          { type: "multiplier", value: 3 },
        ],
      },
    ],
    cost: 1.2e10,
  },
  {
    id: "intern_upgrade_7",
    abbreviation: "IN13",
    name: "Cult of the Standup",
    description:
      "Daily standups now last four hours. Velocity metrics look incredible on slides.",
    unlockConditions: [{ requiredId: "intern", requiredAmount: 750 }],
    effects: [
      {
        genId: "intern",
        changes: [
          { type: "multiplier", value: 12 },
          { type: "costExponent", delta: 0.03 },
        ],
      },
    ],
    cost: 5e10,
  },
  {
    id: "intern_upgrade_8",
    abbreviation: "IN14",
    name: "Intern Singularity",
    description:
      "There are more interns than atoms in this building. HR stopped answering.",
    unlockConditions: [{ requiredId: "intern", requiredAmount: 1000 }],
    effects: [
      {
        genId: "intern",
        changes: [
          { type: "multiplier", value: 15 },
          { type: "costMultiplier", value: 0.5 },
        ],
      },
    ],
    cost: 2e11,
  },
  {
    id: "intern_upgrade_9",
    abbreviation: "IN15",
    name: "Legacy Code Sacrifice",
    description:
      "Interns maintain a COBOL monolith nobody understands. Productivity is unknowable.",
    unlockConditions: [{ requiredId: "intern", requiredAmount: 1500 }],
    effects: [
      {
        genId: "intern",
        changes: [
          { type: "multiplier", value: 20 },
          { type: "costExponent", delta: -0.04 },
        ],
      },
    ],
    cost: 8e11,
  },
  {
    id: "intern_upgrade_10",
    abbreviation: "IN16",
    name: "The Eternal Intern",
    description:
      "Tenure is a myth. The backlog is forever. You have achieved lean immortality.",
    unlockConditions: [{ requiredId: "intern", requiredAmount: 2500 }],
    effects: [
      {
        genId: "intern",
        changes: [
          { type: "multiplier", value: 25 },
          { type: "costExponent", delta: -0.05 },
          { type: "costMultiplier", value: 0.55 },
        ],
      },
    ],
    cost: 4e12,
  },
];

const VIBE_CODER_UPGRADES: Upgrade[] = [
  {
    id: "vibe_coder_upgrade_1",
    abbreviation: "V1",
    name: "Focus Vibing",
    description:
      "Someone tweeted about a new breathing focus LLM. The AI slop factory becomes more efficient.",
    unlockConditions: [{ requiredId: "vibe_coder", requiredAmount: 10 }],
    effects: [
      {
        genId: "vibe_coder",
        changes: [{ type: "multiplier", value: 1.8 }],
      },
    ],
    cost: 7500,
  },
  {
    id: "vibe_coder_upgrade_2",
    abbreviation: "V2",
    name: "JUULing",
    description:
      "You let the zoomers use their vapes in the office, they are happy.",
    unlockConditions: [{ requiredId: "vibe_coder", requiredAmount: 20 }],
    effects: [
      {
        genId: "vibe_coder",
        changes: [{ type: "multiplier", value: 3 }],
      },
    ],
    cost: 30000,
  },
  {
    id: "vibe_coder_cost_1",
    abbreviation: "V3",
    name: "Slop Bargaining",
    description:
      "Sloppers get cheaper the more of them you hire. This might not end well though.",
    unlockConditions: [{ requiredId: "vibe_coder", requiredAmount: 30 }],
    effects: [
      {
        genId: "vibe_coder",
        changes: [{ type: "costMultiplier", value: 0.15 }],
      },
    ],
    cost: 100000,
  },
  {
    id: "vibe_coder_cost_exponent_1",
    abbreviation: "V4",
    name: "Intern Promotion",
    description:
      "You promise the interns LLM code editors. They are willing to take a paycut.",
    unlockConditions: [{ requiredId: "vibe_coder", requiredAmount: 40 }],
    effects: [
      {
        genId: "vibe_coder",
        changes: [
          { type: "costExponent", delta: -0.05 },
          { type: "costMultiplier", value: 0.6 },
          { type: "multiplier", value: 2 },
        ],
      },
    ],
    cost: 2e5,
  },
  {
    id: "vibe_coder_upgrade_3",
    abbreviation: "V5",
    name: "Pure Vibing",
    description:
      "You open a new office purely for the vibers. Vape dispensers, unlimited GPT tokens, they are going crazy.",
    unlockConditions: [{ requiredId: "vibe_coder", requiredAmount: 60 }],
    effects: [
      {
        genId: "vibe_coder",
        changes: [{ type: "multiplier", value: 3 }],
      },
    ],
    cost: 5e5,
  },
  {
    id: "vibe_coder_upgrade_4",
    abbreviation: "V6",
    name: "Existential Imposter Syndrome",
    description:
      "The vibers have started to realise that AI can't actually write code. What now?",
    unlockConditions: [{ requiredId: "vibe_coder", requiredAmount: 70 }],
    effects: [
      {
        genId: "vibe_coder",
        changes: [
          { type: "costExponent", delta: 0.05 },
          { type: "multiplier", value: 8 },
        ],
      },
    ],
    cost: 1e6,
  },
];

const VIBE_LATE_UPGRADES: Upgrade[] = [
  {
    id: "vibe_coder_upgrade_5",
    abbreviation: "V7",
    name: "Vibe IPO Roadshow",
    description:
      "Investors only ask about AI. You only answer in LinkedIn poetry. Valuation up.",
    unlockConditions: [{ requiredId: "vibe_coder", requiredAmount: 85 }],
    effects: [
      {
        genId: "vibe_coder",
        changes: [
          { type: "multiplier", value: 4 },
          { type: "costExponent", delta: -0.03 },
        ],
      },
    ],
    cost: 4e7,
  },
  {
    id: "vibe_coder_cost_2",
    abbreviation: "V8",
    name: "Prompt Engineer Guild Dues",
    description:
      "Mandatory certifications in 'asking nicely'. The certificate is a PNG.",
    unlockConditions: [{ requiredId: "vibe_coder", requiredAmount: 100 }],
    effects: [
      {
        genId: "vibe_coder",
        changes: [
          { type: "costMultiplier", value: 0.25 },
          { type: "multiplier", value: 2 },
        ],
      },
    ],
    cost: 1.2e8,
  },
  {
    id: "vibe_coder_upgrade_6",
    abbreviation: "V9",
    name: "Hallucination As Feature",
    description:
      "Ship the bug. Call it emergent behavior. Charge enterprise for 'creativity mode'.",
    unlockConditions: [{ requiredId: "vibe_coder", requiredAmount: 120 }],
    effects: [
      {
        genId: "vibe_coder",
        changes: [{ type: "multiplier", value: 5 }],
      },
    ],
    cost: 4e8,
  },
  {
    id: "vibe_coder_cost_exponent_2",
    abbreviation: "V10",
    name: "Copilot Tax Haven",
    description:
      "Expense every token as R&D. The IRS sends a thinking emoji.",
    unlockConditions: [{ requiredId: "vibe_coder", requiredAmount: 150 }],
    effects: [
      {
        genId: "vibe_coder",
        changes: [
          { type: "costExponent", delta: -0.07 },
          { type: "multiplier", value: 3 },
        ],
      },
    ],
    cost: 1.5e9,
  },
  {
    id: "vibe_coder_upgrade_7",
    abbreviation: "V11",
    name: "Vibeocracy",
    description:
      "Engineering decisions are now decided by Spotify wrapped and moon phase.",
    unlockConditions: [{ requiredId: "vibe_coder", requiredAmount: 200 }],
    effects: [
      {
        genId: "vibe_coder",
        changes: [
          { type: "multiplier", value: 8 },
          { type: "costExponent", delta: 0.04 },
        ],
      },
    ],
    cost: 6e9,
  },
  {
    id: "vibe_coder_upgrade_8",
    abbreviation: "V12",
    name: "Stack Overflow Is The Product",
    description:
      "You monetize copy-paste. Lawyers say we're in uncharted water. You say 'ship it'.",
    unlockConditions: [{ requiredId: "vibe_coder", requiredAmount: 280 }],
    effects: [
      {
        genId: "vibe_coder",
        changes: [
          { type: "multiplier", value: 10 },
          { type: "costMultiplier", value: 0.45 },
        ],
      },
    ],
    cost: 2.5e10,
  },
  {
    id: "vibe_coder_upgrade_9",
    abbreviation: "V13",
    name: "AI-Native Bloodline",
    description:
      "Every new hire must prove ancestry from a fork of Copilot. HR uses git blame.",
    unlockConditions: [{ requiredId: "vibe_coder", requiredAmount: 400 }],
    effects: [
      {
        genId: "vibe_coder",
        changes: [
          { type: "multiplier", value: 14 },
          { type: "costExponent", delta: -0.05 },
        ],
      },
    ],
    cost: 1e11,
  },
  {
    id: "vibe_coder_upgrade_10",
    abbreviation: "V14",
    name: "SLOP.EXE",
    description:
      "Your codebase is 40% comments that say 'TODO: fix before demo'. Demos never end.",
    unlockConditions: [{ requiredId: "vibe_coder", requiredAmount: 600 }],
    effects: [
      {
        genId: "vibe_coder",
        changes: [
          { type: "multiplier", value: 18 },
          { type: "costMultiplier", value: 0.4 },
        ],
      },
    ],
    cost: 5e11,
  },
  {
    id: "vibe_coder_upgrade_11",
    abbreviation: "V15",
    name: "The Final Prompt",
    description:
      "One mega-prompt runs the company. It asked for a raise. You couldn't refuse.",
    unlockConditions: [{ requiredId: "vibe_coder", requiredAmount: 900 }],
    effects: [
      {
        genId: "vibe_coder",
        changes: [
          { type: "multiplier", value: 22 },
          { type: "costExponent", delta: -0.06 },
        ],
      },
    ],
    cost: 2e12,
  },
  {
    id: "vibe_coder_upgrade_12",
    abbreviation: "V16",
    name: "Post-Code Society",
    description:
      "Nobody writes syntax anymore. Everyone vibes in parallel realities. Revenue doubles.",
    unlockConditions: [{ requiredId: "vibe_coder", requiredAmount: 1200 }],
    effects: [
      {
        genId: "vibe_coder",
        changes: [
          { type: "multiplier", value: 30 },
          { type: "costExponent", delta: -0.04 },
          { type: "costMultiplier", value: 0.5 },
        ],
      },
    ],
    cost: 1e13,
  },
];

const TEN_X_ENGINEER_UPGRADES: Upgrade[] = [
  {
    id: "10x_dev_10x_1",
    abbreviation: "10x1",
    name: "10x Engineering",
    description:
      "Instead of arguing with the AI sloppers all day, your 10x devs actually start 10xing.",
    unlockConditions: [{ requiredId: "10x_dev", requiredAmount: 3 }],
    effects: [
      {
        genId: "10x_dev",
        changes: [{ type: "multiplier", value: 10 }],
      },
    ],
    cost: 2e5,
  },
  {
    id: "10x_dev_10x_2",
    abbreviation: "10x2",
    name: "10x10x Engineering",
    description: "Your 10x engineers begin to see the matrix...",
    unlockConditions: [{ requiredId: "10x_dev", requiredAmount: 4 }],
    effects: [
      {
        genId: "10x_dev",
        changes: [{ type: "multiplier", value: 10 }],
      },
    ],
    cost: 3e6,
  },
  {
    id: "10x_dev_10x_3",
    abbreviation: "10x3",
    name: "Ascendent Engineering",
    description: "DECONSTRUCTING VISUAL PARAMETERS",
    unlockConditions: [{ requiredId: "10x_dev", requiredAmount: 5 }],
    effects: [
      {
        genId: "intern",
        changes: [{ type: "multiplier", value: 10 }],
      },
      {
        genId: "vibe_coder",
        changes: [{ type: "multiplier", value: 10 }],
      },
      {
        genId: "10x_dev",
        changes: [{ type: "multiplier", value: 10 }],
      },
    ],
    cost: 2e7,
  },
];

const TEN_X_LATE_UPGRADES: Upgrade[] = [
  {
    id: "10x_dev_10x_4",
    abbreviation: "10x4",
    name: "Rewrite In Rust (Again)",
    description:
      "The fifth rewrite finally feels correct. The sixth one starts Monday.",
    unlockConditions: [{ requiredId: "10x_dev", requiredAmount: 6 }],
    effects: [
      {
        genId: "10x_dev",
        changes: [
          { type: "multiplier", value: 8 },
          { type: "costExponent", delta: -0.02 },
        ],
      },
    ],
    cost: 8e7,
  },
  {
    id: "10x_dev_cost_1",
    abbreviation: "10x5",
    name: "Staff Engineer Cartel",
    description:
      "They fixed hiring. You fixed salaries downward. Everyone pretends it's merit.",
    unlockConditions: [{ requiredId: "10x_dev", requiredAmount: 8 }],
    effects: [
      {
        genId: "10x_dev",
        changes: [
          { type: "costMultiplier", value: 0.3 },
          { type: "multiplier", value: 5 },
        ],
      },
    ],
    cost: 3e8,
  },
  {
    id: "10x_dev_10x_5",
    abbreviation: "10x6",
    name: "Blameless Postmortem Cult",
    description:
      "Nothing is anyone's fault. Incidents are growth. Outages are brand.",
    unlockConditions: [{ requiredId: "10x_dev", requiredAmount: 10 }],
    effects: [
      {
        genId: "10x_dev",
        changes: [{ type: "multiplier", value: 12 }],
      },
    ],
    cost: 1.2e9,
  },
  {
    id: "10x_dev_cost_exponent_1",
    abbreviation: "10x7",
    name: "Kubernetes Of The Soul",
    description:
      "Every engineer runs three clusters in their head. You bill clients per pod of trauma.",
    unlockConditions: [{ requiredId: "10x_dev", requiredAmount: 14 }],
    effects: [
      {
        genId: "10x_dev",
        changes: [
          { type: "costExponent", delta: -0.08 },
          { type: "multiplier", value: 6 },
        ],
      },
    ],
    cost: 5e9,
  },
  {
    id: "10x_dev_10x_6",
    abbreviation: "10x8",
    name: "SRE Overture",
    description:
      "PagerDuty is the metronome. Sleep is technical debt. You pay it never.",
    unlockConditions: [{ requiredId: "10x_dev", requiredAmount: 18 }],
    effects: [
      {
        genId: "10x_dev",
        changes: [
          { type: "multiplier", value: 15 },
          { type: "costExponent", delta: 0.03 },
        ],
      },
    ],
    cost: 2e10,
  },
  {
    id: "10x_dev_10x_7",
    abbreviation: "10x9",
    name: "Distributed Consensus On Lunch",
    description:
      "Raft elected a sandwich. The sandwich won by quorum. Morale improved.",
    unlockConditions: [{ requiredId: "10x_dev", requiredAmount: 25 }],
    effects: [
      {
        genId: "10x_dev",
        changes: [
          { type: "multiplier", value: 18 },
          { type: "costMultiplier", value: 0.4 },
        ],
      },
    ],
    cost: 9e10,
  },
  {
    id: "10x_dev_10x_8",
    abbreviation: "10x10",
    name: "Meta-10x",
    description:
      "Each 10x engineer mentors ten 1x engineers who become 0.1x. Math checks out.",
    unlockConditions: [{ requiredId: "10x_dev", requiredAmount: 35 }],
    effects: [
      {
        genId: "10x_dev",
        changes: [
          { type: "multiplier", value: 25 },
          { type: "costExponent", delta: -0.05 },
        ],
      },
    ],
    cost: 4e11,
  },
  {
    id: "10x_dev_10x_9",
    abbreviation: "10x11",
    name: "The Monolith Strikes Back",
    description:
      "You deleted microservices. The monolith thanked you in compile errors.",
    unlockConditions: [{ requiredId: "10x_dev", requiredAmount: 50 }],
    effects: [
      {
        genId: "10x_dev",
        changes: [
          { type: "multiplier", value: 35 },
          { type: "costMultiplier", value: 0.35 },
        ],
      },
    ],
    cost: 2e12,
  },
  {
    id: "10x_dev_10x_10",
    abbreviation: "10x12",
    name: "Latency Arbitrage",
    description:
      "You moved the datacenter next to the stock exchange. Physics owes you money.",
    unlockConditions: [{ requiredId: "10x_dev", requiredAmount: 70 }],
    effects: [
      {
        genId: "10x_dev",
        changes: [
          { type: "multiplier", value: 45 },
          { type: "costExponent", delta: -0.06 },
        ],
      },
    ],
    cost: 9e12,
  },
  {
    id: "10x_dev_10x_11",
    abbreviation: "10x13",
    name: "Staff+ Singularity",
    description:
      "Promotion packets are measured in tons. The ladder is a helix. You are the axis.",
    unlockConditions: [{ requiredId: "10x_dev", requiredAmount: 100 }],
    effects: [
      {
        genId: "10x_dev",
        changes: [
          { type: "multiplier", value: 60 },
          { type: "costExponent", delta: -0.04 },
          { type: "costMultiplier", value: 0.45 },
        ],
      },
    ],
    cost: 5e13,
  },
  {
    id: "10x_dev_10x_12",
    abbreviation: "10x14",
    name: "Exit Velocity",
    description:
      "Engineering is a rocket. You are the fuel. The payload is vibes and EBITDA.",
    unlockConditions: [{ requiredId: "10x_dev", requiredAmount: 150 }],
    effects: [
      {
        genId: "10x_dev",
        changes: [
          { type: "multiplier", value: 80 },
          { type: "costExponent", delta: -0.05 },
        ],
      },
    ],
    cost: 2.5e14,
  },
  {
    id: "10x_dev_10x_13",
    abbreviation: "10x15",
    name: "The Last Commit",
    description:
      "There is no main branch anymore. Only main reality. You merged production with destiny.",
    unlockConditions: [{ requiredId: "10x_dev", requiredAmount: 250 }],
    effects: [
      {
        genId: "10x_dev",
        changes: [
          { type: "multiplier", value: 100 },
          { type: "costExponent", delta: -0.06 },
          { type: "costMultiplier", value: 0.4 },
        ],
      },
    ],
    cost: 1.5e15,
  },
];

const CROSS_LATE_UPGRADES: Upgrade[] = [
  {
    id: "cross_late_pyramid",
    abbreviation: "XL1",
    name: "Human Pyramid OKR",
    description:
      "Interns form the base, vibers the middle, 10x on top. Quarterly photo crushes LinkedIn.",
    unlockConditions: [
      { requiredId: "intern", requiredAmount: 300 },
      { requiredId: "vibe_coder", requiredAmount: 100 },
      { requiredId: "10x_dev", requiredAmount: 12 },
    ],
    effects: [
      {
        genId: "intern",
        changes: [{ type: "multiplier", value: 5 }],
      },
      {
        genId: "vibe_coder",
        changes: [{ type: "multiplier", value: 5 }],
      },
      {
        genId: "10x_dev",
        changes: [{ type: "multiplier", value: 5 }],
      },
    ],
    cost: 5e9,
  },
  {
    id: "cross_late_all_hands",
    abbreviation: "XL2",
    name: "Mandatory Fun Budget",
    description:
      "Team-building that scales. Trust falls are now load-tested in staging.",
    unlockConditions: [
      { requiredId: "intern", requiredAmount: 500 },
      { requiredId: "vibe_coder", requiredAmount: 180 },
      { requiredId: "10x_dev", requiredAmount: 20 },
    ],
    effects: [
      {
        genId: "intern",
        changes: [
          { type: "multiplier", value: 6 },
          { type: "costExponent", delta: -0.03 },
        ],
      },
      {
        genId: "vibe_coder",
        changes: [
          { type: "multiplier", value: 6 },
          { type: "costExponent", delta: -0.03 },
        ],
      },
      {
        genId: "10x_dev",
        changes: [
          { type: "multiplier", value: 6 },
          { type: "costExponent", delta: -0.03 },
        ],
      },
    ],
    cost: 3e10,
  },
  {
    id: "cross_late_platform",
    abbreviation: "XL3",
    name: "Internal Platform As Punishment",
    description:
      "Everyone must use the platform. The platform is held together by interns and prayer.",
    unlockConditions: [
      { requiredId: "intern", requiredAmount: 800 },
      { requiredId: "vibe_coder", requiredAmount: 350 },
      { requiredId: "10x_dev", requiredAmount: 40 },
    ],
    effects: [
      {
        genId: "intern",
        changes: [
          { type: "multiplier", value: 8 },
          { type: "costMultiplier", value: 0.55 },
        ],
      },
      {
        genId: "vibe_coder",
        changes: [
          { type: "multiplier", value: 8 },
          { type: "costMultiplier", value: 0.55 },
        ],
      },
      {
        genId: "10x_dev",
        changes: [
          { type: "multiplier", value: 8 },
          { type: "costMultiplier", value: 0.55 },
        ],
      },
    ],
    cost: 2e11,
  },
  {
    id: "cross_late_acqui",
    abbreviation: "XL4",
    name: "Acquihire The Universe",
    description:
      "You bought a competitor for the talent. The product was a PowerPoint. Worth it.",
    unlockConditions: [
      { requiredId: "intern", requiredAmount: 1200 },
      { requiredId: "vibe_coder", requiredAmount: 500 },
      { requiredId: "10x_dev", requiredAmount: 60 },
    ],
    effects: [
      {
        genId: "intern",
        changes: [{ type: "multiplier", value: 12 }],
      },
      {
        genId: "vibe_coder",
        changes: [{ type: "multiplier", value: 12 }],
      },
      {
        genId: "10x_dev",
        changes: [{ type: "multiplier", value: 12 }],
      },
    ],
    cost: 1.2e12,
  },
  {
    id: "cross_late_reality",
    abbreviation: "XL5",
    name: "Reality 2.0 Rollout",
    description:
      "Feature flag for physics. Staged rollout: interns first, then Earth.",
    unlockConditions: [
      { requiredId: "intern", requiredAmount: 1800 },
      { requiredId: "vibe_coder", requiredAmount: 700 },
      { requiredId: "10x_dev", requiredAmount: 90 },
    ],
    effects: [
      {
        genId: "intern",
        changes: [
          { type: "multiplier", value: 15 },
          { type: "costExponent", delta: -0.04 },
        ],
      },
      {
        genId: "vibe_coder",
        changes: [
          { type: "multiplier", value: 15 },
          { type: "costExponent", delta: -0.04 },
        ],
      },
      {
        genId: "10x_dev",
        changes: [
          { type: "multiplier", value: 15 },
          { type: "costExponent", delta: -0.04 },
        ],
      },
    ],
    cost: 8e12,
  },
  {
    id: "cross_late_board",
    abbreviation: "XL6",
    name: "Board Deck Singularity",
    description:
      "Every slide is a lie everyone believes. The cap table is a fractal. You win.",
    unlockConditions: [
      { requiredId: "intern", requiredAmount: 2500 },
      { requiredId: "vibe_coder", requiredAmount: 1000 },
      { requiredId: "10x_dev", requiredAmount: 120 },
    ],
    effects: [
      {
        genId: "intern",
        changes: [
          { type: "multiplier", value: 20 },
          { type: "costMultiplier", value: 0.5 },
        ],
      },
      {
        genId: "vibe_coder",
        changes: [
          { type: "multiplier", value: 20 },
          { type: "costMultiplier", value: 0.5 },
        ],
      },
      {
        genId: "10x_dev",
        changes: [
          { type: "multiplier", value: 20 },
          { type: "costMultiplier", value: 0.5 },
        ],
      },
    ],
    cost: 5e13,
  },
  {
    id: "cross_late_endgame",
    abbreviation: "XL7",
    name: "Startup Idle IRL",
    description:
      "The game was a tutorial. The idle loop is society. Congratulations, founder.",
    unlockConditions: [
      { requiredId: "intern", requiredAmount: 4000 },
      { requiredId: "vibe_coder", requiredAmount: 1500 },
      { requiredId: "10x_dev", requiredAmount: 200 },
    ],
    effects: [
      {
        genId: "intern",
        changes: [
          { type: "multiplier", value: 50 },
          { type: "costExponent", delta: -0.05 },
          { type: "costMultiplier", value: 0.45 },
        ],
      },
      {
        genId: "vibe_coder",
        changes: [
          { type: "multiplier", value: 50 },
          { type: "costExponent", delta: -0.05 },
          { type: "costMultiplier", value: 0.45 },
        ],
      },
      {
        genId: "10x_dev",
        changes: [
          { type: "multiplier", value: 50 },
          { type: "costExponent", delta: -0.05 },
          { type: "costMultiplier", value: 0.45 },
        ],
      },
    ],
    cost: 5e14,
  },
];

/** Main-line upgrades only (excludes late-game and cross-tier megas); used for progression simulations. */
export const UPGRADES_CORE: Upgrade[] = [
  ...INTERN_UPGRADES,
  ...VIBE_CODER_UPGRADES,
  ...TEN_X_ENGINEER_UPGRADES,
];

export const UPGRADES: Upgrade[] = [
  ...UPGRADES_CORE,
  ...INTERN_LATE_UPGRADES,
  ...VIBE_LATE_UPGRADES,
  ...TEN_X_LATE_UPGRADES,
  ...CROSS_LATE_UPGRADES,
];

const unlockedUpgradesFromIds = (ids: string[]): Upgrade[] =>
  UPGRADES.filter((u) => ids.includes(u.id));

export const applyUpgradeEffect = (upgrade: Upgrade) => {
  const state = useGeneratorStore.getState();

  const updated = state.generators.map((gen) => {
    // Find all effects that apply to this generator
    const applicableEffects = upgrade.effects.filter(
      (effect) => effect.genId === gen.id
    );
    if (applicableEffects.length === 0) return gen;

    // Clone generator before applying changes
    const updatedGen = { ...gen };

    // Apply each set of changes
    for (const effect of applicableEffects) {
      for (const change of effect.changes) {
        switch (change.type) {
          case "multiplier":
            updatedGen.multiplier *= change.value;
            break;
          case "costMultiplier":
            updatedGen.costMultiplier *= change.value;
            break;
          case "costExponent":
            updatedGen.costExponent += change.delta;
            break;
        }
      }
    }

    updatedGen.costExponent = Math.max(
      MIN_GENERATOR_COST_EXPONENT,
      updatedGen.costExponent
    );

    return updatedGen;
  });

  useGeneratorStore.setState({ generators: updated });
};

export const syncAvailableUpgrades = () => {
  const ownedMap = Object.fromEntries(
    useGeneratorStore.getState().generators.map((g) => [g.id, g.amount])
  );

  const unlockedIds = useUpgradeStore.getState().unlockedUpgradeIds;

  const available = UPGRADES.filter((upg) => {
    const satisfied = upg.unlockConditions.every((cond) => {
      const owned = ownedMap[cond.requiredId] ?? 0;
      return owned >= cond.requiredAmount;
    });
    return satisfied && !unlockedIds.includes(upg.id);
  }).sort((a, b) => a.cost - b.cost);

  useUpgradeStore.setState({ availableUpgrades: available });
};

type UpgradeStoreState = {
  unlockedUpgradeIds: string[];
  unlockedUpgrades: Upgrade[];
  availableUpgrades: Upgrade[];
  unlockUpgrade: (id: string) => void;
  reset: () => void;
};

export const useUpgradeStore = create<UpgradeStoreState>()(
  persist(
    (set, get) => ({
      unlockedUpgradeIds: [],
      unlockedUpgrades: [],
      availableUpgrades: [],
      unlockUpgrade: (id: string) => {
        const moneyState = useMoneyStore.getState();
        const upgrade = UPGRADES.find((u) => u.id === id);
        if (!upgrade) return;

        if (get().unlockedUpgradeIds.includes(id)) return;

        if (moneyState.money.toNumber() >= upgrade.cost) {
          moneyState.spendMoney(upgrade.cost);
          applyUpgradeEffect(upgrade);

          const newIds = [...get().unlockedUpgradeIds, id];
          set({
            unlockedUpgradeIds: newIds,
            unlockedUpgrades: unlockedUpgradesFromIds(newIds),
          });
          syncAvailableUpgrades();
        }
      },
      reset: () => {
        set({
          unlockedUpgradeIds: [],
          unlockedUpgrades: [],
          availableUpgrades: [],
        });
        useUpgradeStore.persist.clearStorage();
      },
    }),
    {
      name: UPGRADE_PERSIST_KEY,
      storage: createJSONStorage(() => upgradesLegacyStorage),
      partialize: (state) => ({
        unlockedUpgradeIds: state.unlockedUpgradeIds,
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<Pick<UpgradeStoreState, "unlockedUpgradeIds">> | null;
        const ids = p?.unlockedUpgradeIds ?? [];
        return {
          ...current,
          ...p,
          unlockedUpgradeIds: ids,
          unlockedUpgrades: unlockedUpgradesFromIds(ids),
        };
      },
    }
  )
);
