import { IconSettings } from "@tabler/icons-react";
import { ClassNameValue, twMerge } from "tailwind-merge";
import {
  Popover,
  PopoverContent,
  PopoverHeading,
  PopoverTrigger,
} from "../ui/Popover";
import { ResetButton } from "./reset-button";

export const SettingsPopover = ({
  className,
}: {
  className?: ClassNameValue;
}) => {
  return (
    <Popover placement="bottom-start" openOnHover={true}>
      <PopoverTrigger asChild>
        <button
          className={twMerge(
            "p-2 border-primary-500 border-[1px] hover:bg-gray-200",
            className
          )}
        >
          <IconSettings className="w-8 h-8" />
        </button>
      </PopoverTrigger>

      <PopoverContent className="bg-white border-primary-500 border-[1px] p-4 w-48 outline-none focus:ring-0">
        <PopoverHeading className="font-medium mb-2">Settings</PopoverHeading>
        <ResetButton />
      </PopoverContent>
    </Popover>
  );
};
