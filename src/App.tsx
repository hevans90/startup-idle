import { FloatingTree } from "@floating-ui/react";
import { useEffect, useRef } from "react";
import toast, { resolveValue, Toaster } from "react-hot-toast";
import { useCompareVersion } from "./hooks/use-compare-version";
import { useResizeToWrapper } from "./hooks/use-resize-to-wrapper";
import { AiSingularityReadout } from "./molecules/ai-singularity-readout";
import { EmployeeSatisfactionOverlay } from "./molecules/employee-satisfaction-overlay";
import { GameStageTicker } from "./molecules/game-stage-ticker";
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
        <div className="flex h-full min-h-0 w-full">
          {/* LEFT PANEL */}
          <div className="relative flex h-full min-h-0 w-2/3 flex-col items-center">
            <Toolbar />

            <GameStageTicker className="absolute top-13 left-0 right-0 z-20" />

            <div className="relative min-h-0 w-full flex-1 basis-0 overflow-hidden">
              <div className="absolute left-0 right-0 top-8 z-[1] w-full">
                <section className="mt-6 flex flex-col items-center">
                  <h1 className="responsive-header font-bold">
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

              <div
                ref={officeWrapperRef}
                className="absolute inset-x-0 bottom-0 top-8 z-0 min-h-0"
              >
                {wrapperSize && (
                  <Office
                    wrapperRef={officeWrapperRef}
                    wrapperSize={wrapperSize}
                  />
                )}
              </div>

              <EmployeeSatisfactionOverlay className="absolute bottom-3 right-3 z-10" />

              <div className="absolute bottom-2 left-2 z-10 flex flex-col gap-1 items-start">
                <AiSingularityReadout />
                <div className="responsive-text-sm text-primary-300">v{version}</div>
              </div>
            </div>
          </div>

          {/* SIDEBAR */}
          <Sidebar className="h-full min-h-0 min-w-0 max-w-1/3 flex-1 overflow-y-auto" />
        </div>
      )}
    </FloatingTree>
  );
}

export default App;
