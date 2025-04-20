import { useEffect } from "react";
import { Generators } from "./molecules/generators";
import { SettingsPopover } from "./molecules/settings-popover";
import { Upgrades } from "./molecules/upgrades";
import { useGeneratorStore } from "./state/generators.store";
import { useMoneyStore } from "./state/money.store";
import { formatCurrency } from "./utils/money-utils";

function App() {
  const { money, increaseMoney } = useMoneyStore();

  const { tickGenerators } = useGeneratorStore();

  const mps = useGeneratorStore((state) => state.getMoneyPerSecond());

  useEffect(() => {
    setInterval(() => {
      tickGenerators();
    }, 200); // check every 200ms for ticks
  }, []);

  return (
    <>
      <div className="w-full h-full flex flex-col items-center pt-16 gap-8 bg-primary-50 dark:bg-primary-800 text-primary-900 dark:text-primary-300">
        <section className="flex flex-col items-center">
          <h1 className="text-4xl font-bold">Startup Idle</h1>
        </section>
        <section className="flex flex-col items-center">
          <button
            className="p-2 text-3xl cursor-pointer hover:bg-primary-200 dark:hover:bg-primary-600 mb-2"
            onClick={() => increaseMoney(Math.max(mps / 10, 1))}
          >
            {formatCurrency(money)}
          </button>
          <div className="text-sm">({formatCurrency(mps)}/sec)</div>
        </section>
        <Generators />
        <Upgrades />
      </div>
      <SettingsPopover className="absolute top-4 right-4" />
    </>
  );
}

export default App;
