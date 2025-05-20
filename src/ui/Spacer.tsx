import { ClassNameValue, twMerge } from "tailwind-merge";

export const Spacer = ({ className }: { className?: ClassNameValue }) => (
  <div
    className={twMerge(
      "w-full h-[1px] bg-primary-300 dark:bg-primary-600",
      className
    )}
  ></div>
);
