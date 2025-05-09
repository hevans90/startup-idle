import { ClassNameValue, twMerge } from "tailwind-merge";
import { useInnovationStore } from "../state/innovation.store";
import Tabs from "../ui/Tabs";
import { Generators } from "./generators";
import { PurchaseModeToggle } from "./purchase-mode-toggle";
import { Upgrades } from "./upgrades";

export const Sidebar = ({ className }: { className: ClassNameValue }) => {
  const { innovation } = useInnovationStore();

  const innovationEnabled = innovation.gte(1);
  return (
    <div className={twMerge("bg-primary-200 dark:bg-primary-900", className)}>
      <Tabs
        tabs={[
          { id: "production", label: "Production" },
          { id: "innovation", label: "Innovation", hidden: !innovationEnabled },
        ]}
      >
        {{
          production: (
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
              Coming soon!
            </div>
          ),
        }}
      </Tabs>
    </div>
  );
};
