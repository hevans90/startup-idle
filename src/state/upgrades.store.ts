import { create } from "zustand";
import { GeneratorId, useGeneratorStore } from "./generators.store";
import { useMoneyStore } from "./money.store";

export type UnlockCondition = {
  requiredId: GeneratorId;
  requiredAmount: number;
};

const LOCAL_STORAGE_KEY = "unlockedUpgrades";

export type Upgrade = {
  id: string;
  name: string;
  description: string;
  unlockConditions: UnlockCondition[];
  effect: (genId: GeneratorId) => void;
  cost: number;
};

const INTERN_UPGRADES: Upgrade[] = [
  {
    id: "intern_upgrade_1",
    name: "Intern Productivity Boost (+50%)",
    description:
      "Micromanage your interns harder. Weekly 1-1s will improve morale and productivity (you think).",
    unlockConditions: [{ requiredId: "intern", requiredAmount: 15 }],
    effect: (genId) => {
      if (genId === "intern") {
        const state = useGeneratorStore.getState();
        const updated = state.generators.map((gen) =>
          gen.id === "intern"
            ? { ...gen, multiplier: gen.multiplier * 1.5 }
            : gen
        );
        useGeneratorStore.setState({ generators: updated });
      }
    },
    cost: 1000,
  },
  {
    id: "intern_cost_1",
    name: "Intern Discount (-70%)",
    description: "Force prospects to do a week of work for free, profit.",
    unlockConditions: [{ requiredId: "intern", requiredAmount: 35 }],
    effect: (genId) => {
      if (genId === "intern") {
        const state = useGeneratorStore.getState();
        const updated = state.generators.map((gen) =>
          gen.id === "intern"
            ? { ...gen, costMultiplier: gen.costMultiplier * 0.3 }
            : gen
        );
        useGeneratorStore.setState({ generators: updated });
      }
    },
    cost: 2000,
  },
  {
    id: "intern_upgrade_2",
    name: "Intern Productivity Boost (+70%)",
    description:
      "Promise your interns promotions, but in reality just burn them out faster.",
    unlockConditions: [{ requiredId: "intern", requiredAmount: 50 }],
    effect: (genId) => {
      if (genId === "intern") {
        const state = useGeneratorStore.getState();
        const updated = state.generators.map((gen) =>
          gen.id === "intern"
            ? { ...gen, multiplier: gen.multiplier * 1.7 }
            : gen
        );
        useGeneratorStore.setState({ generators: updated });
      }
    },
    cost: 10000,
  },
  {
    id: "intern_cost_exponent_1",
    name: "Intern Base Cost Exponent (-0.02)",
    description: "Start hiring homeless streetrats. They're cheaper.",
    unlockConditions: [{ requiredId: "intern", requiredAmount: 75 }],
    effect: (genId) => {
      if (genId === "intern") {
        const state = useGeneratorStore.getState();
        const updated = state.generators.map((gen) =>
          gen.id === "intern"
            ? { ...gen, costExponent: gen.costExponent - 0.02 }
            : gen
        );
        useGeneratorStore.setState({ generators: updated });
      }
    },
    cost: 100000,
  },
];

const VIBE_CODER_UPGRADES: Upgrade[] = [
  {
    id: "vibe_coder_upgrade_1",
    name: "Vibe Coder Productivity (+40%)",
    description:
      "Someone tweeted about a new breathing focus LLM. The AI slop factory becomes more efficient.",
    unlockConditions: [{ requiredId: "vibe_coder", requiredAmount: 20 }],
    effect: (genId) => {
      if (genId === "vibe_coder") {
        const state = useGeneratorStore.getState();
        const updated = state.generators.map((gen) =>
          gen.id === "vibe_coder"
            ? { ...gen, multiplier: gen.multiplier * 1.4 }
            : gen
        );
        useGeneratorStore.setState({ generators: updated });
      }
    },
    cost: 50000,
  },
  {
    id: "vibe_coder_cost_1",
    name: "Vibe Coder Discount (-85%)",
    description:
      "Sloppers get cheaper the more of them you hire. This might not end well though.",
    unlockConditions: [{ requiredId: "vibe_coder", requiredAmount: 30 }],
    effect: (genId) => {
      if (genId === "vibe_coder") {
        const state = useGeneratorStore.getState();
        const updated = state.generators.map((gen) =>
          gen.id === "vibe_coder"
            ? { ...gen, costMultiplier: gen.costMultiplier * 0.15 }
            : gen
        );
        useGeneratorStore.setState({ generators: updated });
      }
    },
    cost: 20000,
  },
];

const TEN_X_ENGINEER_UPGRADES: Upgrade[] = [
  {
    id: "10x_dev_10x_1",
    name: "10x engineering",
    description:
      "Instead of arguing with the ai sloppers all day, your 10x devs actually start 10xing.",
    unlockConditions: [{ requiredId: "10x_dev", requiredAmount: 3 }],
    effect: (genId) => {
      if (genId === "10x_dev") {
        const state = useGeneratorStore.getState();
        const updated = state.generators.map((gen) =>
          gen.id === "10x_dev"
            ? { ...gen, multiplier: gen.multiplier * 10 }
            : gen
        );
        useGeneratorStore.setState({ generators: updated });
      }
    },
    cost: 200000,
  },
  {
    id: "10x_dev_10x_2",
    name: "10x10x engineering",
    description: "Your 10x engineers begin to see the matrix...",
    unlockConditions: [{ requiredId: "10x_dev", requiredAmount: 4 }],
    effect: (genId) => {
      if (genId === "10x_dev") {
        const state = useGeneratorStore.getState();
        const updated = state.generators.map((gen) =>
          gen.id === "10x_dev"
            ? { ...gen, multiplier: gen.multiplier * 10 }
            : gen
        );
        useGeneratorStore.setState({ generators: updated });
      }
    },
    cost: 10000000,
  },
];

export const UPGRADES: Upgrade[] = [
  ...INTERN_UPGRADES,
  ...VIBE_CODER_UPGRADES,
  ...TEN_X_ENGINEER_UPGRADES,
];

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

        // Apply effect
        for (const cond of upgrade.unlockConditions) {
          upgrade.effect(cond.requiredId);
        }

        // Update state
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
