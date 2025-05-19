import { ReactNode } from "react";
import { ClassNameValue, twMerge } from "tailwind-merge";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";

export const SystemPanel = ({
  className,
  children,
  title,
  help,
}: {
  className?: ClassNameValue;
  children?: ReactNode;
  title: string;
  help?: ReactNode;
}) => {
  return (
    <div
      className={twMerge(
        "w-full flex flex-col gap-2 border-1 border-primary-500",
        className
      )}
    >
      <div className={"p-2 pt-8 pb-6 relative flex flex-col gap-4"}>
        <span className="absolute -top-2.5 bg-primary-200 dark:bg-primary-900 leading-none font-bold">
          {title}
        </span>

        {help && (
          <Popover openOnHover={true} placement="bottom-end">
            <PopoverTrigger asChild>
              <span className="cursor-help absolute -top-3.5 right-2 px-2 py-1 bg-primary-200 dark:bg-primary-900 leading-none font-bold border-primary-500 border-1">
                ?
              </span>
            </PopoverTrigger>

            <PopoverContent className="bg-primary-100 dark:bg-primary-800 text-primary-900 dark:text-primary-100 border-primary-500 border-[1px] p-2  outline-none focus:ring-0">
              <div className="flex flex-col gap-2 items-center justify-center">
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
