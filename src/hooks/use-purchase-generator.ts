import { useMemo } from "react";

import { useMoneyStore } from "../state/money.store";

import { useGeneratorStore } from "../state/generators.store";
import {
  getGeneratorCost,
  getMaxAffordableAmountAndCost,
} from "../utils/generator-utils";

export function useGeneratorPurchase(id: string) {
  const money = useMoneyStore((state) => state.money);
  const purchase = useGeneratorStore((state) => state.purchaseGenerator);
  const purchaseMode = useGeneratorStore((state) => state.purchaseMode);

  const max = useMemo(
    () => getMaxAffordableAmountAndCost(id),
    [id, money.toString()]
  );

  const resolvedAmount = useMemo(() => {
    if (purchaseMode === "max") return max.amount > 0 ? max.amount : 1;
    return 1;
  }, [purchaseMode, max.amount]);

  const resolvedCost = useMemo(() => {
    if (purchaseMode === "max") {
      return max.amount > 0 ? max.cost : getGeneratorCost(id, 1);
    }
    return getGeneratorCost(id, resolvedAmount);
  }, [purchaseMode, resolvedAmount, id, max]);

  const affordable = useMemo(
    () => money.gte(resolvedCost),
    [money, resolvedCost]
  );
  const displayCost = useMemo(() => resolvedCost.toFixed(1), [resolvedCost]);

  const onPurchase = () => {
    if (affordable && resolvedAmount > 0) {
      purchase(id, resolvedAmount);
    }
  };

  return {
    cost: resolvedCost,
    displayCost,
    affordable,
    onPurchase,
    max,
    resolvedAmount,
    purchaseMode,
  };
}
