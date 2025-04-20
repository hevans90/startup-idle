import { create } from "zustand";
import {
  GENERATOR_TYPES,
  GeneratorId,
  useGeneratorStore,
} from "./generators.store";
import { useMoneyStore } from "./money.store";

export type UnlockCondition = {
  requiredId: GeneratorId;
  requiredAmount: number;
};

const LOCAL_STORAGE_KEY = "unlockedUpgrades";

export const getUpgradeSummary = (upgrade: Upgrade): string => {
  const parts: string[] = [];

  // parts.push(`$${upgrade.cost.toLocaleString()}`);
  const genName = GENERATOR_TYPES.find(
    (gen) => gen.id === upgrade.effects.genId
  )?.name;
  parts.push(`${genName}`);

  for (const effect of upgrade.effects.changes) {
    switch (effect.type) {
      case "multiplier":
        parts.push(`multiplier: x${effect.value}`);
        break;
      case "costMultiplier": {
        const discount = Math.round((1 - effect.value) * 100);
        parts.push(`cost: -${discount}%`);
        break;
      }
      case "costExponent":
        parts.push(
          `exponent: ${effect.delta > 0 ? "+" : ""}${effect.delta.toFixed(2)}`
        );
        break;
    }
  }

  return parts.join(" | ");
};

export type GeneratorEffect =
  | { type: "multiplier"; value: number }
  | { type: "costMultiplier"; value: number }
  | { type: "costExponent"; delta: number };

export type Upgrade = {
  id: string;
  name: string;
  description: string;
  unlockConditions: UnlockCondition[];
  effects: { genId: GeneratorId; changes: GeneratorEffect[] };
  cost: number;
};

const INTERN_UPGRADES: Upgrade[] = [
  {
    id: "intern_upgrade_1",
    name: "Micromanagement",
    description:
      "Micromanage your interns harder. Weekly 1-1s will improve morale and productivity (you think).",
    unlockConditions: [{ requiredId: "intern", requiredAmount: 15 }],
    effects: {
      genId: "intern",
      changes: [{ type: "multiplier", value: 1.5 }],
    },
    cost: 400,
  },
  {
    id: "intern_upgrade_2",
    name: "Mandatory Weekend Work",
    description:
      "Threaten your interns with violence if they don't work weekends.",
    unlockConditions: [{ requiredId: "intern", requiredAmount: 25 }],
    effects: {
      genId: "intern",
      changes: [{ type: "multiplier", value: 2 }],
    },
    cost: 3000,
  },
  {
    id: "intern_cost_1",
    name: "Free Prospecting",
    description: "Force applicants to do a week of work for free, profit.",
    unlockConditions: [{ requiredId: "intern", requiredAmount: 35 }],
    effects: {
      genId: "intern",
      changes: [
        { type: "costMultiplier", value: 0.1 },
        { type: "multiplier", value: 1.5 },
      ],
    },
    cost: 5000,
  },
  {
    id: "intern_upgrade_3",
    name: "Promotion Griefing",
    description:
      "Promise your interns promotions, but in reality just burn them out faster.",
    unlockConditions: [{ requiredId: "intern", requiredAmount: 50 }],
    effects: {
      genId: "intern",
      changes: [{ type: "multiplier", value: 2 }],
    },
    cost: 10000,
  },
  {
    id: "intern_cost_exponent_1",
    name: "Homeless Interns",
    description: "Start hiring homeless streetrats. They're cheaper.",
    unlockConditions: [{ requiredId: "intern", requiredAmount: 75 }],
    effects: {
      genId: "intern",
      changes: [
        { type: "costExponent", delta: -0.02 },
        { type: "multiplier", value: 1.3 },
      ],
    },
    cost: 100000,
  },
];

const VIBE_CODER_UPGRADES: Upgrade[] = [
  {
    id: "vibe_coder_upgrade_1",
    name: "Focus Vibing",
    description:
      "Someone tweeted about a new breathing focus LLM. The AI slop factory becomes more efficient.",
    unlockConditions: [{ requiredId: "vibe_coder", requiredAmount: 10 }],
    effects: {
      genId: "vibe_coder",
      changes: [{ type: "multiplier", value: 1.8 }],
    },
    cost: 7500,
  },
  {
    id: "vibe_coder_upgrade_2",
    name: "JUULing",
    description:
      "You let the zoomers use their vapes in the office, they are happy.",
    unlockConditions: [{ requiredId: "vibe_coder", requiredAmount: 20 }],
    effects: {
      genId: "vibe_coder",
      changes: [{ type: "multiplier", value: 3 }],
    },
    cost: 30000,
  },
  {
    id: "vibe_coder_cost_1",
    name: "Slop Bargaining",
    description:
      "Sloppers get cheaper the more of them you hire. This might not end well though.",
    unlockConditions: [{ requiredId: "vibe_coder", requiredAmount: 30 }],
    effects: {
      genId: "vibe_coder",
      changes: [{ type: "costMultiplier", value: 0.15 }],
    },
    cost: 100000,
  },
  {
    id: "vibe_coder_cost_exponent_1",
    name: "Intern Promotion",
    description:
      "You promise the interns LLM code editors. They are willing to take a paycut.",
    unlockConditions: [{ requiredId: "vibe_coder", requiredAmount: 40 }],
    effects: {
      genId: "vibe_coder",
      changes: [{ type: "costExponent", delta: -0.05 }],
    },
    cost: 200000,
  },
  {
    id: "vibe_coder_upgrade_3",
    name: "Pure Vibing",
    description:
      "You open a new office purely for the vibers. Vape dispensers, unlimited GPT tokens, they are going crazy.",
    unlockConditions: [{ requiredId: "vibe_coder", requiredAmount: 60 }],
    effects: {
      genId: "vibe_coder",
      changes: [{ type: "multiplier", value: 3 }],
    },
    cost: 1000000,
  },
];

const TEN_X_ENGINEER_UPGRADES: Upgrade[] = [
  {
    id: "10x_dev_10x_1",
    name: "10x engineering",
    description:
      "Instead of arguing with the AI sloppers all day, your 10x devs actually start 10xing.",
    unlockConditions: [{ requiredId: "10x_dev", requiredAmount: 3 }],
    effects: {
      genId: "10x_dev",
      changes: [{ type: "multiplier", value: 10 }],
    },
    cost: 200000,
  },
  {
    id: "10x_dev_10x_2",
    name: "10x10x engineering",
    description: "Your 10x engineers begin to see the matrix...",
    unlockConditions: [{ requiredId: "10x_dev", requiredAmount: 4 }],
    effects: {
      genId: "10x_dev",
      changes: [{ type: "multiplier", value: 10 }],
    },
    cost: 3000000,
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
    if (gen.id !== upgrade.effects.genId) return gen;

    const updatedGen = { ...gen };
    for (const change of upgrade.effects.changes) {
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
  });

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
