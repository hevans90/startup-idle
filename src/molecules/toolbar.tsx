import { ClassNameValue, twMerge } from "tailwind-merge";
import { useInnovationStore } from "../state/innovation.store";
import { ToolbarInnovationCounter } from "./innovation-counter";
import { SettingsPopover } from "./settings-popover";

export const Toolbar = ({ className }: { className?: ClassNameValue }) => {
  const { innovation } = useInnovationStore();

  return (
    <div
      className={twMerge(
        "w-full h-14 bg-primary-200 dark:bg-primary-900 flex justify-start items-center gap-2",
        className
      )}
    >
      <SettingsPopover className="border-none w-14 h-full" />

      {innovation.gte(1) && <ToolbarInnovationCounter />}
    </div>
  );
};
