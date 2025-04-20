import { useEffect } from "react";
import toast, { resolveValue, Toaster } from "react-hot-toast";
import { Generators } from "./molecules/generators";
import { PurchaseModeToggle } from "./molecules/purchase-mode-toggle";
import { SettingsPopover } from "./molecules/settings-popover";
import { Upgrades } from "./molecules/upgrades";
import { useGeneratorStore } from "./state/generators.store";
import { useMoneyStore } from "./state/money.store";
import { Toast } from "./ui/Toast";
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
      <Toaster position="bottom-center" toastOptions={{ duration: 3000 }}>
        {(t) => (
          <Toast onClose={() => toast.dismiss(t.id)} icon={t.icon}>
            {resolveValue(t.message, t)}
          </Toast>
        )}
      </Toaster>
      <div className="w-full h-full flex flex-col items-center pt-16 gap-2">
        <section className="flex flex-col items-center">
          <h1 className="text-4xl font-bold">Startup Idle</h1>
        </section>
        <section className="flex flex-col items-center mb-6">
          <button
            className="min-w-36 p-2 text-3xl cursor-pointer hover:bg-primary-200 dark:hover:bg-primary-600 mb-2"
            onClick={() => increaseMoney(Math.max(mps / 10, 1))}
          >
            {formatCurrency(money)}
          </button>
          <div className="text-sm">({formatCurrency(mps)}/sec)</div>
        </section>
        <PurchaseModeToggle />
        <Generators />
        <section className="mt-8">
          <Upgrades />
        </section>
      </div>
      <SettingsPopover className="absolute top-4 right-4" />
    </>
  );
}

export default App;
