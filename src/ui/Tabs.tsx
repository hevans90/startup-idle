import React, { useState } from "react";
import { twMerge } from "tailwind-merge";

type TabDefinition<T extends string> = {
  id: T;
  label: string;
  disabled?: boolean;
  hidden?: boolean;
};

type TabsProps<T extends string> = {
  tabs: TabDefinition<T>[];
  children: Record<T, React.ReactNode>;
  selectedTab?: T;
  onTabChange?: (tabId: T) => void;
};

export default function Tabs<T extends string>({
  tabs,
  children,
  selectedTab,
  onTabChange,
}: TabsProps<T>) {
  const visibleTabs = tabs.filter((tab) => !tab.hidden);
  const firstEnabledTab = visibleTabs.find((tab) => !tab.disabled)?.id;

  const [internalTab, setInternalTab] = useState<T | undefined>(
    firstEnabledTab
  );
  const activeTab = selectedTab ?? internalTab;

  const handleTabChange = (tabId: T) => {
    if (selectedTab === undefined) {
      setInternalTab(tabId);
    }
    onTabChange?.(tabId);
  };

  return (
    <div className="w-full select-none">
      {/* Tab Headers */}
      <div className="flex border-primary-300 dark:border-primary-600 h-[53px]">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => !tab.disabled && handleTabChange(tab.id)}
            disabled={tab.disabled}
            className={twMerge(
              "flex-1 px-4 py-2 text-center text-sm font-medium transition-colors cursor-pointer border-b border-primary-300 dark:border-primary-600 text-primary-400 dark:text-primary-300",
              tab.disabled &&
                "cursor-not-allowed text-primary-300 dark:text-primary-600",
              activeTab === tab.id &&
                "bg-primary-300 dark:bg-primary-800 border-primary-600 dark:border-primary-400 text-primary-900 dark:text-primary-50 cursor-default"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab && <>{children[activeTab]}</>}
    </div>
  );
}
