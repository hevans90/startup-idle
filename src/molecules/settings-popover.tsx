import { IconSettings } from "@tabler/icons-react";
import { ClassNameValue, twMerge } from "tailwind-merge";
import {
  Popover,
  PopoverContent,
  PopoverHeading,
  PopoverTrigger,
} from "../ui/Popover";
import { MapEventsToggle } from "./map-events-toggle";
import { DayNightToggle } from "./day-night-toggle";
import { SoundControls } from "./sound-controls";
import { ResetButton } from "./reset-button";
import { ThemeToggle } from "./theme-toggle";
import { POPOVER } from "../ui/console";

export const SettingsPopover = ({
  className,
}: {
  className?: ClassNameValue;
}) => {
  return (
    <Popover
      openOnHover={true}
      persistOnHoverContent={true}
      placement="right-start"
    >
      <PopoverTrigger asChild>
        <button
          className={twMerge(
            "p-2 border-[1px] border-primary-500 hover:bg-primary-100 dark:hover:bg-primary-600 cursor-pointer flex justify-center items-center",
            className
          )}
        >
          <IconSettings className="h-6 w-6 text-fg xl:h-7 xl:w-7" />
        </button>
      </PopoverTrigger>

      <PopoverContent className={twMerge(POPOVER, "w-64")}>
        <PopoverHeading className="font-medium mb-2 responsive-text">
          Settings
        </PopoverHeading>
        <div className="flex flex-col gap-2">
          <ResetButton />
          <ThemeToggle />
          <MapEventsToggle />
          <DayNightToggle />
          <SoundControls />
        </div>
      </PopoverContent>
    </Popover>
  );
};
