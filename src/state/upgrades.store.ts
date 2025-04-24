import { create } from "zustand";
import { GeneratorId, useGeneratorStore } from "./generators.store";
import { useMoneyStore } from "./money.store";

export type UnlockCondition = {
  requiredId: GeneratorId;
  requiredAmount: number;
};

const LOCAL_STORAGE_KEY = "unlockedUpgrades";

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
    id: "intern_hybrid_upgrade_1",
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
    cost: 1e6,
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

export const UPGRADES: Upgrade[] = [
  ...INTERN_UPGRADES,
  ...VIBE_CODER_UPGRADES,
  ...TEN_X_ENGINEER_UPGRADES,
];

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

    return updatedGen;
  });

  useGeneratorStore.setState({ generators: updated });
};

export const syncAvailableUpgrades = () => {
  const ownedMap = Object.fromEntries(
    useGeneratorStore.getState().generators.map((g) => [g.id, g.amount])
  );

  const unlockedIds = useUpgradeStore
    .getState()
    .unlockedUpgrades.map((u) => u.id);

  const available = UPGRADES.filter((upg) => {
    const satisfied = upg.unlockConditions.every((cond) => {
      const owned = ownedMap[cond.requiredId] ?? 0;
      return owned >= cond.requiredAmount;
    });
    return satisfied && !unlockedIds.includes(upg.id);
  }).sort((a, b) => a.cost - b.cost);

  useUpgradeStore.setState({ availableUpgrades: available });
};

export const useUpgradeStore = create<{
  availableUpgrades: Upgrade[];
  unlockedUpgrades: Upgrade[];
  unlockUpgrade: (id: string) => void;
  reset: () => void;
}>(() => {
  const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
  const unlockedIds: string[] = saved ? JSON.parse(saved) : [];

  const unlockedUpgrades = UPGRADES.filter((u) => unlockedIds.includes(u.id));

  return {
    unlockedUpgrades,
    availableUpgrades: [],
    unlockUpgrade: (id: string) => {
      const moneyState = useMoneyStore.getState();
      const upgrade = UPGRADES.find((u) => u.id === id);
      if (!upgrade) return;

      const alreadyUnlocked = useUpgradeStore
        .getState()
        .unlockedUpgrades.find((u) => u.id === id);
      if (alreadyUnlocked) return;

      if (moneyState.money.toNumber() >= upgrade.cost) {
        moneyState.spendMoney(upgrade.cost);
        applyUpgradeEffect(upgrade);

        const newUnlocked = [
          ...useUpgradeStore.getState().unlockedUpgrades,
          upgrade,
        ];
        localStorage.setItem(
          LOCAL_STORAGE_KEY,
          JSON.stringify(newUnlocked.map((u) => u.id))
        );

        useUpgradeStore.setState({ unlockedUpgrades: newUnlocked });
        syncAvailableUpgrades();
      }
    },
    reset: () => {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
      useUpgradeStore.setState({ unlockedUpgrades: [], availableUpgrades: [] });
    },
  };
});
