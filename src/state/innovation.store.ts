import Decimal from "break_infinity.js";
import { create } from "zustand";

type MoneyState = {
  innovation: Decimal;
  increaseInnovation: (increment: number) => void;
  spendInnovation: (decrement: number) => void;
  loadInnovation: () => void;
  reset: () => void;
};

const LOCAL_STORAGE_KEY = "innovation";

export const useInnovationStore = create<MoneyState>((set) => ({
  innovation: new Decimal(0),
  increaseInnovation: (increment: number) => {
    set((state) => {
      const newMoney = state.innovation.add(increment);
      localStorage.setItem(LOCAL_STORAGE_KEY, newMoney.toString());
      return { innovation: newMoney };
    });
  },
  spendInnovation: (decrement: number) => {
    set((state) => {
      const newInnovation = state.innovation.subtract(decrement);
      localStorage.setItem(LOCAL_STORAGE_KEY, newInnovation.toString());
      return { innovation: newInnovation };
    });
  },
  loadInnovation: () => {
    const savedInnovation = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (savedInnovation) {
      set({ innovation: new Decimal(savedInnovation) });
    }
  },
  reset: () => {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    set({ innovation: new Decimal(0) });
  },
}));

// Load innovation from local storage when the application starts
useInnovationStore.getState().loadInnovation();
