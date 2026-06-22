import Decimal from "break_infinity.js";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  coerceDecimal,
  decimalReplacer,
  decimalReviver,
} from "./_break_infinity.decimals";

type MoneyState = {
  money: Decimal;
  increaseMoney: (increment: number) => void;
  spendMoney: (decrement: number) => void;
  reset: () => void;
};

const MONEY_STORAGE_KEY = "money";

/** Migrates legacy plain-decimal-string saves into zustand persist shape. */
const moneyStateStorage = {
  getItem: (name: string): string | null => {
    const raw = localStorage.getItem(name);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === "object" &&
        "state" in (parsed as object)
      ) {
        return raw;
      }
    } catch {
      const d = new Decimal(raw);
      return JSON.stringify({
        state: {
          money: {
            type: "decimal",
            mantissa: d.mantissa,
            exponent: d.exponent,
          },
        },
        version: 0,
      });
    }
    return raw;
  },
  setItem: (name: string, value: string) => localStorage.setItem(name, value),
  removeItem: (name: string) => localStorage.removeItem(name),
};

export const useMoneyStore = create<MoneyState>()(
  persist(
    (set) => ({
      money: new Decimal(0),
      increaseMoney: (increment: number) => {
        set((state) => ({
          money: state.money.add(increment),
        }));
      },
      spendMoney: (decrement: number) => {
        set((state) => ({
          money: state.money.subtract(decrement),
        }));
      },
      reset: () => {
        set({ money: new Decimal(0) });
        useMoneyStore.persist.clearStorage();
      },
    }),
    {
      name: MONEY_STORAGE_KEY,
      storage: createJSONStorage(() => moneyStateStorage, {
        replacer: decimalReplacer,
        reviver: decimalReviver,
      }),
      partialize: (state) => ({ money: state.money }),
      // Guarantee `money` is a Decimal even if an old save stored it in a shape
      // the reviver doesn't recognise — `money.gt`/`formatCurrency(money)` run on
      // first paint, so a non-Decimal here would crash-loop before any recovery.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<MoneyState>;
        return { ...current, ...p, money: coerceDecimal(p.money, current.money) };
      },
    }
  )
);
