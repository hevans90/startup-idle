import { FloatingTree } from "@floating-ui/react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { evaluateAchievements } from "./game/achievements.engine";
import {
  computeOfflineProgress,
  type OfflineSummary,
} from "./game/offline-progress";
import { useCompareVersion } from "./hooks/use-compare-version";
import { AscensionCard } from "./molecules/ascension-card";
import { DevDrawer } from "./molecules/dev-panel";
import { EmployeeSatisfactionOverlay } from "./molecules/employee-satisfaction-overlay";
import { FounderSelect } from "./molecules/founder-select";
import { GameStageTicker } from "./molecules/game-stage-ticker";
import { Generators } from "./molecules/generators";
import { InnovationCounter } from "./molecules/innovation-counter";
import { OfflineSummaryModal } from "./molecules/offline-summary";
import { whenWorldReady } from "./game/world-ready";
import { PurchaseModeToggle } from "./molecules/purchase-mode-toggle";
import { SellTransitionProvider } from "./molecules/sell-transition";
import { SettingsPopover } from "./molecules/settings-popover";
import { Sidebar } from "./molecules/sidebar";
import { Toolbar } from "./molecules/toolbar";
import { Upgrades } from "./molecules/upgrades";
import { VapeMapWrapper } from "./molecules/vape-map-wrapper";
import { useFounderStore } from "./state/founder.store";
import { useGeneratorStore } from "./state/generators.store";
import { useInnovationStore } from "./state/innovation.store";
import { useMoneyStore } from "./state/money.store";
import { useSessionStore } from "./state/session.store";
import { useThemeStore } from "./state/theme.store";
import { useGlobalSettingsStore } from "./state/global-settings.store";
import { listen, setLevel, setMix } from "./audio/sound";
import { formatCurrency } from "./utils/money-utils";
import { NoticeToast } from "./ui/comms/notice-toast";

/** Vibe coders this run before the vape appears on the map. */
const VAPE_UNLOCK_VIBE_CODERS = 50;

/** The company's map, in its own chunk. @see CompanyMap */
const CompanyMap = lazy(() => import("./world/play/company-map"));

const useDynamicTitle = (interval = 1000) => {
  useEffect(() => {
    const id = setInterval(() => {
      document.title = `Startup Idle ${formatCurrency(
        useMoneyStore.getState().money,
        {
          exponentBreakpoint: 1e3,
          decimals: 0,
        },
      )}`;
    }, interval);

    return () => clearInterval(id);
  }, [interval]);
};

function App() {
  useCompareVersion();
  const money = useMoneyStore((s) => s.money);
  const increaseMoney = useMoneyStore((s) => s.increaseMoney);
  const innovation = useInnovationStore((s) => s.innovation);

  const lastAchievementEvalRef = useRef(0);

  const getMoneyPerSecond = useGeneratorStore((s) => s.getMoneyPerSecond);
  const mps = getMoneyPerSecond();
  const vibeCoderCount = useGeneratorStore(
    (s) => s.generators.find((g) => g.id === "vibe_coder")?.amount ?? 0,
  );
  // THE VAPE comes with THIS company's vibe coders, not with an achievement:
  // achievements outlive a run, so tying it to "Vibe army" put a clickable
  // vape on the map of every new game after the first that earned it.
  const vapeVisible = vibeCoderCount >= VAPE_UNLOCK_VIBE_CODERS;

  const founderId = useFounderStore((state) => state.selectedFounderId);

  const [offlineSummary, setOfflineSummary] = useState<OfflineSummary | null>(
    null,
  );

  const isMobile = window.innerWidth <= 768;
  const [phoneTab, setPhoneTab] = useState<"map" | "company">("map");
  // SENT FROM THE MAP to show the company's side — a project's gate, say, whose
  // upgrade is bought on the Employees tab. @see showUpgrades
  useEffect(() => {
    const show = () => setPhoneTab("company");
    window.addEventListener("startup:show-company", show);
    return () => window.removeEventListener("startup:show-company", show);
  }, []);

  const { theme } = useThemeStore();

  useDynamicTitle();

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [theme]);

  // Credit offline progression once, BEFORE the live loop starts ticking (it
  // resets globalLastTick to now, so the first live tick can't double-count)
  // — and, with a company, once its map is up, so the time away is played by
  // the town's rules: its beds, wonders, labs and who is away. @see whenWorldReady
  const [offlineDone, setOfflineDone] = useState(false);
  useEffect(() => {
    const run = () => {
      const summary = computeOfflineProgress();
      if (summary) setOfflineSummary(summary);
      setOfflineDone(true);
    };
    if (useFounderStore.getState().selectedFounderId == null) { run(); return; }
    return whenWorldReady(run, 8000);
  }, []);

  // Mark presence so the next visit can measure time away: periodically and
  // whenever the tab is hidden/closed (the most reliable last-write before exit).
  useEffect(() => {
    // Not before the time away is credited: a touch would erase it.
    if (!offlineDone) return;
    const touch = () => useSessionStore.getState().touch();
    const id = setInterval(touch, 5000);
    const onHide = () => {
      if (document.visibilityState === "hidden") touch();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", touch);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", touch);
    };
  }, [offlineDone]);

  // SOUND: started on the first gesture, buttons click, and the level kept to the player's settings. @see audio/sound
  useEffect(() => {
    const stop = listen();
    const apply = () => {
      const g = useGlobalSettingsStore.getState();
      setLevel(g.volume, g.muted);
      // Each bus's share, and ticks only when asked for and the console is not calm. @see setMix
      setMix({ effects: g.effects, interface: g.interface, ambience: g.ambience, ticks: g.ticks && g.motion !== "calm" });
    };
    apply();
    const unsub = useGlobalSettingsStore.subscribe(apply);
    return () => { stop(); unsub(); };
  }, []);

  useEffect(() => {
    if (founderId == null || !offlineDone) return;

    // Grant any already-met achievements (e.g. from a loaded save) immediately
    // rather than waiting for the first throttled tick.
    lastAchievementEvalRef.current = Date.now();
    evaluateAchievements();

    const id = setInterval(() => {
      useGeneratorStore.getState().tickGenerators();
      useInnovationStore.getState().tickManagers();
      const now = Date.now();
      if (now - lastAchievementEvalRef.current >= 1000) {
        lastAchievementEvalRef.current = now;
        evaluateAchievements();
      }
    }, 16);
    return () => clearInterval(id);
  }, [founderId, offlineDone]);

  return (
    <FloatingTree>
      {/* COMMS' NOTICES: a refusal, by the pointer. @see NoticeToast */}
      <NoticeToast />

      {offlineSummary && (
        <OfflineSummaryModal
          summary={offlineSummary}
          onClose={() => setOfflineSummary(null)}
        />
      )}

      <SellTransitionProvider>
        {founderId == null ? (
          <FounderSelect />
        ) : isMobile ? (
          // THE PHONE: the map and the company, a tab each. The map stays
          // mounted on the other tab, so its gates — beds, projects, the
          // commute — hold on a phone as on a desktop. @see useFoundWorld
          <div className="flex h-full w-full flex-col bg-primary-50 dark:bg-primary-900">
            <header className="flex items-center gap-2 border-b border-primary-300 px-2 py-1 dark:border-primary-700">
              <SettingsPopover className="h-9 w-9 border-none p-1" />
              <button className="cursor-pointer text-left" onClick={() => increaseMoney(Math.max(mps / 10, 1))}>
                <span className="block text-lg font-bold leading-tight">{formatCurrency(money)}</span>
                <span className="block text-[11px] text-primary-600 dark:text-primary-400">{formatCurrency(mps)}/s</span>
              </button>
              <span className="flex-1" />
              {(["map", "company"] as const).map((t) => (
                <button key={t} type="button" onClick={() => setPhoneTab(t)}
                  className={`cursor-pointer border px-3 py-1 text-sm ${phoneTab === t
                    ? "border-primary-700 bg-primary-200 dark:border-primary-200 dark:bg-primary-700"
                    : "border-primary-300 dark:border-primary-600"}`}>
                  {t === "map" ? "Map" : "Company"}
                </button>
              ))}
            </header>
            <div className="relative min-h-0 flex-1">
              <div className={`absolute inset-0 ${phoneTab === "map" ? "" : "invisible"}`}>
                <Suspense fallback={null}>
                  <CompanyMap hidden={phoneTab !== "map"} />
                </Suspense>
              </div>
              {phoneTab === "company" && (
                <div className="absolute inset-0 flex flex-col items-center gap-2 overflow-y-auto bg-primary-50 pt-4 dark:bg-primary-900">
                  {innovation.gte(1) && <InnovationCounter />}
                  <PurchaseModeToggle />
                  <Generators isMobile={true} />
                  <section className="mt-8">
                    <Upgrades isMobile={true} />
                  </section>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-0 w-full">
            {/* LEFT PANEL */}
            <div className="relative flex h-full min-h-0 w-2/3 flex-col items-center">
              <Toolbar />

              <GameStageTicker className="absolute top-13 left-0 right-0 z-20" />

              <div className="relative min-h-0 w-full flex-1 basis-0 overflow-hidden">
                {/* THE COMPANY'S MAP, where the old procedural city was: its
                    own town, built on under the game's rules. Loaded lazily —
                    the map engine is most of the bundle. @see CompanyMap */}
                <div className="absolute inset-0 z-0 min-h-0">
                  <Suspense fallback={null}>
                    <CompanyMap />
                  </Suspense>
                </div>

                <EmployeeSatisfactionOverlay className="absolute bottom-3 right-3 z-10" />

                {/* THE DEV DRAWER, in development: ` to open it, out of comms' way. @see DevPanel */}
                <DevDrawer />

                <AscensionCard className="absolute left-1/2 top-1/4 z-30 -translate-x-1/2" />

                <div className="absolute bottom-2 left-2 z-10 flex flex-col gap-1 items-start">
                  {vapeVisible && <VapeMapWrapper />}
                </div>
              </div>
            </div>

            {/* SIDEBAR */}
            <Sidebar className="h-full min-h-0 min-w-0 max-w-1/3 flex-1 overflow-hidden" />
          </div>
        )}
      </SellTransitionProvider>
    </FloatingTree>
  );
}

export default App;
