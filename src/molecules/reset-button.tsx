import { useCallback } from "react";
import toast from "react-hot-toast";
import { useGeneratorStore } from "../state/generators.store";
import { useInnovationStore } from "../state/innovation.store";
import { useMoneyStore } from "../state/money.store";
import { useUpgradeStore } from "../state/upgrades.store";
import { useValuationStore } from "../state/valuation.store";
import { Button } from "../ui/Button";

export const ResetButton = () => {
  const { reset: resetMoney } = useMoneyStore();
  const { reset: resetGenerators } = useGeneratorStore();
  const { reset: resetUpgrades } = useUpgradeStore();
  const { reset: resetInnovation } = useInnovationStore();
  const { reset: resetValuation } = useValuationStore();

  const totalReset = useCallback(() => {
    if (confirm("This will reset all progress, are you sure?")) {
      resetGenerators();
      resetMoney();
      resetUpgrades();
      resetInnovation();
      resetValuation();
      toast.success("Game fully reset. All progress wiped.");
    }
  }, [resetGenerators, resetInnovation, resetMoney, resetUpgrades, resetValuation]);

  return (
    <Button
      onClick={totalReset}
      className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 responsive-text"
    >
      Reset Game
    </Button>
  );
};
