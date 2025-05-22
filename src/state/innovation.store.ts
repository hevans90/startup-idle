import Decimal from "break_infinity.js";
import { formatDistanceToNow } from "date-fns";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { decimalReplacer, decimalReviver } from "./_break_infinity.decimals";

const LOCAL_STORAGE_KEY = "innovation";

const unlockInitialState = {
  managers: { unlocked: false, cost: new Decimal(1) },
  employeeManagement: { unlocked: false, cost: new Decimal(5) },
};

const PROGRESS_THRESHOLD = new Decimal(100);
const MANGER_TICK_INTERVAL = 200;

type UnlockKeys = keyof typeof unlockInitialState;

export const ManagerKeyValues = ["agile", "corpo", "sales"] as const;
export type ManagerKeys = (typeof ManagerKeyValues)[number];

type ManagerBonusType = "innovation" | "employee" | "valuation";

export type ManagerState = {
  assignment: Decimal;
  progress: Decimal;
  tier: Decimal;
  tierScalingExponent: Decimal;
  growthRate: Decimal;
  estimateToNextTier: string;
  bonusType: ManagerBonusType;
  bonusMultiplierGrowthPerTier: Decimal;
  bonusMultiplier: Decimal;
};

const baseManagerCost = new Decimal(1);
const managerCostGrowth = new Decimal(1.5);

export function getManagerCost(assignments: Decimal): Decimal {
  return baseManagerCost.mul(managerCostGrowth.pow(assignments));
}

const estimateTimeToNextTierFormatted = (manager: {
  assignment: Decimal;
  progress: Decimal;
  tier: Decimal;
  tierScalingExponent: Decimal;
  growthRate: Decimal;
}): string => {
  if (manager.assignment.equals(0)) return "∞";

  const tierModifier = Decimal.pow(manager.tierScalingExponent, manager.tier);
  const gainPerTick = manager.assignment
    .mul(manager.growthRate)
    .div(tierModifier);

  if (gainPerTick.equals(0)) return "∞ (no gain)";

  const remaining = PROGRESS_THRESHOLD.sub(manager.progress);
  const ticksNeeded = remaining.div(gainPerTick);
  const estimatedTimeMs = ticksNeeded.mul(MANGER_TICK_INTERVAL).toNumber();

  const estimatedDate = new Date(Date.now() + estimatedTimeMs);

  return formatDistanceToNow(estimatedDate, {
    addSuffix: true,
    includeSeconds: true,
  });
};

type InnovationState = {
  innovation: Decimal;
  getMultiplier: () => Decimal;
  globalLastTick: number;

  increaseInnovation: (increment: number) => void;
  spendInnovation: (decrement: number) => void;
  reset: () => void;

  unlocks: Record<UnlockKeys, { unlocked: boolean; cost: Decimal }>;
  canUnlock: (key: UnlockKeys) => boolean;
  unlock: (key: UnlockKeys) => void;

  managers: Record<ManagerKeys, ManagerState>;

  assignManager: (key: ManagerKeys) => void;
  unassignManager: (key: ManagerKeys) => void;
  tickManagers: () => void;
};

const initialManagerState: Record<ManagerKeys, ManagerState> = {
  agile: {
    assignment: new Decimal(0),
    progress: new Decimal(0),
    tier: new Decimal(0),
    tierScalingExponent: new Decimal(1.1),
    growthRate: new Decimal(0.8),
    estimateToNextTier: "-",
    bonusType: "innovation",
    bonusMultiplierGrowthPerTier: new Decimal(1.01),
    bonusMultiplier: new Decimal(1),
  },
  corpo: {
    assignment: new Decimal(0),
    progress: new Decimal(0),
    tier: new Decimal(0),
    tierScalingExponent: new Decimal(1.3),
    growthRate: new Decimal(0.5),
    estimateToNextTier: "-",
    bonusType: "employee",
    bonusMultiplierGrowthPerTier: new Decimal(1.01),
    bonusMultiplier: new Decimal(1),
  },
  sales: {
    assignment: new Decimal(0),
    progress: new Decimal(0),
    tier: new Decimal(0),
    tierScalingExponent: new Decimal(1.5),
    growthRate: new Decimal(0.1),
    estimateToNextTier: "-",
    bonusType: "valuation",
    bonusMultiplierGrowthPerTier: new Decimal(1.01),
    bonusMultiplier: new Decimal(1),
  },
};

export const useInnovationStore = create<InnovationState>()(
  persist(
    (set, get) => ({
      innovation: new Decimal(0),
      unlocks: { ...unlockInitialState },
      globalLastTick: Date.now(),

      managers: {
        ...initialManagerState,
      },

      getMultiplier: () => {
        const { innovation } = get();
        return new Decimal(Decimal.log10(innovation.add(1)) + 1);
      },

      increaseInnovation: (increment: number) => {
        set((state) => ({
          innovation: state.innovation.add(increment),
        }));
      },

      spendInnovation: (decrement: number) => {
        set((state) => ({
          innovation: state.innovation.sub(decrement),
        }));
      },

      reset: () => {
        set({
          innovation: new Decimal(0),
          unlocks: { ...unlockInitialState },
          managers: {
            ...initialManagerState,
          },
        });
      },

      canUnlock: (key) => {
        const { innovation, unlocks } = get();
        return (
          !unlocks[key]?.unlocked &&
          innovation.greaterThanOrEqualTo(unlocks[key].cost)
        );
      },

      unlock: (key) => {
        const { canUnlock, spendInnovation, unlocks } = get();
        if (canUnlock(key)) {
          spendInnovation(unlocks[key].cost.toNumber());
          set((state) => ({
            unlocks: {
              ...state.unlocks,
              [key]: { unlocked: true, cost: unlocks[key].cost },
            },
          }));
        }
      },

      assignManager: (key) => {
        const { innovation, managers, spendInnovation } = get();
        const currentAssignments = managers[key].assignment;
        const cost = getManagerCost(currentAssignments);

        if (innovation.greaterThanOrEqualTo(cost)) {
          spendInnovation(cost.toNumber());
          set((state) => ({
            managers: {
              ...state.managers,
              [key]: {
                ...state.managers[key],
                assignment: currentAssignments.add(1),
              },
            },
          }));
        }
      },

      unassignManager: (key) => {
        const { managers, increaseInnovation } = get();
        const currentAssignments = managers[key].assignment;

        if (currentAssignments.greaterThan(0)) {
          const refund = getManagerCost(currentAssignments.sub(1));
          increaseInnovation(refund.toNumber());
          set((state) => ({
            managers: {
              ...state.managers,
              [key]: {
                ...state.managers[key],
                assignment: currentAssignments.sub(1),
              },
            },
          }));
        }
      },
      getManagerBonus: (
        key: ManagerKeys
      ): {
        bonusType: ManagerBonusType;
        bonusMultiplier: Decimal;
      } => {
        const { managers } = get();
        const manager = managers[key];
        return {
          bonusType: manager.bonusType,
          bonusMultiplier: manager.bonusMultiplier,
        };
      },
      tickManagers: () => {
        const now = Date.now();
        const globalTickInterval = now - get().globalLastTick;
        if (globalTickInterval < MANGER_TICK_INTERVAL) return;

        set({ globalLastTick: now });

        const ticks = Math.floor(globalTickInterval / MANGER_TICK_INTERVAL);

        if (ticks > 0) {
          set((state) => {
            const newManagers = { ...state.managers };

            for (const key of ManagerKeyValues) {
              const manager = newManagers[key];
              const tierModifier = Decimal.pow(
                manager.tierScalingExponent,
                manager.tier
              );
              const gain = manager.assignment
                .mul(manager.growthRate)
                .mul(ticks)
                .div(tierModifier);

              const newProgress = manager.progress.add(gain);
              manager.estimateToNextTier =
                estimateTimeToNextTierFormatted(manager);

              if (newProgress.greaterThanOrEqualTo(PROGRESS_THRESHOLD)) {
                manager.tier = manager.tier.plus(1);
                manager.progress = newProgress.sub(PROGRESS_THRESHOLD);
              } else {
                manager.progress = newProgress;
              }

              // Recalculate bonus multiplier
              manager.bonusMultiplier = Decimal.pow(
                manager.bonusMultiplierGrowthPerTier,
                manager.tier
              );
            }

            return { managers: newManagers };
          });
        }
      },
    }),
    {
      name: LOCAL_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage, {
        replacer: decimalReplacer,
        reviver: decimalReviver,
      }),
    }
  )
);
