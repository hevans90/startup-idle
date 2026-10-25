import { useEffect, type ReactNode } from "react";
import { ClassNameValue, twMerge } from "tailwind-merge";

import { useAiSingularityStore } from "../state/ai-singularity.store";
import { useGlobalSettingsStore, type SidebarTab } from "../state/global-settings.store";
import { useInnovationStore } from "../state/innovation.store";
import { useValuationStore } from "../state/valuation.store";
import { useVapeAchievementsStore } from "../state/vape-achievements.store";
import { OverseerBackdrop, Tabs, type TabItem } from "../ui/console";
import { AcquisitionTab } from "./acquisition-tab";
import { AchievementsTab } from "./achievements-tab";
import { AiTab } from "./ai-tab";
import { projectReading } from "../game/projects";
import { useGenerationStore } from "../state/generation.store";
import { Generators } from "./generators";
import { InnovationManagers } from "./innovation/innovation-managers";
import { InnovationSummary } from "./innovation/innovation-summary";
import { PurchaseModeToggle } from "./purchase-mode-toggle";
import { Upgrades } from "./upgrades";
import { ValuationTab } from "./valuation-tab";

function useVapeVisible() {
  return useVapeAchievementsStore((s) => s.unlockedAchievementIds.length > 0);
}

export const Sidebar = ({ className }: { className: ClassNameValue }) => {
  const { sidebarTab, setSidebarTab } = useGlobalSettingsStore();
  const vapeVisible = useVapeVisible();
  const employeeMgmtUnlocked = useInnovationStore(
    (s) => s.unlocks.employeeManagement?.unlocked ?? false,
  );
  const accruedThisRun = useValuationStore((s) => s.accruedThisRun);
  const acquisitionVisible = accruedThisRun.gte(100);
  // THE AI: once the Data Centre stands, the AI has reached the singularity, or any Ascension has been made.
  const generation = useGenerationStore((s) => s.generation);
  const aiVisible = useAiSingularityStore((s) => s.everCompleted) || generation > 1 || (projectReading()?.built.has("datacentre") ?? false);

  const tabs: TabItem<SidebarTab>[] = [
    { id: "employees", label: "Employees" },
    { id: "innovation", label: "Innovation" },
    ...(employeeMgmtUnlocked ? [{ id: "valuation" as SidebarTab, label: "Valuation" }] : []),
    ...(acquisitionVisible ? [{ id: "acquisition" as SidebarTab, label: "Acquisition" }] : []),
    ...(vapeVisible ? [{ id: "achievements" as SidebarTab, label: "Vape shop" }] : []),
    ...(aiVisible ? [{ id: "ai" as SidebarTab, label: "AI" }] : []),
  ];
  // A tab no longer shown — the AI's, after a sale — falls back to the first, and says so.
  const tab = tabs.some((t) => t.id === sidebarTab) ? sidebarTab : tabs[0].id;
  useEffect(() => { if (tab !== sidebarTab) setSidebarTab(tab); }, [tab, sidebarTab, setSidebarTab]);

  const body: Record<SidebarTab, ReactNode> = {
    employees: (
      <div className="flex flex-col gap-6 p-2">
        <PurchaseModeToggle />
        <Generators />
        <Upgrades />
      </div>
    ),
    innovation: (
      <div className="flex w-full flex-col items-center gap-4 p-2 pt-4">
        <InnovationSummary compact={true} className="my-1" />
        <InnovationManagers />
      </div>
    ),
    valuation: <ValuationTab />,
    acquisition: <AcquisitionTab />,
    achievements: <AchievementsTab />,
    ai: <AiTab />,
  };

  return (
    <div className={twMerge("relative flex h-full select-none flex-col overflow-hidden bg-surface-1 text-fg", className)}>
      <OverseerBackdrop />
      <Tabs label="The company" hint="tab" tabs={tabs} value={tab} onChange={setSidebarTab} className="relative h-12 shrink-0 bg-surface-1 px-1" />
      <div role="tabpanel" className="relative min-h-0 flex-1 overflow-y-auto">{body[tab]}</div>
    </div>
  );
};
