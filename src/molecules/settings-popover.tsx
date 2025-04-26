import { IconSettings } from "@tabler/icons-react";
import { ClassNameValue, twMerge } from "tailwind-merge";
import {
  Popover,
  PopoverContent,
  PopoverHeading,
  PopoverTrigger,
} from "../ui/Popover";
import { ResetButton } from "./reset-button";
import { ThemeToggle } from "./theme-toggle";

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
            "p-2 border-[1px] border-primary-500 hover:bg-primary-100 dark:hover:bg-primary-600 cursor-pointer",
            className
          )}
        >
          <IconSettings className="w-6 h-6 xl:w-8 xl:h-8 2xl:w-10 2xl:h-10 4xl:w-12 4xl:h-12 text-primary-900 dark:text-primary-200" />
        </button>
      </PopoverTrigger>

      <PopoverContent className="bg-primary-100 dark:bg-primary-800 text-primary-900 dark:text-primary-100 border-primary-500 border-[1px] p-4 w-48 xl:w-52 2xl:w-56 3xl:w-64 outline-none focus:ring-0">
        <PopoverHeading className="font-medium mb-2 responsive-text">
          Settings
        </PopoverHeading>
        <div className="flex flex-col gap-2">
          <ResetButton />
          <ThemeToggle />
        </div>
      </PopoverContent>
    </Popover>
  );
};
