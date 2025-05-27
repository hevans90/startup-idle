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

export function getManagerCost(key: ManagerKeys): {
  count: number;
  totalCost: Decimal;
} {
  const { innovation, managers, assignment } = useInnovationStore.getState();
  const currentAssignments = managers[key].assignment;

  const base = baseManagerCost;
  const growth = managerCostGrowth;

  if (assignment === "max") {
    const a = base.mul(growth.pow(currentAssignments)); // cost of next manager
    const r = growth;

    const numerator = innovation.mul(r.sub(1));
    const insideLog = numerator.div(a).add(1);

    const maxCount = new Decimal(Decimal.log(insideLog, r.toNumber())).floor();

    if (maxCount.lessThanOrEqualTo(0)) {
      // Return cost for 1 manager even if unaffordable
      const totalCost = a;
      return {
        count: 1,
        totalCost,
      };
    }

    const totalCost = base
      .mul(growth.pow(currentAssignments))
      .mul(growth.pow(maxCount).sub(1))
      .div(growth.sub(1));

    return {
      count: maxCount.toNumber(),
      totalCost,
    };
  } else {
    const totalCost = base
      .mul(growth.pow(currentAssignments))
      .mul(growth.pow(assignment).sub(1))
      .div(growth.sub(1));

    return {
      count: assignment,
      totalCost,
    };
  }
}

export function getManagerRefund(key: ManagerKeys): {
  count: number;
  totalRefund: Decimal;
} {
  const { managers, assignment } = useInnovationStore.getState();
  const currentAssignments = managers[key].assignment;

  const base = baseManagerCost;
  const growth = managerCostGrowth;

  if (currentAssignments.lte(0)) {
    return { count: 0, totalRefund: new Decimal(0) };
  }

  const maxUnassign =
    assignment === "max"
      ? currentAssignments.toNumber()
      : Math.min(assignment, currentAssignments.toNumber());

  const refundStart = currentAssignments.sub(maxUnassign);

  const totalRefund = base
    .mul(growth.pow(refundStart))
    .mul(growth.pow(maxUnassign).sub(1))
    .div(growth.sub(1));

  return {
    count: maxUnassign,
    totalRefund,
  };
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

  assignment: number | "max";
  setAssignment: (value: number | "max") => void;
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
      assignment: 1,
      unlocks: { ...unlockInitialState },
      globalLastTick: Date.now(),

      managers: {
        ...initialManagerState,
      },

      setAssignment: (assignment: number | "max") => set({ assignment }),

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
          innovation.greaterThanOrEqualTo(unlocks[key]?.cost)
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
        const start = currentAssignments;
        const base = baseManagerCost;
        const growth = managerCostGrowth;

        let count = 0;

        const assignment = get().assignment;

        if (assignment === "max") {
          const a = base.mul(growth.pow(start)); // first term
          const r = growth;
          const maxAffordable = innovation;

          // Sum formula: S = a * (r^n - 1) / (r - 1)
          // Solve for n:
          // r^n = ((S * (r - 1)) / a) + 1
          // n = log_r(((S * (r - 1)) / a) + 1)
          const numerator = maxAffordable.mul(r.sub(1));
          const denom = a;
          const insideLog = numerator.div(denom).add(1);
          count = new Decimal(Decimal.log(insideLog, r.toNumber()))
            .floor()
            .toNumber();
        } else {
          count = assignment;
        }

        if (count > 0) {
          // Total cost of assigning `count` managers
          const totalCost = base
            .mul(growth.pow(start))
            .mul(growth.pow(count).sub(1))
            .div(growth.sub(1));

          if (innovation.greaterThanOrEqualTo(totalCost)) {
            spendInnovation(totalCost.toNumber());
            set((state) => ({
              managers: {
                ...state.managers,
                [key]: {
                  ...state.managers[key],
                  assignment: state.managers[key].assignment.add(count),
                },
              },
            }));
          }
        }
      },

      unassignManager: (key) => {
        const { managers, increaseInnovation } = get();
        const currentAssignments = managers[key].assignment;
        const start = currentAssignments.sub(1);
        const base = baseManagerCost;
        const growth = managerCostGrowth;

        let count = 0;

        const assignment = get().assignment;

        if (assignment === "max") {
          count = currentAssignments.toNumber();
        } else {
          count = Math.min(currentAssignments.toNumber(), assignment);
        }

        if (count > 0) {
          // Sum of last `count` costs:
          // base * growth^(start - count + 1) * (growth^count - 1) / (growth - 1)
          const refundStart = start.sub(count - 1);
          const totalRefund = base
            .mul(growth.pow(refundStart))
            .mul(growth.pow(count).sub(1))
            .div(growth.sub(1));

          increaseInnovation(totalRefund.toNumber());
          set((state) => ({
            managers: {
              ...state.managers,
              [key]: {
                ...state.managers[key],
                assignment: state.managers[key].assignment.sub(count),
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
      partialize: (state) => ({
        innovation: state.innovation,
        assignment: state.assignment,
        unlocks: state.unlocks,
        managers: state.managers,
        globalLastTick: state.globalLastTick,
        // don't include functions like increaseInnovation, spendInnovation, etc.
      }),
    }
  )
);
