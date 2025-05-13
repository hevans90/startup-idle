import { ClassNameValue, twMerge } from "tailwind-merge";

type ProgressBarProps = {
  value: number;
  min?: number;
  max?: number;
  className?: ClassNameValue;
};

export const ProgressBar = ({
  value,
  min = 0,
  max = 100,
  className,
}: ProgressBarProps) => {
  const percent = Math.min(
    100,
    Math.max(0, ((value - min) / (max - min)) * 100)
  );

  return (
    <div className={twMerge("w-full", className)}>
      <div className="relative w-full h-4 bg-primary-300 dark:bg-primary-700  overflow-hidden">
        <div
          className="h-full bg-primary-500 dark:bg-primary-400 transition-all duration-300 ease-in-out"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
};
