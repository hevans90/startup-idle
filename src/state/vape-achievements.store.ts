import Decimal from "break_infinity.js";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { coerceDecimal, decimalReplacer, decimalReviver } from "./_break_infinity.decimals";
import { JUICE_SHOP_UPGRADES, drainBlock, isFull, juiceBonuses, juicePlace, pourBlock, type JuiceFills } from "../game/achievements.juice-shop";

const STORAGE_KEY = "vape-achievements";

export type VapeAchievementsState = {
  vapeJuice: Decimal;
  unlockedAchievementIds: string[];
  /** Sum of juice granted from achievements. */
  lifetimeJuiceFromAchievements: Decimal;
  /** The juice in each upgrade's vessel. */
  juiceFills: JuiceFills;
  /** Those full. */
  purchasedJuiceUpgradeIds: string[];
  /** Additive bonuses from juice shop (fraction, e.g. 0.08 => ×1.08). */
  juiceMpsMultBonus: number;
  juiceInnovationMultBonus: number;
  juiceValuationMultBonus: number;
  /** Additive hire-cost reduction (fraction, e.g. 0.30 => ×0.70). */
  juiceHireCostReduction: number;
  /** Additive equity payout bonus (fraction, e.g. 0.10 => ×1.10). */
  juiceEquityMultBonus: number;

  /** Unlock + grant juice; returns true if newly unlocked. */
  recordAchievementUnlock: (id: string, juiceReward: number) => boolean;
  /** Pour some of the flask's juice into an upgrade's vessel; how much went. */
  pourJuice: (id: string, amount: number) => number;
  /** Drain some of a vessel back into the flask; how much went. */
  drainJuice: (id: string, amount: number) => number;
  /** Run reset: no-op — achievements and juice upgrades persist across prestiges. */
  reset: () => void;
  /** Full wipe only: clears everything including achievements and upgrades. */
  clearAll: () => void;
};

/** What follows from the vessels. */
const filled = (juiceFills: JuiceFills) => ({
  juiceFills,
  purchasedJuiceUpgradeIds: JUICE_SHOP_UPGRADES.filter((u) => isFull(juiceFills, u)).map((u) => u.id),
  ...juiceBonuses(juiceFills),
});

/** A save's vessels: from before there were any, each upgrade bought is full. */
const savedFills = (fills: JuiceFills | undefined, bought: readonly string[]): JuiceFills =>
  fills ?? Object.fromEntries(JUICE_SHOP_UPGRADES.filter((u) => bought.includes(u.id)).map((u) => [u.id, u.cost]));

const initial = () => ({
  vapeJuice: new Decimal(0),
  unlockedAchievementIds: [] as string[],
  lifetimeJuiceFromAchievements: new Decimal(0),
  juiceFills: {} as JuiceFills,
  purchasedJuiceUpgradeIds: [] as string[],
  juiceMpsMultBonus: 0,
  juiceInnovationMultBonus: 0,
  juiceValuationMultBonus: 0,
  juiceHireCostReduction: 0,
  juiceEquityMultBonus: 0,
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

      pourJuice: (id, amount) => {
        const { vapeJuice, juiceFills } = get(), at = juicePlace(id);
        if (!at || pourBlock(juiceFills, id)) return 0;
        const has = juiceFills[id] ?? 0, n = Math.min(Math.floor(amount), Math.floor(vapeJuice.toNumber()), at.def.cost - has);
        if (!(n > 0)) return 0;
        set({ vapeJuice: vapeJuice.sub(n), ...filled({ ...juiceFills, [id]: has + n }) });
        return n;
      },

      drainJuice: (id, amount) => {
        const { vapeJuice, juiceFills } = get();
        if (drainBlock(juiceFills, id)) return 0;
        const has = juiceFills[id], n = Math.min(Math.floor(amount), has);
        if (!(n > 0)) return 0;
        set({ vapeJuice: vapeJuice.add(n), ...filled({ ...juiceFills, [id]: has - n }) });
        return n;
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
        juiceFills: state.juiceFills,
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<
          Pick<
            VapeAchievementsState,
            | "vapeJuice"
            | "unlockedAchievementIds"
            | "lifetimeJuiceFromAchievements"
            | "juiceFills"
            | "purchasedJuiceUpgradeIds"
          >
        > | null;
        if (!p) return current;
        return {
          ...current,
          // coerceDecimal guards against pre-{type:"decimal"} saves where the
          // reviver passes a raw number through — calling .add() on a number crashes.
          vapeJuice: coerceDecimal(p.vapeJuice, current.vapeJuice),
          unlockedAchievementIds: p.unlockedAchievementIds ?? [],
          lifetimeJuiceFromAchievements: coerceDecimal(
            p.lifetimeJuiceFromAchievements,
            new Decimal(0),
          ),
          ...filled(savedFills(p.juiceFills, p.purchasedJuiceUpgradeIds ?? [])),
        };
      },
    },
  ),
);
