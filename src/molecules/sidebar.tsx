import { ClassNameValue, twMerge } from "tailwind-merge";
import { useGlobalSettingsStore } from "../state/global-settings.store";
import { useInnovationStore } from "../state/innovation.store";
import Tabs from "../ui/Tabs";
import { Generators } from "./generators";
import { InnovationManagers } from "./innovation-managers";
import { PurchaseModeToggle } from "./purchase-mode-toggle";
import { Upgrades } from "./upgrades";

export const Sidebar = ({ className }: { className: ClassNameValue }) => {
  const { innovation } = useInnovationStore();

  const innovationEnabled = innovation.gte(1);

  const { sidebarTab, setSidebarTab } = useGlobalSettingsStore();

  return (
    <div className={twMerge("bg-primary-200 dark:bg-primary-900", className)}>
      <Tabs
        selectedTab={sidebarTab}
        onTabChange={setSidebarTab}
        tabs={[
          { id: "employees", label: "Employees" },
          { id: "innovation", label: "Innovation", hidden: !innovationEnabled },
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
            <div className="p-2 w-full h-full flex items-center justify-center">
              <InnovationManagers />
            </div>
          ),
        }}
      </Tabs>
    </div>
  );
};
