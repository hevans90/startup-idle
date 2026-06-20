import Decimal from "break_infinity.js";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { decimalReplacer, decimalReviver } from "./_break_infinity.decimals";
import { JUICE_SHOP_UPGRADES } from "../game/achievements.juice-shop";

const STORAGE_KEY = "vape-achievements";

export type VapeAchievementsState = {
  vapeJuice: Decimal;
  unlockedAchievementIds: string[];
  /** Sum of juice granted from achievements (for tank capacity hint). */
  lifetimeJuiceFromAchievements: Decimal;
  purchasedJuiceUpgradeIds: string[];
  /** Additive bonuses from juice shop (e.g. 0.02 => ×1.02 money). */
  juiceMpsMultBonus: number;
  juiceInnovationMultBonus: number;

  /** Unlock + grant juice; returns true if newly unlocked. */
  recordAchievementUnlock: (id: string, juiceReward: number) => boolean;
  spendJuice: (amount: number) => boolean;
  tryPurchaseJuiceUpgrade: (id: string) => boolean;
  reset: () => void;
};

const initial = () => ({
  vapeJuice: new Decimal(0),
  unlockedAchievementIds: [] as string[],
  lifetimeJuiceFromAchievements: new Decimal(0),
  purchasedJuiceUpgradeIds: [] as string[],
  juiceMpsMultBonus: 0,
  juiceInnovationMultBonus: 0,
});

export const useVapeAchievementsStore = create<VapeAchievementsState>()(
  persist(
    (set, get) => ({
      ...initial(),

      recordAchievementUnlock: (id, juiceReward) => {
        if (get().unlockedAchievementIds.includes(id)) return false;
        const d = new Decimal(juiceReward);
        set((s) => ({
          unlockedAchievementIds: [...s.unlockedAchievementIds, id],
          vapeJuice: s.vapeJuice.add(d),
          lifetimeJuiceFromAchievements: s.lifetimeJuiceFromAchievements.add(d),
        }));
        return true;
      },

      spendJuice: (amount: number) => {
        if (amount <= 0) return true;
        const cost = new Decimal(amount);
        const { vapeJuice } = get();
        if (vapeJuice.lt(cost)) return false;
        set({ vapeJuice: vapeJuice.sub(cost) });
        return true;
      },

      tryPurchaseJuiceUpgrade: (id: string) => {
        const def = JUICE_SHOP_UPGRADES.find((u) => u.id === id);
        if (!def) return false;
        if (get().purchasedJuiceUpgradeIds.includes(id)) return false;
        if (!get().spendJuice(def.cost)) return false;
        set((s) => ({
          purchasedJuiceUpgradeIds: [...s.purchasedJuiceUpgradeIds, id],
          juiceMpsMultBonus: s.juiceMpsMultBonus + (def.mpsBonus ?? 0),
          juiceInnovationMultBonus:
            s.juiceInnovationMultBonus + (def.innovationBonus ?? 0),
        }));
        return true;
      },

      reset: () => {
        set(initial());
        useVapeAchievementsStore.persist.clearStorage();
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage, {
        replacer: decimalReplacer,
        reviver: decimalReviver,
      }),
      partialize: (state) => ({
        vapeJuice: state.vapeJuice,
        unlockedAchievementIds: state.unlockedAchievementIds,
        lifetimeJuiceFromAchievements: state.lifetimeJuiceFromAchievements,
        purchasedJuiceUpgradeIds: state.purchasedJuiceUpgradeIds,
        juiceMpsMultBonus: state.juiceMpsMultBonus,
        juiceInnovationMultBonus: state.juiceInnovationMultBonus,
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<
          Pick<
            VapeAchievementsState,
            | "vapeJuice"
            | "unlockedAchievementIds"
            | "lifetimeJuiceFromAchievements"
            | "purchasedJuiceUpgradeIds"
            | "juiceMpsMultBonus"
            | "juiceInnovationMultBonus"
          >
        > | null;
        if (!p) return current;
        return {
          ...current,
          vapeJuice: p.vapeJuice ?? current.vapeJuice,
          unlockedAchievementIds: p.unlockedAchievementIds ?? [],
          lifetimeJuiceFromAchievements:
            p.lifetimeJuiceFromAchievements ?? new Decimal(0),
          purchasedJuiceUpgradeIds: p.purchasedJuiceUpgradeIds ?? [],
          juiceMpsMultBonus: p.juiceMpsMultBonus ?? 0,
          juiceInnovationMultBonus: p.juiceInnovationMultBonus ?? 0,
        };
      },
    },
  ),
);
