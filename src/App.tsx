import { useEffect } from "react";
import toast, { resolveValue, Toaster } from "react-hot-toast";
import { Generators } from "./molecules/generators";
import { PurchaseModeToggle } from "./molecules/purchase-mode-toggle";
import { SettingsPopover } from "./molecules/settings-popover";
import { Upgrades } from "./molecules/upgrades";
import { useGeneratorStore } from "./state/generators.store";
import { useInnovationStore } from "./state/innovation.store";
import { useMoneyStore } from "./state/money.store";
import { Toast } from "./ui/Toast";
import { formatCurrency } from "./utils/money-utils";
import { formatRate } from "./utils/rate-utils";

function App() {
  const { money, increaseMoney } = useMoneyStore();
  const { innovation } = useInnovationStore();

  const { tickGenerators } = useGeneratorStore();

  const mps = useGeneratorStore((state) => state.getMoneyPerSecond());
  const ips = useGeneratorStore((state) => state.getInnovationPerSecond());

  const isMobile = window.innerWidth <= 768;

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

      {isMobile ? (
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
          <Generators isMobile={true} />
          <section className="mt-8">
            <Upgrades isMobile={true} />
          </section>
        </div>
      ) : (
        <div className="flex w-full h-full">
          {/* LEFT PANEL */}
          <div className="grow flex flex-col items-center gap-2">
            <section className="flex flex-col items-center">
              <h1 className="responsive-header font-bold mt-16">
                Startup Idle
              </h1>
            </section>
            <section className="flex flex-col items-center mb-6">
              <button
                className="min-w-36 p-2 responsive-subheader cursor-pointer hover:bg-primary-200 dark:hover:bg-primary-600 mb-2"
                onClick={() => increaseMoney(Math.max(mps / 10, 1))}
              >
                {formatCurrency(money)}
              </button>
              <div className="responsive-text">({formatCurrency(mps)}/sec)</div>
            </section>
            {innovation.gte(1) && (
              <>
                <section className="flex flex-col items-center">
                  <div className="responsive-text">
                    <span className="opacity-50">Innovation: </span>
                    <span className="">{innovation.toFixed(2)} </span>
                  </div>
                </section>
                <span className="opacity-50">
                  ({formatRate(ips).formatted})
                </span>
              </>
            )}
          </div>

          {/* SIDEBAR */}
          <div className="bg-primary-200 dark:bg-primary-900 w-md xl:w-lg">
            <div className="w-full p-2">
              <PurchaseModeToggle className="w-full" />
            </div>
            <div className="flex flex-col gap-8">
              <Generators isMobile={false} />
              <Upgrades isMobile={false} />
            </div>
          </div>
        </div>
      )}

      <SettingsPopover className="absolute top-4 left-4" />
    </>
  );
}

export default App;
