import React, { useEffect, useRef, useState } from "react";
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
  const visibleTabIds = new Set(visibleTabs.map((t) => t.id));
  const firstEnabledTab = visibleTabs.find((tab) => !tab.disabled)?.id;

  const [internalTab, setInternalTab] = useState<T | undefined>(
    firstEnabledTab
  );
  const rawActive = selectedTab ?? internalTab;
  // If the persisted/selected tab is no longer in the visible list, fall back.
  const activeTab = rawActive !== undefined && visibleTabIds.has(rawActive)
    ? rawActive
    : firstEnabledTab;

  // When the controlled selectedTab becomes hidden and we silently render a
  // different tab, notify the parent so its state stays in sync.
  useEffect(() => {
    if (
      selectedTab !== undefined &&
      activeTab !== undefined &&
      activeTab !== selectedTab
    ) {
      onTabChange?.(activeTab);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // THE CHOSEN TAB IN SIGHT, where the row scrolls: one opened from elsewhere — the
  // Data Centre opening the AI tab — may be off the end of it.
  const headers = useRef<Partial<Record<T, HTMLButtonElement | null>>>({});
  useEffect(() => {
    if (activeTab !== undefined) headers.current[activeTab]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeTab]);

  const handleTabChange = (tabId: T) => {
    if (selectedTab === undefined) {
      setInternalTab(tabId);
    }
    onTabChange?.(tabId);
  };

  return (
    <div className="flex h-full w-full select-none flex-col">
      {/* Tab Headers: a label a line each, tighter where the row is narrow, and
          scrolling sideways — a thin bar says so — rather than wrapping when there are too many. */}
      <div className="@container flex h-[53px] shrink-0 overflow-x-auto overflow-y-hidden border-primary-300 [scrollbar-width:thin] dark:border-primary-600">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            ref={(el) => { headers.current[tab.id] = el; }}
            // A handle for first-run hints to point at. @see HintCard
            data-hint={`tab-${tab.id}`}
            onClick={() => !tab.disabled && handleTabChange(tab.id)}
            disabled={tab.disabled}
            className={twMerge(
              "flex-auto shrink-0 whitespace-nowrap px-1.5 py-2 text-center text-[11px] font-medium transition-colors cursor-pointer border-b border-primary-300 dark:border-primary-600 text-primary-400 dark:text-primary-300 @xs:px-2 @xs:text-xs @md:px-4 @md:text-sm",
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
      {activeTab && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {children[activeTab]}
        </div>
      )}
    </div>
  );
}
