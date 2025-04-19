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

export const UPGRADES: Upgrade[] = [
  {
    id: "intern_upgrade_1",
    name: "Intern Productivity Boost (50%)",
    description:
      "Micromanage your interns harder. Weekly 1-1s will improve morale and productivity (you think).",
    unlockConditions: [{ requiredId: "intern", requiredAmount: 10 }],
    effect: (genId: GeneratorId) => {
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
    cost: 100,
  },
  {
    id: "vibe_coder_cost_1",
    name: "Vibe Coder Discount (20%)",
    description:
      "Sloppers get cheaper the more of them you hire. This might not end well though.",
    unlockConditions: [{ requiredId: "vibe_coder", requiredAmount: 20 }],
    effect: (genId: GeneratorId) => {
      if (genId === "vibe_coder") {
        const state = useGeneratorStore.getState();
        const updated = state.generators.map((gen) =>
          gen.id === "vibe_coder"
            ? { ...gen, costMultiplier: gen.costMultiplier * 0.8 }
            : gen
        );
        useGeneratorStore.setState({ generators: updated });
      }
    },
    cost: 200,
  },
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
