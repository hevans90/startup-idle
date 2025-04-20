import { useCallback } from "react";
import { useGeneratorStore } from "../state/generators.store";
import { useMoneyStore } from "../state/money.store";
import { useUpgradeStore } from "../state/upgrades.store";
import { Button } from "../ui/Button";

export const ResetButton = () => {
  const { reset: resetMoney } = useMoneyStore();
  const { reset: resetGenerators } = useGeneratorStore();
  const { reset: resetUpgrades } = useUpgradeStore();

  const totalReset = useCallback(() => {
    if (confirm("This will reset all progress, are you sure?")) {
      resetGenerators();
      resetMoney();
      resetUpgrades();
    }
  }, []);

  return (
    <Button
      onClick={totalReset}
      className="bg-red-500 hover:bg-red-600 text-white px-4 py-2"
    >
      Reset Game
    </Button>
  );
};
