import { useMemo } from "react";

import { useMoneyStore } from "../state/money.store";

import { useGeneratorStore } from "../state/generators.store";
import {
  getGeneratorCost,
  getMaxAffordableAmount,
} from "../utils/generator-utils";

export function useGeneratorPurchase(id: string, amount: number) {
  const money = useMoneyStore((state) => state.money);
  const purchase = useGeneratorStore((state) => state.purchaseGenerator);

  const cost = getGeneratorCost(id, amount);
  const displayCost = useMemo(() => cost.toFixed(1), [cost]);
  const affordable = money.gte(cost);

  const maxAmount = useMemo(
    () => getMaxAffordableAmount(id),
    [id, money.toString()]
  );
  const purchaseMax = () => {
    if (maxAmount > 0) {
      purchase(id, maxAmount);
    }
  };

  const onPurchase = () => {
    if (affordable) {
      purchase(id, amount);
    }
  };

  return {
    cost,
    displayCost,
    affordable,
    onPurchase,
    maxAmount,
    purchaseMax,
  };
}
