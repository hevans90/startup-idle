import Decimal from "break_infinity.js";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { decimalReplacer, decimalReviver } from "./_break_infinity.decimals";

const LOCAL_STORAGE_KEY = "innovation";

const unlockInitialState = {
  managers: { unlocked: false, cost: new Decimal(1) },
};

const MANGER_TICK_INTERVAL = 200;

type UnlockKeys = keyof typeof unlockInitialState;

export const ManagerKeyValues = ["agile", "corpo", "sales"] as const;
type ManagerKeys = (typeof ManagerKeyValues)[number];

const baseManagerCost = new Decimal(1);
const managerCostGrowth = new Decimal(1.5);

export function getManagerCost(assignments: Decimal): Decimal {
  return baseManagerCost.mul(managerCostGrowth.pow(assignments));
}

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

  managers: Record<
    ManagerKeys,
    { assignment: Decimal; progress: Decimal; tier: Decimal }
  >;

  assignManager: (key: ManagerKeys) => void;
  unassignManager: (key: ManagerKeys) => void;
  tickManagers: () => void;
};

export const useInnovationStore = create<InnovationState>()(
  persist(
    (set, get) => ({
      innovation: new Decimal(0),
      unlocks: { ...unlockInitialState },
      globalLastTick: Date.now(),

      managers: {
        agile: {
          assignment: new Decimal(0),
          progress: new Decimal(0),
          tier: new Decimal(0),
        },
        corpo: {
          assignment: new Decimal(0),
          progress: new Decimal(0),
          tier: new Decimal(0),
        },
        sales: {
          assignment: new Decimal(0),
          progress: new Decimal(0),
          tier: new Decimal(0),
        },
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
            agile: {
              assignment: new Decimal(0),
              progress: new Decimal(0),
              tier: new Decimal(0),
            },
            corpo: {
              assignment: new Decimal(0),
              progress: new Decimal(0),
              tier: new Decimal(0),
            },
            sales: {
              assignment: new Decimal(0),
              progress: new Decimal(0),
              tier: new Decimal(0),
            },
          },
        });
      },

      canUnlock: (key) => {
        const { innovation, unlocks } = get();
        return (
          !unlocks[key].unlocked &&
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
      tickManagers: () => {
        const now = Date.now();
        const globalTickInterval = now - get().globalLastTick;
        if (globalTickInterval < 200) return;

        set({ globalLastTick: now });

        const ticks = Math.floor(globalTickInterval / MANGER_TICK_INTERVAL);

        if (ticks > 0) {
          set((state) => {
            const newManagers = { ...state.managers };
            const PROGRESS_THRESHOLD = new Decimal(100);
            const RATE = new Decimal(0.3); // Optional scaling

            for (const key of ManagerKeyValues) {
              const manager = newManagers[key];
              const tierModifier = Decimal.pow(1.5, manager.tier);
              const gain = manager.assignment
                .mul(RATE)
                .mul(ticks)
                .div(tierModifier);

              const newProgress = manager.progress.add(gain);

              if (newProgress.greaterThanOrEqualTo(PROGRESS_THRESHOLD)) {
                // Level up and subtract threshold from progress
                manager.tier = manager.tier.plus(1);
                manager.progress = newProgress.sub(PROGRESS_THRESHOLD);
              } else {
                manager.progress = newProgress;
              }
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
