import { useCallback, useEffect } from "react";
import { Generators } from "./molecules/generators";
import { ResetButton } from "./molecules/reset-button";
import { Upgrades } from "./molecules/upgrades";
import { useGeneratorStore } from "./state/generators.store";
import { useMoneyStore } from "./state/money.store";
import { useUpgradeStore } from "./state/upgrades.store";
import { formatCurrency } from "./utils/money-utils";

function App() {
  const { money, increaseMoney } = useMoneyStore();

  const { reset: resetMoney } = useMoneyStore();
  const { reset: resetGenerators, tickGenerators } = useGeneratorStore();
  const { reset: resetUpgrades } = useUpgradeStore();

  const mps = useGeneratorStore((state) => state.getMoneyPerSecond());

  const totalReset = useCallback(() => {
    resetGenerators();
    resetMoney();
    resetUpgrades();
  }, []);

  useEffect(() => {
    setInterval(() => {
      tickGenerators();
    }, 200); // check every 200ms for ticks
  }, []);

  return (
    <div className="w-full flex flex-col items-center pt-16 gap-8">
      <section className="prose flex flex-col items-center">
        <h1>Startup Idle</h1>
        <ResetButton onReset={totalReset} />
      </section>
      <section className="flex flex-col items-center">
        <button
          className="text-3xl cursor-pointer hover:bg-primary-200 mb-2"
          onClick={() => increaseMoney(mps / 10)}
        >
          {formatCurrency(money)}
        </button>
        <div className="text-sm">({mps}/sec)</div>
      </section>
      <Generators />
      <Upgrades />
    </div>
  );
}

export default App;
