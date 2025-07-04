import { ReactNode } from "react";
import { ClassNameValue, twMerge } from "tailwind-merge";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";

export const SystemPanel = ({
  className,
  children,
  controls,
  title,
  help,
}: {
  className?: ClassNameValue;
  children?: ReactNode;
  controls?: ReactNode;
  title: string;
  help?: ReactNode;
}) => {
  return (
    <div
      className={twMerge(
        "w-full flex flex-col gap-2 border-1 border-primary-300 dark:border-primary-600",
        className
      )}
    >
      <div className={"pt-4 relative flex flex-col"}>
        <span className="absolute -top-2.5 left-1 bg-primary-200 dark:bg-primary-900 leading-none font-bold">
          {title}
        </span>

        {controls && (
          <div className="absolute -top-3.5 right-9 h-6 overflow-hidden flex items-center bg-primary-200 dark:bg-primary-900">
            {controls}
          </div>
        )}

        {help && (
          <Popover openOnHover={true} placement="bottom-end">
            <PopoverTrigger asChild>
              <span className="h-6 inline-flex items-center cursor-help absolute -top-3.5 right-2 px-1.5 py-1 bg-primary-200 dark:bg-primary-900 leading-none font-bold border-primary-500 border-1 text-xs">
                ?
              </span>
            </PopoverTrigger>

            <PopoverContent className="bg-primary-100 dark:bg-primary-800 text-primary-900 dark:text-primary-100 border-primary-500 border-[1px] p-2 py-1.5 max-w-72 outline-none focus:ring-0">
              <div className="flex flex-col gap-2 items-center justify-center text-sm">
                {help}
              </div>
            </PopoverContent>
          </Popover>
        )}

        {children}
      </div>
    </div>
  );
};
