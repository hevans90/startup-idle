import { FloatingTree } from "@floating-ui/react";
import { useEffect, useRef } from "react";
import toast, { resolveValue, Toaster } from "react-hot-toast";
import { useCompareVersion } from "./hooks/use-compare-version";
import { useResizeToWrapper } from "./hooks/use-resize-to-wrapper";
import { Generators } from "./molecules/generators";
import { InnovationCounter } from "./molecules/innovation-counter";
import { PurchaseModeToggle } from "./molecules/purchase-mode-toggle";
import { SettingsPopover } from "./molecules/settings-popover";
import { Sidebar } from "./molecules/sidebar";
import { Toolbar } from "./molecules/toolbar";
import { Upgrades } from "./molecules/upgrades";
import { Office } from "./office/office";
import { useGeneratorStore } from "./state/generators.store";
import { useInnovationStore } from "./state/innovation.store";
import { useMoneyStore } from "./state/money.store";
import { useThemeStore } from "./state/theme.store";
import { useVersionStore } from "./state/version.store";
import { Toast } from "./ui/Toast";
import { formatCurrency } from "./utils/money-utils";

const useDynamicTitle = (interval = 1000) => {
  useEffect(() => {
    const id = setInterval(() => {
      document.title = `Startup Idle ${formatCurrency(
        useMoneyStore.getState().money,
        {
          exponentBreakpoint: 1e3,
          decimals: 0,
        }
      )}`;
    }, interval);

    return () => clearInterval(id);
  }, [interval]);
};

function App() {
  const version = useVersionStore((state) => state.version);
  useCompareVersion();
  const { money, increaseMoney } = useMoneyStore();
  const { innovation } = useInnovationStore();

  const officeWrapperRef = useRef<HTMLDivElement>(null);
  const wrapperSize = useResizeToWrapper(officeWrapperRef);

  const { tickGenerators } = useGeneratorStore();
  const { tickManagers } = useInnovationStore();

  const mps = useGeneratorStore((state) => state.getMoneyPerSecond());

  const isMobile = window.innerWidth <= 768;

  const { theme } = useThemeStore();

  useDynamicTitle();

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [theme]);

  useEffect(() => {
    setInterval(() => {
      tickGenerators();
      tickManagers();
    }, 16); // check every 16ms for ticks (60fps)
  }, []);

  return (
    <FloatingTree>
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
          {innovation.gte(1) && <InnovationCounter />}
          <PurchaseModeToggle />
          <Generators isMobile={true} />
          <section className="mt-8">
            <Upgrades isMobile={true} />
          </section>
          <SettingsPopover className="absolute top-4 left-4" />
        </div>
      ) : (
        <div className="flex w-full h-full">
          {/* LEFT PANEL */}
          <div className="w-2/3 flex flex-col items-center">
            <Toolbar />

            <div ref={officeWrapperRef} className="w-full h-full relative">
              <div className="absolute w-full">
                <section className="flex flex-col items-center">
                  <h1 className="responsive-header font-bold mt-6">
                    Startup Idle
                  </h1>
                  <button
                    className="min-w-36 p-2 responsive-subheader cursor-pointer hover:bg-primary-200 dark:hover:bg-primary-600"
                    onClick={() => increaseMoney(Math.max(mps / 10, 1))}
                  >
                    {formatCurrency(money)}
                  </button>
                  <div className="responsive-text">
                    ({formatCurrency(mps)}/sec)
                  </div>
                </section>
              </div>

              {wrapperSize && (
                <Office
                  wrapperRef={officeWrapperRef}
                  wrapperSize={wrapperSize}
                />
              )}

              <div className="absolute bottom-2 left-2 responsive-text-sm text-primary-300">
                v{version}
              </div>
            </div>
          </div>

          {/* SIDEBAR */}
          <Sidebar className="grow max-w-1/3" />
        </div>
      )}
    </FloatingTree>
  );
}

export default App;
