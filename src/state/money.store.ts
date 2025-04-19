import Decimal from "break_infinity.js";
import { create } from "zustand";

type MoneyState = {
  money: Decimal;
  increaseMoney: (increment: number) => void;
  spendMoney: (decrement: number) => void;
  loadMoney: () => void;
  reset: () => void;
};

export const useMoneyStore = create<MoneyState>((set) => ({
  money: new Decimal(0),
  increaseMoney: (increment: number) => {
    set((state) => {
      const newMoney = state.money.add(increment);
      localStorage.setItem("money", newMoney.toString());
      return { money: newMoney };
    });
  },
  spendMoney: (decrement: number) => {
    set((state) => {
      const newMoney = state.money.subtract(decrement);
      localStorage.setItem("money", newMoney.toString());
      return { money: newMoney };
    });
  },
  loadMoney: () => {
    const savedMoney = localStorage.getItem("money");
    if (savedMoney) {
      set({ money: new Decimal(savedMoney) });
    }
  },
  reset: () => {
    localStorage.removeItem("money");
    set({ money: new Decimal(0) });
  },
}));

// Load money from local storage when the application starts
useMoneyStore.getState().loadMoney();
