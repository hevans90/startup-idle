import { useCallback, useEffect } from "react";
import { GeneratorBuyButton } from "./molecules/generator-buy-button";
import { ResetButton } from "./molecules/reset-button";
import { Upgrades } from "./molecules/upgrades";
import { useGeneratorStore } from "./state/generators.store";
import { useMoneyStore } from "./state/money.store";
import { useUpgradeStore } from "./state/upgrades.store";

function App() {
  const { money, increaseMoney } = useMoneyStore();

  const { generators } = useGeneratorStore();

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
          className="text-3xl cursor-pointer hover:bg-primary-200"
          onClick={() => increaseMoney(1)}
        >
          ${money.toFixed(2)}
        </button>
        <div className="text-sm">({mps}/sec)</div>
      </section>
      <div className="flex flex-wrap gap-2">
        {generators.map((gen) => (
          <div
            key={gen.id}
            className="flex flex-col gap-2 items-center border-[1px] border-primary-500 p-4"
          >
            {gen.name} - {gen.amount}
            <GeneratorBuyButton id={gen.id} />
          </div>
        ))}
      </div>
      <Upgrades />
    </div>
  );
}

export default App;
