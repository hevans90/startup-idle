import { ClassNameValue, twMerge } from "tailwind-merge";
import { useGlobalSettingsStore, type SidebarTab } from "../state/global-settings.store";
import { useInnovationStore } from "../state/innovation.store";
import { useValuationStore } from "../state/valuation.store";
import { useVapeAchievementsStore } from "../state/vape-achievements.store";
import Tabs from "../ui/Tabs";
import { AcquisitionTab } from "./acquisition-tab";
import { AchievementsTab } from "./achievements-tab";
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

  const tabs: { id: SidebarTab; label: string }[] = [
    { id: "employees", label: "Employees" },
    { id: "innovation", label: "Innovation" },
    ...(employeeMgmtUnlocked ? [{ id: "valuation" as SidebarTab, label: "Valuation" }] : []),
    ...(acquisitionVisible ? [{ id: "acquisition" as SidebarTab, label: "Acquisition" }] : []),
    ...(vapeVisible ? [{ id: "achievements" as SidebarTab, label: "Vape shop" }] : []),
  ];

  return (
    <div className={twMerge("flex h-full flex-col overflow-hidden bg-primary-200 dark:bg-primary-900", className)}>
      <Tabs
        selectedTab={sidebarTab}
        onTabChange={setSidebarTab}
        tabs={tabs}
      >
        {{
          employees: (
            <div>
              <div className="w-full p-2">
                <PurchaseModeToggle className="w-full" />
              </div>
              <div className="flex flex-col gap-8">
                <Generators isMobile={false} />
                <Upgrades isMobile={false} />
              </div>
            </div>
          ),
          innovation: (
            <div className="p-2 pt-4 w-full h-full flex flex-col gap-4 items-center justify-center">
              <InnovationSummary compact={true} className="my-1" />
              <InnovationManagers />
            </div>
          ),
          valuation: <ValuationTab />,
          acquisition: <AcquisitionTab />,
          achievements: <AchievementsTab />,
        }}
      </Tabs>
    </div>
  );
};
