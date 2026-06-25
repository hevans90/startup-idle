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
  /** Additive bonuses from juice shop (fraction, e.g. 0.08 => ×1.08). */
  juiceMpsMultBonus: number;
  juiceInnovationMultBonus: number;
  juiceValuationMultBonus: number;
  /** Additive hire-cost reduction (fraction, e.g. 0.30 => ×0.70). */
  juiceHireCostReduction: number;
  /** Additive equity payout bonus (fraction, e.g. 0.10 => ×1.10). */
  juiceEquityMultBonus: number;

  // ── Minigame bonuses ──────────────────────────────────────────────────────
  /** Accumulated tap window width bonus (fraction). */
  minigameTapWindowBonus: number;
  /** Accumulated hold threshold reduction (fraction, subtracted from 0.60). */
  minigameHoldThresholdReduction: number;
  /** Accumulated innovation reward bonus (fraction). */
  minigameRewardBonus: number;
  /** Total missed tap zones forgiven per game (integer). */
  minigameForgiveness: number;
  /** Accumulated perfect-cloud threshold reduction (fraction, subtracted from 0.92). */
  minigamePerfectThresholdReduction: number;

  /** Unlock + grant juice; returns true if newly unlocked. */
  recordAchievementUnlock: (id: string, juiceReward: number) => boolean;
  spendJuice: (amount: number) => boolean;
  tryPurchaseJuiceUpgrade: (id: string) => boolean;
  /** Run reset: no-op — achievements and juice upgrades persist across prestiges. */
  reset: () => void;
  /** Full wipe only: clears everything including achievements and upgrades. */
  clearAll: () => void;
};

const initial = () => ({
  vapeJuice: new Decimal(0),
  unlockedAchievementIds: [] as string[],
  lifetimeJuiceFromAchievements: new Decimal(0),
  purchasedJuiceUpgradeIds: [] as string[],
  juiceMpsMultBonus: 0,
  juiceInnovationMultBonus: 0,
  juiceValuationMultBonus: 0,
  juiceHireCostReduction: 0,
  juiceEquityMultBonus: 0,
  minigameTapWindowBonus: 0,
  minigameHoldThresholdReduction: 0,
  minigameRewardBonus: 0,
  minigameForgiveness: 0,
  minigamePerfectThresholdReduction: 0,
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
          juiceValuationMultBonus:
            s.juiceValuationMultBonus + (def.valuationBonus ?? 0),
          juiceHireCostReduction:
            s.juiceHireCostReduction + (def.hireCostReduction ?? 0),
          juiceEquityMultBonus:
            s.juiceEquityMultBonus + (def.equityBonus ?? 0),
          minigameTapWindowBonus:
            s.minigameTapWindowBonus + (def.minigameTapWindowBonus ?? 0),
          minigameHoldThresholdReduction:
            s.minigameHoldThresholdReduction + (def.minigameHoldThresholdReduction ?? 0),
          minigameRewardBonus:
            s.minigameRewardBonus + (def.minigameRewardBonus ?? 0),
          minigameForgiveness:
            s.minigameForgiveness + (def.minigameForgiveness ?? 0),
          minigamePerfectThresholdReduction:
            s.minigamePerfectThresholdReduction + (def.minigamePerfectThresholdReduction ?? 0),
        }));
        return true;
      },

      reset: () => {
        // Achievements and juice upgrades persist across prestiges — no-op.
      },

      clearAll: () => {
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
        juiceValuationMultBonus: state.juiceValuationMultBonus,
        juiceHireCostReduction: state.juiceHireCostReduction,
        juiceEquityMultBonus: state.juiceEquityMultBonus,
        minigameTapWindowBonus: state.minigameTapWindowBonus,
        minigameHoldThresholdReduction: state.minigameHoldThresholdReduction,
        minigameRewardBonus: state.minigameRewardBonus,
        minigameForgiveness: state.minigameForgiveness,
        minigamePerfectThresholdReduction: state.minigamePerfectThresholdReduction,
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
            | "juiceValuationMultBonus"
            | "juiceHireCostReduction"
            | "juiceEquityMultBonus"
            | "minigameTapWindowBonus"
            | "minigameHoldThresholdReduction"
            | "minigameRewardBonus"
            | "minigameForgiveness"
            | "minigamePerfectThresholdReduction"
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
          juiceValuationMultBonus: p.juiceValuationMultBonus ?? 0,
          juiceHireCostReduction: p.juiceHireCostReduction ?? 0,
          juiceEquityMultBonus: p.juiceEquityMultBonus ?? 0,
          minigameTapWindowBonus: p.minigameTapWindowBonus ?? 0,
          minigameHoldThresholdReduction: p.minigameHoldThresholdReduction ?? 0,
          minigameRewardBonus: p.minigameRewardBonus ?? 0,
          minigameForgiveness: p.minigameForgiveness ?? 0,
          minigamePerfectThresholdReduction: p.minigamePerfectThresholdReduction ?? 0,
        };
      },
    },
  ),
);
