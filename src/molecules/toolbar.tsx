import { ClassNameValue, twMerge } from "tailwind-merge";
import { ToolbarInnovationCounter } from "./innovation-counter";
import { SettingsPopover } from "./settings-popover";

export const Toolbar = ({ className }: { className?: ClassNameValue }) => {
  return (
    <div
      className={twMerge(
        "w-full h-14 bg-primary-200 dark:bg-primary-900 flex justify-start items-center gap-2",
        className
      )}
    >
      <SettingsPopover className="border-none w-14 h-full" />

      <ToolbarInnovationCounter />
    </div>
  );
};
