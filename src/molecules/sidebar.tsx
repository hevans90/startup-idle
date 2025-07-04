import { ClassNameValue, twMerge } from "tailwind-merge";
import { useGlobalSettingsStore } from "../state/global-settings.store";
import Tabs from "../ui/Tabs";
import { Generators } from "./generators";
import { InnovationManagers } from "./innovation/innovation-managers";
import { InnovationSummary } from "./innovation/innovation-summary";
import { PurchaseModeToggle } from "./purchase-mode-toggle";
import { Upgrades } from "./upgrades";

export const Sidebar = ({ className }: { className: ClassNameValue }) => {
  const { sidebarTab, setSidebarTab } = useGlobalSettingsStore();

  return (
    <div className={twMerge("bg-primary-200 dark:bg-primary-900", className)}>
      <Tabs
        selectedTab={sidebarTab}
        onTabChange={setSidebarTab}
        tabs={[
          { id: "employees", label: "Employees" },
          { id: "innovation", label: "Innovation" },
        ]}
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
              <InnovationSummary compact={true} className="my-4" />
              <InnovationManagers />
            </div>
          ),
        }}
      </Tabs>
    </div>
  );
};
