import { useMemo } from "react";

import { useMoneyStore } from "../state/money.store";

import { useGeneratorStore, type GeneratorId } from "../state/generators.store";
import { roomFor } from "../game/housing";
import {
  getGeneratorCost,
  getMaxAffordableAmountAndCost,
} from "../utils/generator-utils";

export function useGeneratorPurchase(id: string) {
  const money = useMoneyStore((state) => state.money);
  const purchase = useGeneratorStore((state) => state.purchaseGenerator);
  const purchaseMode = useGeneratorStore((state) => state.purchaseMode);

  const owned = useGeneratorStore(
    (state) => state.generators.find((g) => g.id === id)?.amount ?? 0
  );
  // Read every render: the map can add beds without anything here changing.
  const room = roomFor(id as GeneratorId, owned);
  // Capped by the beds as well as the money. @see getMaxAffordableAmountAndCost
  const max = useMemo(
    () => getMaxAffordableAmountAndCost(id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, money.toString(), owned, room]
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

  /**
   * BEDS, AND WHETHER THERE ARE ENOUGH FOR THIS HIRE.
   *
   * Recomputed against the owned count rather than held, because the map can
   * change under it — a building placed in the world view raises this without
   * anything here being told. `Infinity` while no map is registered, which is
   * what keeps the game playable on its own. @see roomFor
   *
   * The store refuses the purchase anyway; this is so the BUTTON can say so
   * rather than looking broken when it is clicked and nothing happens.
   */
  const beds = room;
  const housed = beds >= resolvedAmount;

  const onPurchase = () => {
    if (affordable && housed && resolvedAmount > 0) {
      purchase(id, resolvedAmount);
    }
  };

  return {
    cost: resolvedCost,
    displayCost,
    affordable,
    /** Whether there is somewhere for this hire to live. @see housing */
    housed,
    /** Beds free right now — for the readout, and `Infinity` with no map. */
    beds,
    onPurchase,
    max,
    resolvedAmount,
    purchaseMode,
  };
}
